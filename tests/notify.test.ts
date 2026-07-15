import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  readTelemetryConfig,
  writeTelemetryConfig,
  detectContextCrossings,
  coalesce,
  DEFAULT_CONTEXT_THRESHOLDS,
  ContextSample,
  ContextThresholdState,
} from "../src/notify.js";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "asw-notify-"));
}

const s = (sessionId: string, pct: number | null, where = "proj"): ContextSample => ({ sessionId, pct, where });

// ---------- config ----------

test("telemetry config: defaults off, thresholds sorted, round-trips", () => {
  const root = tmp();
  const def = readTelemetryConfig(root);
  assert.equal(def.notify, false);
  assert.deepEqual(def.contextThresholds, DEFAULT_CONTEXT_THRESHOLDS);

  writeTelemetryConfig(root, { notify: true, contextThresholds: [95, 80] });
  const back = readTelemetryConfig(root);
  assert.equal(back.notify, true);
  assert.deepEqual(back.contextThresholds, [80, 95], "thresholds normalized ascending");
});

// ---------- per-session crossing detection ----------

test("detectContextCrossings: edge-triggered, fires each threshold once", () => {
  let state: ContextThresholdState = {};
  let r = detectContextCrossings([s("a", 82)], state);
  assert.deepEqual(r.crossings.map((c) => c.threshold), [80]);
  state = r.state;

  // still 82 next cycle → no re-fire
  r = detectContextCrossings([s("a", 82)], state);
  assert.deepEqual(r.crossings, []);
  state = r.state;

  // climbs to 96 → 95 fires (80 already fired)
  r = detectContextCrossings([s("a", 96)], state);
  assert.deepEqual(r.crossings.map((c) => c.threshold), [95]);
});

test("detectContextCrossings: null pct is ignored (window unknown)", () => {
  const r = detectContextCrossings([s("a", null)], {});
  assert.deepEqual(r.crossings, []);
  assert.equal("a" in r.state, false);
});

test("detectContextCrossings: re-arms on a real compaction event", () => {
  let r = detectContextCrossings([s("a", 96)], {});
  assert.equal(r.crossings.length, 2); // 80 + 95
  // compaction happened → fired set cleared; 96 fires again
  r = detectContextCrossings([s("a", 96)], r.state, DEFAULT_CONTEXT_THRESHOLDS, new Set(["a"]));
  assert.deepEqual(r.crossings.map((c) => c.threshold), [80, 95]);
});

test("detectContextCrossings: re-arms on a drop below the lowest threshold", () => {
  let r = detectContextCrossings([s("a", 82)], {});
  assert.equal(r.crossings.length, 1);
  // dropped below 80 (e.g. /clear) → fired cleared
  r = detectContextCrossings([s("a", 20)], r.state);
  assert.deepEqual(r.crossings, []);
  // climbs again → fires again
  r = detectContextCrossings([s("a", 82)], r.state);
  assert.deepEqual(r.crossings.map((c) => c.threshold), [80]);
});

test("detectContextCrossings: independent per session id", () => {
  const r = detectContextCrossings([s("a", 82), s("b", 96), s("c", 10)], {});
  const byId = Object.fromEntries(r.crossings.map((c) => [c.sessionId, c.threshold]));
  assert.equal(byId["a"], 80);
  assert.equal(r.crossings.filter((c) => c.sessionId === "b").length, 2);
  assert.equal(r.crossings.filter((c) => c.sessionId === "c").length, 0);
});

// ---------- coalescing (council #11) ----------

test("coalesce: one crossing → single-session title; none → null", () => {
  assert.equal(coalesce([]), null);
  const one = coalesce([{ sessionId: "a", where: "proj-x", threshold: 80, pct: 82 }])!;
  assert.match(one.title, /80%/);
  assert.match(one.body, /proj-x/);
  assert.match(one.body, /compact/);
});

test("coalesce: many crossings → ONE notification naming the worst, no profile names", () => {
  const note = coalesce([
    { sessionId: "a", where: "proj-x", threshold: 80, pct: 82 },
    { sessionId: "b", where: "proj-y", threshold: 95, pct: 97 },
    { sessionId: "c", where: "proj-z", threshold: 80, pct: 85 },
  ])!;
  assert.match(note.title, /3 sessions/);
  assert.match(note.body, /proj-y/); // the worst (97%)
  assert.match(note.body, /97%/);
  // own-session discipline: no "profile" wording, just project + pct
  assert.doesNotMatch(note.body, /profile/i);
});
