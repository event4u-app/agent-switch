/**
 * Usage engine — policy-scoped, own-profile only.
 *
 * Parses Claude's OAuth `/usage` response into a defensive snapshot, formats it
 * for `status`, tracks 30-day history, and detects active-profile threshold
 * crossings. It NEVER compares or ranks accounts — that is the anti-rotation
 * boundary the whole roadmap is locked around. Codex/Gemini have no usage
 * readout (verified), so they surface "usage unavailable" and never reach here.
 */

export interface UsageWindow {
  key: string;
  label: string;
  /** 0-100, rounded; null when the field is missing/non-numeric. */
  utilization: number | null;
  /** ISO reset timestamp; null when absent. */
  resetsAt: string | null;
}

export interface UsageSnapshot {
  windows: UsageWindow[];
  /** Claude Code daily routines (used/limit) when present. */
  routines: { used: number; limit: number } | null;
  /** ISO capture time. */
  capturedAt: string;
}

// The windows Claude's /usage exposes, richest first. seven_day_opus/sonnet are
// the per-model 7-day windows (extension-verified); absent shapes are skipped.
const WINDOW_DEFS: ReadonlyArray<readonly [string, string]> = [
  ["five_hour", "5h"],
  ["seven_day", "7d"],
  ["seven_day_opus", "7d Opus"],
  ["seven_day_sonnet", "7d Sonnet"],
];

/** Defensive parse — unknown shapes degrade to fewer windows, never throw. */
export function parseUsage(raw: any, capturedAt: string = new Date().toISOString()): UsageSnapshot {
  const windows: UsageWindow[] = [];
  for (const [key, label] of WINDOW_DEFS) {
    const w = raw?.[key];
    if (!w || typeof w !== "object") continue;
    const utilization = typeof w.utilization === "number" ? Math.round(w.utilization) : null;
    const resetsAt = typeof w.resets_at === "string" ? w.resets_at : null;
    if (utilization === null && resetsAt === null) continue;
    windows.push({ key, label, utilization, resetsAt });
  }
  let routines: { used: number; limit: number } | null = null;
  const r = raw?.routines;
  if (r && typeof r.used === "number" && typeof r.limit === "number") {
    routines = { used: r.used, limit: r.limit };
  }
  return { windows, routines, capturedAt };
}

function resetHint(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `  resets ${d.toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })}`;
}

/** Human-readable lines for `status`; empty when nothing is known. */
export function formatSnapshot(s: UsageSnapshot): string[] {
  const lines: string[] = [];
  for (const w of s.windows) {
    if (w.utilization === null) continue;
    lines.push(`  ${w.label}: ${String(w.utilization).padStart(3)}%${w.resetsAt ? resetHint(w.resetsAt) : ""}`);
  }
  if (s.routines) lines.push(`  routines: ${s.routines.used}/${s.routines.limit}`);
  return lines;
}

// ---------- headroom + auto-switch decision (pure) --------------------------

/** Highest utilization across a snapshot's windows (0-100), or null when no
 *  window reports a number. This is a profile's OWN headroom, never a ranking. */
export function maxUtilization(s: UsageSnapshot): number | null {
  const vals = s.windows.map((w) => w.utilization).filter((u): u is number => typeof u === "number");
  return vals.length ? Math.max(...vals) : null;
}

export interface SwitchCandidate {
  name: string;
  snapshot: UsageSnapshot;
}

/**
 * Opt-in auto-switch decision (pure, no I/O). Given the active profile and the
 * same-provider candidates with their usage, return the profile to switch to,
 * or null. Switches only when the active profile has hit `threshold`% on some
 * window AND another candidate has strictly more headroom (lower max
 * utilization) while itself staying below `threshold`. Ties keep the first
 * candidate. This is a single switch decision gated behind config — never a
 * display ranking.
 */
export function pickSwitchTarget(active: string, candidates: SwitchCandidate[], threshold: number): string | null {
  const activeSnap = candidates.find((c) => c.name === active)?.snapshot;
  const activeMax = activeSnap ? maxUtilization(activeSnap) : null;
  if (activeMax === null || activeMax < threshold) return null; // active still has headroom

  let best: { name: string; max: number } | null = null;
  for (const c of candidates) {
    if (c.name === active) continue;
    const m = maxUtilization(c.snapshot);
    if (m === null || m >= threshold) continue; // unknown or also maxed → not a target
    if (!best || m < best.max) best = { name: c.name, max: m };
  }
  return best?.name ?? null;
}

// ---------- threshold detection (active profile only, edge-triggered) --------

/** Per-window: the reset stamp last seen + which thresholds have already fired
 *  for the current window cycle. Persisted by the daemon between polls. */
export type ThresholdState = Record<string, { resetsAt: string | null; fired: number[] }>;

export interface Crossing {
  window: string;
  threshold: number;
  utilization: number;
}

export const DEFAULT_THRESHOLDS = [75, 90];

/**
 * Edge-triggered threshold detection: a threshold fires once when utilization
 * first reaches it, and the fired-set resets when the window rolls over
 * (`resetsAt` changes). Returns the crossings for THIS poll plus the new state
 * to persist. Pure — no I/O, no cross-account view.
 */
export function detectCrossings(
  snapshot: UsageSnapshot,
  prev: ThresholdState,
  thresholds: number[] = DEFAULT_THRESHOLDS,
): { crossings: Crossing[]; state: ThresholdState } {
  const state: ThresholdState = {};
  const crossings: Crossing[] = [];
  for (const w of snapshot.windows) {
    const prevW = prev[w.key];
    if (w.utilization === null) {
      state[w.key] = prevW ?? { resetsAt: w.resetsAt, fired: [] };
      continue;
    }
    // Same cycle → keep the fired set; rolled over → reset it.
    const fired = prevW && prevW.resetsAt === w.resetsAt ? [...prevW.fired] : [];
    for (const t of thresholds) {
      if (w.utilization >= t && !fired.includes(t)) {
        crossings.push({ window: w.key, threshold: t, utilization: w.utilization });
        fired.push(t);
      }
    }
    state[w.key] = { resetsAt: w.resetsAt, fired };
  }
  return { crossings, state };
}
