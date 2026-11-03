import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";

import { AcpBridge, textDiff, toolName } from "../src/bridge/acp-bridge.js";
import type { BridgeOutput } from "../src/bridge/claude-bridge.js";
import { AppServer } from "../src/bridge/codex-bridge.js";
import type { AsEvent } from "../src/timeline/events.js";

type Json = Record<string, any>;

/** A scripted ACP agent: `on(method)` decides what it answers and what it streams. */
function fakeAgent(script: Record<string, (msg: Json, io: { reply: (r: Json) => void; error: (m: string) => void; notify: (u: Json) => void; ask: (m: string, p: Json) => Promise<Json> }) => void>) {
  const child = new EventEmitter() as ChildProcess & EventEmitter;
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  Object.assign(child, { stdin, stdout, stderr: new PassThrough() });
  const seen: Json[] = [];
  const asked = new Map<number, (r: Json) => void>();
  let reqId = 1000;
  let buf = "";
  const write = (m: Json) => stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
  stdin.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const m = JSON.parse(buf.slice(0, i)) as Json;
      buf = buf.slice(i + 1);
      seen.push(m);
      if (m.method === undefined && asked.has(m.id)) {
        asked.get(m.id)!(m);
        continue;
      }
      const h = script[m.method];
      if (!h) continue;
      h(m, {
        reply: (result) => write({ id: m.id, result }),
        error: (message) => write({ id: m.id, error: { code: -32000, message } }),
        notify: (update) => write({ method: "session/update", params: { sessionId: "s-1", update } }),
        ask: (method, params) => new Promise((r) => { const id = ++reqId; asked.set(id, r); write({ id, method, params }); }),
      });
    }
  });
  stdin.on("finish", () => child.emit("exit", 0));
  return { server: new AppServer(child), seen };
}

const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));
const events = (out: BridgeOutput[]) => out.flatMap((o) => ("event" in o ? [o.event] : []));
const INIT = { protocolVersion: 1, agentCapabilities: { loadSession: true } };

test("textDiff trims the shared head and tail into one hunk", () => {
  assert.deepEqual(textDiff("a\nb\nc", "a\nB\nc"), [{ oldStart: 2, newStart: 2, lines: ["-b", "+B"] }]);
  assert.deepEqual(textDiff("", "new"), [{ oldStart: 1, newStart: 1, lines: ["+new"] }]);
  assert.deepEqual(textDiff("same", "same"), []);
});

test("ACP tool kinds map onto the chat view's tool names", () => {
  assert.equal(toolName("edit", "x"), "Edit");
  assert.equal(toolName("execute", "x"), "Bash");
  assert.equal(toolName("other", "Custom thing"), "Custom thing");
});

test("a new session: one turn streams text, a tool with a diff, and ends", async () => {
  const { server, seen } = fakeAgent({
    initialize: (_m, io) => io.reply(INIT),
    "session/new": (_m, io) => io.reply({ sessionId: "s-1" }),
    "session/prompt": (_m, io) => {
      io.notify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hel" } });
      io.notify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "lo" } });
      io.notify({ sessionUpdate: "tool_call", toolCallId: "t1", title: "Edit a.txt", kind: "edit", status: "pending", locations: [{ path: "/w/a.txt" }] });
      io.notify({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed", content: [{ type: "diff", path: "/w/a.txt", oldText: "x", newText: "y" }] });
      io.notify({ sessionUpdate: "plan", entries: [{ content: "do it", status: "completed", priority: "high" }] });
      io.notify({ sessionUpdate: "something_new" });
      setTimeout(() => io.reply({ stopReason: "end_turn" }), 5);
    },
  });
  const out: BridgeOutput[] = [];
  let started = "";
  const b = new AcpBridge({ key: "acp/gemini/", sessionId: null, cwd: "/w", server, out: (o) => out.push(o), onSession: (s) => (started = s) });
  await b.start();
  assert.equal(started, "s-1");
  assert.ok(out.some((o) => "bridge" in o && o.bridge === "session" && o.key === "acp/gemini/s-1"));
  const init = seen.find((m) => m.method === "initialize")!;
  assert.deepEqual(init.params.clientCapabilities, { fs: { readTextFile: false, writeTextFile: false }, terminal: false });
  b.command({ cmd: "send", text: "hi" });
  await tick(40);
  const ev = events(out);
  const kinds = ev.map((e) => e.t);
  assert.deepEqual(kinds, ["turn", "message", "message.delta", "message.delta", "message", "tool.started", "diff", "tool.finished", "plan", "unknown", "turn.end"]);
  assert.deepEqual(ev.find((e): e is Extract<AsEvent, { t: "message" }> => e.t === "message" && e.role === "assistant")?.text, "Hello");
  assert.deepEqual(ev.find((e) => e.t === "diff"), { t: "diff", toolId: "t1", path: "/w/a.txt", added: 1, removed: 1, hunks: [{ oldStart: 1, newStart: 1, lines: ["-x", "+y"] }] });
  assert.deepEqual(ev.at(-1), { ...(ev.at(-1) as object), t: "turn.end", ok: true, costUsd: null });
});

test("a permission request waits for the user; deny picks the agent's reject option", async () => {
  let answer: Json | null = null;
  const { server } = fakeAgent({
    initialize: (_m, io) => io.reply(INIT),
    "session/new": (_m, io) => io.reply({ sessionId: "s-1" }),
    "session/prompt": async (_m, io) => {
      io.notify({ sessionUpdate: "tool_call", toolCallId: "t9", title: "rm -rf build", kind: "execute", status: "pending", rawInput: { command: "rm -rf build" } });
      answer = await io.ask("session/request_permission", {
        sessionId: "s-1",
        toolCall: { toolCallId: "t9", title: "rm -rf build", kind: "execute" },
        options: [{ optionId: "yes", name: "Allow", kind: "allow_once" }, { optionId: "always", name: "Always", kind: "allow_always" }, { optionId: "no", name: "Reject", kind: "reject_once" }],
      });
      io.reply({ stopReason: "end_turn" });
    },
  });
  const out: BridgeOutput[] = [];
  let open: string[] = [];
  const b = new AcpBridge({ key: "acp/goose/", sessionId: null, cwd: "/w", server, out: (o) => out.push(o), onApprovals: (o) => (open = o.map((x) => x.id)) });
  await b.start();
  b.command({ cmd: "send", text: "clean up" });
  await tick();
  assert.deepEqual(open, ["t9"]);
  assert.equal(answer, null, "nothing is answered without the user");
  const req = events(out).find((e) => e.t === "approval.requested");
  assert.deepEqual(req, { t: "approval.requested", id: "t9", tool: "Bash", summary: "rm -rf build", input: {} });
  b.command({ cmd: "deny", id: "t9" });
  await tick();
  assert.deepEqual(answer!.result, { outcome: { outcome: "selected", optionId: "no" } });
  assert.deepEqual(open, []);
});

test("always-allow prefers the agent's allow_always option", async () => {
  let answer: Json | null = null;
  const { server } = fakeAgent({
    initialize: (_m, io) => io.reply(INIT),
    "session/new": (_m, io) => io.reply({ sessionId: "s-1" }),
    "session/prompt": async (_m, io) => {
      answer = await io.ask("session/request_permission", { sessionId: "s-1", toolCall: { toolCallId: "t1", title: "ls" }, options: [{ optionId: "once", kind: "allow_once" }, { optionId: "always", kind: "allow_always" }] });
      io.reply({ stopReason: "end_turn" });
    },
  });
  const b = new AcpBridge({ key: "acp/x/", sessionId: null, cwd: "/w", server, out: () => {} });
  await b.start();
  b.command({ cmd: "send", text: "go" });
  await tick();
  b.command({ cmd: "approve", id: "t1", always: true });
  await tick();
  assert.equal(answer!.result.outcome.optionId, "always");
});

test("mode changes are refused: a client cannot loosen what the agent may do", async () => {
  const { server, seen } = fakeAgent({ initialize: (_m, io) => io.reply(INIT), "session/new": (_m, io) => io.reply({ sessionId: "s-1" }) });
  const out: BridgeOutput[] = [];
  const b = new AcpBridge({ key: "acp/x/", sessionId: null, cwd: "/w", server, out: (o) => out.push(o) });
  await b.start();
  b.command({ cmd: "set-mode", mode: "acceptEdits" });
  await tick();
  assert.ok(out.some((o) => "bridge" in o && o.bridge === "error" && /set-mode is not offered/.test(o.message)));
  assert.ok(!seen.some((m) => m.method === "session/set_mode"));
});

test("fs and terminal requests are refused with an error, never served", async () => {
  let reply: Json | null = null;
  const { server } = fakeAgent({
    initialize: (_m, io) => io.reply(INIT),
    "session/new": (_m, io) => io.reply({ sessionId: "s-1" }),
    "session/prompt": async (_m, io) => {
      reply = await io.ask("fs/read_text_file", { sessionId: "s-1", path: "/etc/passwd" });
      io.reply({ stopReason: "end_turn" });
    },
  });
  const b = new AcpBridge({ key: "acp/x/", sessionId: null, cwd: "/w", server, out: () => {} });
  await b.start();
  b.command({ cmd: "send", text: "go" });
  await tick(30);
  assert.equal(reply!.error.code, -32601);
  assert.equal(reply!.result, undefined);
});

test("load replays history as turns and messages; a session that cannot load says so", async () => {
  const { server } = fakeAgent({
    initialize: (_m, io) => io.reply(INIT),
    "session/load": (_m, io) => {
      io.notify({ sessionUpdate: "user_message_chunk", content: { type: "text", text: "fix it" } });
      io.notify({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "done" } });
      io.reply({});
    },
  });
  const out: BridgeOutput[] = [];
  const b = new AcpBridge({ key: "acp/gemini/s-1", sessionId: "s-1", cwd: "/w", server, out: (o) => out.push(o) });
  await b.start();
  assert.deepEqual(events(out).map((e) => e.t), ["turn", "message", "message"], "no deltas while replaying");

  const { server: s2 } = fakeAgent({ initialize: (_m, io) => io.reply({ protocolVersion: 1, agentCapabilities: {} }) });
  const b2 = new AcpBridge({ key: "acp/goose/s-1", sessionId: "s-1", cwd: "/w", server: s2, out: () => {} });
  await assert.rejects(b2.start(), /cannot load a session over ACP/);
});

test("interrupt sends session/cancel and closes open permissions as cancelled", async () => {
  let answer: Json | null = null;
  const { server, seen } = fakeAgent({
    initialize: (_m, io) => io.reply(INIT),
    "session/new": (_m, io) => io.reply({ sessionId: "s-1" }),
    "session/prompt": async (m, io) => {
      answer = await io.ask("session/request_permission", { sessionId: "s-1", toolCall: { toolCallId: "t1" }, options: [{ optionId: "y", kind: "allow_once" }] });
      io.reply({ stopReason: "cancelled" });
    },
  });
  const out: BridgeOutput[] = [];
  const b = new AcpBridge({ key: "acp/x/", sessionId: null, cwd: "/w", server, out: (o) => out.push(o) });
  await b.start();
  b.command({ cmd: "send", text: "go" });
  await tick();
  b.command({ cmd: "interrupt" });
  await tick();
  assert.ok(seen.some((m) => m.method === "session/cancel" && m.params.sessionId === "s-1"));
  assert.deepEqual(answer!.result, { outcome: { outcome: "cancelled" } });
  assert.equal((events(out).at(-1) as Extract<AsEvent, { t: "turn.end" }>).ok, false);
});

test("a message sent during a turn is queued and runs after it", async () => {
  let prompts = 0;
  const { server } = fakeAgent({
    initialize: (_m, io) => io.reply(INIT),
    "session/new": (_m, io) => io.reply({ sessionId: "s-1" }),
    "session/prompt": (_m, io) => (prompts++, setTimeout(() => io.reply({ stopReason: "end_turn" }), 10)),
  });
  const out: BridgeOutput[] = [];
  const b = new AcpBridge({ key: "acp/x/", sessionId: null, cwd: "/w", server, out: (o) => out.push(o) });
  await b.start();
  b.command({ cmd: "send", text: "one" });
  b.command({ cmd: "send", text: "two" });
  assert.ok(out.some((o) => "bridge" in o && o.bridge === "queued" && o.count === 1));
  await tick(60);
  assert.equal(prompts, 2);
});
