/**
 * Which profile a new session in a folder gets, and why — the logic behind
 * `agent-switch dir` (the shell wrapper's hot path) and `dir --json`.
 *
 * Order: folder rule (to a profile, or to a pool) > balanced plain start > active
 * profile > none. A rule never resolves outside itself: a disabled or missing
 * profile, like a pool that cannot serve, refuses the start (`blocked`).
 * A pool resolves to the member with the most headroom on FRESH cached usage.
 * Unknown usage is never treated as free: a member whose usage is older than
 * {@link FRESH_USAGE_MS}, missing, or who is signed out is skipped. A pool rule
 * never leaves its pool: with no fresh member it takes a usable member anyway,
 * and when the pool is gone or has no usable member the start is refused
 * (`blocked`) rather than run on an account outside it. No
 * network call happens here — only the cache the daemon / `status` already wrote.
 * The background service (`agent-switch service`) is what keeps that cache
 * fresh for pool members: it polls every member of a pool a folder rule targets.
 *
 * Live sessions: under guard `block` a member that already holds a live
 * session is skipped (starting there would be refused). Otherwise a free member
 * wins a headroom tie over a busy one, and a busy pick is called out.
 */

import type { UsageSnapshot } from "./usage.js";
import { describe, level, weigh, type Weighed } from "./balance.js";
import { ProviderId } from "./providers.js";
import { isPoolRef, poolIdOf, parseMember, type Pool } from "./pools.js";
import type { GuardPolicy } from "./single-load.js";

export const FRESH_USAGE_MS = 10 * 60_000;
export const DEFAULT_LIMIT_PCT = 95;

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
  /** True for a disabled profile (default: none is). */
  disabled?: (name: string) => boolean;
  /** True when the profile shares its login with the default install (default: none does). */
  sharesDefaultLogin?: (name: string) => boolean;
  /** All of this provider's profiles. Given → a start without a folder rule is
   *  balanced across them; absent → it uses the active profile. */
  names?: string[];
  /** Protection threshold per profile, % (default {@link DEFAULT_LIMIT_PCT}). */
  threshold?: (name: string) => number;
  pool: (id: string) => Pool | null;
  usage: (name: string) => CachedUsage;
  /** True when the profile already holds a live session (default: never). */
  live?: (name: string) => boolean;
  /** The single-load guard policy (default `off` → live sessions only break ties). */
  guard?: GuardPolicy;
  now: number;
  /** Display form of a folder path (e.g. `~/x`). */
  displayPath?: (p: string) => string;
}

export interface Resolution {
  /** Resolved profile name (same provider), or null → provider default dir. */
  name: string | null;
  why: string[];
  /** Set when a folder rule forbids every start it could make — the caller
   *  refuses instead of falling back to an account outside the rule. */
  blocked?: string;
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

function refuse(why: string[], reason: string): Resolution {
  why.push(`Refused: ${reason}`);
  return { name: null, why, blocked: reason };
}

export function resolveForDir(i: ResolveInputs): Resolution {
  const shown = (p: string) => (i.displayPath ? i.displayPath(p) : p);
  const why: string[] = [];

  if (i.mapping && isPoolRef(i.mapping.name)) {
    const id = poolIdOf(i.mapping.name);
    why.push(`Rule: folder ${shown(i.mapping.path)} → pool ${id}`);
    const pool = i.pool(id);
    if (!pool) return refuse(why, `pool ${id} no longer exists — bind the folder anew or remove the rule (agent-switch unmap)`);
    const considered = pool.members.map(parseMember).filter((m) => m && m.provider === i.providerId) as {
      provider: ProviderId;
      name: string;
    }[];
    if (considered.length === 0) return refuse(why, `pool ${id} has no ${i.providerId} profile — add one with agent-switch pool add`);
    const members = considered.map((m) => m.name);
    const best = pickBalanced(i, members, why, null);
    if (best) return { name: best, why };
    // No fresh numbers to weigh: still a member — the rule is a boundary first.
    const usable = (n: string) =>
      i.exists(n) && !i.disabled?.(n) && !i.sharesDefaultLogin?.(n) && i.signedIn(n) && !(i.guard === "block" && (i.live?.(n) ?? false));
    const anyone = members.filter(usable);
    if (!anyone.length) return refuse(why, `pool ${id} has no usable ${i.providerId} member (signed out, disabled, busy or sharing the default login)`);
    why.push(`No member of pool ${id} has fresh usage`);
    why.push("Usage comes from the background service or the open desktop app — keep one running (agent-switch service install)");
    if (i.active && anyone.includes(i.active)) {
      why.push(`Using the plain-start account ${i.providerId}/${i.active}, a member of pool ${id}`);
      return { name: i.active, why };
    }
    why.push(`Using ${i.providerId}/${anyone[0]}, the first usable member of pool ${id}`);
    return { name: anyone[0], why };
  }

  // A rule to one account is a boundary too: never another account in its place.
  if (i.mapping) {
    const key = `${i.providerId}/${i.mapping.name}`;
    const flag = i.providerId === "claude" ? "" : ` --provider ${i.providerId}`;
    why.push(`Rule: folder ${shown(i.mapping.path)} → ${key}`);
    if (!i.exists(i.mapping.name)) return refuse(why, `${key} no longer exists — bind the folder anew (agent-switch map) or remove the rule (agent-switch unmap)`);
    if (i.disabled?.(i.mapping.name)) return refuse(why, `${key} is disabled — turn it back on (agent-switch enable ${i.mapping.name}${flag}) or change the rule`);
    return { name: i.mapping.name, why };
  }
  return balancePlain(i, why);
}

/** No rule decides: balance across all profiles, or the active one when the
 *  caller gave no profile list. */
function balancePlain(i: ResolveInputs, why: string[]): Resolution {
  if (!i.names) return fallbackToActive(i, why);
  const n = i.names.length;
  why.push(`No folder rule — balancing across ${n} ${i.providerId} account${n === 1 ? "" : "s"} by what each would lose at its reset`);
  const best = pickBalanced(i, i.names, why, i.active);
  if (best) return { name: best, why };
  why.push("No account has fresh usage to weigh — using the plain-start account");
  return fallbackToActive(i, why);
}

/**
 * The candidate that would lose the most at its reset (see balance.ts), after
 * dropping every profile that can't take work. A level tie goes to `prefer`
 * (the plain-start account), then to one without a live session.
 */
function pickBalanced(i: ResolveInputs, names: string[], why: string[], prefer: string | null): string | null {
  const isLive = i.live ?? (() => false);
  const guard = i.guard ?? "off";
  const picks: { name: string; w: Extract<Weighed, { usable: true }>; live: boolean; ageMs: number }[] = [];
  for (const name of names) {
    const key = `${i.providerId}/${name}`;
    if (!i.exists(name)) {
      why.push(`Skipped ${key}: profile not found`);
      continue;
    }
    if (i.disabled?.(name)) {
      why.push(`Skipped ${key}: disabled`);
      continue;
    }
    if (i.sharesDefaultLogin?.(name)) {
      why.push(`Skipped ${key}: shares its login with the default install`);
      continue;
    }
    if (!i.signedIn(name)) {
      why.push(`Skipped ${key}: signed out`);
      continue;
    }
    const live = isLive(name);
    if (live && guard === "block") {
      why.push(`Skipped ${key}: already has a live session (guard: block would refuse it)`);
      continue;
    }
    const u = i.usage(name);
    if (u.capturedMs === null || !u.snapshot) {
      why.push(`Skipped ${key}: usage unknown`);
      continue;
    }
    const ageMs = i.now - u.capturedMs;
    if (ageMs > FRESH_USAGE_MS) {
      why.push(`Skipped ${key}: usage checked ${ago(ageMs)} (too old to trust)`);
      continue;
    }
    const w = weigh(u.snapshot, i.now, i.threshold?.(name) ?? DEFAULT_LIMIT_PCT);
    if (!w.usable) {
      why.push(`Skipped ${key}: ${w.why}`);
      continue;
    }
    picks.push({ name, w, live, ageMs });
  }
  if (!picks.length) return null;
  const top = picks.reduce((a, b) => (b.w.need > a.w.need ? b : a));
  const tied = picks.filter((p) => level(p.w.need, top.w.need));
  let chosen = top;
  if (tied.length > 1) {
    const free = tied.filter((p) => !p.live);
    const roomiest = (ps: typeof tied) => ps.reduce((a, b) => (b.w.peak < a.w.peak ? b : a));
    chosen = tied.find((p) => p.name === prefer) ?? (free.length ? roomiest(free) : roomiest(tied));
    const keys = tied.map((p) => `${i.providerId}/${p.name}`).join(", ");
    const by =
      chosen.name === prefer
        ? "the plain-start account"
        : !chosen.live && tied.some((p) => p.live)
          ? "the one without a live session"
          : tied.some((p) => p.w.peak !== chosen.w.peak)
            ? "the one with the most room right now"
            : "the first of them";
    why.push(`${keys} are level (${top.w.need.toFixed(1)} %/h) — taking ${by}, ${i.providerId}/${chosen.name}`);
  }
  const runnerUp = picks.filter((p) => p !== chosen).reduce<(typeof picks)[number] | null>((a, b) => (!a || b.w.need > a.w.need ? b : a), null);
  if (chosen.live) why.push(`Note: ${i.providerId}/${chosen.name} already has a live session (guard: ${guard})`);
  why.push(
    `Picked ${describe(`${i.providerId}/${chosen.name}`, chosen.w)} · usage checked ${ago(chosen.ageMs)}` +
      (runnerUp && tied.length === 1 ? ` — ahead of ${i.providerId}/${runnerUp.name} (${runnerUp.w.need.toFixed(1)} %/h)` : ""),
  );
  return chosen.name;
}
