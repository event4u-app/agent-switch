/**
 * The limit-dialog model (Phase 4) — the PURE, testable core behind the CLI's
 * interactive `agent-switch rebind` picker. It computes the switch-target rows
 * and the pre-selected best-headroom suggestion; it performs NO switch and does
 * NO I/O. The switch itself is always a user interaction (§ Out of scope,
 * road-to-live-rebind.md): this module only shapes what the user is shown and
 * maps their keystroke to a target. The credential write lives in rebind.ts.
 *
 * The suggestion reuses the usage helper `maxUtilization` — the same ranking
 * `pickSwitchTarget` uses (lowest max-utilization = most headroom); no new
 * ranking is invented. Unlike `pickSwitchTarget` it is NOT threshold-gated: the
 * user opened the dialog on demand, so a best-headroom target is always
 * pre-selected as a convenience (the pick, not the suggestion, is the switch).
 */

import { UsageSnapshot, maxUtilization } from "./usage.js";

/** A profile the dialog may offer, plus its own usage snapshot (null when the
 *  credential is unreadable or the API shape is unknown — status-parity). */
export interface RebindDialogCandidate {
  name: string;
  snapshot: UsageSnapshot | null;
  label?: string | null;
}

/** One rendered row. `maxUtil` is the profile's own highest window utilization
 *  (0–100), or null when no usage is known. `isRunning` flags the profile the
 *  live session currently serves — never a selectable target. */
export interface RebindDialogRow {
  profile: string;
  label: string | null;
  maxUtil: number | null;
  isRunning: boolean;
}

export interface RebindDialog {
  rows: RebindDialogRow[];
  /** The pre-selected best-headroom (lowest maxUtil) non-running profile, or
   *  null when no other profile has a known usage value / no other profile
   *  exists. A convenience default — the user may pick any row. */
  suggestedProfile: string | null;
}

/**
 * Build the dialog model. `runningProfile` is the profile the live session
 * serves; it is excluded from the suggestion (and, marked `isRunning`, from the
 * selectable rows). Pure — takes plain data, returns plain data.
 */
export function buildRebindDialog(
  candidates: RebindDialogCandidate[],
  runningProfile: string,
): RebindDialog {
  const rows: RebindDialogRow[] = candidates.map((c) => ({
    profile: c.name,
    label: c.label ?? null,
    maxUtil: c.snapshot ? maxUtilization(c.snapshot) : null,
    isRunning: c.name === runningProfile,
  }));

  // Suggestion = lowest known max-utilization among the non-running rows (most
  // headroom). Same ranking as pickSwitchTarget's `m < best.max`, reusing the
  // maxUtilization helper — no new ranking invented. Ties keep the first row.
  let best: RebindDialogRow | null = null;
  for (const r of rows) {
    if (r.isRunning || r.maxUtil === null) continue;
    if (best === null || r.maxUtil < (best.maxUtil as number)) best = r;
  }

  return { rows, suggestedProfile: best ? best.profile : null };
}

/** The selectable rows (non-running), in dialog order — the list the CLI
 *  numbers 1..N and that {@link resolveRebindChoice} indexes against. */
export function selectableRows(dialog: RebindDialog): RebindDialogRow[] {
  return dialog.rows.filter((r) => !r.isRunning);
}

export type RebindChoice =
  | { kind: "target"; profile: string }
  | { kind: "cancel" }
  | { kind: "invalid" };

/**
 * Map a raw picker keystroke to a target profile or a control action — the pure
 * selection→target mapping the readline loop delegates to. `q`/`c` (any case) =
 * cancel; empty = the pre-selected suggestion (or invalid when none); a 1-based
 * index into the selectable rows = that profile; anything else = invalid. Never
 * switches — it only resolves intent.
 */
export function resolveRebindChoice(input: string, dialog: RebindDialog): RebindChoice {
  const trimmed = input.trim().toLowerCase();
  if (trimmed === "q" || trimmed === "c") return { kind: "cancel" };

  const selectable = selectableRows(dialog);
  if (trimmed === "") {
    return dialog.suggestedProfile ? { kind: "target", profile: dialog.suggestedProfile } : { kind: "invalid" };
  }

  const n = Number(trimmed);
  if (Number.isInteger(n) && n >= 1 && n <= selectable.length) {
    return { kind: "target", profile: selectable[n - 1].profile };
  }
  return { kind: "invalid" };
}
