/**
 * Own-profile usage history — a small ring buffer per profile for the GUI
 * sparkline. Capped at 720 samples (≈ 30 days hourly); mode 0600. Records only
 * the profile's own window utilization, never anything cross-account.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { UsageSnapshot } from "./usage.js";

export const MAX_SAMPLES = 720; // 30 days at one sample/hour

export interface HistorySample {
  at: string; // ISO
  windows: { key: string; utilization: number | null }[];
}

export function readHistory(file: string): HistorySample[] {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(data?.samples) ? data.samples : [];
  } catch {
    return [];
  }
}

/** Minimum spacing between two recorded samples. The ring holds MAX_SAMPLES
 *  (720) and the chart spans ~30 days, so ~one sample/hour fills it. Frequent
 *  callers — a GUI refresh every few minutes, the 60s daemon poll — would
 *  otherwise pack 720 samples into a few hours and shrink the window to that.
 *  55 min (not a full 60) so a refresh landing slightly early still counts. */
export const HISTORY_MIN_GAP_MS = 55 * 60 * 1000;

/**
 * Throttled append: record `snapshot` only when the newest existing sample is
 * at least {@link HISTORY_MIN_GAP_MS} older (or there is none). This is the entry
 * point every recorder uses so no caller's cadence can bloat the ring. Time is
 * the snapshot's own `capturedAt`; an unparseable one always records.
 */
export function recordHistorySample(file: string, snapshot: UsageSnapshot): HistorySample[] {
  const samples = readHistory(file);
  const capturedMs = Date.parse(snapshot.capturedAt);
  const last = samples[samples.length - 1];
  if (last && Number.isFinite(capturedMs)) {
    const lastMs = Date.parse(last.at);
    if (Number.isFinite(lastMs) && capturedMs - lastMs < HISTORY_MIN_GAP_MS) return samples;
  }
  return appendSample(file, snapshot);
}

/** Append a snapshot as one sample, trimming to the newest MAX_SAMPLES. */
export function appendSample(file: string, snapshot: UsageSnapshot): HistorySample[] {
  const samples = readHistory(file);
  samples.push({
    at: snapshot.capturedAt,
    windows: snapshot.windows.map((w) => ({ key: w.key, utilization: w.utilization })),
  });
  const trimmed = samples.slice(-MAX_SAMPLES);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ schema: 1, samples: trimmed }, null, 2) + "\n", { mode: 0o600 });
  return trimmed;
}

/** The utilization series for one window key, oldest → newest (nulls dropped). */
export function seriesFor(samples: HistorySample[], windowKey: string): number[] {
  return samples
    .map((s) => s.windows.find((w) => w.key === windowKey)?.utilization)
    .filter((u): u is number => typeof u === "number");
}
