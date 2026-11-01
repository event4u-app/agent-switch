/**
 * claude-swap list schema v1 — the account list CodexBar and ccdeck read from
 * `cswap --list --json`, emitted for agent-switch's Claude profiles (roadmap
 * road-to-the-rows-where-others-lead, Phase 2, decision D2).
 *
 * Read-only by design: `supportsAccountSwitching` is always false, so a
 * consumer never offers a switch. Cache only — the daemon's state file and each
 * profile's `usage-latest.json`. No network, no credential read; the email
 * comes from the profile's `.claude.json` account metadata.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { ROOT, activeFor, identity, isDisabled, listProfiles, profileDir } from "./profiles.js";
import { cacheMaxAgeMs, readDaemonState } from "./daemon.js";
import { LATEST_FILE, readLatestSnapshot } from "./history.js";
import { withFileLockSync } from "./locks.js";
import type { UsageSnapshot } from "./usage.js";

export const CSWAP_FORMAT = "cswap-v1";
/** Profile name → account number, kept next to `state.json`. */
export const CSWAP_NUMBERS_FILE = "cswap-numbers.json";

export type CswapUsageStatus = "ok" | "stale" | "unavailable";

export interface CswapWindow {
  pct: number | null;
  resetsAt: string | null;
}

export interface CswapAccount {
  number: number;
  email: string | null;
  alias: string;
  active: boolean;
  disabled: boolean;
  usageStatus: CswapUsageStatus;
  usage: { fiveHour: CswapWindow | null; sevenDay: CswapWindow | null } | null;
  usageFetchedAt: string | null;
  usageAgeSeconds: number | null;
}

export interface CswapList {
  schemaVersion: 1;
  supportsAccountSwitching: false;
  activeAccountNumber: number | null;
  accounts: CswapAccount[];
}

export interface CswapError {
  schemaVersion: 1;
  error: { code: string; message: string };
}

export interface CswapProfileInput {
  name: string;
  email: string | null;
  active: boolean;
  disabled: boolean;
  snapshot: UsageSnapshot | null;
}

/** `next` only ever grows, so a removed profile's number is never handed out again. */
export interface NumberMap {
  schema: 1;
  next: number;
  numbers: Record<string, number>;
}

export function emptyNumberMap(): NumberMap {
  return { schema: 1, next: 1, numbers: {} };
}

export function cswapError(code: string, message: string): CswapError {
  return { schemaVersion: 1, error: { code, message } };
}

/** Keep the numbers of present names, drop absent ones, and give new names
 *  (sorted) the next numbers. Pure; tolerates a corrupt map. */
export function assignNumbers(prev: NumberMap, names: string[]): NumberMap {
  const old = prev && typeof prev.numbers === "object" && prev.numbers ? prev.numbers : {};
  const valid = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n > 0;
  const highest = Math.max(0, ...Object.values(old).filter(valid));
  let next = Math.max(valid(prev?.next) ? prev.next : 1, highest + 1);
  const numbers: Record<string, number> = {};
  for (const name of names) if (valid(old[name])) numbers[name] = old[name];
  for (const name of [...names].sort()) if (numbers[name] === undefined) numbers[name] = next++;
  return { schema: 1, next, numbers };
}

function windowOf(s: UsageSnapshot, key: string): CswapWindow | null {
  const w = s.windows.find((x) => x.key === key);
  return w ? { pct: w.utilization, resetsAt: w.resetsAt } : null;
}

/** Pure builder. `staleAfterMs` is the age past which cached usage is "stale". */
export function buildCswapList(
  profiles: CswapProfileInput[],
  numbers: Record<string, number>,
  now: number,
  staleAfterMs: number,
): CswapList {
  const accounts = profiles.map((p): CswapAccount => {
    const capturedMs = p.snapshot ? Date.parse(p.snapshot.capturedAt) : NaN;
    const fiveHour = p.snapshot && !isNaN(capturedMs) ? windowOf(p.snapshot, "five_hour") : null;
    const sevenDay = p.snapshot && !isNaN(capturedMs) ? windowOf(p.snapshot, "seven_day") : null;
    const known = fiveHour !== null || sevenDay !== null;
    const age = known ? Math.max(0, now - capturedMs) : null;
    return {
      number: numbers[p.name],
      email: p.email,
      alias: p.name,
      active: p.active,
      disabled: p.disabled,
      usageStatus: age === null ? "unavailable" : age <= staleAfterMs ? "ok" : "stale",
      usage: known ? { fiveHour, sevenDay } : null,
      usageFetchedAt: known ? p.snapshot!.capturedAt : null,
      usageAgeSeconds: age === null ? null : Math.floor(age / 1000),
    };
  });
  accounts.sort((a, b) => a.number - b.number);
  return {
    schemaVersion: 1,
    supportsAccountSwitching: false,
    activeAccountNumber: accounts.find((a) => a.active)?.number ?? null,
    accounts,
  };
}

function readNumberMap(file: string): NumberMap {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as NumberMap;
  } catch {
    return emptyNumberMap();
  }
}

/** Load the stored map, update it for the current profiles, and persist it
 *  only when it changed. */
function storedNumbers(names: string[]): Record<string, number> {
  const file = path.join(ROOT, CSWAP_NUMBERS_FILE);
  return withFileLockSync(file, () => {
    const prev = readNumberMap(file);
    const next = assignNumbers(prev, names);
    if (JSON.stringify(prev) !== JSON.stringify(next)) {
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
      fs.renameSync(tmp, file);
    }
    return next.numbers;
  });
}

/** The list from local files only: the daemon's snapshot or the profile's own
 *  `usage-latest.json`, whichever is newer. */
export function readCswapList(now: number = Date.now()): CswapList {
  const names = listProfiles("claude");
  const state = readDaemonState();
  const active = activeFor("claude");
  const profiles = names.map((name): CswapProfileInput => {
    const fromDaemon = state?.profiles?.[`claude/${name}`] ?? null;
    const latest = readLatestSnapshot(path.join(profileDir("claude", name), LATEST_FILE));
    const daemonMs = fromDaemon ? Date.parse(fromDaemon.capturedAt) : NaN;
    const snapshot = latest && (isNaN(daemonMs) || latest.capturedMs > daemonMs) ? latest.snapshot : fromDaemon;
    return { name, email: identity("claude", name), active: active === name, disabled: isDisabled("claude", name), snapshot };
  });
  // "stale" past the age at which the CLI itself stops serving a cached
  // snapshot and reads live instead (daemon cadence + one loop wake).
  return buildCswapList(profiles, storedNumbers(names), now, cacheMaxAgeMs(state?.pollIntervalMs));
}

/** CLI entry for `--list` (format implied) and `list --format <f>`: print the
 *  list, or a schema-v1 error and exit non-zero. */
export function printCswapList(flags: Record<string, string | boolean | undefined>, formatImplied: boolean): void {
  const format = "format" in flags ? flags.format : formatImplied ? CSWAP_FORMAT : undefined;
  if (format !== CSWAP_FORMAT) {
    console.log(JSON.stringify(cswapError("unsupported_format", `unknown --format "${String(format ?? "")}" (supported: ${CSWAP_FORMAT})`)));
    process.exit(2);
  }
  try {
    console.log(JSON.stringify(readCswapList(), null, 2));
  } catch (e) {
    console.log(JSON.stringify(cswapError("read_failed", (e as Error)?.message ?? String(e))));
    process.exit(1);
  }
}
