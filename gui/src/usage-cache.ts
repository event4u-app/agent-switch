import type { UsageSnapshot } from "./transforms.js";

/**
 * Local persistence for the last-known per-profile usage snapshot.
 *
 * The OAuth usage endpoint rate-limits, so a fresh fetch is not always
 * available on load. Remembering the last snapshot lets the UI show the
 * previous numbers (as greyed-out "stale" bars) instead of nothing, until a
 * live value arrives. Entries are keyed by `<provider>/<profile>` so Claude and
 * Codex profiles that share a name never collide.
 *
 * localStorage is wrapped in try/catch: it is absent under jsdom (tests) and
 * could throw in a locked-down webview — a cache miss must never break the UI.
 */

const KEY = "agent-switch.usage.v1";

/** A shown usage entry: the snapshot plus whether it came from a live fetch
 *  THIS session (`fresh`) or was restored from the cache (`fresh: false`). */
export interface UsageEntry {
  snap: UsageSnapshot;
  fresh: boolean;
}

function readRaw(): Record<string, UsageSnapshot> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, UsageSnapshot>) : {};
  } catch {
    return {};
  }
}

/** Restore the cached snapshots as stale entries (`fresh: false`), keyed by
 *  `<provider>/<profile>`. */
export function loadUsageCache(): Record<string, UsageEntry> {
  const raw = readRaw();
  const out: Record<string, UsageEntry> = {};
  for (const [key, snap] of Object.entries(raw)) {
    if (snap && Array.isArray(snap.windows)) out[key] = { snap, fresh: false };
  }
  return out;
}

/**
 * Backfill reset timestamps we already knew but a newer snapshot dropped, so a
 * reset time is never LOST once seen (the API omits `resets_at` for some
 * windows / at 0%). Per-window by key: if `next` has no `resetsAt` for a window
 * but `prev` did, carry the previous one forward. Pure — unit-testable.
 */
export function withStickyResets(prev: UsageSnapshot | undefined, next: UsageSnapshot): UsageSnapshot {
  if (!prev) return next;
  const prevReset = new Map(prev.windows.map((w) => [w.key, w.resetsAt]));
  return {
    ...next,
    windows: next.windows.map((w) => (w.resetsAt == null && prevReset.get(w.key) ? { ...w, resetsAt: prevReset.get(w.key)! } : w)),
  };
}

/** Age-based staleness: a snapshot is stale (render hatched) only when its
 *  `capturedAt` is older than `staleAfterMs` — so recently-captured or unchanged
 *  data (a skipped-on-cooldown fetch) stays solid, and only genuinely old data
 *  hatches. A missing/unparseable timestamp counts as stale (can't prove currency).
 *  No snapshot at all → not stale (the bars render N.A., not hatched-value). Pure. */
export function isUsageStale(snap: UsageSnapshot | undefined | null, now: number, staleAfterMs: number): boolean {
  if (!snap) return false;
  const age = now - Date.parse(snap.capturedAt);
  return !Number.isFinite(age) || age > staleAfterMs;
}

/** Persist one profile's latest snapshot for the next session. `key` is
 *  `<provider>/<profile>`. */
export function saveUsageSnapshot(key: string, snap: UsageSnapshot): void {
  try {
    const raw = readRaw();
    raw[key] = snap;
    localStorage.setItem(KEY, JSON.stringify(raw));
  } catch {
    /* ignore — persistence is best-effort */
  }
}

const ATTEMPTS_KEY = "agent-switch.usage.attempts.v1";

function readAttempts(): Record<string, number> {
  try {
    const raw = localStorage.getItem(ATTEMPTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** Last usage-fetch ATTEMPT time (unix ms) per `<provider>/<profile>`. Set on
 *  every attempt — success OR FAILURE — and persisted, so a failed fetch still
 *  records its attempt and a dev rebuild can't re-hammer the rate-limited usage
 *  endpoint (the bug behind the "Usage fetch failed" flood on every rebuild). */
export function getUsageAttempts(): Record<string, number> {
  return readAttempts();
}

export function markUsageAttempt(key: string, ts: number): void {
  try {
    const raw = readAttempts();
    raw[key] = ts;
    localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(raw));
  } catch {
    /* best-effort */
  }
}

/** True when the last fetch attempt for a profile is still within the cooldown,
 *  so it must NOT be re-fetched yet — whether that attempt succeeded or failed. */
export function fetchOnCooldown(attemptAt: number | undefined, cooldownMs: number, now: number = Date.now()): boolean {
  return typeof attemptAt === "number" && attemptAt > 0 && now - attemptAt < cooldownMs;
}

/** Forget one profile's cached snapshot AND its attempt timestamp. Called on
 *  rename so numbers from a prior account never linger under a reused key and
 *  the renamed profile is re-fetched right away. No-op if the key is absent. */
export function dropUsageSnapshot(key: string): void {
  try {
    const raw = readRaw();
    if (key in raw) {
      delete raw[key];
      localStorage.setItem(KEY, JSON.stringify(raw));
    }
    const attempts = readAttempts();
    if (key in attempts) {
      delete attempts[key];
      localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(attempts));
    }
  } catch {
    /* ignore — best-effort */
  }
}
