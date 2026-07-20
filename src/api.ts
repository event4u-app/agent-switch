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
  // The usage/profile endpoints rate-limit (429) aggressively — a few near-
  // simultaneous reads (e.g. the GUI polling every profile) trip it, which
  // surfaced as a profile's usage intermittently coming back empty. Retry a 429
  // with a short backoff (honouring Retry-After), capped, so one throttled read
  // recovers instead of silently degrading to "no data".
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`https://api.anthropic.com${pathname}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "anthropic-beta": BETA_HEADER,
          // Send an honest tool User-Agent. Some clients report the endpoint
          // rate-limits (429) without one; a real UA is good practice regardless.
          "User-Agent": "agent-switch/1.0 (+https://github.com/event4u-app/agent-switch)",
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      return null; // network / timeout — stay snappy, don't retry
    }
    if (res.status === 429 && attempt < 3) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 5_000) : 800 * (attempt + 1);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    if (!res.ok) return null;
    try {
      return await res.json();
    } catch {
      return null;
    }
  }
}

export function fetchProfile(token: string): Promise<any | null> {
  return oauthGet("/api/oauth/profile", token);
}

export function fetchUsage(token: string): Promise<any | null> {
  return oauthGet("/api/oauth/usage", token);
}

export type AuthState = "ok" | "expired" | "no-credential" | "unknown";

/** Classify an HTTP status (null = network/timeout failure) into an auth state.
 *  Pure — the testable core of `checkAuth`. 401/403 = credential present but
 *  rejected (login expired); 2xx = valid; anything else / no response = unknown
 *  (offline, transient, or an API change) — NEVER reported as "expired". */
export function classifyAuthStatus(status: number | null): Exclude<AuthState, "no-credential"> {
  if (status === null) return "unknown";
  if (status === 401 || status === 403) return "expired";
  if (status >= 200 && status < 300) return "ok";
  return "unknown";
}

/** Read-only login check for a Claude profile: is the stored credential still
 *  accepted by Anthropic? Never writes or refreshes a token. "no-credential"
 *  when nothing is stored; otherwise the classified profile-endpoint probe. */
export async function checkAuth(configDir: string): Promise<AuthState> {
  const creds = readProfileCredential(configDir);
  const token = creds ? accessTokenOf(creds) : null;
  if (!token) return "no-credential";
  let status: number | null = null;
  try {
    const res = await fetch("https://api.anthropic.com/api/oauth/profile", {
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": BETA_HEADER,
        "User-Agent": "agent-switch/1.0 (+https://github.com/event4u-app/agent-switch)",
      },
      signal: AbortSignal.timeout(10_000),
    });
    status = res.status;
  } catch {
    status = null;
  }
  return classifyAuthStatus(status);
}

// Usage parsing/formatting moved to usage.ts (richer per-model + routines +
// thresholds). api.ts stays the low-level fetch layer.

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
