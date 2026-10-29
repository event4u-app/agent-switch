/**
 * Per-account usage for the view model, gentle on the rate-limited Claude
 * endpoint: the last snapshot is cached (so a reload never blanks the bars),
 * a fetch attempt — success OR failure — puts that account on cooldown for one
 * refresh interval, and consecutive Claude fetches are spaced. A manual refresh
 * forces a fetch past the cooldown. Ported from the classic window's refresh().
 */

import { profileUsage } from "../ipc.js";
import { getRefreshMinutes, setNextUsageRefreshAt } from "../settings-store.js";
import { fetchOnCooldown, getUsageAttempts, loadUsageCache, markUsageAttempt, saveUsageSnapshot, withStickyResets } from "../usage-cache.js";
import { hasUsageReadout, type ProviderId, type UsageSnapshot } from "../transforms.js";
import { notify } from "../redesign/engines/bus.js";

/** The /api/oauth/usage endpoint 429s on a few near-simultaneous reads, so
 *  consecutive Claude fetches are spaced; the other readouts are local. */
export const USAGE_FETCH_STAGGER_MS = import.meta.env?.MODE === "test" ? 0 : 1500;

let forceNext = false;

/** The next load fetches every account, ignoring the cooldown (manual refresh). */
export function forceUsageOnNextLoad(): void {
  forceNext = true;
}

const forcedKeys = new Set<string>();

/** The next load fetches this one account (`provider/name`) past its cooldown;
 *  the others keep theirs, so one refresh doesn't hit the rate-limited endpoint
 *  for every account. */
export function forceUsageFor(key: string): void {
  forcedKeys.add(key);
}

function takeForce(): boolean {
  const f = forceNext;
  forceNext = false;
  return f;
}

export function refreshIntervalMs(): number {
  return getRefreshMinutes() * 60_000;
}

/** Restart the auto-refresh countdown at a full interval; returns the deadline. */
export function restartUsageCountdown(now: number = Date.now()): number {
  const next = now + refreshIntervalMs();
  setNextUsageRefreshAt(next);
  return next;
}

export interface UsageDeps {
  fetch(provider: ProviderId, name: string): Promise<UsageSnapshot | null>;
  onFailure(provider: ProviderId, name: string): Promise<void>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

const defaultDeps: UsageDeps = {
  fetch: (p, n) => profileUsage(p, n).catch(() => null),
  onFailure: (p, n) => notify("warning", "Usage fetch failed", `Could not fetch usage limits for ${p}/${n}.`),
  sleep: (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve()),
  now: () => Date.now(),
};

/** Usage per profile (same order). On cooldown or failure the cached snapshot
 *  stands in — its own capturedAt carries its age. */
export async function loadUsage(
  profiles: readonly { provider: ProviderId; name: string; disabled?: boolean }[],
  opts: { force?: boolean; cooldownMs?: number; staggerMs?: number } = {},
  deps: UsageDeps = defaultDeps,
): Promise<(UsageSnapshot | null)[]> {
  const force = opts.force ?? takeForce();
  const forcedOne = new Set(forcedKeys);
  forcedKeys.clear();
  const cooldown = opts.cooldownMs ?? refreshIntervalMs();
  const stagger = opts.staggerMs ?? USAGE_FETCH_STAGGER_MS;
  const cache = loadUsageCache();
  const attempts = getUsageAttempts();
  const out: (UsageSnapshot | null)[] = profiles.map((p) => cache[`${p.provider}/${p.name}`]?.snap ?? null);

  const fetchOne = async (i: number) => {
    const { provider, name } = profiles[i];
    const key = `${provider}/${name}`;
    markUsageAttempt(key, deps.now()); // before the await: a rebuild mid-fetch can't re-fire it
    const snap = await deps.fetch(provider, name);
    if (snap) {
      const merged = withStickyResets(cache[key]?.snap, snap);
      saveUsageSnapshot(key, merged);
      out[i] = merged;
    } else {
      await deps.onFailure(provider, name);
    }
  };

  const due = profiles
    .map((p, i) => ({ p, i }))
    // A disabled account is read only when that one account is refreshed by
    // hand — never on the timer or a refresh-all; its last readout stays on show.
    .filter(({ p }) => {
      if (!hasUsageReadout(p.provider)) return false;
      const key = `${p.provider}/${p.name}`;
      if (forcedOne.has(key)) return true;
      return !p.disabled && (force || !fetchOnCooldown(attempts[key], cooldown, deps.now()));
    });
  const claude = due.filter(({ p }) => p.provider === "claude");
  const rest = due.filter(({ p }) => p.provider !== "claude");

  const sequential = async () => {
    for (let k = 0; k < claude.length; k++) {
      if (k > 0) await deps.sleep(stagger);
      await fetchOne(claude[k].i);
    }
  };
  await Promise.all([sequential(), ...rest.map(({ i }) => fetchOne(i))]);
  return out.map((snap, i) => (hasUsageReadout(profiles[i].provider) ? snap : null));
}
