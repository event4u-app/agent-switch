/**
 * What agent-switch says about a session's prompt cache (roadmap:
 * road-to-sessions-that-show-their-cache). Pure text from a CacheReading —
 * tokens only, never money, never a request to act. The probe behind the move
 * line is agents/evidence/cache-move-probe-2026-11.md: the cache is shared
 * within an organization and not across organizations.
 */

import type { CacheReading } from "./telemetry.js";

function k(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`;
}

/** Local wall-clock "10:42". */
export function clock(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "cold for 23 min" / "cold for 2 h" — or plain "cold" when the expiry is not known. */
function coldFor(c: CacheReading, nowMs: number): string {
  if (!c.expiresAt) return "cold";
  const m = Math.max(1, Math.round((nowMs - Date.parse(c.expiresAt)) / 60_000));
  return m < 120 ? `cold for ${m} min` : `cold for ${Math.round(m / 60)} h`;
}

function resent(c: CacheReading): string {
  return c.resendTokens === null ? "the whole conversation" : `~${k(c.resendTokens)}`;
}

/** The sessions-table column: "cache warm till 10:42", "cache cold · ~182k re-sent",
 *  "cache compacted". Empty when nothing is known. */
export function formatCache(c: CacheReading | null): string {
  if (!c) return "";
  if (c.state === "warm") return c.expiresAt ? `cache warm till ${clock(c.expiresAt)}` : "cache warm";
  if (c.state === "cold") return c.resendTokens === null ? "cache cold" : `cache cold · ~${k(c.resendTokens)} re-sent`;
  if (c.state === "compacted") return "cache compacted";
  return "";
}

/**
 * The line a move (takeover, rebind) prints before it acts. `sameOrg`: whether
 * the target account belongs to the source's organization; null when either
 * side's organization is unknown. null when there is nothing worth saying.
 */
export function moveCacheLine(c: CacheReading | null, target: string, sameOrg: boolean | null, nowMs: number): string | null {
  if (!c || c.state === "compacted") return null;
  if (c.state === "cold") return `Cache: ${coldFor(c, nowMs)} — the first turn on ${target} re-sends ${resent(c)}, same as staying.`;
  const warm = c.state === "warm" && c.expiresAt ? `warm till ${clock(c.expiresAt)}` : c.state === "warm" ? "warm" : null;
  if (sameOrg === true) {
    return warm ? `Cache: ${warm} — ${target} is in the same organization, so the cache moves with the session.` : null;
  }
  const here = warm ? `${warm} here` : "state unknown";
  if (sameOrg === false) return `Cache: ${here}, but ${target} is another organization — its first turn re-sends ${resent(c)}.`;
  return `Cache: ${here} — if ${target} is another organization, its first turn re-sends ${resent(c)}.`;
}

/** The line `compact` prints before typing /compact into a cold session; null otherwise. */
export function compactCacheLine(c: CacheReading | null, nowMs: number): string | null {
  if (!c || c.state !== "cold") return null;
  return `Cache ${coldFor(c, nowMs)}: this /compact re-reads ${resent(c)} as uncached input.`;
}
