/**
 * Read-only OAuth endpoints for identity verification and usage display.
 *
 * Endpoints and header adopted from claude-swap (oauth.py):
 *   GET https://api.anthropic.com/api/oauth/profile  — account identity
 *   GET https://api.anthropic.com/api/oauth/usage    — 5h/7d windows
 * both with `Authorization: Bearer <accessToken>` and the
 * `anthropic-beta: oauth-2025-04-20` header.
 *
 * Deliberately NOT adopted from claude-swap: the token-refresh grant. Our
 * profiles are live logins — Claude Code refreshes its own tokens per config
 * dir. Refreshing from outside would rotate the refresh token underneath a
 * running session for no benefit.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { credentialStore } from "./credentials.js";

const BETA_HEADER = "oauth-2025-04-20";

/** A Claude profile's live credential via the per-OS store (keychain-then-file
 * on darwin, plaintext file on linux/win32), given its config dir. Claude-only:
 * the OAuth identity/usage endpoints below are Anthropic's. null if unreadable. */
export function readProfileCredential(configDir: string): string | null {
  return credentialStore().read(configDir);
}

export function accessTokenOf(credentials: string): string | null {
  try {
    return JSON.parse(credentials)?.claudeAiOauth?.accessToken ?? null;
  } catch {
    return null;
  }
}

async function oauthGet(pathname: string, token: string): Promise<any | null> {
  try {
    const res = await fetch(`https://api.anthropic.com${pathname}`, {
      headers: { Authorization: `Bearer ${token}`, "anthropic-beta": BETA_HEADER },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export function fetchProfile(token: string): Promise<any | null> {
  return oauthGet("/api/oauth/profile", token);
}

export function fetchUsage(token: string): Promise<any | null> {
  return oauthGet("/api/oauth/usage", token);
}

/** Render the 5h/7d windows defensively; unknown shapes degrade to nothing. */
export function formatUsage(usage: any): string[] {
  const lines: string[] = [];
  for (const [label, key] of [
    ["5h", "five_hour"],
    ["7d", "seven_day"],
  ] as const) {
    const w = usage?.[key];
    if (!w || typeof w !== "object") continue;
    const pct = typeof w.utilization === "number" ? Math.round(w.utilization) : null;
    const resets = typeof w.resets_at === "string" ? new Date(w.resets_at) : null;
    const resetStr =
      resets && !isNaN(resets.getTime())
        ? `  resets ${resets.toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })}`
        : "";
    if (pct !== null) lines.push(`  ${label}: ${String(pct).padStart(3)}%${resetStr}`);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Process detection — adopted from claude-swap (process_detection.py): Claude
// Code writes session PID files to <config>/sessions/{pid}.json and IDE
// lockfiles to <config>/ide/{port}.lock. Reading them is the same mechanism
// Claude Code uses internally. Best-effort: absence of files ≠ proof of no
// session on older versions.
// ---------------------------------------------------------------------------

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err?.code === "EPERM"; // exists, not ours
  }
}

/** PIDs of live Claude Code sessions running on a profile's config dir. */
export function liveSessionPids(configDir: string): number[] {
  const sessionsDir = path.join(configDir, "sessions");
  let entries: string[];
  try {
    entries = fs.readdirSync(sessionsDir);
  } catch {
    return [];
  }
  const pids: number[] = [];
  for (const entry of entries) {
    const m = /^(\d+)\.json$/.exec(entry);
    if (!m) continue;
    const pid = Number(m[1]);
    if (pidAlive(pid)) pids.push(pid);
  }
  return pids;
}
