import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseUsage,
  formatSnapshot,
  detectCrossings,
  maxUtilization,
  pickSwitchTarget,
  windowPace,
  type ThresholdState,
  type UsageSnapshot,
  type UsageWindow,
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

test("pickSwitchTarget honours the eligibility filter (tag scope)", () => {
  const cands = [
    { name: "work", snapshot: snap([96]) }, // active, over threshold
    { name: "privat", snapshot: snap([10]) }, // most headroom, but NOT eligible (wrong tag)
    { name: "work2", snapshot: snap([40]) }, // eligible
  ];
  // Only "work"/"work2" are eligible (e.g. tag=Work); "privat" is excluded despite
  // having the most headroom → the target is the eligible one.
  const eligible = (n: string) => n !== "privat";
  assert.equal(pickSwitchTarget("work", cands, 95, eligible), "work2");
  // No eligible target → null even though a maxed active would otherwise switch.
  assert.equal(pickSwitchTarget("work", cands, 95, (n) => n === "nope"), null);
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

test("parseUsage prefers the limits[] shape and surfaces the per-model (Fable) window", () => {
  const raw = {
    // legacy top-level keys are also present; the limits[] array wins when non-empty
    five_hour: { utilization: 9, resets_at: AT },
    seven_day: { utilization: 63, resets_at: AT },
    limits: [
      { kind: "session", percent: 9, resets_at: "2026-07-15T06:00:00Z", scope: null },
      { kind: "weekly_all", percent: 63, resets_at: "2026-07-17T18:00:00Z", scope: null },
      {
        kind: "weekly_scoped",
        percent: 95,
        resets_at: "2026-07-17T18:00:00Z",
        scope: { model: { id: null, display_name: "Fable" }, surface: null },
      },
    ],
  };
  const s = parseUsage(raw, AT);
  assert.deepEqual(
    s.windows.map((w) => `${w.key}:${w.label}:${w.utilization}`),
    ["five_hour:5h:9", "seven_day:All:63", "weekly_fable:Fable:95"],
  );
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

// ---------- windowPace (informational) ----------

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const CAP = Date.parse(AT);
// Build a weekly window whose cycle is `frac` elapsed at the AT capture instant:
// resets_at = cycleStart + WEEK, cycleStart = captured − frac·WEEK.
const pw = (util: number | null, frac: number, key = "seven_day"): UsageWindow => ({
  key,
  label: key,
  utilization: util,
  resetsAt: new Date(CAP - frac * WEEK_MS + WEEK_MS).toISOString(),
});

test("windowPace: ahead when more quota used than cycle elapsed", () => {
  // 80% used, 30% of the week elapsed → clearly ahead.
  assert.equal(windowPace(pw(80, 0.3), AT), "ahead");
});

test("windowPace: behind and on-track are derived from the gap, not hardcoded", () => {
  assert.equal(windowPace(pw(10, 0.5), AT), "behind"); // 0.10 − 0.50 = −0.40
  assert.equal(windowPace(pw(50, 0.5), AT), "on-track"); // gap 0 within ±minGap
});

test("windowPace: suppressed within 24h of the reset cycle start", () => {
  // 0.7 of a day elapsed (< 24h) → suppressed regardless of utilization.
  assert.equal(windowPace(pw(99, 0.1), AT), null);
});

test("windowPace: the 5h window is excluded", () => {
  assert.equal(windowPace(pw(90, 0.3, "five_hour"), AT), null);
});

test("windowPace: null when utilization or reset is missing, or captured is outside the cycle", () => {
  assert.equal(windowPace({ key: "seven_day", label: "7d", utilization: null, resetsAt: AT }, AT), null);
  assert.equal(windowPace({ key: "seven_day", label: "7d", utilization: 50, resetsAt: null }, AT), null);
  assert.equal(windowPace(pw(50, 1.3), AT), null); // captured past the reset → outside cycle
});

test("windowPace measures against capturedAt, not the wall clock (stale-safe)", () => {
  // Same window judged via its own capturedAt gives the same verdict no matter
  // when the test runs — the function takes no wall-clock input.
  const w = pw(80, 0.3);
  assert.equal(windowPace(w, AT), windowPace(w, AT));
  assert.equal(windowPace(w, AT), "ahead");
});
