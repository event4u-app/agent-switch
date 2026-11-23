import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { claudeState, compareVersions, fromClaudeLine, readClaudeTranscript } from "../src/timeline/claude.js";
import { drawsRow, page } from "../src/commands/bridge.js";
import { countHunks, parseUnifiedDiff, toolSummary, type AsEvent } from "../src/timeline/events.js";

const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../tests/fixtures/timeline");
const kinds = (es: AsEvent[]) => es.map((e) => e.t);

test("transcript 2.1.316: turns, tools with their results, the edit as a diff, the subagent", () => {
  const { events, version, newerThanFixtures } = readClaudeTranscript(path.join(FIX, "claude-2.1.316.jsonl"));
  assert.equal(version, "2.1.316");
  assert.equal(newerThanFixtures, false);
  const turns = events.filter((e) => e.t === "turn");
  assert.equal(turns.length, 2, "two prompts, two turns");
  const started = events.filter((e): e is Extract<AsEvent, { t: "tool.started" }> => e.t === "tool.started");
  assert.deepEqual(started.map((e) => e.name), ["Write", "Read", "Edit", "Bash", "Agent"]);
  const finished = new Set(events.filter((e) => e.t === "tool.finished").map((e) => (e as { id: string }).id));
  for (const s of started) assert.ok(finished.has(s.id), `${s.name} has its result`);
  const diffs = events.filter((e): e is Extract<AsEvent, { t: "diff" }> => e.t === "diff");
  const edit = diffs.find((d) => d.path.endsWith("notes.md") && d.removed > 0)!;
  assert.ok(edit, "the Edit became a diff with a removed line");
  assert.ok(edit.hunks[0].lines.some((l) => l === "-alpha") && edit.hunks[0].lines.some((l) => l === "+beta"));
  assert.deepEqual(
    events.filter((e) => e.t === "subagent.started" || e.t === "subagent.finished").map((e) => e.t),
    ["subagent.started", "subagent.finished"],
  );
  const bash = started.find((s) => s.name === "Bash")!;
  assert.equal(bash.summary, "wc -l notes.md");
  // Bookkeeping lines are passed through as unknown, never dropped.
  const unknown = events.filter((e) => e.t === "unknown").map((e) => (e as { kind: string }).kind);
  assert.ok(unknown.includes("api-request-blob") && unknown.includes("attachment"));
  assert.equal(events.filter((e) => e.t === "message" && e.role === "assistant").length, 2);
});

test("stream 2.1.316: deltas carry the live message id, the approval request, limits and the turn end", () => {
  const st = claudeState();
  const events = fs
    .readFileSync(path.join(FIX, "claude-stream-2.1.316.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((l) => fromClaudeLine(JSON.parse(l), st));
  const deltas = events.filter((e): e is Extract<AsEvent, { t: "message.delta" }> => e.t === "message.delta");
  assert.ok(deltas.length > 0);
  assert.ok(deltas.every((d) => /^msg_[A-Za-z0-9]+:\d+$/.test(d.id)), "delta ids name the message and the block");
  const approval = events.find((e): e is Extract<AsEvent, { t: "approval.requested" }> => e.t === "approval.requested")!;
  assert.equal(approval.tool, "Write");
  assert.match(approval.summary, /hello\.txt$/);
  assert.ok(approval.id.length > 0);
  const limits = events.find((e) => e.t === "limits")!;
  assert.deepEqual(limits, { t: "limits", status: "allowed", resetsAt: new Date(1794034800 * 1000).toISOString() });
  const diff = events.find((e): e is Extract<AsEvent, { t: "diff" }> => e.t === "diff")!;
  assert.deepEqual([diff.path.endsWith("hello.txt"), diff.added, diff.removed, diff.hunks[0].lines], [true, 1, 0, ["+hi"]], "the stream's tool_use_result gives the diff too");
  const end = events.at(-1)!;
  assert.equal(end.t, "turn.end");
  assert.equal((end as { ok: boolean }).ok, true);
  assert.ok(kinds(events).indexOf("approval.requested") < kinds(events).indexOf("turn.end"));
});

test("a failed turn says why before it ends; unknown control requests and odd lines pass through", () => {
  const st = claudeState();
  assert.deepEqual(fromClaudeLine({ type: "result", subtype: "error_max_turns", is_error: true, duration_ms: 5, total_cost_usd: 0 }, st), [
    { t: "error", message: "error_max_turns" },
    { t: "turn.end", ok: false, durationMs: 5, costUsd: 0 },
  ]);
  assert.deepEqual(fromClaudeLine({ type: "control_request", request_id: "r", request: { subtype: "hook_callback" } }, st), [{ t: "unknown", kind: "control_request:hook_callback" }]);
  assert.deepEqual(fromClaudeLine({ type: "weird" }, st), [{ t: "unknown", kind: "weird" }]);
  assert.deepEqual(fromClaudeLine({ type: "assistant", message: { id: "m", content: [{ type: "server_tool_use" }] } }, st), [{ t: "unknown", kind: "assistant:server_tool_use" }]);
  assert.deepEqual(fromClaudeLine(null, st), [{ t: "unknown", kind: "line" }]);
  assert.deepEqual(fromClaudeLine({ type: "user", isSidechain: true, message: { content: "x" } }, st), [], "a subagent's own lines live in its own file");
});

test("lines Claude writes in the user role are not prompts", () => {
  const st = claudeState();
  assert.deepEqual(fromClaudeLine({ type: "user", message: { content: "<local-command-stdout>Set model to `sonnet`</local-command-stdout>" } }, st), [{ t: "unknown", kind: "local-command" }]);
  assert.deepEqual(fromClaudeLine({ type: "user", message: { content: [{ type: "text", text: "[Request interrupted by user]" }] } }, st), [{ t: "unknown", kind: "interrupted" }]);
  assert.deepEqual(fromClaudeLine({ type: "user", message: { content: "<command-name>/model</command-name>" } }, st), [{ t: "unknown", kind: "local-command" }]);
  assert.equal(fromClaudeLine({ type: "user", message: { content: "please explain <local-command-stdout> tags" } }, st)[0].t, "turn", "only a line that starts with it");
});

test("lines Claude Code injects (task notifications, the compaction summary) are notices, not prompts", () => {
  const { events } = readClaudeTranscript(path.join(FIX, "claude-injected-2.1.316.jsonl"));
  const prompts = events.filter((e) => e.t === "message" && e.role === "user").map((e) => (e as { text: string }).text);
  assert.deepEqual(prompts, ["Run the audit in the background and tell me when it is done.", "Thanks. Now write the release notes.", "# Council question: is this sent by the bridge?"], "a bridge's sdk prompt stays a prompt");
  assert.deepEqual(
    events.filter((e) => e.t === "notice"),
    [
      { t: "notice", id: "u2", kind: "task", text: 'Agent "Audit the repo" finished' },
      { t: "notice", id: "u3", kind: "task", text: "Background task completed" },
      { t: "notice", id: "u4", kind: "compacted", text: "Conversation compacted here" },
    ],
  );
  // The agent answers a notification in a turn of its own, so its reply is not folded into the previous turn.
  assert.equal(events[events.findIndex((e) => e.t === "notice" && e.id === "u2") - 1]?.t, "turn");
  assert.notEqual(events[events.findIndex((e) => e.t === "notice" && e.id === "u4") - 1]?.t, "turn", "a compaction starts no turn");
});

test("page: injected lines are not earlier prompts", () => {
  const { events } = readClaudeTranscript(path.join(FIX, "claude-injected-2.1.316.jsonl"));
  const p = page(events, 1);
  assert.equal(p.earlierPrompts, 2, "two typed prompts before the last row, never the notifications or the summary");
  assert.equal(drawsRow({ t: "notice", id: "n", kind: "task", text: "x" }), true, "a notice is a row of its own");
});

test("a transcript's turn_duration line ends the turn", () => {
  assert.deepEqual(fromClaudeLine({ type: "system", subtype: "turn_duration", durationMs: 4200 }, claudeState()), [{ t: "turn.end", ok: true, durationMs: 4200, costUsd: null }]);
});

test("questions and plans become their own events", () => {
  const st = claudeState();
  const q = fromClaudeLine({ type: "assistant", message: { id: "m1", content: [{ type: "tool_use", id: "t1", name: "AskUserQuestion", input: { questions: [{ question: "Which DB?", options: [{ label: "SQLite" }, { label: "Postgres" }] }] } }] } }, st);
  assert.deepEqual(q.at(-1), { t: "question.requested", id: "t1", questions: [{ question: "Which DB?", options: ["SQLite", "Postgres"] }] });
  const p = fromClaudeLine({ type: "assistant", message: { id: "m2", content: [{ type: "tool_use", id: "t2", name: "ExitPlanMode", input: { plan: "1. do it" } }] } }, st);
  assert.deepEqual(p.at(-1), { t: "plan", id: "t2", text: "1. do it" });
});

test("a transcript newer than every fixture is flagged; unparsable lines are kept as unknown", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asw-tl-"));
  const f = path.join(dir, "t.jsonl");
  fs.writeFileSync(f, JSON.stringify({ type: "user", version: "9.0.0", uuid: "u", message: { content: "hi" } }) + "\n{not json\n");
  const r = readClaudeTranscript(f);
  assert.equal(r.newerThanFixtures, true);
  assert.deepEqual(kinds(r.events), ["turn", "message", "unknown"]);
});

test("helpers: version compare, unified diff, tool summaries", () => {
  assert.equal(compareVersions("2.1.316", "2.1.40"), 1);
  assert.equal(compareVersions("2.1", "2.1.0"), 0);
  assert.equal(compareVersions("1.9.9", "2.0.0"), -1);
  const hunks = parseUnifiedDiff("--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n@@ -10 +10,2 @@\n+d\n");
  assert.deepEqual(hunks.map((h) => [h.oldStart, h.newStart, h.lines.length]), [[1, 1, 3], [10, 10, 1]]);
  assert.deepEqual(countHunks(hunks), { added: 2, removed: 1 });
  assert.equal(toolSummary("Grep", { pattern: "foo", path: "src" }), "foo in src");
  assert.equal(toolSummary("Bash", { command: "x".repeat(100) }).length, 80);
  assert.equal(toolSummary("mcp__thing", { query: "q", n: 3 }), "q");
});

test("a live question: the control request names the tool call it answers; multi-select is carried", () => {
  const st = claudeState();
  const q = { questions: [{ question: "Which?", multiSelect: true, options: [{ label: "A", description: "first" }, { label: "B" }] }] };
  const fromTool = fromClaudeLine({ type: "assistant", message: { id: "m1", content: [{ type: "tool_use", id: "toolu_Q", name: "AskUserQuestion", input: q }] } }, st);
  assert.deepEqual(fromTool.find((e) => e.t === "question.requested"), { t: "question.requested", id: "toolu_Q", questions: [{ question: "Which?", options: ["A", "B"], multiSelect: true }] });
  const fromReq = fromClaudeLine({ type: "control_request", request_id: "req-1", request: { subtype: "can_use_tool", tool_name: "AskUserQuestion", input: q, tool_use_id: "toolu_Q" } }, st);
  assert.deepEqual(fromReq, [{ t: "question.requested", id: "req-1", toolId: "toolu_Q", questions: [{ question: "Which?", options: ["A", "B"], multiSelect: true }] }]);
});

test("the answer to a question in the transcript resolves it, with the answers it carried", () => {
  const st = claudeState();
  fromClaudeLine({ type: "assistant", message: { id: "m1", content: [{ type: "tool_use", id: "toolu_Q", name: "AskUserQuestion", input: { questions: [{ question: "Colour?", options: [{ label: "Red" }] }] } }] } }, st);
  const ok = fromClaudeLine({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_Q", content: "User has answered" }] }, toolUseResult: { answers: { "Colour?": "Red" } } }, st);
  assert.deepEqual(ok.find((e) => e.t === "question.resolved"), { t: "question.resolved", id: "toolu_Q", answers: { "Colour?": "Red" } });
  fromClaudeLine({ type: "assistant", message: { id: "m2", content: [{ type: "tool_use", id: "toolu_R", name: "AskUserQuestion", input: { questions: [] } }] } }, st);
  const no = fromClaudeLine({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_R", is_error: true, content: "declined" }] } }, st);
  assert.deepEqual(no.find((e) => e.t === "question.resolved"), { t: "question.resolved", id: "toolu_R", answers: null });
});

test("an approval names the rule \"Always allow\" would add, from Claude's own suggestion", () => {
  const ask = (permission_suggestions?: unknown) =>
    fromClaudeLine({ type: "control_request", request_id: "r", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "npx vitest run" }, ...(permission_suggestions ? { permission_suggestions } : {}) } }, claudeState())[0] as Extract<AsEvent, { t: "approval.requested" }>;
  assert.equal(ask([{ type: "addRules", rules: [{ toolName: "Bash", ruleContent: "npx vitest:*" }], behavior: "allow", destination: "localSettings" }]).rule, "allow Bash(npx vitest:*) in this project");
  assert.equal(ask([{ type: "setMode", mode: "acceptEdits", destination: "session" }]).rule, "accept edits for this session");
  assert.equal(ask([{ type: "addDirectories", directories: ["/x"], destination: "session" }]).rule, "allow access to /x for this session");
  assert.equal(ask().rule, undefined, "no suggestion, no rule");
  assert.equal(ask([]).rule, undefined);
});
