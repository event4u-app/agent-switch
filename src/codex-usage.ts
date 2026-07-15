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
