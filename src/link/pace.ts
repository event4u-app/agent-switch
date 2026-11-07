/**
 * Pace: whether an account with live work runs out well before its reset while
 * another account of the same provider would let unused room expire at its own
 * reset (road-to-limits-that-last-the-whole-run). Only measures and suggests;
 * a pace request is answered by the user like a limit request.
 *
 * Burn is read from the account's own captures — the hourly usage history plus
 * the snapshot just read — never from another account's data.
 */

import type { HistorySample } from "../history.js";
import type { UsageSnapshot } from "../usage.js";
import { askWindow } from "./raise.js";
import type { Candidate, SwitchRequest } from "./requests.js";

const HOUR_MS = 3_600_000;
/** Two captures closer than this say nothing reliable about a rate. */
export const MIN_SPAN_MS = 30 * 60_000;
/** Older captures describe how the account was used, not how it is used now. */
export const LOOKBACK_MS = 6 * HOUR_MS;
/** Too fast: full sooner than this share of the time left until the reset. */
export const TOO_FAST_RATIO = 0.8;
/** Room to spare: projected fill at the account's reset below this. */
export const SPARE_BELOW_PCT = 60;
/** A window resetting sooner than this is the limit ask's to watch: the 5h
 *  window fills during any real session and would make every session "too fast". */
export const MIN_RESET_H = 6;
/** A drop larger than rounding noise between two captures is a reset. */
const RESET_DROP = 2;

export interface PacePoint {
  at: number;
  fill: number;
}

/** One window's captures, oldest → newest, starting after the latest reset. */
export function pacePoints(history: HistorySample[], current: UsageSnapshot, key: string): PacePoint[] {
  const nowAt = Date.parse(current.capturedAt);
  const pts: PacePoint[] = [];
  for (const s of history) {
    const at = Date.parse(s.at);
    const fill = s.windows.find((w) => w.key === key)?.utilization;
    if (Number.isFinite(at) && typeof fill === "number" && !(at >= nowAt)) pts.push({ at, fill });
  }
  const cur = current.windows.find((w) => w.key === key)?.utilization;
  if (Number.isFinite(nowAt) && typeof cur === "number") pts.push({ at: nowAt, fill: cur });
  pts.sort((a, b) => a.at - b.at);
  let from = 0;
  for (let i = 1; i < pts.length; i++) if (pts[i - 1].fill - pts[i].fill > RESET_DROP) from = i;
  return pts.slice(from);
}

/** Fill change per hour over the recent captures; null when there are not two
 *  captures at least {@link MIN_SPAN_MS} apart. Never negative. */
export function burnRate(points: PacePoint[], now: number): number | null {
  const newest = points[points.length - 1];
  if (!newest) return null;
  const oldest = points.find((p) => p.at >= Math.min(newest.at, now) - LOOKBACK_MS && newest.at - p.at >= MIN_SPAN_MS);
  if (!oldest) return null;
  return Math.max(0, (newest.fill - oldest.fill) / ((newest.at - oldest.at) / HOUR_MS));
}

/** Hours until `thresholdPct` at this burn; null when nothing is used. */
export function etaFull(fill: number, burnPerHour: number | null, thresholdPct: number): number | null {
  if (burnPerHour === null || burnPerHour <= 0) return null;
  return Math.max(0, (thresholdPct - fill) / burnPerHour);
}

export interface PaceInput {
  snapshot: UsageSnapshot;
  history: HistorySample[];
  thresholdPct: number;
  now: number;
}

export type PaceReason = SwitchRequest["reason"] & { kind: "pace"; etaFull: number; burnPerHour: number };

/** The window that runs out soonest relative to its reset, when one is too fast. */
export function paceReason(i: PaceInput): PaceReason | null {
  if (askWindow(i.snapshot, i.now, i.thresholdPct)) return null;
  let best: PaceReason | null = null;
  for (const w of i.snapshot.windows) {
    if (typeof w.utilization !== "number" || !w.resetsAt) continue;
    const resetH = (Date.parse(w.resetsAt) - i.now) / HOUR_MS;
    if (!(resetH >= MIN_RESET_H)) continue;
    const burn = burnRate(pacePoints(i.history, i.snapshot, w.key), i.now);
    const eta = etaFull(w.utilization, burn, i.thresholdPct);
    if (eta === null || burn === null || eta >= resetH * TOO_FAST_RATIO) continue;
    if (!best || eta < best.etaFull) {
      best = { kind: "pace", window: w.key, fill: w.utilization, resetsAt: w.resetsAt, etaFull: round1(eta), burnPerHour: round1(burn) };
    }
  }
  return best;
}

/** Fill of the account's longest window when it resets, at its current burn. */
export function projectedAtReset(snapshot: UsageSnapshot, history: HistorySample[], now: number): number | null {
  const withReset = snapshot.windows.filter((w) => typeof w.utilization === "number" && w.resetsAt && Date.parse(w.resetsAt) > now);
  if (!withReset.length) return null;
  const w = withReset.reduce((a, b) => (Date.parse(b.resetsAt!) > Date.parse(a.resetsAt!) ? b : a));
  const burn = burnRate(pacePoints(history, snapshot, w.key), now) ?? 0;
  const resetH = (Date.parse(w.resetsAt!) - now) / HOUR_MS;
  return Math.min(100, (w.utilization as number) + burn * resetH);
}

/** Same-provider, idle accounts whose room would expire unused, most room first. */
export function spareCandidates(
  source: string,
  candidates: Candidate[],
  busy: (id: string) => boolean,
  projected: (id: string) => number | null,
): Candidate[] {
  const provider = source.split("/")[0];
  const out: Candidate[] = [];
  for (const c of candidates) {
    if (c.provider !== provider || busy(c.target)) continue;
    const p = projected(c.target);
    if (p === null || p >= SPARE_BELOW_PCT) continue;
    out.push({ ...c, spareAtReset: Math.round(100 - p) });
  }
  return out.sort((a, b) => (b.spareAtReset ?? 0) - (a.spareAtReset ?? 0) || a.target.localeCompare(b.target));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
