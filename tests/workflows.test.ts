import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { boundResult, journalCalls, readWorkflowRun, readWorkflows, scriptMeta, summarize, workflowAgentTranscript, workflowArgs } from "../src/workflows.js";
import { approachOf, decide, labelIds, parseBracket, phaseOf, rationaleOf, readBracket, total, toVerdict, type Scores } from "../src/bracket.js";
import { headlineOf, parseCouncil, parseDebate, readCouncils } from "../src/council-runs.js";
import { boardFields, namedBrackets, readOrchestration } from "../src/commands/workflows.js";

const SID = "e6bc8479-ccc5-4f97-a638-10877aeb96e4";
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "as-wf-"));
const line = (o: unknown) => JSON.stringify(o) + "\n";

/** A session transcript with one Workflow run on disk, the way Claude Code lays it out. */
function session(opts: { record?: boolean; resumed?: boolean } = {}) {
  const projects = tmp();
  const transcript = path.join(projects, `${SID}.jsonl`);
  const folder = path.join(projects, SID);
  const runId = "wf_436c2db1-76d";
  const agents = path.join(folder, "subagents", "workflows", runId);
  fs.mkdirSync(agents, { recursive: true });
  fs.mkdirSync(path.join(folder, "workflows", "scripts"), { recursive: true });
  const script = "export const meta = {\n  name: 'demo-judge',\n  description: 'Judge \\'two\\' matches',\n  phases: [{ title: 'Judge' }, { title: \"Report\" }],\n}\nconst x = await agent('…', { label: 'judge:R1M1' })\n";
  fs.writeFileSync(path.join(folder, "workflows", "scripts", `demo-judge-${runId}.js`), script);
  const verdict = { a: sc(8), b: sc(6), fatal: { a: "none", b: "none" }, pick: "a", checks: "a: tsc ok", critique: "b: MAJOR" };
  let journal = line({ type: "launched" });
  journal += line({ type: "started", key: "k1", agentId: "aaa1", label: "judge:R1M1", phase: "Judge" });
  journal += line({ type: "started", key: "k2", agentId: "aaa2", label: "judge:R1M2", phase: "Judge" });
  if (opts.resumed) {
    journal += line({ type: "launched" });
    journal += line({ type: "started", key: "k2", agentId: "bbb2", label: "judge:R1M2", phase: "Judge" });
  }
  journal += line({ type: "result", key: "k1", agentId: "aaa1", result: verdict });
  journal += '{"type":"res'; // a torn tail line, still being written
  fs.writeFileSync(path.join(agents, "journal.jsonl"), journal);
  for (const id of ["aaa1", "aaa2", "bbb2"]) {
    fs.writeFileSync(path.join(agents, `agent-${id}.jsonl`), line({ type: "assistant", message: { content: [{ type: "tool_use", id: `t-${id}`, name: "Bash", input: { command: "npm test" } }] } }));
    fs.writeFileSync(path.join(agents, `agent-${id}.meta.json`), JSON.stringify({ description: "ignored when the journal names it", workflowPhase: "Judge", model: "claude-opus-5-5" }));
  }
  if (opts.record) fs.writeFileSync(path.join(folder, "workflows", `${runId}.json`), JSON.stringify({ runId, status: "completed", workflowName: "demo-judge", phases: [{ title: "Judge" }], durationMs: 1234, totalTokens: 99, startTime: 1795525385251 }));
  const use = { type: "assistant", message: { content: [{ type: "tool_use", id: "w1", name: "Workflow", input: { scriptPath: `/x/demo-judge-${runId}.js`, resumeFromRunId: runId, args: JSON.stringify({ matches: [{ id: "R1M1", a: "L001", b: "L002" }] }) } }] } };
  fs.writeFileSync(transcript, line(use) + line({ type: "user", message: { content: "see agents/runtime/bracket/demo/bracket.json and agents/runtime/council/responses/c1.json" } }));
  return { projects, transcript, folder, runId, agents };
}

const sc = (n: number): Scores => ({ correctness: n, requirements: n, robustness: n, clarity: n, efficiency: n });

test("scriptMeta: name, description and phase titles from the meta literal, quotes unescaped, never evaluated", () => {
  assert.deepEqual(scriptMeta("export const meta = { name: 'x', description: \"it's\", phases: [{ title: 'A' }, { title: `B` }] }\nphases: [{ title: 'not meta' }]"), { name: "x", description: "it's", phases: ["A", "B"] });
  assert.deepEqual(scriptMeta("const meta = {}"), { phases: [] });
});

test("journalCalls: one call per key; a resume adds an attempt and moves to the new agent; torn lines are skipped", () => {
  const { calls, launches } = journalCalls(line({ type: "launched" }) + line({ type: "started", key: "k", agentId: "a1", label: "x" }) + line({ type: "launched" }) + line({ type: "started", key: "k", agentId: "a2" }) + line({ type: "result", key: "k", agentId: "a2", result: 1 }) + "{");
  assert.equal(launches, 2);
  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0].agentId, calls[0].attempts, calls[0].label, calls[0].hasResult, calls[0].result], ["a2", 2, "x", true, 1]);
});

test("readWorkflowRun: labels, phases and results from the journal; a call without a result runs while the session lives, stops when it does not", () => {
  const s = session({ resumed: true });
  const live = readWorkflowRun(s.transcript, s.runId, true)!;
  assert.equal(live.name, "demo-judge");
  assert.equal(live.description, "Judge 'two' matches");
  assert.deepEqual(live.phases, ["Judge", "Report"]);
  assert.equal(live.status, "running");
  assert.equal(live.resumed, true);
  assert.deepEqual(live.agents.map((a) => [a.label, a.agentId, a.state, a.attempts]), [["judge:R1M1", "aaa1", "done", 1], ["judge:R1M2", "bbb2", "running", 2]]);
  assert.equal(live.agents[1].doing, "Bash · npm test");
  assert.deepEqual(live.args, { matches: [{ id: "R1M1", a: "L001", b: "L002" }] }, "a string args value is parsed");
  const dead = readWorkflowRun(s.transcript, s.runId, false)!;
  assert.deepEqual([dead.status, dead.agents[1].state], ["stopped", "stopped"]);
  assert.equal(readWorkflowRun(s.transcript, "../../etc", true), null, "a run id that is not plain reads nothing");
  assert.deepEqual(summarize(live), { runId: s.runId, name: "demo-judge", status: "running", phase: "Judge", done: 1, failed: 0, total: 2, startedAt: live.startedAt });
});

test("readWorkflowRun: an ended run's record decides its status, and an unanswered call is then stopped, not running", () => {
  const s = session({ record: true });
  const r = readWorkflowRun(s.transcript, s.runId, true)!;
  assert.deepEqual([r.status, r.durationMs, r.totalTokens, r.phases], ["completed", 1234, 99, ["Judge"]]);
  assert.deepEqual(r.agents.map((a) => a.state), ["done", "stopped"]);
  const summary = readWorkflows(s.transcript, true, false)[0];
  assert.equal(summary.args, undefined, "the shallow read leaves the arguments out");
  assert.equal(summary.agents[1].doing, undefined, "and the current tool");
});

test("confinement: an agent file that links out of the session folder is never read, and a workflow agent's transcript is found by id", () => {
  const s = session();
  const outside = path.join(tmp(), "secret.jsonl");
  fs.writeFileSync(outside, line({ type: "assistant", message: { content: [{ type: "tool_use", id: "x", name: "Read", input: { file_path: "/etc/passwd" } }] } }));
  fs.rmSync(path.join(s.agents, "agent-aaa2.jsonl"));
  fs.symlinkSync(outside, path.join(s.agents, "agent-aaa2.jsonl"));
  const r = readWorkflowRun(s.transcript, s.runId, true)!;
  assert.equal(r.agents.find((a) => a.agentId === "aaa2")!.doing, undefined);
  assert.equal(workflowAgentTranscript(s.transcript, "aaa1"), path.join(fs.realpathSync(s.agents), "agent-aaa1.jsonl"));
  assert.equal(workflowAgentTranscript(s.transcript, "../x"), null);
});

test("workflowArgs: an inline run is found by the run id its result names", () => {
  const t = line({ type: "assistant", message: { content: [{ type: "tool_use", id: "u1", name: "Workflow", input: { script: "…", args: { n: 1 } } }] } }) + line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "u1", content: "Started wf_abc-1 in the background" }] } });
  assert.deepEqual(workflowArgs(t).get("wf_abc-1"), { n: 1 });
});

test("boundResult: small results pass as they are, large ones become a preview", () => {
  assert.deepEqual(boundResult({ a: 1 }), { a: 1 });
  const big = boundResult("x".repeat(100), 40) as { truncated: boolean; preview: string };
  assert.deepEqual([big.truncated, big.preview.length], [true, 20]);
});

test("decide and total match agent-config's rule: an upheld FATAL loses, else points, a pick against the points is overruled, a tie falls to the pick", () => {
  assert.equal(total(sc(10)), 100);
  assert.equal(total({ correctness: 8, requirements: 7, robustness: 6, clarity: 5, efficiency: 4 }), 28 + 17.5 + 12 + 5 + 4);
  const v = (a: number, b: number, pick: "a" | "b", fa = "none", fb = "none") => toVerdict({ a: sc(a), b: sc(b), fatal: { a: fa, b: fb }, pick })!;
  assert.deepEqual(decide(v(9, 5, "a", "upheld")), { winner: "b", notes: ["upheld FATAL decides"] });
  assert.deepEqual(decide(v(5, 9, "a")).winner, "b");
  assert.match(decide(v(5, 9, "a")).notes[0], /pick a overruled by points \(50 vs 90\)/);
  assert.deepEqual(decide(v(7, 7, "b")), { winner: "b", notes: ["tie on points; pick decides"] });
  assert.equal(toVerdict({ a: sc(11), b: sc(1), fatal: {}, pick: "a" }), null, "scores outside 0–10 are not a verdict");
});

function bracketState(over: Record<string, unknown> = {}) {
  const ln = (id: string, status: string, extra: Record<string, unknown> = {}) => ({ id, lineage: id, status, attempts: 0, eliminations: 0, cards: 0, lostTo: [], lastLoss: null, ...extra });
  return {
    version: 1, runId: "demo", tier: "S0", seed: 1, round: 1, auditRate: 0.1,
    lines: [ln("L001", "alive"), ln("L002", "alive"), ln("L003", "eliminated", { lostTo: ["L001"], eliminations: 1, lastLoss: { match: "R1M2", upheldFatal: true } })],
    matches: [
      { id: "R1M1", round: 1, a: "L001", b: "L002", verdict: null, winner: null, loser: null, notes: [], signals: [], appeal: null },
      { id: "R1M2", round: 1, a: "L001", b: "L003", verdict: { a: sc(8), b: sc(3), fatal: { a: "none", b: "upheld" }, pick: "a" }, winner: "L001", loser: "L003", notes: ["upheld FATAL decides"], signals: [], appeal: null },
    ],
    log: ["R1M2 L001 beats L003"],
    ...over,
  };
}

test("parseBracket + phaseOf: lines, matches and the engine's next step; a champion only once one line is left and nothing is open", () => {
  const v = parseBracket(JSON.stringify(bracketState()), "demo")!;
  assert.deepEqual([v.phase, v.champion, v.lines.length, v.matches[1].verdict!.fatal.b], ["judging", null, 3, "upheld"]);
  assert.equal(v.lines[2].lastLoss!.upheldFatal, true);
  assert.equal(phaseOf({ round: 0, lines: [{ status: "pending" }] as never, matches: [] }), "generating");
  const done = parseBracket(JSON.stringify(bracketState({ round: 2, lines: [{ id: "L001", status: "alive" }, { id: "L002", status: "eliminated" }], matches: [{ id: "R2M1", round: 2, a: "L001", b: "L002", winner: "L001", loser: "L002", appeal: "declined" }] })), "demo")!;
  assert.deepEqual([done.phase, done.champion], ["done", "L001"]);
  const appeal = parseBracket(JSON.stringify(bracketState({ matches: [{ id: "R1M1", round: 1, a: "L001", b: "L002", winner: "L001", loser: "L002", appeal: "open" }] })), "demo")!;
  assert.equal(appeal.phase, "appeals");
  assert.equal(parseBracket("{}", "x"), null);
  assert.equal(parseBracket("not json", "x"), null);
});

test("approachOf, rationaleOf, labelIds", () => {
  assert.equal(approachOf("# Line L001\n\nApproach: - Smallest diff:\n  one module.\n\n## Task\nbody"), "Smallest diff: one module.");
  assert.equal(approachOf("# Line L001\n\n## Task"), undefined);
  assert.equal(rationaleOf("# L001\n\nWhy this works.\n\n```diff\n+x\n```\n"), "Why this works.");
  assert.deepEqual(labelIds("judge:R12M3"), { match: "R12M3", line: undefined });
  assert.deepEqual(labelIds("appeal:L006"), { match: undefined, line: "L006" });
});

function project(state = bracketState()) {
  const cwd = tmp();
  const dir = path.join(cwd, "agents", "runtime", "bracket", "demo");
  fs.mkdirSync(path.join(dir, "briefs"), { recursive: true });
  fs.mkdirSync(path.join(dir, "lines"), { recursive: true });
  fs.writeFileSync(path.join(dir, "bracket.json"), JSON.stringify(state));
  fs.writeFileSync(path.join(dir, "task.md"), "# Task: sign the app\n\nbody");
  fs.writeFileSync(path.join(dir, "briefs", "L001.md"), "# Line L001\n\nApproach: - Small.\n\n## Task\n");
  fs.writeFileSync(path.join(dir, "lines", "L001.md"), "Because.\n```diff\n+x\n```\n");
  return { cwd, dir };
}

test("readBracket: an unrecorded match gets the judge's verdict as provisional, with the engine's winner; a running judge marks its match", () => {
  const s = session();
  const p = project();
  const runs = readWorkflows(s.transcript, true);
  const v = readBracket(p.cwd, "demo", runs)!;
  assert.deepEqual([v.taskTitle, v.lines[0].approach, v.lines[0].rationale, v.lines[0].hasOutput, v.lines[1].hasOutput], ["sign the app", "Small.", "Because.", true, false]);
  const m1 = v.matches.find((m) => m.id === "R1M1")!;
  assert.equal(m1.verdict, null);
  assert.deepEqual([m1.provisional!.winner, m1.provisional!.verdict.critique], ["L001", "b: MAJOR"]);
  const m2 = v.matches.find((m) => m.id === "R1M2")!;
  assert.equal(m2.provisional, undefined, "a recorded verdict is never shadowed");
  assert.equal(m2.judging?.agentId, "aaa2");
  assert.equal(readBracket(p.cwd, "../demo", runs), null);
});

test("readBracket: a bracket.json that links out of the bracket folder reads nothing", () => {
  const p = project();
  const outside = path.join(tmp(), "bracket.json");
  fs.writeFileSync(outside, JSON.stringify(bracketState()));
  fs.rmSync(path.join(p.dir, "bracket.json"));
  fs.symlinkSync(outside, path.join(p.dir, "bracket.json"));
  assert.equal(readBracket(p.cwd, "demo"), null);
});

test("councils: a run counts only when the session names its file; a debate is read round by round and stays open until its last round", () => {
  const cwd = tmp();
  const root = path.join(cwd, "agents", "runtime", "council", "responses");
  fs.mkdirSync(path.join(root, "deb"), { recursive: true });
  const run = { members: ["anthropic/m1", "openai/m2"], mode: "design", original_ask: "should we?", cost_usd_actual: 0.5, blind_review_map: { "Response-A": "openai:m2" }, quorum: { status: "concluded", threshold: 1, total: 2, present: 2 }, handoff: { decision: "ship B" }, responses: [{ provider: "anthropic", model: "m1", text: "## Round 2\n\n**Verdict: B**\nbecause", input_tokens: 5, output_tokens: 7, latency_ms: 900 }, { provider: "openai", model: "m2", text: "", error: "timeout" }] };
  fs.writeFileSync(path.join(root, "c1.json"), JSON.stringify(run));
  fs.writeFileSync(path.join(root, "c2.json"), JSON.stringify(run));
  fs.writeFileSync(path.join(root, "deb", "debate-round-1.json"), JSON.stringify({ members: ["a/x"], debate_round: 1, debate_total_rounds: 2, cost_usd_actual: 0.1, responses: [{ provider: "a", model: "x", text: "Opening" }] }));
  const named = readCouncils(cwd, "wrote agents/runtime/council/responses/c1.json and responses/deb/");
  assert.deepEqual(named.map((c) => [c.name, c.kind]).sort(), [["c1", "run"], ["deb", "debate"]]);
  const c1 = named.find((c) => c.name === "c1")!;
  assert.deepEqual([c1.seats[0].headline, c1.seats[0].blindLabel, c1.seats[1].blindLabel, c1.seats[1].error, c1.decision, c1.quorum!.present], ["Verdict: B", undefined, "Response-A", "timeout", "ship B", 2]);
  assert.equal(named.find((c) => c.name === "deb")!.open, true);
  assert.equal(parseDebate([JSON.stringify({ debate_round: 2, debate_total_rounds: 2, responses: [] }), JSON.stringify({ debate_round: 1, debate_total_rounds: 2, responses: [] })], "d")!.open, false);
  assert.equal(parseCouncil("{}", "x"), null);
  assert.equal(headlineOf("# Title\n\nsome text"), "Title");
});

test("readOrchestration: a bracket counts only when the session's text names its folder", () => {
  const s = session();
  const p = project();
  const o = readOrchestration(s.transcript, p.cwd, `claude/x/${SID}`, true);
  assert.deepEqual(o.brackets.map((b) => b.run), ["demo"]);
  assert.deepEqual(namedBrackets(["demo", "other"], "see runtime/bracket/demo/x"), ["demo"]);
  // A session that moved (resumed in another worktree) keeps its runs where it started them.
  const moved = readOrchestration(s.transcript, [tmp(), p.cwd, p.cwd], `claude/x/${SID}`, true);
  assert.deepEqual(moved.brackets.map((b) => b.run), ["demo"], "found in the folder it started in, counted once");
  fs.mkdirSync(path.join(p.cwd, "agents", "runtime", "council", "responses"), { recursive: true });
  fs.writeFileSync(path.join(p.cwd, "agents", "runtime", "council", "responses", "c1.json"), JSON.stringify({ members: [], responses: [] }));
  const f = boardFields(s.transcript, true, p.cwd);
  assert.deepEqual(f.boards, ["bracket", "council"]);
  assert.deepEqual(f.brackets, [{ run: "demo", round: 1, phase: "judging", alive: 2, total: 3, champion: null }]);
  assert.equal(f.workflows!.length, 1);
  const chatty = path.join(tmp(), `${SID}.jsonl`);
  fs.writeFileSync(chatty, line({ type: "user", message: { content: "rules: run council:status, /judge bracket, agents/runtime/council/ …" } }));
  assert.deepEqual(boardFields(chatty, true, p.cwd), {}, "rule text that only names the features is no evidence of a run");
  assert.deepEqual(boardFields(s.transcript, true), { workflows: f.workflows }, "without a folder, only the session's own workflows");
});

// ---- the live council table (agent-config live.jsonl + inbox.jsonl) ----

import { parseLive, readLiveTables, writeInbox } from "../src/council-runs.js";
import { councilMessage } from "../src/commands/workflows.js";

const ev = (o: Record<string, unknown>) => line({ v: 1, at: "2026-11-24T10:00:00Z", ...o });
function liveTable(stem = "c-live", extra = "") {
  const cwd = tmp();
  const dir = path.join(cwd, "agents", "runtime", "council", "live", stem);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "live.jsonl"),
    ev({ type: "run.started", subcommand: "run", ask: "Ship it?", response: `agents/runtime/council/responses/${stem}.json`, seats: [{ id: "anthropic#architect", member: "anthropic", model: "sonnet", role: "Architect" }, { id: "anthropic#skeptic", member: "anthropic", model: "opus", role: "Skeptic" }, { id: "gemini#outsider", member: "gemini", role: "Outsider", absent: "member \"gemini\" is not at the table" }] }) +
      ev({ type: "seat.started", seat: "anthropic#architect", turn: 1 }) +
      ev({ type: "seat.finished", seat: "anthropic#architect", turn: 1, ok: true, headline: "Verdict: ship it", output_tokens: 900, latency_ms: 4000 }) +
      ev({ type: "human.said", text: "Mind the upgrade path.", before: "anthropic#skeptic" }) +
      ev({ type: "seat.started", seat: "anthropic#skeptic", turn: 1 }) +
      extra,
  );
  fs.writeFileSync(path.join(dir, "inbox.jsonl"), "");
  return { cwd, dir, stem };
}

test("parseLive: who answered, who is thinking, who could not sit, what the human said", () => {
  const t = liveTable();
  const live = parseLive(fs.readFileSync(path.join(t.dir, "live.jsonl"), "utf8"), t.stem, true)!;
  assert.deepEqual(live.seats.map((s) => [s.id, s.state, s.headline ?? null]), [["anthropic#architect", "answered", "Verdict: ship it"], ["anthropic#skeptic", "thinking", null], ["gemini#outsider", "absent", null]]);
  assert.deepEqual([live.status, live.listening, live.turn, live.said.map((s) => s.text)], ["running", true, 1, ["Mind the upgrade path."]]);
  assert.equal(live.feed.at(-1)!.text, "Skeptic is thinking (turn 1)");
  assert.equal(parseLive("{}\n", "x", true), null, "no run.started: not a live table");
  assert.equal(parseLive(fs.readFileSync(path.join(t.dir, "live.jsonl"), "utf8"), t.stem, false)!.status, "failed", "an unfinished log from a session that ended did not finish");
});

test("parseLive: a raised hand pauses, a stop is stopping until the run finishes as stopped", () => {
  const paused = liveTable("p", ev({ type: "run.paused", before: "anthropic#skeptic" }));
  assert.equal(parseLive(fs.readFileSync(path.join(paused.dir, "live.jsonl"), "utf8"), "p", true)!.status, "paused");
  const stopped = liveTable("s", ev({ type: "run.stopping", by: "human" }) + ev({ type: "seat.skipped", seat: "anthropic#skeptic", turn: 1 }) + ev({ type: "run.finished", status: "stopped" }));
  const live = parseLive(fs.readFileSync(path.join(stopped.dir, "live.jsonl"), "utf8"), "s", true)!;
  assert.deepEqual([live.status, live.listening, live.seats[1]!.state], ["stopped", false, "skipped"]);
});

test("readCouncils: a live table counts only when the session names its response; it stands as the view until the response exists, then joins it", () => {
  const t = liveTable();
  assert.deepEqual(readLiveTables(t.cwd, "nothing here", true), []);
  const mention = `--output agents/runtime/council/responses/${t.stem}.json`;
  const chatty = path.join(tmp(), `${SID}.jsonl`);
  fs.writeFileSync(chatty, line({ type: "user", message: { content: `ran ${mention}` } }));
  assert.deepEqual(boardFields(chatty, true, t.cwd), { boards: ["council"], councilLive: true }, "a table that listens marks the row live");
  const [only] = readCouncils(t.cwd, mention, true);
  assert.deepEqual([only!.name, only!.open, only!.live!.status, only!.seats.map((s) => s.role), only!.absent.map((a) => a.member)], [t.stem, true, "running", ["Architect", "Skeptic"], ["gemini#outsider"]]);
  fs.mkdirSync(path.join(t.cwd, "agents", "runtime", "council", "responses"), { recursive: true });
  fs.writeFileSync(path.join(t.cwd, "agents", "runtime", "council", "responses", `${t.stem}.json`), JSON.stringify({ members: ["anthropic/sonnet"], responses: [{ provider: "anthropic", model: "opus", text: "**Verdict: hold**", metadata: { seat: { id: "anthropic#skeptic" } } }] }));
  const [joined] = readCouncils(t.cwd, mention, true);
  assert.deepEqual([joined!.seats[0]!.seatId, joined!.seats[0]!.role, joined!.seats[0]!.headline, !!joined!.live], ["anthropic#skeptic", "Skeptic", "Verdict: hold", true]);
});

test("writeInbox: speaks only to a table that listens, only through its own inbox", () => {
  const t = liveTable();
  writeInbox(t.cwd, t.stem, { type: "say", text: `  ${"x".repeat(2100)} ` });
  writeInbox(t.cwd, t.stem, { type: "pause" });
  const lines = fs.readFileSync(path.join(t.dir, "inbox.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual([lines[0].type, lines[0].text.length, lines[1].type], ["say", 2000, "pause"]);
  assert.throws(() => writeInbox(t.cwd, "../x", { type: "stop" }), /not a council run name/);
  assert.throws(() => writeInbox(t.cwd, t.stem, { type: "say", text: "   " }), /nothing to say/);
  assert.throws(() => writeInbox(t.cwd, t.stem, { type: "stop" }, false), /no longer listens/, "a table whose session ended does not listen");
  const done = liveTable("d", ev({ type: "run.finished", status: "completed" }));
  assert.throws(() => writeInbox(done.cwd, "d", { type: "say", text: "late" }), /completed; it no longer listens/);
  const linked = liveTable("l");
  const outside = path.join(tmp(), "elsewhere.jsonl");
  fs.writeFileSync(outside, "");
  fs.rmSync(path.join(linked.dir, "inbox.jsonl"));
  fs.symlinkSync(outside, path.join(linked.dir, "inbox.jsonl"));
  assert.throws(() => writeInbox(linked.cwd, "l", { type: "stop" }), /not the council's own file/);
  assert.equal(fs.readFileSync(outside, "utf8"), "");
});

test("councilMessage: one of say, pause, resume, stop", () => {
  assert.deepEqual(councilMessage({ say: "hi" }), { type: "say", text: "hi" });
  assert.deepEqual(councilMessage({ stop: true }), { type: "stop" });
  assert.equal(councilMessage({}), null);
  assert.throws(() => councilMessage({ say: "hi", stop: true }), /one at a time/);
});
