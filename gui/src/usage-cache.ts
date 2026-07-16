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

/** Forget one profile's cached snapshot. Called on rename so numbers from a
 *  prior account/state never linger under a reused `<provider>/<profile>` key
 *  until the next successful fetch overwrites them. No-op if the key is absent. */
export function dropUsageSnapshot(key: string): void {
  try {
    const raw = readRaw();
    if (!(key in raw)) return;
    delete raw[key];
    localStorage.setItem(KEY, JSON.stringify(raw));
  } catch {
    /* ignore — best-effort */
  }
}
