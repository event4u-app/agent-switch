/**
 * Pick ledger — every account a wrapped start chose by itself, with the reasons
 * the resolver gave. Append-only JSONL, size-capped to the newest
 * {@link PICKS_MAX_LINES}, read by `agent-switch picks [--json]`.
 *
 * Separate from the activity log on purpose: a start happens far more often
 * than anything else agent-switch does, and would push every other entry out.
 * It is the evidence base for tuning the balance rule — no constant there
 * changes without a replay against these records. No prompt text, no session
 * content; every string passes {@link redactSecrets}.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { redactSecrets } from "./activity.js";
import { ROOT, ensureRoot } from "./profiles.js";

export const PICKS_FILE = path.join(ROOT, "picks.jsonl");
export const PICKS_MAX_LINES = 500;
const TRIM_BYTES = 256 * 1024;
const MAX_LINE = 300;
const MAX_WHY = 20;

export interface PickEntry {
  at: string;
  provider: string;
  /** `provider/name`, or null when the start fell back to the default install. */
  chosen: string | null;
  /** The resolver's reasons, in its own words — candidates, skips, tie-breaks. */
  why: string[];
  blocked?: string;
  note?: string;
}

function clean(s: string): string {
  const one = redactSecrets(String(s)).replace(/[\r\n\t]+/g, " ");
  return one.length > MAX_LINE ? one.slice(0, MAX_LINE - 1) + "…" : one;
}

export function appendPick(e: Omit<PickEntry, "at"> & { at?: string }, file: string = PICKS_FILE): PickEntry | null {
  const entry: PickEntry = {
    at: e.at ?? new Date().toISOString(),
    provider: clean(e.provider),
    chosen: e.chosen === null ? null : clean(e.chosen),
    why: e.why.slice(0, MAX_WHY).map(clean),
    ...(e.blocked ? { blocked: clean(e.blocked) } : {}),
    ...(e.note ? { note: clean(e.note) } : {}),
  };
  try {
    if (file === PICKS_FILE) ensureRoot();
    fs.appendFileSync(file, JSON.stringify(entry) + "\n", { mode: 0o600 });
    if (fs.statSync(file).size > TRIM_BYTES) trimPicks(file);
    return entry;
  } catch {
    return null; // a record, never a reason for a start to fail
  }
}

export function trimPicks(file: string): void {
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  if (lines.length <= PICKS_MAX_LINES) return;
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, lines.slice(-PICKS_MAX_LINES).join("\n") + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** Entries oldest → newest; malformed lines are skipped. `limit` keeps the newest N. */
export function readPicks(limit?: number, file: string = PICKS_FILE): PickEntry[] {
  let raw = "";
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: PickEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    try {
      const e = JSON.parse(line);
      if (e && typeof e.at === "string" && typeof e.provider === "string" && Array.isArray(e.why)) out.push(e);
    } catch {
      /* skip */
    }
  }
  if (limit === undefined || limit < 0) return out;
  return limit === 0 ? [] : out.slice(-limit);
}
