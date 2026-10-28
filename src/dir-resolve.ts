/**
 * Which profile a new session in a folder gets, and why — the logic behind
 * `agent-switch dir` (the shell wrapper's hot path) and `dir --json`.
 *
 * Order: folder rule (to a profile, or to a pool) > active profile > none.
 * A pool resolves to the member with the most headroom on FRESH cached usage.
 * Unknown usage is never treated as free: a member whose usage is older than
 * {@link FRESH_USAGE_MS}, missing, or who is signed out is skipped, and when no
 * member qualifies the rule falls back to the active profile and says so. No
 * network call happens here — only the cache the daemon / `status` already wrote.
 */

import { maxUtilization, type UsageSnapshot } from "./usage.js";
import { ProviderId } from "./providers.js";
import { isPoolRef, poolIdOf, parseMember, type Pool } from "./pools.js";

export const FRESH_USAGE_MS = 10 * 60_000;

export interface CachedUsage {
  snapshot: UsageSnapshot | null;
  /** When that snapshot was captured (ms), or null when nothing is cached. */
  capturedMs: number | null;
}

export interface ResolveInputs {
  providerId: ProviderId;
  /** Nearest folder rule for this provider, or null. `name` may be `pool:<id>`. */
  mapping: { path: string; name: string } | null;
  active: string | null;
  exists: (name: string) => boolean;
  signedIn: (name: string) => boolean;
  pool: (id: string) => Pool | null;
  usage: (name: string) => CachedUsage;
  now: number;
  /** Display form of a folder path (e.g. `~/x`). */
  displayPath?: (p: string) => string;
}

export interface Resolution {
  /** Resolved profile name (same provider), or null → provider default dir. */
  name: string | null;
  why: string[];
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

function fallbackToActive(i: ResolveInputs, why: string[]): Resolution {
  if (i.active && i.exists(i.active)) {
    why.push(`Using the active profile ${i.providerId}/${i.active}`);
    return { name: i.active, why };
  }
  why.push("No active profile — the tool starts with its own default login");
  return { name: null, why };
}

export function resolveForDir(i: ResolveInputs): Resolution {
  const shown = (p: string) => (i.displayPath ? i.displayPath(p) : p);
  const why: string[] = [];

  if (i.mapping && isPoolRef(i.mapping.name)) {
    const id = poolIdOf(i.mapping.name);
    why.push(`Rule: folder ${shown(i.mapping.path)} → pool ${id}`);
    const pool = i.pool(id);
    if (!pool) {
      why.push(`Pool ${id} no longer exists`);
      return fallbackToActive(i, why);
    }
    let best: { name: string; headroom: number; ageMs: number } | null = null;
    const considered = pool.members.map(parseMember).filter((m) => m && m.provider === i.providerId) as {
      provider: ProviderId;
      name: string;
    }[];
    if (considered.length === 0) {
      why.push(`Pool ${id} has no ${i.providerId} profile`);
      return fallbackToActive(i, why);
    }
    for (const { name } of considered) {
      const key = `${i.providerId}/${name}`;
      if (!i.exists(name)) {
        why.push(`Skipped ${key}: profile not found`);
        continue;
      }
      if (!i.signedIn(name)) {
        why.push(`Skipped ${key}: signed out`);
        continue;
      }
      const u = i.usage(name);
      const max = u.snapshot ? maxUtilization(u.snapshot) : null;
      if (u.capturedMs === null || max === null) {
        why.push(`Skipped ${key}: usage unknown`);
        continue;
      }
      const ageMs = i.now - u.capturedMs;
      if (ageMs > FRESH_USAGE_MS) {
        why.push(`Skipped ${key}: usage checked ${ago(ageMs)} (too old to trust)`);
        continue;
      }
      const headroom = 100 - max;
      if (!best || headroom > best.headroom) best = { name, headroom, ageMs };
    }
    if (!best) {
      why.push(`No member of pool ${id} has fresh usage`);
      return fallbackToActive(i, why);
    }
    why.push(`Most left in pool ${id} · ${i.providerId}/${best.name} at ${100 - best.headroom}% · usage checked ${ago(best.ageMs)}`);
    return { name: best.name, why };
  }

  if (i.mapping && i.exists(i.mapping.name)) {
    why.push(`Rule: folder ${shown(i.mapping.path)} → ${i.providerId}/${i.mapping.name}`);
    return { name: i.mapping.name, why };
  }
  if (i.mapping) why.push(`Rule: folder ${shown(i.mapping.path)} → ${i.providerId}/${i.mapping.name}, but that profile is gone`);
  return fallbackToActive(i, why);
}
