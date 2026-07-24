/**
 * Usage engine — policy-scoped, own-profile only.
 *
 * Parses Claude's OAuth `/usage` response into a defensive snapshot, formats it
 * for `status`, tracks 30-day history, and detects active-profile threshold
 * crossings. It NEVER compares or ranks accounts — that is the anti-rotation
 * boundary the whole roadmap is locked around. Codex/Antigravity have no usage
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
  /** Codex only: banked rate-limit reset credits still available ("N available").
   *  Undefined for providers/plans that don't expose it. */
  resetCredits?: number | null;
}

// The windows Claude's /usage exposes, richest first. seven_day_opus/sonnet are
// the per-model 7-day windows (extension-verified); absent shapes are skipped.
const WINDOW_DEFS: ReadonlyArray<readonly [string, string]> = [
  ["five_hour", "5h"],
  ["seven_day", "7d"],
  ["seven_day_opus", "7d Opus"],
  ["seven_day_sonnet", "7d Sonnet"],
];

/** One entry of the current `limits[]` shape → a window, or null to skip. This
 *  array is the ONLY place the per-model weekly limit (e.g. Fable) is exposed;
 *  `weekly_all` is the all-models weekly window, `session` the 5h window. */
function windowFromLimit(l: any): UsageWindow | null {
  if (!l || typeof l !== "object") return null;
  const utilization = typeof l.percent === "number" ? Math.round(l.percent) : null;
  const resetsAt = typeof l.resets_at === "string" ? l.resets_at : null;
  if (utilization === null && resetsAt === null) return null;
  const kind = typeof l.kind === "string" ? l.kind : "";
  if (kind === "session") return { key: "five_hour", label: "5h", utilization, resetsAt };
  if (kind === "weekly_all") return { key: "seven_day", label: "All", utilization, resetsAt };
  if (kind === "weekly_scoped") {
    const model = l.scope?.model?.display_name;
    const surface = l.scope?.surface;
    const name = (typeof model === "string" && model) || (typeof surface === "string" && surface) || "scoped";
    const key = `weekly_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`;
    return { key, label: name, utilization, resetsAt };
  }
  return { key: kind || "unknown", label: kind ? kind.replace(/_/g, " ") : "?", utilization, resetsAt };
}

/** Defensive parse — unknown shapes degrade to fewer windows, never throw.
 *  Prefers the current `limits[]` array (carries the per-model Fable window);
 *  falls back to the legacy top-level `five_hour`/`seven_day` keys. */
export function parseUsage(raw: any, capturedAt: string = new Date().toISOString()): UsageSnapshot {
  const windows: UsageWindow[] = [];
  if (Array.isArray(raw?.limits) && raw.limits.length > 0) {
    const seen = new Set<string>();
    for (const l of raw.limits) {
      const w = windowFromLimit(l);
      if (w && !seen.has(w.key)) {
        seen.add(w.key);
        windows.push(w);
      }
    }
  }
  if (windows.length === 0) {
    for (const [key, label] of WINDOW_DEFS) {
      const w = raw?.[key];
      if (!w || typeof w !== "object") continue;
      const utilization = typeof w.utilization === "number" ? Math.round(w.utilization) : null;
      const resetsAt = typeof w.resets_at === "string" ? w.resets_at : null;
      if (utilization === null && resetsAt === null) continue;
      windows.push({ key, label, utilization, resetsAt });
    }
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

// ---------- pace (informational, pure) --------------------------------------

export type PaceStatus = "ahead" | "on-track" | "behind";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Default minimum gap (fraction of the window) before pace is called either
 *  way — guards against noise around the on-track line. */
export const PACE_MIN_GAP = 0.05;

/** Window length for pace, derived from the key. The 5h window is deliberately
 *  excluded (too short/bursty to pace meaningfully); only weekly windows pace. */
function paceWindowMs(key: string): number | null {
  if (key === "five_hour") return null;
  if (key.startsWith("seven_day") || key.startsWith("weekly")) return WEEK_MS;
  return null;
}

/**
 * "Ahead of pace" = more of the window's quota consumed than of its cycle
 * elapsed. PURE and stale-safe: time is measured against the snapshot's
 * `capturedAt` (its real measurement instant), never the wall clock, so a
 * re-served stale snapshot is judged against when it was actually taken. This
 * is purely informational — it is NEVER an input to a switch decision (the
 * anti-rotation boundary this file is locked around).
 *
 * Returns null when it cannot be judged: no utilization/reset, the 5h window,
 * within 24h of a reset (suppressed — early-cycle noise), or a captured time
 * outside the window's own cycle.
 */
export function windowPace(w: UsageWindow, capturedAtIso: string, minGap: number = PACE_MIN_GAP): PaceStatus | null {
  if (w.utilization === null || w.resetsAt === null) return null;
  const durMs = paceWindowMs(w.key);
  if (durMs === null) return null;
  const reset = Date.parse(w.resetsAt);
  const captured = Date.parse(capturedAtIso);
  if (Number.isNaN(reset) || Number.isNaN(captured)) return null;
  const cycleStart = reset - durMs;
  const elapsedMs = captured - cycleStart;
  if (elapsedMs < DAY_MS) return null; // 24h post-reset suppression
  if (elapsedMs <= 0 || elapsedMs > durMs) return null; // outside this cycle
  const aheadBy = w.utilization / 100 - elapsedMs / durMs;
  if (aheadBy > minGap) return "ahead";
  if (aheadBy < -minGap) return "behind";
  return "on-track";
}

/** Human-readable lines for `status`; empty when nothing is known. */
export function formatSnapshot(s: UsageSnapshot): string[] {
  const lines: string[] = [];
  for (const w of s.windows) {
    if (w.utilization === null) continue;
    // Surface only "ahead of pace" — the one informative signal; on-track /
    // behind are the quiet default and add no line noise.
    const pace = windowPace(w, s.capturedAt) === "ahead" ? "  · ahead of pace" : "";
    lines.push(`  ${w.label}: ${String(w.utilization).padStart(3)}%${w.resetsAt ? resetHint(w.resetsAt) : ""}${pace}`);
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
 * Opt-in switch SUGGESTION (pure, no I/O). Given the active profile and the
 * same-provider candidates with their usage, return the profile to suggest
 * switching to, or null. Suggests only when the active profile has hit
 * `threshold`% on some window AND another candidate has strictly more headroom
 * (lower max utilization) while itself staying below `threshold`. Ties keep the
 * first candidate. This computes the suggestion the daemon notifies with and the
 * user-clicked switch modal pre-selects — it never performs the switch itself,
 * and is never a display ranking.
 */
export function pickSwitchTarget(
  active: string,
  candidates: SwitchCandidate[],
  threshold: number,
  isEligible: (name: string) => boolean = () => true,
): string | null {
  const activeSnap = candidates.find((c) => c.name === active)?.snapshot;
  const activeMax = activeSnap ? maxUtilization(activeSnap) : null;
  if (activeMax === null || activeMax < threshold) return null; // active still has headroom

  let best: { name: string; max: number } | null = null;
  for (const c of candidates) {
    if (c.name === active) continue;
    if (!isEligible(c.name)) continue; // tag filter: only eligible accounts are switch targets
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
