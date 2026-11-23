/**
 * 7.7: what a subagent is doing. Reading subagent files reverses the
 * "content is never read" choice in src/lineage.ts; these tests pin how far
 * the reversal goes — a plain agent id, a bounded tail, the first line of a
 * description, never the prompt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import fsDefault from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import * as os from "node:os";
import * as path from "node:path";

import { spawnSync } from "node:child_process";

import { readConfined, readTail, sessionFolder, subagentDir, subagentFacts, subagentsFromFiles, subagentTranscript, taskDescriptions } from "../src/lineage.js";
import { childrenOf } from "../src/hooks.js";
import { readSubagentTimeline } from "../src/commands/bridge.js";

const SID = "3c87a281-1424-4ebf-965d-7ee64ed28e82";
const line = (o: unknown) => JSON.stringify(o) + "\n";
const taskUse = (id: string, description: string) => line({ type: "assistant", message: { id: `m-${id}`, content: [{ type: "tool_use", id, name: "Agent", input: { subagent_type: "general-purpose", description, prompt: "secret prompt text" } }] } });
const taskResult = (id: string, agentId: string) => line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: "done" }] }, toolUseResult: { agentId, status: "completed" } });
const toolUse = (id: string, name: string, input: unknown) => line({ type: "assistant", message: { id: `m-${id}`, content: [{ type: "tool_use", id, name, input }] } });
const toolResult = (id: string) => line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] } });

function fixture(): { dir: string; transcript: string } {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), "asw-sub-"));
  const proj = path.join(cfg, "projects", "-repo");
  const dir = path.join(proj, SID, "subagents");
  fs.mkdirSync(dir, { recursive: true });
  return { dir, transcript: path.join(proj, `${SID}.jsonl`) };
}

test("taskDescriptions: a Task call's description, by its tool-use id and by the agent id its result names", () => {
  const t = taskUse("tu1", "Fix 7.2 take over") + taskResult("tu1", "a1") + taskUse("tu2", "Arena r1: owner requirements\nsecond line") + "not json\n";
  const d = taskDescriptions(t);
  assert.equal(d.byAgent.get("a1"), "Fix 7.2 take over");
  assert.equal(d.byToolUse.get("tu2"), "Arena r1: owner requirements", "first line only");
  assert.equal(d.byAgent.size, 1, "a running Task has no agent id yet");
  assert.ok(![...d.byToolUse.values()].some((v) => v.includes("secret")), "the prompt is never kept");
});

test("subagentFacts: description from the meta file, else joined to the parent's Task call; the tool it runs now", () => {
  const { dir, transcript } = fixture();
  fs.writeFileSync(path.join(dir, "agent-a1.meta.json"), JSON.stringify({ agentType: "general-purpose", description: "Fix 7.2 take over", toolUseId: "tu1" }));
  fs.writeFileSync(path.join(dir, "agent-a1.jsonl"), line({ type: "user", message: { role: "user", content: "the prompt" } }) + toolUse("x1", "Read", { file_path: "/repo/a.ts" }) + toolResult("x1") + toolUse("x2", "Bash", { command: "npm test", description: "Run tests" }));
  // A meta file without a description (an older host): its toolUseId joins the parent's Task call.
  fs.writeFileSync(path.join(dir, "agent-a2.meta.json"), JSON.stringify({ agentType: "Explore", toolUseId: "tu2" }));
  fs.writeFileSync(path.join(dir, "agent-a2.jsonl"), toolUse("y1", "Grep", { pattern: "x" }) + toolResult("y1"));
  fs.writeFileSync(transcript, taskUse("tu1", "ignored: the meta file wins") + taskUse("tu2", "Map the schema") + taskUse("tu3", "Third") + taskResult("tu3", "a3"));
  const facts = subagentFacts(transcript, ["a1", "a2", "a3", "missing"]);
  assert.equal(facts.get("a1")?.description, "Fix 7.2 take over");
  assert.match(facts.get("a1")?.doing ?? "", /^Bash/);
  assert.deepEqual(facts.get("a2"), { description: "Map the schema" }, "every tool finished: nothing running");
  assert.deepEqual(facts.get("a3"), { description: "Third" }, "no meta file: the agent id its Task result names");
  assert.equal(facts.has("missing"), false);
});

test("subagentFacts: an agent id that is not a plain name reads nothing; the parent is not read when meta files name every task", () => {
  const { dir, transcript } = fixture();
  fs.writeFileSync(path.join(path.dirname(dir), "agent-evil.meta.json"), JSON.stringify({ description: "outside" }));
  fs.writeFileSync(path.join(dir, "agent-a1.meta.json"), JSON.stringify({ description: "From meta" }));
  fs.writeFileSync(transcript, taskUse("tu9", "should not be read"));
  fs.chmodSync(transcript, 0o000);
  const evil = "x/../../agent-evil"; // lexically: the folder above subagents/
  const facts = subagentFacts(transcript, [evil, "a1"]);
  assert.equal(facts.has(evil), false);
  assert.deepEqual(facts.get("a1"), { description: "From meta" });
});

test("readTail: bounded — only the last bytes, starting at a whole line", () => {
  const { dir } = fixture();
  const f = path.join(dir, "big.jsonl");
  fs.writeFileSync(f, line({ n: "head-" + "x".repeat(4000) }) + line({ n: "tail" }));
  assert.equal(readTail(f, 100), line({ n: "tail" }));
  assert.ok(readTail(f, 1 << 20).startsWith('{"n":"head-'));
  assert.equal(readTail(path.join(dir, "none"), 100), "");
});

test("subagentFacts: a tool call only in the head of a long transcript is outside the bounded read", () => {
  const { dir, transcript } = fixture();
  fs.writeFileSync(transcript, "");
  fs.writeFileSync(path.join(dir, "agent-a1.jsonl"), toolUse("x1", "Bash", { command: "early" }) + line({ pad: "p".repeat(300_000) }));
  assert.equal(subagentFacts(transcript, ["a1"]).get("a1")?.doing, undefined);
});

test("subagentDir / subagentTranscript: next to the session's transcript; only a plain agent id", () => {
  assert.equal(subagentDir(`/c/projects/-repo/${SID}.jsonl`), path.join("/c/projects/-repo", SID, "subagents"));
  assert.equal(subagentTranscript(`/c/projects/-repo/${SID}.jsonl`, "a1b2"), path.join("/c/projects/-repo", SID, "subagents", "agent-a1b2.jsonl"));
  for (const bad of ["../x", "a/b", "", "a".repeat(200), "a b"]) assert.equal(subagentTranscript(`/c/projects/-repo/${SID}.jsonl`, bad), null, bad);
});

test("subagent timeline: the subagent's own transcript as events, bounded, refused for an id that is not plain", () => {
  const { dir, transcript } = fixture();
  fs.writeFileSync(path.join(dir, "agent-a1.jsonl"), line({ pad: "p".repeat(5000) }) + toolUse("x2", "Bash", { command: "npm test" }));
  const all = readSubagentTimeline(transcript, "a1");
  assert.equal(all.truncated, false);
  assert.ok(all.events.some((e) => e.t === "tool.started" && e.name === "Bash"));
  const tail = readSubagentTimeline(transcript, "a1", 1000);
  assert.equal(tail.truncated, true, "the head beyond the bound is left out and said so");
  assert.ok(tail.events.some((e) => e.t === "tool.started"));
  assert.throws(() => readSubagentTimeline(transcript, "../a1"), /not a subagent id/);
  assert.throws(() => readSubagentTimeline(transcript, "nobody"), /no transcript/);
});

test("childrenOf: a subagent carries when it started and, once stopped, when it ended", () => {
  const ev = [
    { event: "SubagentStart", sessionId: "p", agentId: "a1", agentType: "Explore", at: "2026-11-02T10:00:00.000Z" },
    { event: "SubagentStart", sessionId: "p", agentId: "a2", agentType: "Explore", at: "2026-11-02T10:01:00.000Z" },
    { event: "SubagentStop", sessionId: "p", agentId: "a1", at: "2026-11-02T10:03:00.000Z" },
  ];
  const kids = childrenOf(ev, "p");
  assert.equal(kids[0].startedAt, "2026-11-02T10:00:00.000Z");
  assert.equal(kids[0].endedAt, "2026-11-02T10:03:00.000Z");
  assert.equal(kids[1].startedAt, "2026-11-02T10:01:00.000Z");
  assert.equal(kids[1].endedAt, undefined);
});

const sidechain = (o: Record<string, unknown>) => line({ isSidechain: true, agentId: "a1", ...o });

test("subagent timeline: a subagent's own lines are all sidechain lines, and they are its conversation", () => {
  const { dir, transcript } = fixture();
  fs.writeFileSync(
    path.join(dir, "agent-a1.jsonl"),
    sidechain({ type: "user", message: { role: "user", content: "map the schema" } }) + sidechain({ type: "assistant", message: { id: "m1", role: "assistant", content: [{ type: "text", text: "Mapped." }] } }),
  );
  const t = readSubagentTimeline(transcript, "a1");
  assert.ok(t.events.some((e) => e.t === "message" && e.role === "user" && e.text === "map the schema"));
  assert.ok(t.events.some((e) => e.t === "message" && e.text === "Mapped."));
});

/** A file outside the session folder, and links to it from inside `subagents/`. */
function outside(dir: string): string {
  const far = fs.mkdtempSync(path.join(os.tmpdir(), "asw-far-"));
  const secret = path.join(far, "secret.jsonl");
  fs.writeFileSync(secret, line({ type: "assistant", message: { id: "x", content: [{ type: "text", text: "outside the session" }] } }));
  fs.writeFileSync(path.join(far, "meta.json"), JSON.stringify({ description: "outside meta", agentType: "Explore", finished: true }));
  fs.symlinkSync(secret, path.join(dir, "agent-evil.jsonl"));
  fs.symlinkSync(path.join(far, "meta.json"), path.join(dir, "agent-evil.meta.json"));
  return far;
}

const linkGate = { skip: process.platform === "win32" ? "symlinks need privileges on Windows" : false };

test("confined reads: a symlink out of the session folder reads nothing — transcript and meta file alike", linkGate, () => {
  const { dir, transcript } = fixture();
  const far = outside(dir);
  const folder = sessionFolder(transcript)!;
  assert.equal(readConfined(folder, path.join(dir, "agent-evil.jsonl"), 1024), null);
  assert.equal(readConfined(folder, path.join(dir, "agent-evil.meta.json"), 1024), null);
  assert.throws(() => readSubagentTimeline(transcript, "evil"), /not a regular file inside this session's folder/);
  assert.equal(subagentFacts(transcript, ["evil"]).get("evil"), undefined, "the meta file outside is not read");
  const listed = subagentsFromFiles(transcript, true);
  assert.deepEqual([listed.children.length, listed.unreadable], [0, 1], "only counted");
  // A link that stays inside the session folder is followed.
  fs.writeFileSync(path.join(path.dirname(dir), "kept.jsonl"), line({ type: "assistant", isSidechain: true, message: { id: "k", content: [{ type: "text", text: "kept" }] } }));
  fs.symlinkSync(path.join(path.dirname(dir), "kept.jsonl"), path.join(dir, "agent-inside.jsonl"));
  assert.ok(readSubagentTimeline(transcript, "inside").events.some((e) => e.t === "message" && e.text === "kept"));
  // The subagents folder itself linked out of the session: nothing in it is read.
  const { dir: dir2, transcript: transcript2 } = fixture();
  fs.rmSync(dir2, { recursive: true });
  fs.symlinkSync(far, dir2);
  fs.copyFileSync(path.join(far, "secret.jsonl"), path.join(far, "agent-a1.jsonl"));
  assert.throws(() => readSubagentTimeline(transcript2, "a1"), /not a regular file inside/);
  assert.deepEqual(subagentsFromFiles(transcript2, true).children, []);
});

const fifoGate = { skip: process.platform === "win32" ? "no mkfifo on Windows" : false };

test("confined reads: a FIFO is never opened — no hang, nothing read, only counted", fifoGate, () => {
  const { dir, transcript } = fixture();
  assert.equal(spawnSync("mkfifo", [path.join(dir, "agent-pipe.jsonl")]).status, 0);
  assert.equal(spawnSync("mkfifo", [path.join(dir, "agent-a1.meta.json")]).status, 0);
  fs.writeFileSync(path.join(dir, "agent-a1.jsonl"), sidechain({ type: "user", message: { role: "user", content: "hi" } }));
  assert.equal(readConfined(sessionFolder(transcript)!, path.join(dir, "agent-pipe.jsonl"), 1024), null);
  assert.throws(() => readSubagentTimeline(transcript, "pipe"), /not a regular file/);
  const listed = subagentsFromFiles(transcript, false);
  assert.deepEqual(listed.children.map((c) => [c.agentId, c.type]), [["a1", undefined]], "a FIFO meta file is skipped, its transcript still lists");
  assert.equal(listed.unreadable, 1);
});

test("subagentsFromFiles: Claude Code's own files, without hooks — type, task, worktree, state from `finished`, file times", () => {
  const { dir, transcript } = fixture();
  fs.writeFileSync(path.join(dir, "agent-a1.meta.json"), JSON.stringify({ agentType: "general-purpose", description: "Phase 1: honest actions", toolUseId: "tu1", finished: true, worktreePath: "/repo/.claude/worktrees/agent-a1" }));
  fs.writeFileSync(path.join(dir, "agent-a1.jsonl"), sidechain({ type: "user", message: { role: "user", content: "go" } }));
  fs.writeFileSync(path.join(dir, "agent-a2.meta.json"), JSON.stringify({ agentType: "Explore", toolUseId: "tu2" }));
  fs.writeFileSync(path.join(dir, "agent-a2.jsonl"), toolUse("x1", "Grep", { pattern: "schema" }));
  fs.writeFileSync(path.join(dir, "agent-a3.jsonl"), "");
  fs.writeFileSync(path.join(dir, "notes.txt"), "");
  fs.writeFileSync(transcript, taskUse("tu2", "Map the schema"));
  const live = subagentsFromFiles(transcript, true);
  assert.equal(live.unreadable, 0);
  const [a1, a2, a3] = live.children;
  assert.deepEqual(
    { ...a1, startedAt: typeof a1.startedAt, endedAt: typeof a1.endedAt },
    { kind: "subagent", agentId: "a1", type: "general-purpose", state: "done", source: "files", cwd: "/repo/.claude/worktrees/agent-a1", toolUseId: "tu1", description: "Phase 1: honest actions", startedAt: "string", endedAt: "string" },
  );
  assert.deepEqual([a2.state, a2.type, a2.description, a2.doing, a2.endedAt], ["running", "Explore", "Map the schema", "Grep · schema", undefined], "no `finished`, parent live: running; its task from the parent's Task call by toolUseId");
  assert.deepEqual([a3.agentId, a3.type, a3.state], ["a3", undefined, "running"], "no meta file: listed, its type unknown");
  const idle = subagentsFromFiles(transcript, false);
  assert.deepEqual(idle.children.map((c) => c.state), ["done", "done", "done"], "a session that is not live runs no subagent");
  assert.deepEqual(subagentsFromFiles(transcript, true, new Set(["a1", "a3"])).children.map((c) => c.agentId), ["a2"], "ids the hooks reported are not listed twice");
});

/**
 * A directory of the path swapped for a link out of the session between the check and the open:
 * O_NOFOLLOW guards only the last component, so the open would follow the swapped directory.
 * `swap` runs just before the read's `open`; `back` (when set) just after it, before the read checks the file.
 */
function withSwap(target: string, swap: () => void, back: (() => void) | null, read: () => unknown): unknown {
  const real = { openSync: fsDefault.openSync, fstatSync: fsDefault.fstatSync };
  let opened = false;
  fsDefault.openSync = ((p: fs.PathLike, ...rest: unknown[]) => {
    if (!opened && String(p) === target) {
      opened = true;
      swap();
    }
    return (real.openSync as (...a: unknown[]) => number)(p, ...rest);
  }) as typeof fs.openSync;
  fsDefault.fstatSync = ((...a: unknown[]) => {
    const st = (real.fstatSync as (...x: unknown[]) => fs.Stats)(...a);
    if (opened && back) {
      back();
      back = null;
    }
    return st;
  }) as typeof fs.fstatSync;
  syncBuiltinESMExports();
  try {
    return read();
  } finally {
    Object.assign(fsDefault, real);
    syncBuiltinESMExports();
  }
}

test("confined reads: a directory swapped for a link out of the session after the check reads nothing", linkGate, () => {
  const { dir, transcript } = fixture();
  fs.writeFileSync(path.join(dir, "agent-a1.jsonl"), sidechain({ type: "user", message: { role: "user", content: "inside" } }));
  const far = fs.mkdtempSync(path.join(os.tmpdir(), "asw-far-"));
  fs.writeFileSync(path.join(far, "agent-a1.jsonl"), line({ type: "assistant", message: { id: "x", content: [{ type: "text", text: "outside the session" }] } }));
  const folder = sessionFolder(transcript)!;
  const subagents = path.join(folder, "subagents");
  const target = path.join(subagents, "agent-a1.jsonl");
  const aside = path.join(folder, "subagents-aside");
  const swap = () => {
    fs.renameSync(subagents, aside);
    fs.symlinkSync(far, subagents);
  };
  const restore = () => {
    fs.unlinkSync(subagents);
    fs.renameSync(aside, subagents);
  };
  // Swapped while the read runs.
  assert.equal(withSwap(target, swap, null, () => readConfined(folder, target, 1024)), null, "the link is seen on the walk");
  restore();
  // Swapped for the open and back before the read looks: the opened file is not the one the path names.
  assert.equal(withSwap(target, swap, restore, () => readConfined(folder, target, 1024)), null, "the opened file is compared with the path");
  assert.match(readConfined(folder, target, 1024)?.text ?? "", /inside/, "unswapped, the read works");
});
