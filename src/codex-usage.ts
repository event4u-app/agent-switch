/**
 * Codex usage readout — live, from the ChatGPT backend.
 *
 * Codex has no `usage` CLI command, and `/backend-api/codex/*` is Cloudflare-
 * gated (a bearer token gets a 403). But the `wham/*` endpoints DO accept the
 * stored OAuth bearer, and `GET /backend-api/wham/usage` returns the live rate
 * limits + banked reset credits (verified). Shape:
 *
 *   { plan_type, rate_limit: { allowed, limit_reached,
 *       primary_window:   { used_percent, limit_window_seconds, reset_at },
 *       secondary_window: null | {…} },
 *     rate_limit_reset_credits: { available_count } }
 *
 * We map the windows to the same UsageSnapshot the Claude readout produces, and
 * carry the reset-credit count so the GUI can show "N resets available".
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { UsageSnapshot, UsageWindow } from "./usage.js";

const WHAM_USAGE = "https://chatgpt.com/backend-api/wham/usage";
const CODEX_VERSION = "0.134.0"; // only used for the User-Agent string

interface CodexToken {
  accessToken: string;
  accountId: string | null;
}

/** Read a codex profile's OAuth access token + account id from its auth.json. */
export function codexTokenOf(configDir: string): CodexToken | null {
  try {
    const raw = fs.readFileSync(path.join(configDir, "auth.json"), "utf8");
    const parsed = JSON.parse(raw);
    const accessToken = parsed?.tokens?.access_token;
    if (typeof accessToken !== "string" || !accessToken) return null;
    const accountId = typeof parsed?.tokens?.account_id === "string" ? parsed.tokens.account_id : null;
    return { accessToken, accountId };
  } catch {
    return null;
  }
}

/** limit_window_seconds → a short window key + label (18000 = 5h, 604800 = 7d,
 *  2592000 = 30d; anything else falls back to hours/days). */
function windowMeta(seconds: unknown): { key: string; label: string } {
  if (seconds === 18000) return { key: "five_hour", label: "5h" };
  if (seconds === 604800) return { key: "seven_day", label: "7d" };
  if (seconds === 2592000) return { key: "monthly", label: "30d" };
  if (typeof seconds === "number" && seconds > 0) {
    return seconds >= 86400
      ? { key: `w_${seconds}`, label: `${Math.round(seconds / 86400)}d` }
      : { key: `w_${seconds}`, label: `${Math.round(seconds / 3600)}h` };
  }
  return { key: "window", label: "—" };
}

function toWindow(w: any): UsageWindow | null {
  if (!w || typeof w !== "object") return null;
  const utilization = typeof w.used_percent === "number" ? Math.round(w.used_percent) : null;
  const resetsAt = typeof w.reset_at === "number" ? new Date(w.reset_at * 1000).toISOString() : null;
  if (utilization === null && resetsAt === null) return null;
  const { key, label } = windowMeta(w.limit_window_seconds);
  return { key, label, utilization, resetsAt };
}

/** Pure parse of a `wham/usage` response into a UsageSnapshot. Exported for
 *  tests; degrades to null when no window carries data. */
export function parseCodexUsage(raw: any, capturedAt: string = new Date().toISOString()): UsageSnapshot | null {
  const rl = raw?.rate_limit;
  if (!rl || typeof rl !== "object") return null;
  const windows: UsageWindow[] = [];
  for (const w of [rl.primary_window, rl.secondary_window]) {
    const win = toWindow(w);
    if (win) windows.push(win);
  }
  const available = raw?.rate_limit_reset_credits?.available_count;
  const resetCredits = typeof available === "number" ? available : null;
  if (windows.length === 0 && resetCredits === null) return null;
  return { windows, routines: null, capturedAt, resetCredits };
}

/** Live Codex usage for one profile home, or null (no token / network / 4xx). */
export async function readCodexUsage(configDir: string, capturedAt: string = new Date().toISOString()): Promise<UsageSnapshot | null> {
  const tok = codexTokenOf(configDir);
  if (!tok) return null;
  let raw: any;
  try {
    const res = await fetch(WHAM_USAGE, {
      headers: {
        Authorization: `Bearer ${tok.accessToken}`,
        ...(tok.accountId ? { "chatgpt-account-id": tok.accountId } : {}),
        originator: "codex_cli_rs",
        "User-Agent": `codex_cli_rs/${CODEX_VERSION}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    raw = await res.json();
  } catch {
    return null;
  }
  return parseCodexUsage(raw, capturedAt);
}

/**
 * One rollout line → a usage snapshot, when it is a `token_count` event that
 * carries `rate_limits`. Codex writes one after every turn, with the same
 * numbers the live endpoint returns (window in minutes, reset in epoch seconds)
 * — a local, network-free readout that is as fresh as the last turn. No reset
 * credits in it (null: unknown, never 0).
 */
export function parseRolloutRateLimits(o: any): UsageSnapshot | null {
  if (o?.type !== "event_msg" || o?.payload?.type !== "token_count") return null;
  const rl = o.payload.rate_limits;
  if (!rl || typeof rl !== "object") return null;
  const windows: UsageWindow[] = [];
  for (const w of [rl.primary, rl.secondary]) {
    if (!w || typeof w !== "object") continue;
    const win = toWindow({
      used_percent: w.used_percent,
      limit_window_seconds: typeof w.window_minutes === "number" ? w.window_minutes * 60 : undefined,
      reset_at: w.resets_at,
    });
    if (win) windows.push(win);
  }
  if (windows.length === 0) return null;
  const at = typeof o.timestamp === "string" && !isNaN(Date.parse(o.timestamp)) ? new Date(o.timestamp).toISOString() : null;
  if (!at) return null;
  return { windows, routines: null, capturedAt: at, resetCredits: null };
}

/** How much of a rollout's end is read for its last `rate_limits` line. */
const ROLLOUT_TAIL_BYTES = 512 * 1024;

function newestRollout(sessionsDir: string): { file: string; mtimeMs: number } | null {
  const sortedDirs = (dir: string): string[] => {
    try {
      return fs.readdirSync(dir).filter((n) => /^\d+$/.test(n)).sort().reverse();
    } catch {
      return [];
    }
  };
  // sessions/YYYY/MM/DD — the two newest day folders cover a session that
  // started before midnight and is still writing.
  const days: string[] = [];
  for (const y of sortedDirs(sessionsDir)) {
    for (const m of sortedDirs(path.join(sessionsDir, y))) {
      for (const d of sortedDirs(path.join(sessionsDir, y, m))) {
        days.push(path.join(sessionsDir, y, m, d));
        if (days.length >= 2) break;
      }
      if (days.length >= 2) break;
    }
    if (days.length >= 2) break;
  }
  let best: { file: string; mtimeMs: number } | null = null;
  for (const day of days) {
    let names: string[] = [];
    try {
      names = fs.readdirSync(day).filter((n) => n.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const n of names) {
      try {
        const st = fs.statSync(path.join(day, n));
        if (!best || st.mtimeMs > best.mtimeMs) best = { file: path.join(day, n), mtimeMs: st.mtimeMs };
      } catch {
        /* vanished between list and stat */
      }
    }
  }
  return best;
}

/**
 * The newest `rate_limits` a Codex home's own session files carry, when it is
 * newer than `notBeforeMs` (the last capture) — else null. Local reads only:
 * the newest rollout's tail, scanned from the end.
 */
export function rolloutUsage(codexHome: string, notBeforeMs: number): UsageSnapshot | null {
  const newest = newestRollout(path.join(codexHome, "sessions"));
  if (!newest || newest.mtimeMs <= notBeforeMs) return null;
  let text: string;
  try {
    const fd = fs.openSync(newest.file, "r");
    try {
      const size = fs.fstatSync(fd).size;
      const len = Math.min(size, ROLLOUT_TAIL_BYTES);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      text = buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"rate_limits"')) continue;
    let o: unknown;
    try {
      o = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    const snap = parseRolloutRateLimits(o);
    if (!snap) continue;
    return Date.parse(snap.capturedAt) > notBeforeMs ? snap : null;
  }
  return null;
}
