import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { appendSample, recordHistorySample, readHistory, seriesFor, MAX_SAMPLES } from "../src/history.js";
import * as H from "../src/history.js";
import { parseUsage } from "../src/usage.js";

function tmpFile(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "asw-hist-")), "usage-history.json");
}

const snap = (u: number) => parseUsage({ five_hour: { utilization: u, resets_at: "R" } }, `2026-07-13T00:00:00Z`);

test("appendSample creates the file and reads back", () => {
  const f = tmpFile();
  appendSample(f, snap(10));
  const h = readHistory(f);
  assert.equal(h.length, 1);
  assert.equal(h[0].windows[0].utilization, 10);
});

test("recordHistorySample throttles to ~hourly: near samples skipped, spaced ones kept", () => {
  const f = tmpFile();
  const at = (iso: string) => parseUsage({ five_hour: { utilization: 10, resets_at: "R" } }, iso);
  recordHistorySample(f, at("2026-07-13T00:00:00Z")); // first → always recorded
  recordHistorySample(f, at("2026-07-13T00:10:00Z")); // +10 min < 55 → skipped
  recordHistorySample(f, at("2026-07-13T00:40:00Z")); // +40 min < 55 → skipped
  recordHistorySample(f, at("2026-07-13T01:00:00Z")); // +60 min ≥ 55 → recorded
  const h = readHistory(f);
  assert.equal(h.length, 2, "only the first and the >55-min-later sample were recorded");
  assert.equal(h[1].at, "2026-07-13T01:00:00Z");
});

test("appendSample rings at MAX_SAMPLES (keeps the newest)", () => {
  const f = tmpFile();
  for (let i = 0; i < MAX_SAMPLES + 5; i++) appendSample(f, snap(i % 100));
  const h = readHistory(f);
  assert.equal(h.length, MAX_SAMPLES);
  // The last appended sample survived; the first ones were trimmed.
  assert.equal(h[h.length - 1].windows[0].utilization, (MAX_SAMPLES + 4) % 100);
});

test("seriesFor extracts one window's utilization series, dropping nulls", () => {
  const f = tmpFile();
  appendSample(f, snap(20));
  appendSample(f, parseUsage({ five_hour: { resets_at: "R" } }, "2026-07-13T01:00:00Z")); // null utilization
  appendSample(f, snap(40));
  assert.deepEqual(seriesFor(readHistory(f), "five_hour"), [20, 40]);
});

test("readHistory returns [] for a missing file", () => {
  assert.deepEqual(readHistory(path.join(os.tmpdir(), "nope-asw-hist.json")), []);
});

test("latest snapshot: every read is kept unthrottled, atomically, and read back with its age", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asw-latest-"));
  const file = path.join(dir, "usage-latest.json");
  const snap = (at: string, util: number) => ({ windows: [{ key: "five_hour", label: "5h", utilization: util, resetsAt: "2026-10-29T15:00:00Z" }], routines: null, capturedAt: at });
  assert.equal(H.readLatestSnapshot(file), null);
  H.writeLatestSnapshot(file, snap("2026-10-29T10:00:00Z", 10) as any);
  H.writeLatestSnapshot(file, snap("2026-10-29T10:05:00Z", 20) as any);
  const got = H.readLatestSnapshot(file)!;
  assert.equal(got.capturedMs, Date.parse("2026-10-29T10:05:00Z"));
  assert.equal(got.snapshot.windows[0].utilization, 20);
  assert.equal(got.snapshot.windows[0].resetsAt, "2026-10-29T15:00:00Z", "unlike history, the reset time is kept");
  if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(dir), ["usage-latest.json"], "no temp file left behind");
});
