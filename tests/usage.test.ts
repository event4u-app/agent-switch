import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseUsage,
  formatSnapshot,
  detectCrossings,
  maxUtilization,
  pickSwitchTarget,
  type ThresholdState,
  type UsageSnapshot,
} from "../src/usage.js";

const AT = "2026-07-13T12:00:00.000Z";

const snap = (util: number[]): UsageSnapshot => ({
  windows: util.map((u, i) => ({ key: `w${i}`, label: `w${i}`, utilization: u, resetsAt: null })),
  routines: null,
  capturedAt: AT,
});

test("maxUtilization returns the highest window value, or null when none known", () => {
  assert.equal(maxUtilization(snap([12, 63, 80])), 80);
  assert.equal(maxUtilization({ windows: [], routines: null, capturedAt: AT }), null);
});

test("pickSwitchTarget returns null while the active profile still has headroom", () => {
  const cands = [
    { name: "work", snapshot: snap([50]) },
    { name: "privat", snapshot: snap([10]) },
  ];
  assert.equal(pickSwitchTarget("work", cands, 95), null);
});

test("pickSwitchTarget picks the most-headroom account once the active one is maxed", () => {
  const cands = [
    { name: "work", snapshot: snap([96]) }, // active, over threshold
    { name: "privat", snapshot: snap([40]) },
    { name: "acme", snapshot: snap([20]) }, // most headroom
  ];
  assert.equal(pickSwitchTarget("work", cands, 95), "acme");
});

test("pickSwitchTarget returns null when every other account is also maxed", () => {
  const cands = [
    { name: "work", snapshot: snap([99]) },
    { name: "privat", snapshot: snap([97]) },
  ];
  assert.equal(pickSwitchTarget("work", cands, 95), null);
});

test("parseUsage reads all four windows + routines, rounding utilization", () => {
  const raw = {
    five_hour: { utilization: 12.4, resets_at: "2026-07-13T17:00:00Z" },
    seven_day: { utilization: 63.6, resets_at: "2026-07-20T00:00:00Z" },
    seven_day_opus: { utilization: 80, resets_at: "2026-07-20T00:00:00Z" },
    seven_day_sonnet: { utilization: 20, resets_at: "2026-07-20T00:00:00Z" },
    routines: { used: 3, limit: 10 },
  };
  const s = parseUsage(raw, AT);
  assert.deepEqual(s.windows.map((w) => `${w.key}:${w.utilization}`), [
    "five_hour:12",
    "seven_day:64",
    "seven_day_opus:80",
    "seven_day_sonnet:20",
  ]);
  assert.deepEqual(s.routines, { used: 3, limit: 10 });
  assert.equal(s.capturedAt, AT);
});

test("parseUsage degrades on missing/garbage without throwing", () => {
  assert.deepEqual(parseUsage(null, AT).windows, []);
  assert.deepEqual(parseUsage({ five_hour: "nope" }, AT).windows, []);
  // a window with only a reset (no utilization) is still kept; routines needs both fields
  const s = parseUsage({ seven_day: { resets_at: "2026-07-20T00:00:00Z" }, routines: { used: 1 } }, AT);
  assert.equal(s.windows.length, 1);
  assert.equal(s.windows[0].utilization, null);
  assert.equal(s.routines, null);
});

test("formatSnapshot renders percent lines + routines, skips null-utilization windows", () => {
  const s = parseUsage({ five_hour: { utilization: 50, resets_at: AT }, routines: { used: 2, limit: 5 } }, AT);
  const lines = formatSnapshot(s);
  assert.ok(lines.some((l) => l.includes("5h:") && l.includes("50%")));
  assert.ok(lines.some((l) => l.includes("routines: 2/5")));
});

test("detectCrossings fires each threshold once per window cycle (edge-triggered)", () => {
  const win = (u: number, reset: string) => parseUsage({ five_hour: { utilization: u, resets_at: reset } }, AT);
  let state: ThresholdState = {};

  // 60% → nothing.
  let r = detectCrossings(win(60, "R1"), state);
  assert.deepEqual(r.crossings, []);
  state = r.state;

  // 78% → crosses 75 once.
  r = detectCrossings(win(78, "R1"), state);
  assert.deepEqual(r.crossings.map((c) => c.threshold), [75]);
  state = r.state;

  // still 78% same cycle → no re-fire.
  r = detectCrossings(win(78, "R1"), state);
  assert.deepEqual(r.crossings, []);
  state = r.state;

  // 92% same cycle → crosses 90 (75 already fired).
  r = detectCrossings(win(92, "R1"), state);
  assert.deepEqual(r.crossings.map((c) => c.threshold), [90]);
  state = r.state;

  // window rolls over (new resets_at) at 80% → 75 fires again for the new cycle.
  r = detectCrossings(win(80, "R2"), state);
  assert.deepEqual(r.crossings.map((c) => c.threshold), [75]);
});
