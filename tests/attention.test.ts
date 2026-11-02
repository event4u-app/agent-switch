import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { buildQueue, afterRead, snooze, digest, itemId, emptyState, readAttention, writeAttention, attentionFile, AWAY_MS, HISTORY_CAP, type Candidate } from "../src/attention.js";

const c = (kind: Candidate["kind"], subject: string, since: string, version = "v1"): Candidate => ({ kind, subject, who: subject, what: kind, since, version });

test("one queue, ordered approvals → questions → limits → CI → sign-ins → updates, oldest first within a kind", () => {
  const q = buildQueue(
    [c("update", "tool", "2026-11-02T09:00:00Z"), c("signin", "acct", "2026-11-02T09:00:00Z"), c("question", "s2", "2026-11-02T10:05:00Z"), c("approval", "s1", "2026-11-02T10:10:00Z"), c("question", "s1", "2026-11-02T10:00:00Z"), c("limit", "side", "2026-11-02T08:00:00Z"), c("ci", "pr", "2026-11-02T07:00:00Z")],
    emptyState(),
  );
  assert.deepEqual(q.map((i) => `${i.kind}:${i.subject}`), ["approval:s1", "question:s1", "question:s2", "limit:side", "ci:pr", "signin:acct", "update:tool"]);
  assert.deepEqual(q.map((i) => i.verb), ["Allow", "Reply", "Reply", "Decide", "Fix", "Sign in", "Update"]);
});

test("a candidate may say where to go instead (D-approve: Focus terminal)", () => {
  const [i] = buildQueue([{ ...c("approval", "s1", "2026-11-02T10:00:00Z"), verb: "Focus terminal" }], emptyState());
  assert.equal(i.verb, "Focus terminal");
});

test("Later hides an item until it changes", () => {
  const item = buildQueue([c("limit", "side", "t", "5h:reset-1")], emptyState())[0];
  const state = snooze(emptyState(), item);
  assert.deepEqual(buildQueue([c("limit", "side", "t", "5h:reset-1")], state), [], "same version: hidden");
  assert.equal(buildQueue([c("limit", "side", "t", "5h:reset-2")], state).length, 1, "changed: back");
});

test("an item that leaves the queue becomes history once; a gone item's snooze is dropped", () => {
  let state = emptyState();
  const a = c("question", "s1", "t1");
  const b = c("approval", "s2", "t2");
  const ids = (...xs: Candidate[]) => new Set(xs.map((x) => itemId(x.kind, x.subject)));
  state = afterRead(state, buildQueue([a, b], state), ids(a, b), "2026-11-02T10:00:00.000Z");
  state = snooze(state, { id: itemId(a.kind, a.subject), version: "v1" });
  state = afterRead(state, buildQueue([b], state), ids(b), "2026-11-02T10:05:00.000Z");
  assert.deepEqual(state.history.map((h) => [h.kind, h.who, h.doneAt]), [["question", "s1", "2026-11-02T10:05:00.000Z"]]);
  assert.deepEqual(state.snoozed, {}, "snooze of a resolved item is gone");
  state = afterRead(state, buildQueue([b], state), ids(b), "2026-11-02T10:06:00.000Z");
  assert.equal(state.history.length, 1, "not recorded twice");
});

test("history is capped", () => {
  let state = emptyState();
  for (let i = 0; i < HISTORY_CAP + 30; i++) {
    const x = c("question", `s${i}`, "t");
    state = afterRead(state, buildQueue([x], state), new Set([itemId(x.kind, x.subject)]), `2026-11-02T10:00:${String(i % 60).padStart(2, "0")}Z`);
  }
  state = afterRead(state, [], new Set(), "2026-11-02T11:00:00Z");
  assert.equal(state.history.length, HISTORY_CAP);
});

test("one digest row after a long absence, with what happened meanwhile; none after a short one", () => {
  const seen = "2026-11-02T08:00:00.000Z";
  const state = { ...emptyState(), lastSeenAt: seen, history: [{ id: "x", kind: "question" as const, who: "s", what: "q", doneAt: "2026-11-02T09:00:00.000Z" }] };
  const events = [
    { event: "Stop", at: "2026-11-02T07:00:00.000Z" },
    { event: "Stop", at: "2026-11-02T09:00:00.000Z" },
    { event: "Stop", at: "2026-11-02T09:30:00.000Z" },
    { event: "StopFailure", at: "2026-11-02T09:40:00.000Z" },
  ];
  const later = new Date(Date.parse(seen) + AWAY_MS + 1).toISOString();
  assert.deepEqual(digest(state, later, events), { since: seen, finishedTurns: 2, stoppedOnError: 1, resolved: 1 });
  assert.equal(digest(state, new Date(Date.parse(seen) + AWAY_MS - 1).toISOString(), events), null);
  assert.equal(digest({ ...state, history: [] }, later, []), null, "nothing happened: no row");
});

test("the state file is private and survives a round-trip", () => {
  const file = attentionFile(fs.mkdtempSync(path.join(os.tmpdir(), "asw-att-")));
  const s = snooze(emptyState(), { id: "abc", version: "1" });
  writeAttention(file, s);
  assert.deepEqual(readAttention(file), s);
  if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  fs.writeFileSync(file, "{broken");
  assert.deepEqual(readAttention(file), emptyState());
});
