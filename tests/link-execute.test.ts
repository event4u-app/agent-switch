import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { executeApproved, planMove, type MoveContext, type Runner } from "../src/link/execute.js";
import { RequestStore, type Candidate, type MoveHow } from "../src/link/requests.js";

const T0 = Date.parse("2026-11-05T12:00:00Z");

function setup(source: string, session: string | null, cand: Candidate) {
  const s = new RequestStore(fs.mkdtempSync(path.join(os.tmpdir(), "asw-exec-")), () => T0);
  const { request } = s.raise({
    account: source,
    session,
    reason: { window: "five_hour", fill: 92, resetsAt: new Date(T0 + 3_600_000).toISOString() },
    raisedBy: "ac",
    candidates: [cand],
  });
  return { s, id: request.id };
}

const claudeB: Candidate = { target: "claude/b", provider: "claude", fill: 10, resetsAt: null, how: ["after-turn", "now", "handoff"] };
const codexX: Candidate = { target: "codex/x", provider: "codex", fill: 5, resetsAt: null, how: ["now", "handoff"] };

function approve(s: RequestStore, id: string, target: string, how: MoveHow) {
  s.decide(id, { kind: "approve", target, how, by: "as-gui" });
  return s.get(id)!;
}

test("plans: rebind after the turn, rebind now, Codex takeover, handoff", () => {
  const a = setup("claude/work", "claude/work/sid-1", claudeB);
  assert.deepEqual(planMove(approve(a.s, a.id, "claude/b", "after-turn")).argv, ["rebind", "b", "--when-idle", "--profile", "work", "--session", "sid-1"]);
  const b = setup("claude/work", null, claudeB);
  assert.deepEqual(planMove(approve(b.s, b.id, "claude/b", "now")).argv, ["rebind", "b", "--profile", "work"]);
  const c = setup("codex/one", "codex/one/sid-2", { ...codexX, target: "codex/two" });
  assert.deepEqual(planMove(approve(c.s, c.id, "codex/two", "now")).argv, ["takeover", "sid-2", "--to", "two", "--provider", "codex", "--from", "one", "--json"]);
  const d = setup("claude/work", "claude/work/sid-3", codexX);
  assert.deepEqual(planMove(approve(d.s, d.id, "codex/x", "handoff")).argv, ["handoff", "extract", "sid-3", "--from", "work", "--to", "codex", "--provider", "claude", "--json"]);
});

test("a move that needs a session id refuses a request without one", () => {
  const a = setup("claude/work", null, codexX);
  const p = planMove(approve(a.s, a.id, "codex/x", "handoff"));
  assert.equal(p.argv, null);
  assert.match(p.error ?? "", /session/);
});

test("an approved request runs once and records the outcome; a second pass runs nothing", () => {
  const a = setup("claude/work", "claude/work/sid-1", claudeB);
  approve(a.s, a.id, "claude/b", "now");
  const calls: string[][] = [];
  const run: Runner = (argv) => (calls.push(argv), { status: 0, stdout: "now serves b's account\n", stderr: "" });
  const done = executeApproved(a.s, run);
  assert.equal(done.length, 1);
  assert.equal(done[0].state, "done");
  assert.match(done[0].outcome?.detail ?? "", /serves b/);
  assert.equal(executeApproved(a.s, run).length, 0);
  assert.equal(calls.length, 1);
});

test("a failed step records failed with the error, never retries", () => {
  const a = setup("claude/work", "claude/work/sid-1", claudeB);
  approve(a.s, a.id, "claude/b", "now");
  let n = 0;
  const run: Runner = () => (n++, { status: 1, stdout: "", stderr: "agent-switch: rebind refused: busy\n" });
  const [r] = executeApproved(a.s, run);
  assert.equal(r.state, "failed");
  assert.match(r.outcome?.detail ?? "", /refused: busy/);
  executeApproved(a.s, run);
  assert.equal(n, 1);
});

test("a handoff records the seed command to resume with; a takeover its resume command", () => {
  const a = setup("claude/work", "claude/work/sid-3", codexX);
  approve(a.s, a.id, "codex/x", "handoff");
  const [h] = executeApproved(a.s, () => ({ status: 0, stdout: JSON.stringify({ briefPath: "/tmp/brief.md" }), stderr: "" }));
  assert.equal(h.outcome?.resume, "agent-switch handoff seed --to x --provider codex --brief /tmp/brief.md");

  const b = setup("codex/one", "codex/one/sid-2", { ...codexX, target: "codex/two" });
  approve(b.s, b.id, "codex/two", "now");
  const [t] = executeApproved(b.s, () => ({ status: 0, stdout: JSON.stringify({ resumeCommand: "agent-switch run two --provider codex -- resume sid-2" }), stderr: "" }));
  assert.equal(t.outcome?.resume, "agent-switch run two --provider codex -- resume sid-2");
  assert.equal(t.outcome?.newSession, "codex/two/sid-2");
});

test("open, declined and executing requests are left alone", () => {
  const a = setup("claude/work", null, claudeB);
  let n = 0;
  assert.equal(executeApproved(a.s, () => (n++, { status: 0, stdout: "", stderr: "" })).length, 0);
  a.s.decide(a.id, { kind: "decline", by: "ac:claude" });
  assert.equal(executeApproved(a.s, () => (n++, { status: 0, stdout: "", stderr: "" })).length, 0);
  assert.equal(n, 0);
});

const CONT = "Continue where you left off.";
const ctx = (over: Partial<MoveContext> = {}): MoveContext => ({ busy: () => false, hosted: () => false, ...over });

test("2.1: a Claude move onto an account that runs a session of its own is a takeover, never a rebind", () => {
  const busyB = ctx({ busy: (a) => a === "claude/b" });
  for (const how of ["now", "after-turn"] as const) {
    const a = setup("claude/work", "claude/work/sid-1", claudeB);
    const p = planMove(approve(a.s, a.id, "claude/b", how), busyB);
    assert.deepEqual(p.argv, ["takeover", "sid-1", "--to", "b", "--provider", "claude", "--stop-source", "--prompt", CONT, "--json"]);
  }
  // Not busy → still the plain rebind.
  const c = setup("claude/work", "claude/work/sid-1", claudeB);
  assert.equal(planMove(approve(c.s, c.id, "claude/b", "now"), ctx({ busy: (a) => a === "claude/other" })).argv?.[0], "rebind");
  // A whole-account request cannot be moved by session: refused, nothing signed out.
  const d = setup("claude/work", null, claudeB);
  const refused = planMove(approve(d.s, d.id, "claude/b", "now"), busyB);
  assert.equal(refused.argv, null);
  assert.match(refused.error ?? "", /runs a session of its own/);
});

test("2.1: the busy takeover records its resume command and the session's new key", () => {
  const a = setup("claude/work", "claude/work/sid-1", claudeB);
  approve(a.s, a.id, "claude/b", "now");
  const [t] = executeApproved(a.s, () => ({ status: 0, stdout: JSON.stringify({ resumeCommand: "agent-switch run b -- --resume sid-1" }), stderr: "" }), ctx({ busy: (x) => x === "claude/b" }));
  assert.equal(t.state, "done");
  assert.equal(t.outcome?.resume, "agent-switch run b -- --resume sid-1");
  assert.equal(t.outcome?.newSession, "claude/b/sid-1");
});

test("2.2: after a rebind now, a hosted session is told to carry on; a session not hosted is not", () => {
  const a = setup("claude/work", "claude/work/sid-1", claudeB);
  approve(a.s, a.id, "claude/b", "now");
  const typed: string[] = [];
  const hosted = ctx({ hosted: (k) => k === "claude/work/sid-1" });
  const [r] = executeApproved(a.s, () => ({ status: 0, stdout: "now serves b's account\n", stderr: "" }), hosted, (k) => (typed.push(k), true));
  assert.deepEqual(typed, ["claude/work/sid-1"]);
  assert.equal(r.state, "done");
  assert.match(r.outcome?.detail ?? "", /carries on/);

  // The continuation fails → the move still stands, and the outcome says what to do.
  const b = setup("claude/work", "claude/work/sid-1", claudeB);
  approve(b.s, b.id, "claude/b", "now");
  const [f] = executeApproved(b.s, () => ({ status: 0, stdout: "ok\n", stderr: "" }), hosted, () => "someone is typing there");
  assert.equal(f.state, "done");
  assert.match(f.outcome?.detail ?? "", /type one message/i);

  // Not hosted, or after the turn (the arm watcher continues those): no typing here.
  const c = setup("claude/work", "claude/work/sid-1", claudeB);
  approve(c.s, c.id, "claude/b", "now");
  executeApproved(c.s, () => ({ status: 0, stdout: "", stderr: "" }), ctx(), (k) => (typed.push(k), true));
  const d = setup("claude/work", "claude/work/sid-1", claudeB);
  approve(d.s, d.id, "claude/b", "after-turn");
  executeApproved(d.s, () => ({ status: 0, stdout: "", stderr: "" }), hosted, (k) => (typed.push(k), true));
  assert.deepEqual(typed, ["claude/work/sid-1"]);
  // A failed rebind is never followed by a continuation.
  const e = setup("claude/work", "claude/work/sid-1", claudeB);
  approve(e.s, e.id, "claude/b", "now");
  executeApproved(e.s, () => ({ status: 1, stdout: "", stderr: "refused" }), hosted, (k) => (typed.push(k), true));
  assert.equal(typed.length, 1);
});

test("2.3: a hosted session moves in its own window — Codex, and Claude onto a busy account", () => {
  const hosted = (key: string) => ctx({ hosted: (k) => k === key, busy: (a) => a === "claude/b" });
  for (const how of ["now", "after-turn"] as const) {
    const a = setup("codex/one", "codex/one/sid-2", { ...codexX, target: "codex/two", how: ["now", "after-turn", "handoff"] });
    const p = planMove(approve(a.s, a.id, "codex/two", how), hosted("codex/one/sid-2"));
    assert.deepEqual(p.argv, ["takeover", "sid-2", "--to", "two", "--provider", "codex", "--in-place", "--hosted", "codex/one/sid-2", "--prompt", CONT]);
  }
  const b = setup("claude/work", "claude/work/sid-1", claudeB);
  assert.deepEqual(planMove(approve(b.s, b.id, "claude/b", "now"), hosted("claude/work/sid-1")).argv, ["takeover", "sid-1", "--to", "b", "--provider", "claude", "--in-place", "--hosted", "claude/work/sid-1", "--prompt", CONT]);

  const c = setup("codex/one", "codex/one/sid-2", { ...codexX, target: "codex/two" });
  approve(c.s, c.id, "codex/two", "now");
  const [r] = executeApproved(c.s, () => ({ status: 0, stdout: 'Handed the session over to "two" in its hosted window (codex/two/sid-2).\n', stderr: "" }), hosted("codex/one/sid-2"));
  assert.equal(r.state, "done");
  assert.equal(r.outcome?.resume, undefined); // it runs already; nothing to offer
  assert.equal(r.outcome?.newSession, "codex/two/sid-2");
});

test("a Codex move after the turn, should one be approved, is the same takeover as now (Codex has no live switch)", () => {
  // Raised Codex candidates offer `now` only; the plan does not depend on that.
  const a = setup("codex/one", "codex/one/sid-2", { ...codexX, target: "codex/two", how: ["now", "after-turn"] });
  assert.deepEqual(planMove(approve(a.s, a.id, "codex/two", "after-turn")).argv, ["takeover", "sid-2", "--to", "two", "--provider", "codex", "--from", "one", "--json"]);
});
