/**
 * Per-session context-threshold detection + alert config (roadmap:
 * road-to-agent-switch-session-telemetry, Phase 3). Own-session only: a
 * crossing names a project dir + percentage + suggested action, NEVER another
 * profile (council #5 — furthest from the rotation line).
 *
 * Delivery is via the shared notification log (`src/notifications.ts` →
 * `appendNotification`): the daemon records the coalesced crossing there and
 * the GUI bell/flyout reads it + fires a best-effort desktop notification (the
 * app's single notifier). This module only DETECTS + COALESCES; it does not
 * fire an OS toast itself.
 *
 * Config lives in `<ROOT>/telemetry-config.json` (its own file rather than
 * state.json, whose readState rebuilds from known fields and would drop new
 * ones): { notify: boolean (default OFF), contextThresholds: number[] }.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export const DEFAULT_CONTEXT_THRESHOLDS = [80, 95];

export interface TelemetryConfig {
  notify: boolean;
  contextThresholds: number[];
}

export function configFile(root: string): string {
  return path.join(root, "telemetry-config.json");
}

export function readTelemetryConfig(root: string): TelemetryConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(configFile(root), "utf8"));
    const thresholds = Array.isArray(raw?.contextThresholds) && raw.contextThresholds.every((n: unknown) => typeof n === "number")
      ? [...raw.contextThresholds].sort((a, b) => a - b)
      : DEFAULT_CONTEXT_THRESHOLDS;
    return { notify: raw?.notify === true, contextThresholds: thresholds };
  } catch {
    return { notify: false, contextThresholds: DEFAULT_CONTEXT_THRESHOLDS };
  }
}

export function writeTelemetryConfig(root: string, cfg: TelemetryConfig): void {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(configFile(root), JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
}

// ---------- per-session context crossing detection (pure) ----------

export interface ContextSample {
  sessionId: string;
  /** 0–100 or null (window unknown → no threshold logic). */
  pct: number | null;
  /** Short project label for the notification (project dir basename / cwd). */
  where: string;
}

export interface ContextCrossing {
  sessionId: string;
  where: string;
  threshold: number;
  pct: number;
}

/** Per-session fired thresholds, persisted by the daemon (fixes the restart
 *  re-fire gap). Keyed by sessionId. */
export type ContextThresholdState = Record<string, { fired: number[]; lastPct: number }>;

/**
 * Edge-triggered per-session context crossings. A threshold fires once when a
 * session first reaches it. Re-arm (clear the fired set) happens when:
 *   - the session id is in `compacted` (a real PreCompact/PostCompact/
 *     SessionStart(compact) event was seen — the ground-truth signal), OR
 *   - pct fell below the lowest threshold (conservative fallback when hooks
 *     are not installed).
 * Pure — no I/O, own-session only (caller passes one profile's live sessions).
 */
export function detectContextCrossings(
  samples: ContextSample[],
  prev: ContextThresholdState,
  thresholds: number[] = DEFAULT_CONTEXT_THRESHOLDS,
  compacted: Set<string> = new Set(),
): { crossings: ContextCrossing[]; state: ContextThresholdState } {
  const sorted = [...thresholds].sort((a, b) => a - b);
  const minT = sorted[0] ?? Infinity;
  const state: ContextThresholdState = {};
  const crossings: ContextCrossing[] = [];

  for (const s of samples) {
    if (s.pct === null) continue; // window unknown → cannot threshold
    const prevS = prev[s.sessionId];
    let fired = prevS ? [...prevS.fired] : [];
    // re-arm on real compaction or a drop below the lowest threshold
    if (compacted.has(s.sessionId) || s.pct < minT) fired = [];
    for (const t of sorted) {
      if (s.pct >= t && !fired.includes(t)) {
        crossings.push({ sessionId: s.sessionId, where: s.where, threshold: t, pct: s.pct });
        fired.push(t);
      }
    }
    state[s.sessionId] = { fired, lastPct: s.pct };
  }
  return { crossings, state };
}

/** Coalesce same-cycle crossings into ONE notification body (council #11 — no
 *  toast storm). Reports the count + the single worst session. Project +
 *  percentage only; never a profile name. */
export function coalesce(crossings: ContextCrossing[]): { title: string; body: string } | null {
  if (crossings.length === 0) return null;
  const worst = crossings.reduce((a, b) => (b.pct > a.pct ? b : a));
  const n = new Set(crossings.map((c) => c.sessionId)).size;
  const title = n === 1 ? `Context ${worst.threshold}%+` : `${n} sessions high on context`;
  const body =
    n === 1
      ? `${worst.where} at ${worst.pct}% context — consider /compact`
      : `worst: ${worst.where} at ${worst.pct}% — consider /compact`;
  return { title, body };
}
