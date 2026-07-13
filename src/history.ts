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
