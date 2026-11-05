import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { RequestStore, type RaiseInput } from "../src/link/requests.js";

const T0 = Date.parse("2026-11-05T12:00:00Z");
const MIN = 60_000;

function store(now: { t: number }, dir = fs.mkdtempSync(path.join(os.tmpdir(), "asw-req-"))) {
  return { dir, s: new RequestStore(dir, () => now.t) };
}

function raise(over: Partial<RaiseInput> = {}): RaiseInput {
  return {
    account: "claude/work",
    session: "claude/work/sess-1",
    reason: { window: "five_hour", fill: 91, resetsAt: new Date(T0 + 90 * MIN).toISOString() },
    raisedBy: "as-daemon",
    candidates: [{ target: "claude/home", provider: "claude", fill: 20, resetsAt: null, how: ["after-turn", "now", "brief"] }],
    ...over,
  };
}

test("raising twice for the same account, session, window and reset returns one request", () => {
  const now = { t: T0 };
  const { s } = store(now);
  const a = s.raise(raise());
  const b = s.raise(raise({ raisedBy: "ac" }));
  assert.equal(a.created, true);
  assert.equal(b.created, false);
  assert.equal(a.request.id, b.request.id);
  assert.equal(b.request.raisedBy, "as-daemon", "the first raiser is kept");
  assert.equal(s.list().length, 1);
});

test("a new reset cycle is a new request", () => {
  const now = { t: T0 };
  const { s } = store(now);
  const a = s.raise(raise());
  const b = s.raise(raise({ reason: { window: "five_hour", fill: 91, resetsAt: new Date(T0 + 400 * MIN).toISOString() } }));
  assert.notEqual(a.request.id, b.request.id);
});

test("the first decision wins; a later one from the other tool is not applied", () => {
  const now = { t: T0 };
  const { dir, s } = store(now);
  const { request } = s.raise(raise());
  // Two independent readers of the same directory — the GUI and agent-config.
  const gui = new RequestStore(dir, () => now.t);
  const ac = new RequestStore(dir, () => now.t);
  const first = gui.decide(request.id, { kind: "approve", target: "claude/home", how: "after-turn", by: "as-gui" });
  const second = ac.decide(request.id, { kind: "decline", by: "ac:claude" });
  assert.equal(first.applied, true);
  assert.equal(second.applied, false);
  assert.equal(second.request.state, "approved");
  assert.equal(second.request.decision?.by, "as-gui");
  assert.equal(s.get(request.id)?.state, "approved");
  assert.ok(second.request.rev > request.rev);
});

test("approving needs a target that is one of the candidates", () => {
  const now = { t: T0 };
  const { s } = store(now);
  const { request } = s.raise(raise());
  assert.throws(() => s.decide(request.id, { kind: "approve", target: "claude/nobody", how: "now", by: "as-cli" }), /not a candidate/);
  assert.throws(() => s.decide(request.id, { kind: "approve", target: "claude/home", how: "handoff", by: "as-cli" }), /not offered/);
  assert.equal(s.get(request.id)?.state, "open");
});

test("decline and snooze close the request for this cycle", () => {
  const now = { t: T0 };
  const { s } = store(now);
  const a = s.raise(raise({ account: "claude/a", session: null }));
  const b = s.raise(raise({ account: "claude/b", session: null }));
  assert.equal(s.decide(a.request.id, { kind: "decline", by: "ac:claude" }).request.state, "declined");
  assert.equal(s.decide(b.request.id, { kind: "snooze", by: "as-gui" }).request.state, "snoozed");
  // Raising again in the same cycle returns the closed request, it does not reopen it.
  assert.equal(s.raise(raise({ account: "claude/a", session: null })).request.state, "declined");
});

test("an open request past its reset expires and can no longer be decided", () => {
  const now = { t: T0 };
  const { s } = store(now);
  const { request } = s.raise(raise());
  now.t = T0 + 91 * MIN;
  assert.equal(s.get(request.id)?.state, "expired");
  const r = s.decide(request.id, { kind: "approve", target: "claude/home", how: "now", by: "as-gui" });
  assert.equal(r.applied, false);
  assert.equal(r.request.state, "expired");
});

test("claim moves an approved request to executing exactly once", () => {
  const now = { t: T0 };
  const { dir, s } = store(now);
  const { request } = s.raise(raise());
  assert.equal(s.claim(request.id), null, "an open request cannot be claimed");
  s.decide(request.id, { kind: "approve", target: "claude/home", how: "now", by: "as-gui" });
  const first = s.claim(request.id);
  const second = new RequestStore(dir, () => now.t).claim(request.id);
  assert.equal(first?.state, "executing");
  assert.equal(second, null);
  const done = s.finish(request.id, { ok: true, detail: "moved", newSession: "claude/home/sess-1" });
  assert.equal(done?.state, "done");
  assert.equal(done?.outcome?.newSession, "claude/home/sess-1");
  assert.equal(s.finish(request.id, { ok: false, detail: "again" }), null, "a finished request is not finished twice");
});

test("a corrupt request file is skipped, not fatal", () => {
  const now = { t: T0 };
  const { dir, s } = store(now);
  s.raise(raise());
  fs.writeFileSync(path.join(dir, "garbage.json"), "{not json");
  assert.equal(s.list().length, 1);
});

test("finished requests older than seven days are pruned; open ones are kept", () => {
  const now = { t: T0 };
  const { s } = store(now);
  const a = s.raise(raise({ account: "claude/a", session: null }));
  s.raise(raise({ account: "claude/b", session: null, reason: { window: "seven_day", fill: 92, resetsAt: new Date(T0 + 30 * 24 * 60 * MIN).toISOString() } }));
  s.decide(a.request.id, { kind: "decline", by: "as-cli" });
  now.t = T0 + 8 * 24 * 60 * MIN;
  assert.equal(s.prune(), 1);
  assert.deepEqual(s.list().map((r) => r.account), ["claude/b"]);
});

test("request files are private to the user", { skip: process.platform === "win32" }, () => {
  const now = { t: T0 };
  const { dir, s } = store(now);
  const { request } = s.raise(raise());
  assert.equal(fs.statSync(path.join(dir, `${request.id}.json`)).mode & 0o777, 0o600);
});
