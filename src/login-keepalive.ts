/**
 * "Keep accounts signed in" for Codex and Antigravity — the counterpart of
 * token-freshen.ts, under the same rule (ADR-004 § Amendment 2026-11-01).
 *
 * The provider's own CLI does the refresh, under its own lock, into its own
 * store; agent-switch only decides WHEN and judges the result by re-reading the
 * store's expiry. Both triggers are local and spend no model quota. Verified
 * 2026-11-01:
 *
 * - codex-cli 0.166.0: `codex app-server` + `account/read { refreshToken: true }`
 *   runs Codex's normal refresh-token flow and rewrites `auth.json`
 *   (`last_refresh` moved to now). `codex doctor` and `codex login status` do
 *   NOT refresh — doctor's WebSocket check just 401s on an expired token.
 * - agy 1.1.3: `agy models` refreshes an expired access token and writes it back
 *   to the keychain (`token.expiry` moved from two months ago to now + 1 h).
 *
 * Neither CLI has a live-session marker, so the session guard reads the
 * environment of running CLI processes: a process whose CODEX_HOME / HOME is
 * this profile — or whose environment cannot be read — counts as a session.
 */

import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import { jwtExpMs } from "./auth-status.js";
import { agyKeychainState, ensureAgyKeychain } from "./agy-keychain.js";
import { configDir, isDisabled, listProfiles, readBinaryPath, readKeepSignedIn, sharesDefaultLogin } from "./profiles.js";
import { provider, resolveBinary } from "./providers.js";
import {
  FRESHEN_COOLDOWN_MS,
  doctorPath,
  loginRefreshAllowed,
  readLastAttemptFile,
  recordAttemptFile,
  type FreshenOutcome,
} from "./token-freshen.js";

export type KeepAliveProvider = "codex" | "antigravity";
export const KEEPALIVE_PROVIDERS: readonly KeepAliveProvider[] = ["codex", "antigravity"];

/**
 * How long after the access token ran out the refresh is due. Codex's access
 * token lives ~10 days and Codex itself refreshes after 8, so an expired one
 * means nothing has run on the account. Antigravity's lives one hour; what
 * lapses there is the refresh token after long disuse, so a weekly renewal is
 * enough and keeps `agy` from starting every poll cycle.
 */
export const STALE_AFTER_MS: Record<KeepAliveProvider, number> = {
  codex: 0,
  antigravity: 7 * 24 * 60 * 60_000,
};

const KEEPALIVE_TIMEOUT_MS = 30_000;

/** Is the refresh due? A store whose expiry cannot be read never is. */
export function keepAliveDue(expiresAt: number | null, now: number, staleAfterMs: number): boolean {
  return expiresAt !== null && now - expiresAt >= staleAfterMs;
}

/** Codex access-token expiry (epoch ms) from `auth.json`. null for an API-key
 *  login, a login without a refresh token, or an unreadable file. */
export function codexAccessExpiry(raw: string | null): number | null {
  try {
    const auth = raw ? JSON.parse(raw) : null;
    if (!auth || (typeof auth.OPENAI_API_KEY === "string" && auth.OPENAI_API_KEY)) return null;
    if (typeof auth.tokens?.refresh_token !== "string" || !auth.tokens.refresh_token) return null;
    return jwtExpMs(auth.tokens.access_token);
  } catch {
    return null;
  }
}

/** Antigravity access-token expiry (epoch ms) from the go-keyring item agy
 *  stores. Only `token.expiry` is read; null when there is no refresh token. */
export function agyAccessExpiry(raw: string | null): number | null {
  if (!raw) return null;
  try {
    const prefix = "go-keyring-base64:";
    const b64 = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
    const token = JSON.parse(Buffer.from(b64, "base64").toString("utf8"))?.token;
    if (typeof token?.refresh_token !== "string" || !token.refresh_token) return null;
    const ms = Date.parse(token.expiry);
    return isNaN(ms) ? null : ms;
  } catch {
    return null;
  }
}

/**
 * Does any of these processes run on this profile? `envOf` returns a process's
 * environment as text, or null when it cannot be read — which counts as yes:
 * refreshing under a session we could not rule out is the race to avoid.
 */
export function runsOnProfile(pids: number[], envVar: string, dir: string, envOf: (pid: number) => string | null): boolean {
  const needle = `${envVar}=${dir}`;
  return pids.some((pid) => {
    const env = envOf(pid);
    if (env === null) return true;
    return env.split(/\0|\n/).some((entry) => entry === needle) || new RegExp(`(^|\\s)${escapeRegExp(needle)}(\\s|$)`).test(env);
  });
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pidsOf(binary: string): number[] {
  const r = spawnSync("pgrep", ["-x", binary], { encoding: "utf8", timeout: 5000 });
  return (r.stdout ?? "")
    .split("\n")
    .map((l) => Number(l.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

/** A process's environment: /proc on Linux, `ps -E` (same user only) on macOS. */
function processEnv(pid: number): string | null {
  if (process.platform === "linux") {
    try {
      return fs.readFileSync(`/proc/${pid}/environ`, "utf8");
    } catch {
      return null;
    }
  }
  const r = spawnSync("ps", ["-p", String(pid), "-wwE", "-o", "command="], { encoding: "utf8", timeout: 5000 });
  return r.status === 0 && r.stdout.trim() ? r.stdout : null;
}

function readCodexExpiry(dir: string): number | null {
  try {
    return codexAccessExpiry(fs.readFileSync(provider("codex").credentialPath(dir), "utf8"));
  } catch {
    return null;
  }
}

function readAgyExpiry(home: string): number | null {
  if (process.platform !== "darwin" || agyKeychainState(home) === "none") return null;
  ensureAgyKeychain(home);
  const r = spawnSync("security", ["find-generic-password", "-s", "gemini", "-wa", "antigravity"], {
    env: { ...process.env, HOME: home, CFFIXED_USER_HOME: home },
    encoding: "utf8",
    timeout: 10_000,
  });
  return agyAccessExpiry(r.stdout?.trim() || null);
}

/** The three JSON-RPC lines that make `codex app-server` refresh the login. */
export const CODEX_REFRESH_REQUEST = [
  { jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "agent-switch", title: null, version: "0" }, capabilities: null } },
  { jsonrpc: "2.0", method: "initialized" },
  { jsonrpc: "2.0", id: 2, method: "account/read", params: { refreshToken: true } },
]
  .map((m) => JSON.stringify(m))
  .join("\n") + "\n";

/** `codex app-server` exits on stdin EOF before answering, so stdin stays open
 *  until the `account/read` reply (id 2) arrives, then the server is stopped. */
function runCodexRefresh(dir: string, linked: string | null): Promise<true | string> {
  const bin = resolveBinary("codex", linked);
  return new Promise((resolve) => {
    const child = spawn(bin, ["app-server"], {
      env: { ...process.env, CODEX_HOME: dir, PATH: doctorPath(bin, process.execPath, process.env.PATH) },
      cwd: os.tmpdir(),
      stdio: ["pipe", "pipe", "ignore"],
    });
    let done = false;
    let out = "";
    const finish = (r: true | string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.stdin?.end();
      child.kill();
      resolve(r);
    };
    const timer = setTimeout(() => finish(`${bin} app-server: no reply within ${KEEPALIVE_TIMEOUT_MS / 1000}s`), KEEPALIVE_TIMEOUT_MS);
    child.on("error", (e: NodeJS.ErrnoException) => finish(`${bin}: ${e.code ?? e.message}`));
    child.on("exit", () => finish(true));
    child.stdout?.on("data", (b: Buffer) => {
      out += b.toString("utf8");
      if (/"id"\s*:\s*2\b/.test(out)) finish(true);
    });
    child.stdin?.write(CODEX_REFRESH_REQUEST);
  });
}

function runAgyRefresh(home: string, linked: string | null): true | string {
  const bin = resolveBinary("agy", linked);
  const res = spawnSync(bin, ["models"], {
    env: { ...process.env, HOME: home, CFFIXED_USER_HOME: home, PATH: doctorPath(bin, process.execPath, process.env.PATH) },
    cwd: os.tmpdir(),
    stdio: "ignore",
    timeout: KEEPALIVE_TIMEOUT_MS,
  });
  if (res.error) return `${bin}: ${(res.error as NodeJS.ErrnoException).code ?? res.error.message}`;
  return true;
}

export interface KeepAliveDeps {
  now: () => number;
  readExpiry: (dir: string) => number | null;
  readLastAttempt: (dir: string) => number;
  recordAttempt: (dir: string, at: number) => void;
  /** Run the provider's refresh. A string = it could not run, and why. */
  refresh: (dir: string) => Promise<true | string>;
  cooldownMs: number;
  staleAfterMs: number;
}

export function defaultKeepAliveDeps(p: KeepAliveProvider, linked: string | null = null): KeepAliveDeps {
  return {
    now: () => Date.now(),
    readExpiry: p === "codex" ? readCodexExpiry : readAgyExpiry,
    readLastAttempt: readLastAttemptFile,
    recordAttempt: recordAttemptFile,
    refresh: p === "codex" ? (dir) => runCodexRefresh(dir, linked) : async (dir) => runAgyRefresh(dir, linked),
    cooldownMs: FRESHEN_COOLDOWN_MS,
    staleAfterMs: STALE_AFTER_MS[p],
  };
}

/** Refresh one profile's login when it is due. Cooldown-guarded; the result is
 *  judged by re-reading the expiry, never by the CLI's exit. */
export async function keepAlive(dir: string, deps: KeepAliveDeps): Promise<{ outcome: FreshenOutcome; reason?: string }> {
  if (!keepAliveDue(deps.readExpiry(dir), deps.now(), deps.staleAfterMs)) return { outcome: "not-needed" };
  if (deps.now() - deps.readLastAttempt(dir) < deps.cooldownMs) return { outcome: "cooling-down" };
  deps.recordAttempt(dir, deps.now());
  const ran = await deps.refresh(dir);
  if (ran !== true) return { outcome: "unavailable", reason: ran };
  const after = deps.readExpiry(dir);
  return { outcome: after !== null && after > deps.now() ? "refreshed" : "still-expired" };
}

/** {@link loginRefreshAllowed} for a Codex or Antigravity profile, read from disk and the process table. */
export function keepAliveAllowed(p: KeepAliveProvider, name: string): boolean {
  const prov = provider(p);
  return loginRefreshAllowed({
    keepSignedIn: readKeepSignedIn(),
    sharesDefaultLogin: sharesDefaultLogin(p, name),
    liveSession: runsOnProfile(pidsOf(prov.binary), prov.envVar, prov.configDirFor(configDir(p, name)), processEnv),
  });
}

/** One sweep over every enabled Codex and Antigravity profile — the daemon runs
 *  it each cycle. Cheap when nothing is due: one file or keychain read each. */
export async function keepAliveSweep(log: (line: string) => void): Promise<void> {
  if (!readKeepSignedIn()) return;
  for (const p of KEEPALIVE_PROVIDERS) {
    const deps = defaultKeepAliveDeps(p, readBinaryPath(p));
    for (const name of listProfiles(p)) {
      if (isDisabled(p, name)) continue;
      const dir = provider(p).configDirFor(configDir(p, name));
      if (!keepAliveDue(deps.readExpiry(dir), deps.now(), deps.staleAfterMs)) continue;
      if (!keepAliveAllowed(p, name)) continue;
      const { outcome, reason } = await keepAlive(dir, deps);
      if (outcome === "unavailable") log(`keep-signed-in: ${p}/${name} — could not start ${provider(p).binary} (${reason})`);
      else if (outcome === "still-expired") log(`keep-signed-in: ${p}/${name} — ${provider(p).binary} could not refresh the login (sign in again)`);
      else if (outcome === "refreshed") log(`keep-signed-in: ${p}/${name} — login refreshed by ${provider(p).binary}`);
    }
  }
}
