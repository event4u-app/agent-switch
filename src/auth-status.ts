/**
 * `agent-switch auth-status [--json]` — how each profile's login stands, read
 * from the provider's own credential store METADATA. Token values are parsed
 * only to read expiry fields and are never copied into the result.
 *
 * States: `connected` (a refreshable login is stored), `expiring` (the stored
 * login's refresh window ends within {@link EXPIRING_MS}), `sign-in-needed`
 * (nothing usable stored, or the refresh window is over), `unknown` (the store
 * cannot be read from here). Nothing is inferred from usage or network calls.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { ProviderId } from "./providers.js";

export const EXPIRING_MS = 3 * 24 * 60 * 60_000;

export type AuthState = "connected" | "expiring" | "sign-in-needed" | "unknown";

export interface AuthStatus {
  provider: ProviderId;
  name: string;
  state: AuthState;
  /** When the stored login stops being refreshable (ISO), when the store says. */
  expiresAt: string | null;
  /** Last time the store was refreshed (ISO), when the store records it. */
  lastRefreshAt: string | null;
  /** Who keeps the login fresh: the provider's own CLI refreshes on use. */
  keptFreshBy: string;
  /** Plain-language note on what is and is not known. */
  detail: string;
}

function iso(ms: number | null): string | null {
  return ms !== null && Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function windowState(refreshEndsMs: number | null, now: number): AuthState {
  if (refreshEndsMs === null) return "connected";
  if (refreshEndsMs <= now) return "sign-in-needed";
  return refreshEndsMs - now <= EXPIRING_MS ? "expiring" : "connected";
}

/**
 * Claude Code credential (`{ claudeAiOauth: { refreshToken, expiresAt,
 * refreshTokenExpiresAt? } }`). `expiresAt` there is the short-lived access
 * token, which Claude Code refreshes itself — not a sign-in deadline, so it is
 * not reported as one. `lastRefreshMs` is the store's mtime when it is a file.
 */
export function claudeAuthStatus(name: string, raw: string | null, lastRefreshMs: number | null, now: number): AuthStatus {
  const base = { provider: "claude" as const, name, keptFreshBy: "claude (refreshes the login when it runs)" };
  let oauth: any = null;
  try {
    oauth = raw ? JSON.parse(raw)?.claudeAiOauth : null;
  } catch {
    oauth = null;
  }
  if (!raw) {
    return { ...base, state: "sign-in-needed", expiresAt: null, lastRefreshAt: null, detail: "No stored login for this profile." };
  }
  if (oauth && oauth.refreshToken === "" && (oauth.accessToken === "" || oauth.accessToken == null)) {
    return {
      ...base,
      state: "sign-in-needed",
      expiresAt: null,
      lastRefreshAt: iso(lastRefreshMs),
      detail: "Claude Code cleared this login (signed out, or the refresh window ended). Sign in again.",
    };
  }
  if (!oauth || typeof oauth.refreshToken !== "string" || !oauth.refreshToken) {
    return { ...base, state: "unknown", expiresAt: null, lastRefreshAt: iso(lastRefreshMs), detail: "The stored login has an unrecognised shape." };
  }
  const refreshEnds = typeof oauth.refreshTokenExpiresAt === "number" ? oauth.refreshTokenExpiresAt : null;
  return {
    ...base,
    state: windowState(refreshEnds, now),
    expiresAt: iso(refreshEnds),
    lastRefreshAt: iso(lastRefreshMs),
    detail:
      refreshEnds === null
        ? "A refreshable login is stored; Claude does not record when it ends, so a revoked login shows up only on next use."
        : "A refreshable login is stored.",
  };
}

/** Codex `auth.json` (`{ tokens: { refresh_token, … }, last_refresh, OPENAI_API_KEY? }`). */
/** A JWT's `exp` (epoch ms) from its payload — read without verifying, only to
 *  date it; null when it is not a JWT or carries no exp. */
function jwtExpMs(token: unknown): number | null {
  if (typeof token !== "string") return null;
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const exp = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))?.exp;
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}

export function codexAuthStatus(name: string, raw: string | null, now: number): AuthStatus {
  const base = { provider: "codex" as const, name, keptFreshBy: "codex (refreshes the login when it runs)" };
  let auth: any = null;
  try {
    auth = raw ? JSON.parse(raw) : null;
  } catch {
    auth = null;
  }
  if (!auth) {
    return { ...base, state: raw ? "unknown" : "sign-in-needed", expiresAt: null, lastRefreshAt: null, detail: raw ? "auth.json is not readable JSON." : "No stored login for this profile." };
  }
  const last = typeof auth.last_refresh === "string" && !isNaN(Date.parse(auth.last_refresh)) ? new Date(auth.last_refresh).toISOString() : null;
  if (typeof auth.OPENAI_API_KEY === "string" && auth.OPENAI_API_KEY) {
    return { ...base, state: "connected", expiresAt: null, lastRefreshAt: last, keptFreshBy: "not needed (API key)", detail: "Signed in with an API key, billed per use." };
  }
  if (typeof auth?.tokens?.refresh_token !== "string" || !auth.tokens.refresh_token) {
    return { ...base, state: "sign-in-needed", expiresAt: null, lastRefreshAt: last, detail: "No refreshable login stored." };
  }
  const accessEnds = jwtExpMs(auth.tokens.access_token);
  if (accessEnds !== null && accessEnds <= now) {
    return {
      ...base,
      state: "unknown",
      expiresAt: null,
      lastRefreshAt: last,
      detail: `The access token ran out on ${new Date(accessEnds).toISOString().slice(0, 10)}; codex renews it the next time it runs on this account, if the login is still valid. Usage can't be read until then.`,
    };
  }
  return {
    ...base,
    state: windowState(null, now),
    expiresAt: null,
    lastRefreshAt: last,
    detail: "A refreshable login is stored; codex does not record when it ends.",
  };
}

/** Antigravity keeps its login in a per-profile keychain agent-switch does not read here. */
export function antigravityAuthStatus(name: string, keychainExists: boolean): AuthStatus {
  return {
    provider: "antigravity",
    name,
    state: keychainExists ? "unknown" : "sign-in-needed",
    expiresAt: null,
    lastRefreshAt: null,
    keptFreshBy: "agy (refreshes the login when it runs)",
    detail: keychainExists ? "The login lives in the profile's keychain; its expiry is not readable from here." : "No profile keychain yet — sign in once with agy.",
  };
}

export function fileMtimeMs(p: string): number | null {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return null;
  }
}

export function readText(p: string): string | null {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

export function claudeCredentialFile(cfg: string): string {
  return path.join(cfg, ".credentials.json");
}
