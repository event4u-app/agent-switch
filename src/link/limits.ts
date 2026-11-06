/**
 * Every account's limits as one report, for another tool to read (the
 * agent-config link, `agent-switch limits --json`, MCP `limits_get`).
 *
 * Observations, never reservations: a usable account can be full by the time a
 * caller acts on it. Cached data only — the daemon and the app keep it fresh —
 * so reading this costs no request and no quota. A stale account keeps its
 * numbers and is marked, because a caller that sees nothing cannot tell "no
 * account" from "no fresh read".
 */

import { weigh } from "../balance.js";
import type { CachedUsage } from "../dir-resolve.js";
import type { ProviderId } from "../providers.js";
import type { UsageSnapshot } from "../usage.js";

export const LIMITS_SCHEMA = 1;

export interface LimitWindow {
  key: string;
  /** 0-100, or null when unknown or the window has reset since it was read. */
  fill: number | null;
  resetsAt: string | null;
  resetPassed: boolean;
}

export interface AccountLimits {
  id: string;
  provider: ProviderId;
  name: string;
  disabled: boolean;
  /** Free to take work now: fresh, enabled and under its threshold in every window. */
  usable: boolean;
  /** Why not usable; null when usable. */
  why: string | null;
  stale: boolean;
  observedAt: string | null;
  thresholdPct: number;
  windows: LimitWindow[];
  /** The cached readout as stored (labels, exact utilization, credits), for
   *  displays that show it rather than weigh it; null without a readout. */
  snapshot: UsageSnapshot | null;
}

export interface LimitsReport {
  v: typeof LIMITS_SCHEMA;
  at: string;
  accounts: AccountLimits[];
}

export interface LimitsInputs {
  now: number;
  accounts: { provider: ProviderId; name: string; disabled: boolean }[];
  usage: (provider: ProviderId, name: string) => CachedUsage;
  threshold: (provider: ProviderId, name: string) => number;
  freshMs: number;
}

function account(i: LimitsInputs, a: LimitsInputs["accounts"][number]): AccountLimits {
  const thresholdPct = i.threshold(a.provider, a.name);
  const base = { id: `${a.provider}/${a.name}`, provider: a.provider, name: a.name, disabled: a.disabled, thresholdPct };
  const u = i.usage(a.provider, a.name);
  if (!u.snapshot || u.capturedMs === null) {
    return { ...base, usable: false, why: a.disabled ? "disabled" : "no usage readout", stale: false, observedAt: null, windows: [], snapshot: null };
  }
  const windows: LimitWindow[] = u.snapshot.windows.map((w) => {
    const resetPassed = w.resetsAt !== null && !isNaN(Date.parse(w.resetsAt)) && Date.parse(w.resetsAt) <= i.now;
    return { key: w.key, fill: resetPassed ? null : w.utilization, resetsAt: w.resetsAt, resetPassed };
  });
  const stale = i.now - u.capturedMs > i.freshMs;
  // Weigh only what still holds: a window past its reset is no longer full.
  const live = { ...u.snapshot, windows: u.snapshot.windows.filter((_, k) => !windows[k].resetPassed) };
  const w = weigh(live, i.now, thresholdPct);
  const why = a.disabled
    ? "disabled"
    : stale
      ? `stale: last read ${Math.round((i.now - u.capturedMs) / 60_000)} min ago`
      : w.usable
        ? null
        : w.why;
  return { ...base, usable: why === null, why, stale, observedAt: new Date(u.capturedMs).toISOString(), windows, snapshot: u.snapshot };
}

export function buildLimits(i: LimitsInputs): LimitsReport {
  const accounts = i.accounts
    .map((a) => account(i, a))
    .sort((x, y) => (x.provider === y.provider ? x.name.localeCompare(y.name) : x.provider.localeCompare(y.provider)));
  return { v: LIMITS_SCHEMA, at: new Date(i.now).toISOString(), accounts };
}
