import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import type { ChildProcess } from "node:child_process";

import { ClaudeBridge, claudeArgs, type BridgeOutput } from "../src/bridge/claude-bridge.js";
import { AppServer, CodexBridge } from "../src/bridge/codex-bridge.js";
import { hostedTarget, page } from "../src/commands/bridge.js";

const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../tests/fixtures/timeline");
const STREAM = fs.readFileSync(path.join(FIX, "claude-stream-2.1.316.jsonl"), "utf8").split("\n").filter(Boolean);

/** A child process whose stdin the test reads and whose stdout the test writes. */
function fakeChild() {
  const child = new EventEmitter() as ChildProcess & EventEmitter;
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  Object.assign(child, { stdin, stdout, stderr: new PassThrough() });
  const written: Record<string, unknown>[] = [];
  let buf = "";
  stdin.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      written.push(JSON.parse(buf.slice(0, i)));
      buf = buf.slice(i + 1);
    }
  });
  stdin.on("finish", () => child.emit("exit", 0));
  return { child, stdout, written };
}

const tick = () => new Promise((r) => setTimeout(r, 10));

function claude() {
  const f = fakeChild();
  const out: BridgeOutput[] = [];
  let spawned: { cmd: string; args: string[]; env: Record<string, string> } | null = null;
  const b = new ClaudeBridge({
    key: "claude/work/s1",
    bin: "/bin/claude",
    configDir: "/cfg/work",
    cwd: "/work",
    sessionId: "s1",
    mode: "default",
    out: (o) => out.push(o),
    spawn: (cmd, args, opts) => ((spawned = { cmd, args, env: opts.env as Record<string, string> }), f.child),
  });
  b.start();
  return { b, f, out, spawned: () => spawned! };
}
const events = (out: BridgeOutput[]) => out.flatMap((o) => ("event" in o ? [o.event] : []));

test("claude args: the session's mode every time, resume, never a bypass", () => {
  assert.deepEqual(claudeArgs({ sessionId: "s1", mode: "acceptEdits", model: "opus" }).slice(-6), ["--permission-mode", "acceptEdits", "--resume", "s1", "--model", "opus"]);
  assert.ok(claudeArgs({ sessionId: null, mode: "default" }).includes("--permission-prompt-tool"));
  assert.ok(!claudeArgs({ sessionId: null, mode: "plan" }).includes("--resume"));
  assert.throws(() => claudeArgs({ sessionId: null, mode: "bypassPermissions" as never }), /not offered/);
  const fresh = claudeArgs({ sessionId: "s1", fresh: true, mode: "default" });
  assert.deepEqual(fresh.slice(-2), ["--session-id", "s1"], "a reserved id without a conversation starts under that id");
  assert.ok(!fresh.includes("--resume"));
});

test("claude bridge: the account's config dir, a turn with an approval answered as always-allow, events out", async () => {
  const { b, f, out, spawned } = claude();
  assert.equal(spawned().env.CLAUDE_CONFIG_DIR, "/cfg/work");
  assert.deepEqual(out[0], { bridge: "ready", key: "claude/work/s1", mode: "default" });
  b.command({ cmd: "send", text: "write hello.txt" });
  assert.deepEqual(f.written[0], { type: "user", message: { role: "user", content: "write hello.txt" } });
  assert.deepEqual(events(out).map((e) => e.t), ["turn", "message"], "the sent message shows at once");
  assert.equal((events(out)[1] as { text: string }).text, "write hello.txt");
  // The agent asks; nothing is answered until the user does.
  const upTo = STREAM.findIndex((l) => l.includes('"control_request"'));
  for (const l of STREAM.slice(0, upTo + 1)) f.stdout.write(l + "\n");
  await tick();
  const req = events(out).find((e) => e.t === "approval.requested") as { id: string };
  assert.ok(req);
  assert.deepEqual(b.openApprovals, [req.id]);
  assert.equal(f.written.length, 1, "no answer written by itself");
  b.command({ cmd: "approve", id: req.id, always: true });
  const resp = f.written[1] as { response: { request_id: string; response: { behavior: string; updatedPermissions?: unknown } } };
  assert.equal(resp.response.request_id, req.id);
  assert.equal(resp.response.response.behavior, "allow");
  const raw = JSON.parse(STREAM[upTo]);
  assert.deepEqual(resp.response.response.updatedPermissions, raw.request.permission_suggestions, "the rule the terminal would have offered");
  for (const l of STREAM.slice(upTo + 1)) f.stdout.write(l + "\n");
  await tick();
  assert.equal(events(out).at(-1)?.t, "turn.end");
  assert.ok(events(out).some((e) => e.t === "approval.resolved"));
});

test("claude bridge: names the session once, reports open approvals as they change", async () => {
  const f = fakeChild();
  const out: BridgeOutput[] = [];
  const sessions: string[] = [];
  const reported: string[][] = [];
  const b = new ClaudeBridge({ key: "claude/work/new", bin: "x", configDir: "/c", cwd: "/w", sessionId: null, mode: "default", out: (o) => out.push(o), spawn: () => f.child, onSession: (id) => sessions.push(id), onApprovals: (a) => reported.push(a.map((x) => `${x.id}:${x.tool}:${x.summary}`)) });
  b.start();
  const init = { type: "system", subtype: "init", session_id: "abc-123", model: "claude-haiku-5-5", permissionMode: "default", slash_commands: ["compact", 7, "review"] };
  f.stdout.write(JSON.stringify(init) + "\n" + JSON.stringify(init) + "\n");
  await tick();
  assert.deepEqual(out.filter((o) => "bridge" in o && o.bridge === "session"), [{ bridge: "session", key: "claude/work/abc-123", model: "claude-haiku-5-5", mode: "default", commands: ["compact", "review"] }], "once, with the real id");
  assert.deepEqual(sessions, ["abc-123"]);
  f.stdout.write(JSON.stringify({ type: "control_request", request_id: "r1", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "ls" } } }) + "\n");
  await tick();
  b.command({ cmd: "deny", id: "r1" });
  f.stdout.write(JSON.stringify({ type: "control_request", request_id: "r2", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "pwd" } } }) + "\n");
  await tick();
  b.command({ cmd: "interrupt" });
  assert.deepEqual(reported, [["r1:Bash:ls"], [], ["r2:Bash:pwd"], []], "an interrupt drops the open request too");
});

test("claude bridge: a message typed during a turn waits for the turn to end; interrupt clears the queue", async () => {
  const { b, f, out } = claude();
  b.command({ cmd: "send", text: "first" });
  b.command({ cmd: "send", text: "second" });
  assert.equal(f.written.length, 1, "the second waits");
  assert.deepEqual(out.at(-1), { bridge: "queued", count: 1 });
  f.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false }) + "\n");
  await tick();
  assert.equal((f.written[1] as { message: { content: string } }).message.content, "second");
  b.command({ cmd: "send", text: "third" });
  assert.equal(b.queued, 1);
  b.command({ cmd: "interrupt" });
  assert.equal(b.queued, 0);
  assert.deepEqual((f.written.at(-1) as { request: unknown }).request, { subtype: "interrupt" });
});

test("claude bridge: a question arrives as a form and is answered with the chosen options", async () => {
  const { b, f, out } = claude();
  f.stdout.write(JSON.stringify({ type: "control_request", request_id: "q1", request: { subtype: "can_use_tool", tool_name: "AskUserQuestion", input: { questions: [{ question: "Colour?", options: [{ label: "Red" }, { label: "Blue" }] }] } } }) + "\n");
  await tick();
  assert.deepEqual(events(out).at(-1), { t: "question.requested", id: "q1", questions: [{ question: "Colour?", options: ["Red", "Blue"] }] });
  b.command({ cmd: "answer", id: "q1", answers: { "Colour?": "Blue" } });
  const resp = f.written.at(-1) as { response: { response: { behavior: string; updatedInput: { answers: unknown } } } };
  assert.equal(resp.response.response.behavior, "allow");
  assert.deepEqual(resp.response.response.updatedInput.answers, { "Colour?": "Blue" });
  b.command({ cmd: "answer", id: "q1", answers: {} });
  assert.deepEqual(out.at(-1), { bridge: "error", message: "no open question q1" });
});

test("claude bridge: deny, unknown approvals, modes and images", async () => {
  const { b, f, out } = claude();
  f.stdout.write(JSON.stringify({ type: "control_request", request_id: "r1", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "rm -rf x" } } }) + "\n");
  await tick();
  b.command({ cmd: "deny", id: "r1" });
  assert.deepEqual((f.written.at(-1) as { response: { response: unknown } }).response.response, { behavior: "deny", message: "Denied in Agent Switch" });
  b.command({ cmd: "approve", id: "r1" });
  assert.deepEqual(out.at(-1), { bridge: "error", message: "no open approval r1" });
  b.command({ cmd: "set-mode", mode: "bypassPermissions" as never });
  assert.match((out.at(-1) as { message: string }).message, /not offered/);
  b.command({ cmd: "set-mode", mode: "plan" });
  assert.deepEqual((f.written.at(-1) as { request: unknown }).request, { subtype: "set_permission_mode", mode: "plan" });
  b.command({ cmd: "review", target: "uncommitted" });
  assert.match((out.at(-1) as { message: string }).message, /no review command/);
  b.command({ cmd: "set-model", model: "sonnet" });
  assert.deepEqual((f.written.at(-1) as { request: unknown }).request, { subtype: "set_model", model: "sonnet" });
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");
  assert.deepEqual(ClaudeBridge.content("look", [{ image: { mediaType: "image/png", data: png } }]), [
    { type: "text", text: "look" },
    { type: "image", source: { type: "base64", media_type: "image/png", data: png } },
  ]);
  b.command({ cmd: "send", text: "x", attachments: [{ image: { mediaType: "image/png", data: Buffer.from("nope").toString("base64") } }] });
  assert.match((out.at(-1) as { message: string }).message, /not an image/, "a refused attachment is an error, not a crash");
  f.stdout.write("{broken\n");
  await tick();
  assert.deepEqual(events(out).at(-1), { t: "unknown", kind: "unparsable" });
  b.command({ cmd: "close" });
  await tick();
  assert.deepEqual(out.at(-1), { bridge: "exit", code: 0 });
});

/** A scripted codex app-server: answers requests, sends notifications. */
function codex(thread: unknown) {
  const f = fakeChild();
  const server = new AppServer(f.child);
  const reply = (id: unknown, result: unknown) => f.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
  const note = (method: string, params: unknown) => f.stdout.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  const ask = (id: number, method: string, params: unknown) => f.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  const answered = () => f.written.filter((w) => w.result !== undefined);
  // Kept referenced (not unref'd): on Node ≤ 22 an unref'd poll lets the event loop
  // drain while a test still awaits the server's reply. `stop()` ends it.
  const poll = setInterval(() => {
    for (const w of f.written.splice(0)) {
      if (w.result !== undefined) (f as unknown as { answers: unknown[] }).answers.push(w);
      else if (w.method === "initialize") reply(w.id, {});
      else if (w.method === "thread/read") reply(w.id, thread);
      else if (w.method === "thread/resume") reply(w.id, { thread: { id: "thr_1" } });
      else if (w.method === "turn/start") reply(w.id, { turn: { id: "turn_9" } });
      else if (w.method === "turn/interrupt") reply(w.id, {});
      else if (w.method && w.id !== undefined) (f as unknown as { calls: unknown[] }).calls.push(w);
    }
  }, 2);
  Object.assign(f, { answers: [], calls: [] });
  return { f, server, note, ask, answered, stop: () => clearInterval(poll), answers: () => (f as unknown as { answers: { id: unknown; result: unknown }[] }).answers, calls: () => (f as unknown as { calls: { method: string }[] }).calls };
}

test("codex bridge: history from thread/read, a turn with an approval, the queue", async (t) => {
  const thread = JSON.parse(fs.readFileSync(path.join(FIX, "codex-thread-0.166.0.json"), "utf8"));
  const c = codex(thread);
  t.after(c.stop);
  const out: BridgeOutput[] = [];
  const b = new CodexBridge({ key: "codex/w/thr_1", threadId: "thr_1", cwd: "/work", server: c.server, out: (o) => out.push(o) });
  await b.start();
  assert.deepEqual(out.at(-1), { bridge: "ready", key: "codex/w/thr_1", mode: "default" });
  assert.equal(events(out).filter((e) => e.t === "turn").length, 2, "history first");
  b.command({ cmd: "send", text: "go" });
  await tick();
  b.command({ cmd: "send", text: "later" });
  assert.deepEqual(out.at(-1), { bridge: "queued", count: 1 });
  c.ask(77, "item/commandExecution/requestApproval", { itemId: "it1", command: "npm test", threadId: "thr_1", turnId: "turn_9" });
  await tick();
  assert.deepEqual(b.openApprovals, ["it1"]);
  b.command({ cmd: "approve", id: "it1", always: true });
  await tick();
  assert.deepEqual(c.answers()[0], { jsonrpc: "2.0", id: 77, result: { decision: "acceptForSession" } });
  c.note("item/agentMessage/delta", { itemId: "m1", delta: "Ru" });
  c.note("item/completed", { item: { type: "agentMessage", id: "m1", text: "Ran." } });
  c.note("turn/completed", { turn: { id: "turn_9", status: "completed" } });
  await tick();
  const tail = events(out).slice(-6).map((e) => e.t);
  assert.deepEqual(tail, ["approval.resolved", "message.delta", "message", "turn.end", "turn", "message"], "then the queued message goes out");
  assert.equal((events(out).at(-1) as { text: string }).text, "later");
  await tick();
  assert.ok(c.calls().length === 0, "no unexpected calls");
  assert.deepEqual(out.at(-1), { bridge: "queued", count: 0 }, "the queued message went out after the turn");
  b.command({ cmd: "review", target: "uncommitted" });
  b.command({ cmd: "review", target: { baseBranch: "main" } });
  await tick();
  assert.deepEqual(c.calls().map((x) => [x.method, (x as unknown as { params: { target: unknown } }).params.target]), [["review/start", { type: "uncommittedChanges" }], ["review/start", { type: "baseBranch", branch: "main" }]]);
  c.calls().length = 0;
  c.ask(78, "item/tool/requestUserInput", {});
  await tick();
  assert.deepEqual(events(out).at(-1), { t: "unknown", kind: "codex-request:item/tool/requestUserInput" });
  b.command({ cmd: "deny", id: "nope" });
  assert.deepEqual(out.at(-1), { bridge: "error", message: "no open approval nope" });
});

test("timeline paging: newest last, before an index", () => {
  const ev = Array.from({ length: 450 }, (_, i) => ({ t: "unknown" as const, kind: String(i) }));
  const last = page(ev);
  assert.deepEqual([last.from, last.events.length, last.total, (last.events[0] as { kind: string }).kind], [250, 200, 450, "250"]);
  const prev = page(ev, 200, last.from);
  assert.deepEqual([prev.from, prev.events.length], [50, 200]);
  assert.deepEqual(page(ev, 200, 30).events.length, 30);
  assert.deepEqual(page([], 10).events, []);
});

test("hostedTarget: a hosted Claude session from the host registry, nothing else", () => {
  const hosted = [
    { key: "claude/work/s1", provider: "claude", account: "work", sessionId: "s1", cwd: "/w" },
    { key: "codex/me/t1", provider: "codex", account: "me", sessionId: "t1", cwd: "/c" },
  ];
  assert.deepEqual(hostedTarget("claude/work/s1", hosted), { key: "claude/work/s1", provider: "claude", account: "work", sessionId: "s1", cwd: "/w", transcript: null });
  assert.equal(hostedTarget("codex/me/t1", hosted), null);
  assert.equal(hostedTarget("claude/work/s2", hosted), null);
});
