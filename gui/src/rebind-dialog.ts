/**
 * GUI mirror of the CLI's pure rebind-dialog model (src/rebind-dialog.ts). It
 * shapes what the "Switch account" panel shows and pre-selects the best-headroom
 * target; it performs NO switch and does NO I/O. The switch is always the user's
 * explicit click (road-to-live-rebind.md § Out of scope) — this module only maps
 * data to rows + a suggestion. The credential write lives entirely in the CLI
 * `rebind` command, invoked via `ipc.rebindTo`.
 *
 * Suggestion ranking is identical to the CLI's: lowest known max-utilization =
 * most headroom, running profile excluded, unknown-usage rows never suggested,
 * ties keep the first row.
 */

/** A profile the dialog may offer + its own nearest-limit utilization (0-100),
 *  null when no usage is known (credential unreadable / unknown API shape). The
 *  caller computes `max` with transforms.nearestLimit, the GUI analogue of the
 *  CLI's maxUtilization. */
export interface RebindCandidate {
  name: string;
  max: number | null;
  label?: string | null;
}

/** One rendered row. `maxUtil` is the profile's own highest window utilization
 *  (0-100), or null when unknown. `isRunning` flags the live profile — never a
 *  selectable target. */
export interface RebindDialogRow {
  profile: string;
  label: string | null;
  maxUtil: number | null;
  isRunning: boolean;
}

export interface RebindDialogModel {
  rows: RebindDialogRow[];
  /** The pre-selected best-headroom (lowest maxUtil) non-running profile, or
   *  null when no other profile has a known usage value. A convenience default —
   *  the user may pick any selectable row. */
  suggestedProfile: string | null;
}

/**
 * Build the dialog model — mirrors the CLI `buildRebindDialog`. `runningProfile`
 * is the live profile; it is marked `isRunning` (excluded from the suggestion and,
 * via {@link selectableRows}, from the selectable list). Pure — plain data in,
 * plain data out.
 */
export function buildRebindDialog(candidates: RebindCandidate[], runningProfile: string): RebindDialogModel {
  const rows: RebindDialogRow[] = candidates.map((c) => ({
    profile: c.name,
    label: c.label ?? null,
    maxUtil: c.max,
    isRunning: c.name === runningProfile,
  }));

  // Suggestion = lowest known max-utilization among the non-running rows (most
  // headroom). Unknown usage never wins; ties keep the first row. Same ranking
  // as the CLI — no new ranking invented.
  let best: RebindDialogRow | null = null;
  for (const r of rows) {
    if (r.isRunning || r.maxUtil === null) continue;
    if (best === null || r.maxUtil < (best.maxUtil as number)) best = r;
  }

  return { rows, suggestedProfile: best ? best.profile : null };
}

/** The selectable (non-running) rows, in model order. */
export function selectableRows(model: RebindDialogModel): RebindDialogRow[] {
  return model.rows.filter((r) => !r.isRunning);
}
