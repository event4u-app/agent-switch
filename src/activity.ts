/**
 * Activity log — what agent-switch itself did, and why. Append-only JSONL,
 * size-capped to the newest {@link ACTIVITY_MAX_LINES} entries, read by
 * `agent-switch activity [--json]` and the GUI.
 *
 * Only agent-switch's own actions land here (switch, rebind, login, redeem,
 * autostart, guard, update, protection, pool, remove) — never provider traffic.
 * Every string field passes {@link redactSecrets} on the way in, so a token that
 * leaked into an error message never reaches the file.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { ROOT, ensureRoot } from "./profiles.js";

export const ACTIVITY_FILE = path.join(ROOT, "activity.jsonl");
export const ACTIVITY_MAX_LINES = 2000;
/** Trim only once the file grows past this, so a normal append stays O(1). */
const TRIM_BYTES = 512 * 1024;
const MAX_FIELD = 300;

export const ACTIVITY_KINDS = [
  "switch",
  "rebind",
  "login",
  "redeem",
  "autostart",
  "guard",
  "update",
  "protection",
  "pool",
  "remove",
  "launcher",
  "settings",
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export interface ActivityEntry {
  at: string;
  kind: ActivityKind;
  /** `provider/name`, a pool id, or null when the action has no single target. */
  target: string | null;
  /** What happened, in a few words ("activated", "restored", "set warn"). */
  action: string;
  /** Why: the trigger ("user ran `agent-switch use`", "first-run default"). */
  reason: string;
  ok: boolean;
}

/** Strip anything shaped like a credential: OAuth/API key prefixes, JWTs, and
 *  long opaque runs. Over-redaction is fine here; a leaked token is not. */
export function redactSecrets(s: string): string {
  return s
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/\b(sk|rt|at|sess|ghp|gho|xox[abp])[-_][A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/[A-Za-z0-9_+=-]{40,}/g, "[redacted]");
}

function clean(s: string): string {
  const one = redactSecrets(String(s)).replace(/[\r\n\t]+/g, " ");
  return one.length > MAX_FIELD ? one.slice(0, MAX_FIELD - 1) + "…" : one;
}

export function appendActivity(
  e: Omit<ActivityEntry, "at"> & { at?: string },
  file: string = ACTIVITY_FILE,
): ActivityEntry | null {
  const entry: ActivityEntry = {
    at: e.at ?? new Date().toISOString(),
    kind: e.kind,
    target: e.target === null ? null : clean(e.target),
    action: clean(e.action),
    reason: clean(e.reason),
    ok: e.ok,
  };
  try {
    if (file === ACTIVITY_FILE) ensureRoot();
    fs.appendFileSync(file, JSON.stringify(entry) + "\n", { mode: 0o600 });
    if (fs.statSync(file).size > TRIM_BYTES) trimActivity(file);
    return entry;
  } catch {
    return null; // the log is a record, never a reason for a command to fail
  }
}

export function trimActivity(file: string): void {
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  if (lines.length <= ACTIVITY_MAX_LINES) return;
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, lines.slice(-ACTIVITY_MAX_LINES).join("\n") + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** Entries oldest → newest; malformed lines are skipped. `limit` keeps the newest N. */
export function readActivity(limit?: number, file: string = ACTIVITY_FILE): ActivityEntry[] {
  let raw = "";
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: ActivityEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    try {
      const e = JSON.parse(line);
      if (e && typeof e.at === "string" && (ACTIVITY_KINDS as readonly string[]).includes(e.kind)) out.push(e);
    } catch {
      /* skip */
    }
  }
  if (limit === undefined || limit < 0) return out;
  return limit === 0 ? [] : out.slice(-limit);
}
