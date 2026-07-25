/**
 * Keep a Claude profile's OAuth access token usable for the read-only usage /
 * profile endpoints — WITHOUT agent-switch ever touching the credential store.
 *
 * The problem: a stored access token lives ~8h, the refresh token ~3 weeks.
 * agent-switch reads the credential and calls the OAuth endpoints with whatever
 * access token is in the store. Once that token expires the endpoints 401 and
 * usage silently freezes on the last cached numbers — for exactly the profiles
 * the operator is NOT actively using, which is the whole point of the readout.
 * Starting Claude Code on the profile "fixes" it, because Claude Code refreshes.
 *
 * The mechanism: let Claude Code do the refresh. `claude doctor` is a LOCAL
 * health check — it runs no completion and consumes no quota — but it goes
 * through Claude Code's auth path, so an expired token is refreshed first,
 * under Claude Code's own lock, into Claude Code's own store. Verified against
 * CC 2.1.x (2026-07-25): with `expiresAt` in the past, `claude doctor` rotates
 * BOTH the access and the refresh token and moves `expiresAt` ~8h out.
 *
 * Why not the refresh grant ourselves: that rotation is precisely the hazard the
 * Phase-4 lock recorded — an out-of-band grant invalidates the refresh token a
 * live session still holds. Delegating honours that lock instead of reopening
 * it: agent-switch stays read-only outside `rebind` (ADR-003), and the one
 * process allowed to rotate the token family is the one that owns it. Full
 * rationale, evidence, and the rejected alternatives: ADR-004.
 */

import { spawnSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { accessTokenOf, readProfileCredential } from "./api.js";
import { ROOT } from "./profiles.js";
import { resolveBinary } from "./providers.js";

/** Treat a token as spent this close to `expiresAt` — mirrors Claude Code's own
 *  5-minute refresh buffer, so we never race it into a just-expired window. */
export const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

/** Minimum gap between two freshen attempts for one profile. A truly dead login
 *  (refresh token expired / revoked) cannot be healed by retrying, and the GUI
 *  re-reads usage every few seconds — without this floor a dead profile would
 *  spawn `claude doctor` on every cycle. */
export const FRESHEN_COOLDOWN_MS = 10 * 60 * 1000;

/** How long to let Claude Code's health check run before giving up on it. The
 *  observed run is a few seconds; this is a stuck-process guard, and it bounds
 *  how long a daemon poll cycle can stall on one profile. */
const FRESHEN_TIMEOUT_MS = 30_000;

/** `expiresAt` (epoch ms) out of a credential blob; null when absent/unparseable. */
export function tokenExpiresAt(credentials: string | null): number | null {
  if (!credentials) return null;
  try {
    const v = JSON.parse(credentials)?.claudeAiOauth?.expiresAt;
    return typeof v === "number" ? v : null;
  } catch {
    return null;
  }
}

/**
 * Is this credential's access token spent (or about to be)? Pure — the testable
 * core. A credential we cannot read or whose `expiresAt` we cannot parse is NOT
 * reported as expired: we have no evidence it is, and spawning Claude Code on a
 * guess is worse than one failed read.
 */
export function needsFreshen(credentials: string | null, now: number, bufferMs: number = EXPIRY_BUFFER_MS): boolean {
  const exp = tokenExpiresAt(credentials);
  if (exp === null) return false;
  return exp - now <= bufferMs;
}

/** Injectable side-effects so the decision logic is unit-testable without IO. */
export interface FreshenDeps {
  now: () => number;
  readCredential: (configDir: string) => string | null;
  /** Last freshen attempt for this config dir (epoch ms), 0 when never. */
  readLastAttempt: (configDir: string) => number;
  recordAttempt: (configDir: string, at: number) => void;
  /** Run Claude Code's health check against this config dir. False = could not
   *  run it at all (binary missing, spawn failure) — never a verdict on the
   *  refresh itself, which is judged by re-reading the credential. */
  runHealthCheck: (configDir: string) => boolean;
  cooldownMs: number;
  bufferMs: number;
}

/** The attempt-stamp file for a config dir. Keyed by hash so the path stays
 *  flat and filesystem-safe, and lives in agent-switch's own root — never
 *  inside Claude Code's config dir. */
function attemptStampFile(configDir: string): string {
  const digest = crypto.createHash("sha256").update(configDir.normalize("NFC"), "utf8").digest("hex").slice(0, 12);
  return path.join(ROOT, "freshen", `${digest}`);
}

/** Cooldown state is a FILE, not a module variable: the GUI reads usage by
 *  spawning a fresh `agent-switch status --json` per profile, so an in-process
 *  map would reset on every read and defeat the floor entirely. */
function readLastAttemptFile(configDir: string): number {
  try {
    const n = Number(fs.readFileSync(attemptStampFile(configDir), "utf8").trim());
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function recordAttemptFile(configDir: string, at: number): void {
  const file = attemptStampFile(configDir);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, String(at));
  } catch {
    /* best-effort: a missing stamp only costs an extra attempt */
  }
}

/**
 * `claude doctor` against one profile's config dir. stdout/stderr are dropped —
 * this is a side-effect call, not a readout. Any completed run returns true;
 * whether the token actually got refreshed is decided by re-reading the store.
 */
function runClaudeDoctor(configDir: string, linkedBinary: string | null): boolean {
  const res = spawnSync(resolveBinary("claude", linkedBinary), ["doctor"], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
    // Claude Code reads settings from the CWD; run it somewhere neutral so a
    // project's config can never influence a background health check.
    cwd: os.tmpdir(),
    stdio: "ignore",
    timeout: FRESHEN_TIMEOUT_MS,
  });
  if (res.error) return false;
  return true;
}

export function defaultFreshenDeps(linkedBinary: string | null = null): FreshenDeps {
  return {
    now: () => Date.now(),
    readCredential: readProfileCredential,
    readLastAttempt: readLastAttemptFile,
    recordAttempt: recordAttemptFile,
    runHealthCheck: (configDir) => runClaudeDoctor(configDir, linkedBinary),
    cooldownMs: FRESHEN_COOLDOWN_MS,
    bufferMs: EXPIRY_BUFFER_MS,
  };
}

/** Why a freshen attempt did not happen / how it ended — for logs and tests. */
export type FreshenOutcome = "not-needed" | "cooling-down" | "unavailable" | "refreshed" | "still-expired";

/**
 * Make sure the store behind `configDir` holds a usable access token, letting
 * Claude Code refresh it when it does not. Idempotent, cooldown-guarded, and a
 * no-op when the token is still good.
 */
export function freshenToken(configDir: string, deps: FreshenDeps = defaultFreshenDeps()): FreshenOutcome {
  const creds = deps.readCredential(configDir);
  if (!needsFreshen(creds, deps.now(), deps.bufferMs)) return "not-needed";
  if (deps.now() - deps.readLastAttempt(configDir) < deps.cooldownMs) return "cooling-down";
  deps.recordAttempt(configDir, deps.now());
  if (!deps.runHealthCheck(configDir)) return "unavailable";
  return needsFreshen(deps.readCredential(configDir), deps.now(), deps.bufferMs) ? "still-expired" : "refreshed";
}

/**
 * The access token to call the OAuth endpoints with — freshened first when it
 * has expired. Returns whatever the store holds afterwards (null when there is
 * no readable credential at all); a freshen that could not heal the login just
 * means the caller's read fails as it did before.
 */
export function freshAccessToken(configDir: string, deps: FreshenDeps = defaultFreshenDeps()): string | null {
  freshenToken(configDir, deps);
  const creds = deps.readCredential(configDir);
  return creds ? accessTokenOf(creds) : null;
}
