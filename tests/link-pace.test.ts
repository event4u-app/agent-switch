import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { burnRate, etaFull, paceReason, pacePoints, projectedAtReset, spareCandidates, TOO_FAST_RATIO, SPARE_BELOW_PCT } from "../src/link/pace.js";
import { RequestStore, type Candidate } from "../src/link/requests.js";
import { raiseAsks, raisePaceForAccount } from "../src/link/raise.js";
import type { HistorySample } from "../src/history.js";
import type { UsageSnapshot } from "../src/usage.js";

const NOW = Date.parse("2026-11-07T12:00:00Z");
const H = 3_600_000;
const iso = (h: number) => new Date(NOW + h * H).toISOString();
const sample = (h: number, fills: Record<string, number | null>): HistorySample => ({
  at: iso(h),
  windows: Object.entries(fills).map(([key, utilization]) => ({ key, utilization })),
});
const snap = (w: [string, number, number][], capturedH = 0): UsageSnapshot => ({
  capturedAt: iso(capturedH),
  routines: null,
  windows: w.map(([key, utilization, resetH]) => ({ key, label: key, utilization, resetsAt: iso(resetH) })),
});

test("burn rate: a steady climb gives fill per hour", () => {
  const pts = pacePoints([sample(-2, { seven_day: 40 }), sample(-1, { seven_day: 45 })], snap([["seven_day", 50, 48]]), "seven_day");
  const b = burnRate(pts, NOW);
  assert.ok(b !== null);
  assert.equal(Math.round(b * 10) / 10, 5);
});

test("burn rate: a reset between two points drops the older ones", () => {
  // 80 → 5 is a reset; only the points after it count, and they are too close.
  const pts = pacePoints([sample(-3, { five_hour: 80 }), sample(-0.2, { five_hour: 5 })], snap([["five_hour", 8, 4]]), "five_hour");
  assert.equal(burnRate(pts, NOW), null);
});

test("burn rate: fewer than two points at least 30 min apart is unknown", () => {
  assert.equal(burnRate(pacePoints([], snap([["seven_day", 50, 48]]), "seven_day"), NOW), null);
  assert.equal(burnRate(pacePoints([sample(-0.25, { seven_day: 49 })], snap([["seven_day", 50, 48]]), "seven_day"), NOW), null);
});

test("burn rate: flat usage has no ETA", () => {
  const pts = pacePoints([sample(-2, { seven_day: 50 })], snap([["seven_day", 50, 48]]), "seven_day");
  assert.equal(burnRate(pts, NOW), 0);
  assert.equal(etaFull(50, 0, 98), null);
  assert.equal(etaFull(50, 4, 98), 12);
});

const busyNone = () => false;
function cand(target: string, how: Candidate["how"] = ["after-turn", "now"]): Candidate {
  return { target, provider: target.split("/")[0] as Candidate["provider"], fill: 10, resetsAt: iso(100), how };
}

test("too fast and another account has room → a pace reason", () => {
  // 60 % used, 6 %/h → 98 % in ~6.3 h; the week resets in 48 h.
  const r = paceReason({
    snapshot: snap([["seven_day", 60, 48]]),
    history: [sample(-2, { seven_day: 48 }), sample(-1, { seven_day: 54 })],
    thresholdPct: 98,
    now: NOW,
  });
  assert.ok(r);
  assert.equal(r.kind, "pace");
  assert.equal(r.window, "seven_day");
  assert.equal(r.fill, 60);
  assert.equal(Math.round(r.etaFull!), 6);
});

test("a pace that lasts until the reset is not too fast", () => {
  // 1 %/h, 38 % to go, reset in 40 h → ETA 38 h ≥ 0.8 × 40 h.
  const r = paceReason({ snapshot: snap([["seven_day", 60, 40]]), history: [sample(-2, { seven_day: 58 })], thresholdPct: 98, now: NOW });
  assert.equal(r, null);
  assert.equal(TOO_FAST_RATIO, 0.8);
});

test("a window that resets within hours is the limit ask's to watch, not pace", () => {
  const r = paceReason({ snapshot: snap([["five_hour", 50, 3]]), history: [sample(-1, { five_hour: 20 })], thresholdPct: 98, now: NOW });
  assert.equal(r, null);
});

test("an account already at the ask mark is the limit ask's, not a pace ask", () => {
  const r = paceReason({ snapshot: snap([["five_hour", 92, 3]]), history: [sample(-1, { five_hour: 80 })], thresholdPct: 98, now: NOW });
  assert.equal(r, null);
});

test("spare: same provider, not busy, projected under the mark; room that expires is reported", () => {
  const cands = [cand("claude/idle"), cand("claude/busy", ["handoff"]), cand("claude/full"), cand("codex/x", ["handoff"])];
  const projected: Record<string, number> = { "claude/idle": 20, "claude/busy": 10, "claude/full": 70, "codex/x": 0 };
  const out = spareCandidates("claude/work", cands, (id) => id === "claude/busy", (id) => projected[id] ?? null);
  assert.deepEqual(out.map((c) => [c.target, c.spareAtReset]), [["claude/idle", 80]]);
  assert.equal(SPARE_BELOW_PCT, 60);
});

test("spare: every other account busy or full → nothing", () => {
  const out = spareCandidates("claude/work", [cand("claude/a"), cand("claude/b")], (id) => id === "claude/a", () => 75);
  assert.deepEqual(out, []);
});

test("projected at reset adds the account's own burn until its longest window resets", () => {
  const s = snap([["five_hour", 10, 2], ["seven_day", 20, 24]]);
  assert.equal(projectedAtReset(s, [sample(-2, { seven_day: 18 })], NOW), 20 + 1 * 24);
  assert.equal(projectedAtReset(s, [], NOW), 20, "no burn known → today's fill");
});

const store = () => new RequestStore(fs.mkdtempSync(path.join(os.tmpdir(), "asw-pace-")), () => NOW);
const fast = { snapshot: snap([["seven_day", 60, 48]]), history: [sample(-2, { seven_day: 48 })], thresholdPct: 98, now: NOW };

test("raising a pace request: one per session, carries kind, ETA and spare; a second tick creates nothing", () => {
  const s = store();
  const input = { account: "claude/work", sessions: ["s1"], ...fast, candidates: () => [cand("claude/idle")], busy: busyNone, projected: () => 10 };
  const created = raisePaceForAccount(s, input);
  assert.equal(created.length, 1);
  assert.equal(created[0].reason.kind, "pace");
  assert.ok(typeof created[0].reason.etaFull === "number");
  assert.equal(created[0].candidates[0].spareAtReset, 90);
  assert.equal(raisePaceForAccount(s, input).length, 0);
});

test("no room anywhere → no pace request", () => {
  const s = store();
  const created = raisePaceForAccount(s, { account: "claude/work", sessions: ["s1"], ...fast, candidates: () => [cand("claude/idle")], busy: busyNone, projected: () => 90 });
  assert.equal(created.length, 0);
});

test("a declined pace request is not raised again in the same window", () => {
  const s = store();
  const input = { account: "claude/work", sessions: ["s1"], ...fast, candidates: () => [cand("claude/idle")], busy: busyNone, projected: () => 10 };
  const [r] = raisePaceForAccount(s, input);
  s.decide(r.id, { kind: "decline", by: "as-gui" });
  assert.equal(raisePaceForAccount(s, input).length, 0);
  assert.equal(s.list().filter((x) => x.reason.kind === "pace").length, 1);
});

test("at most one open pace request per account across windows", () => {
  const s = store();
  const base = { account: "claude/work", sessions: ["s1"], candidates: () => [cand("claude/idle")], busy: busyNone, projected: () => 10, thresholdPct: 98, now: NOW };
  assert.equal(raisePaceForAccount(s, { ...base, snapshot: snap([["seven_day", 60, 48]]), history: [sample(-2, { seven_day: 48 })] }).length, 1);
  const other = raisePaceForAccount(s, { ...base, snapshot: snap([["seven_day", 60, 48], ["weekly_opus", 70, 30]]), history: [sample(-2, { seven_day: 60, weekly_opus: 50 })] });
  assert.equal(other.length, 0);
});

test("a nothing-runs account gets no pace request", () => {
  const s = store();
  assert.equal(raisePaceForAccount(s, { account: "claude/work", sessions: [], ...fast, candidates: () => [cand("claude/idle")], busy: busyNone, projected: () => 10 }).length, 0);
});

test("a poll: imbalance with a live session opens one pace request; the next poll the same; setting off none", () => {
  const input = { account: "claude/work", sessions: ["s1"], ...fast, candidates: () => [cand("claude/idle")], busy: busyNone, projected: () => 10 };
  const s = store();
  const first = raiseAsks(s, { ...input, paceOn: true });
  assert.deepEqual(first.map((r) => r.reason.kind), ["pace"]);
  assert.equal(raiseAsks(s, { ...input, paceOn: true }).length, 0);
  assert.equal(s.list().length, 1);
  assert.equal(raiseAsks(store(), { ...input, paceOn: false }).length, 0);
});

test("a poll at the ask mark raises the limit request, not a pace one", () => {
  const s = store();
  const created = raiseAsks(s, {
    account: "claude/work", sessions: ["s1"], snapshot: snap([["seven_day", 93, 48]]), history: [sample(-2, { seven_day: 70 })],
    thresholdPct: 98, now: NOW, candidates: () => [cand("claude/idle")], busy: busyNone, projected: () => 10, paceOn: true,
  });
  assert.equal(created.length, 1);
  assert.equal(created[0].reason.kind, undefined);
});
