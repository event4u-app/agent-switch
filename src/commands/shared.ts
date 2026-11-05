/**
 * Helpers shared by more than one command family: the credential store, the
 * activity log, the single-load guard, the provider launcher, cached usage and
 * context readings, the Claude Desktop scan, and the auth-status read.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { spawnSync } from "node:child_process";
import {
  HOME,
  configDir,
  die,
  listProfiles,
  profileDir,
  readJson,
  sharesDefaultLogin,
  readKeepSignedIn,
  readBinaryPath,
  readGuard,
} from "../profiles.js";
import { Provider, ProviderId, provider, resolveBinary } from "../providers.js";
import { credentialStore } from "../credentials.js";
import { syncProfileSettings } from "../claude-settings.js";
import { appendActivity, type ActivityKind } from "../activity.js";
import { parseMember } from "../pools.js";
import { type CachedUsage } from "../dir-resolve.js";
import {
  antigravityAuthStatus,
  claudeAuthStatus,
  claudeCredentialFile,
  codexAuthStatus,
  fileMtimeMs,
  readText,
  type AuthStatus,
  keptFreshByFor,
} from "../auth-status.js";
import { LATEST_FILE, readHistory, readLatestSnapshot } from "../history.js";
import {
  GuardVerdict,
  LoadInspection,
  guardVerdict,
  inspectLoad,
  overrideFromEnv,
  renderGuardMessage,
} from "../single-load.js";
import { fetchUsage, liveSessionPids } from "../api.js";
import { claudeLoginRefreshAllowed, defaultFreshenDeps, usageToken } from "../token-freshen.js";
import { UsageSnapshot, parseUsage, windowLabel } from "../usage.js";
import { SessionRow, listSessions, listCodexSessions, markLive } from "../sessions.js";
import { cacheMaxAgeMs, snapshotFresh, readDaemonState } from "../daemon.js";
import { serviceTarget } from "../service.js";
import { CacheReading, ContextReading, readClaudeCache, readContext, withResumeFacts } from "../telemetry.js";
import { resumeFactsFor, type HookEventRecord } from "../hooks.js";
import { findApp, guiDataDir } from "../apps.js";
import { scanDesktop, type DesktopInstance } from "../desktop-sessions.js";
import { ensureAgyKeychain } from "../agy-keychain.js";

// Per-OS credential store (keychain-then-file on darwin, file-only elsewhere).
export const credentials = credentialStore();
export const CLAUDE_HOME = provider("claude").defaultConfigDir(); // ~/.claude
export const CLAUDE_JSON = path.join(HOME, ".claude.json");

/** Record one of agent-switch's own actions in the activity log (never a token). */
export function logActivity(kind: ActivityKind, target: string | null, action: string, reason: string, ok = true): void {
  appendActivity({ kind, target, action, reason, ok });
}


// One profile, one live session. Every enforcement point below resolves through
// THIS function so the CLI, the shell-wrapper path, and `use` cannot drift into
// three different answers. The pure half (detection, policy, wording) lives in
// single-load.ts; this is only the composition with real state and processes.

interface GuardCheck {
  verdict: GuardVerdict;
  inspection: LoadInspection;
  /** Rendered message, or null when the verdict is `allow`. */
  message: string | null;
}

/** Same-provider profiles that carry no live session — the concrete
 *  alternatives a refusal names, so the user can act on it without first
 *  running `list` themselves. */
function freeProfiles(providerId: ProviderId, exclude: string): string[] {
  return listProfiles(providerId).filter(
    (n) => n !== exclude && liveSessionPids(configDir(providerId, n)).length === 0,
  );
}

export function checkSingleLoad(
  providerId: ProviderId,
  name: string,
  opts: { forced?: boolean; offerForceFlag?: boolean; context?: "start" | "use" } = {},
): GuardCheck {
  const p = provider(providerId);

  // Early-out before touching the filesystem: `dir --guard` runs on every
  // interactive start, so a disabled guard (or a provider with no live-session
  // signal at all) must cost a state read and nothing more.
  const policy = readGuard();
  if (policy === "off" || !p.hasLiveSessionSignal) {
    return { verdict: "allow", inspection: { sessions: [], loaded: false, nested: false }, message: null };
  }

  const cfg = configDir(providerId, name);
  const inspection = inspectLoad(cfg, p.envVar);
  const verdict = guardVerdict({
    policy,
    inspection,
    overridden: opts.forced === true || overrideFromEnv(),
    detectable: p.hasLiveSessionSignal,
  });
  return {
    verdict,
    inspection,
    message:
      verdict === "allow"
        ? null
        : renderGuardMessage({
            profile: name,
            binary: p.binary,
            verdict,
            inspection,
            offerForceFlag: opts.offerForceFlag === true,
            context: opts.context ?? "start",
            // Only worth computing on a message we are actually going to print.
            alternatives: verdict === "refuse" ? freeProfiles(providerId, name) : [],
          }),
  };
}


/** Bring a Claude profile's settings.json up to date with ~/.claude/settings.json
 *  (src/claude-settings.ts). A failure never blocks the launch. */
export function syncClaudeProfile(dir: string): void {
  try {
    syncProfileSettings(path.join(CLAUDE_HOME, "settings.json"), dir);
  } catch {
    /* the launch goes ahead with the profile's current file */
  }
}

export function launch(p: Provider, name: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}): number {
  const home = configDir(p.id, name);
  const env: NodeJS.ProcessEnv = { ...process.env, ...extraEnv, [p.envVar]: home };
  if (p.id === "claude") syncClaudeProfile(home);
  // Antigravity's agy CLI stores its token in the macOS keychain (fixed key) —
  // seed a per-profile keychain under this HOME so the token is isolated per
  // account (and macOS doesn't pop its "no keychain found" dialog). No-op off mac.
  // CFFIXED_USER_HOME is pinned to HOME so CoreFoundation can't be redirected out
  // of the profile by an ambient value (see agy-keychain.ts). Only for antigravity
  // — claude/codex keep the real HOME (their isolation is a config-dir env var).
  if (p.id === "antigravity") {
    ensureAgyKeychain(home);
    env.CFFIXED_USER_HOME = home;
  }
  const res = spawnSync(resolveBinary(p.binary, readBinaryPath(p.id)), args, { env, stdio: "inherit" });
  if (res.error && (res.error as NodeJS.ErrnoException).code === "ENOENT") {
    die(`\`${p.binary}\` not found. Install ${p.id}, or link its binary: agent-switch providers link --provider ${p.id} --path <path> (Providers tab in the GUI).`);
  }
  return res.status ?? 1;
}

/** A Claude profile's usage snapshot via the OAuth endpoint; null if the
 *  credential is unreadable or the API shape is unknown. Codex/Antigravity have no
 *  usage readout (verified), so this is Claude-only. */
export async function claudeSnapshot(name: string): Promise<UsageSnapshot | null> {
  // Prefer the daemon's cache while THIS profile's snapshot is fresh — the
  // daemon is a cache, and the CLI works with or without it. The age of the
  // last poll says nothing about a profile whose reads have been failing.
  const state = readDaemonState();
  const cached = state?.profiles?.[`claude/${name}`];
  if (snapshotFresh(cached, Date.now(), cacheMaxAgeMs(state?.pollIntervalMs))) return cached!;
  const token = usageToken(configDir("claude", name), defaultFreshenDeps(readBinaryPath("claude")), claudeLoginRefreshAllowed(name));
  if (!token) return null;
  const raw = await fetchUsage(token);
  return raw ? parseUsage(raw) : null;
}

/** Cached usage for one profile: the daemon's snapshot or the newest history
 *  sample, whichever is newer. Local reads only — `dir` runs on every start. */
export function cachedUsage(providerId: ProviderId, name: string): CachedUsage {
  const fromDaemonOrHistory = cachedUsageFromDaemonOrHistory(providerId, name);
  // The app's own reads land here unthrottled; take whichever source is newest.
  const latest = readLatestSnapshot(path.join(profileDir(providerId, name), LATEST_FILE));
  return latest && (fromDaemonOrHistory.capturedMs === null || latest.capturedMs > fromDaemonOrHistory.capturedMs) ? latest : fromDaemonOrHistory;
}

function cachedUsageFromDaemonOrHistory(providerId: ProviderId, name: string): CachedUsage {
  const daemonSnap = readDaemonState()?.profiles?.[`${providerId}/${name}`] ?? null;
  const daemonMs = daemonSnap ? Date.parse(daemonSnap.capturedAt) : NaN;
  const hist = readHistory(path.join(profileDir(providerId, name), "usage-history.json"));
  const last = hist.length ? hist[hist.length - 1] : null;
  const histMs = last ? Date.parse(last.at) : NaN;
  if (last && !isNaN(histMs) && (isNaN(daemonMs) || histMs > daemonMs)) {
    // History samples keep no reset time; the daemon's last one still holds
    // while it lies ahead (a window's reset only moves once it has passed).
    const resetOf = (key: string) => {
      const r = daemonSnap?.windows.find((d) => d.key === key)?.resetsAt ?? null;
      return r && Date.parse(r) > histMs ? r : null;
    };
    const labelOf = (key: string) => daemonSnap?.windows.find((d) => d.key === key)?.label ?? windowLabel(key);
    const windows = last.windows.map((w) => ({ key: w.key, label: labelOf(w.key), utilization: w.utilization, resetsAt: resetOf(w.key) }));
    return { snapshot: { windows, routines: null, capturedAt: last.at }, capturedMs: histMs };
  }
  return { snapshot: daemonSnap, capturedMs: isNaN(daemonMs) ? null : daemonMs };
}

export function tildePath(p: string): string {
  return p === HOME || p.startsWith(HOME + path.sep) ? "~" + p.slice(HOME.length) : p;
}

/** `claude --version`, read once per process (best-effort). Null when claude is
 *  not on PATH → the telemetry reader degrades to low confidence, never fails. */
let _claudeVersion: string | null | undefined;
function claudeVersion(): string | null {
  if (_claudeVersion !== undefined) return _claudeVersion;
  try {
    _claudeVersion = spawnSync("claude", ["--version"], { encoding: "utf8" }).stdout?.trim() || null;
  } catch {
    _claudeVersion = null;
  }
  return _claudeVersion;
}

/** Read a session row's own context state via the sanctioned telemetry reader.
 *  Own-session only — never a cross-account view. */
export function contextForRow(providerId: ProviderId, row: SessionRow): ContextReading | null {
  if (!row.file) return null;
  if (providerId !== "claude" && providerId !== "codex") return null;
  return readContext(providerId, row.file, { claudeVersion: claudeVersion() });
}

/** A Claude session row's prompt-cache state: its transcript, refined by the
 *  host's resume facts from the profile's hook events. null for other providers. */
export function cacheForRow(providerId: ProviderId, row: Pick<SessionRow, "sessionId" | "file">, events: readonly HookEventRecord[], nowMs = Date.now()): CacheReading | null {
  if (providerId !== "claude" || !row.file) return null;
  return withResumeFacts(readClaudeCache(row.file, nowMs), resumeFactsFor(events, row.sessionId));
}

/** The organization a Claude profile is signed in to (`oauthAccount` in its
 *  `.claude.json`, which holds no secret), or null when unknown. */
export function claudeOrganization(profile: string): string | null {
  const org = readJson(path.join(configDir("claude", profile), ".claude.json"))?.oauthAccount?.organizationUuid;
  return typeof org === "string" && org.length > 0 ? org : null;
}

/** Whether two Claude profiles share an organization (and so a prompt cache); null when either is unknown. */
export function sameOrganization(a: string, b: string): boolean | null {
  const oa = claudeOrganization(a);
  const ob = claudeOrganization(b);
  return oa && ob ? oa === ob : null;
}

/** The worst (highest-utilization) LIVE session's context for a profile — the
 *  one-liner `status` surfaces. Own-profile only; live-marking is POSIX-only
 *  (win32 has none, so this returns null there). Claude/codex only. */
export function worstLiveContext(providerId: ProviderId, name: string): (ContextReading & { sessionId: string }) | null {
  if (providerId !== "claude" && providerId !== "codex") return null;
  const cfg = configDir(providerId, name);
  const rows = providerId === "codex" ? listCodexSessions(cfg, 20) : listSessions(cfg, 20);
  if (providerId === "claude") markLive(cfg, rows);
  let worst: (ContextReading & { sessionId: string }) | null = null;
  for (const r of rows) {
    if (!r.live) continue;
    const c = contextForRow(providerId, r);
    if (!c) continue;
    const key = c.pct ?? c.contextTokens / 1e9; // pct when known, else a tiny token-based tiebreak
    const worstKey = worst ? (worst.pct ?? worst.contextTokens / 1e9) : -1;
    if (key > worstKey) worst = { ...c, sessionId: r.sessionId };
  }
  return worst;
}

/** One-column context render for the sessions table: "67% · 134k/200k",
 *  "134k tok" (window unknown), with a "~" prefix on low confidence. Empty
 *  string when there is nothing to show. */
export function formatContext(c: ContextReading | null): string {
  if (!c) return "";
  const mark = c.confidence === "low" ? "~" : "";
  const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);
  if (c.pct !== null && c.windowTokens) return `${mark}${c.pct}% · ${k(c.contextTokens)}/${k(c.windowTokens)}`;
  return `${mark}${k(c.contextTokens)} tok`;
}

/**
 * `agent-switch sessions [profile] [--recent N] [--json]` — recent (and, where
 * detectable, live) Claude Code sessions per profile. The JSON branch is the
 * GUI contract: a flat array, metadata only — transcript content never leaves
 * the profile dir (only the guarded first-line header is read).
 */
/** The regular Desktop app's data dir, then every profile's own instance. */
function desktopInstances(): DesktopInstance[] {
  const app = findApp("claude-desktop");
  const regular =
    process.platform === "darwin"
      ? path.join(HOME, "Library", "Application Support", "Claude")
      : process.platform === "win32"
        ? path.join(process.env.APPDATA ?? path.join(HOME, "AppData", "Roaming"), "Claude")
        : path.join(HOME, ".config", "Claude");
  return [{ profile: null, dir: regular }, ...(app ? listProfiles("claude").map((p) => ({ profile: p, dir: guiDataDir(app, p) })) : [])];
}

export function desktopScan() {
  const byAccount = new Map<string, string>();
  for (const p of listProfiles("claude")) {
    const uuid = readJson(path.join(configDir("claude", p), ".claude.json"))?.oauthAccount?.accountUuid;
    if (typeof uuid === "string") byAccount.set(uuid, p);
  }
  return scanDesktop({ instances: desktopInstances(), claudeHome: CLAUDE_HOME, profileOf: (u) => byAccount.get(u) ?? null, now: Date.now() });
}

/**
 * Ask before a destructive or scarce-credit action. `--yes` skips the question.
 * Off a terminal there is nobody to ask, so the action proceeds as it always
 * did (scripts and the GUI, which confirms in its own UI, keep working) and a
 * note on stderr says how to make that explicit.
 */
export async function confirmAction(question: string, yes: boolean): Promise<boolean> {
  if (yes) return true;
  if (!process.stdin.isTTY) {
    console.error("agent-switch: not a terminal — proceeding without confirmation (pass --yes to make this explicit).");
    return true;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer: string = await new Promise((resolve) => rl.question(`${question} [y/N] `, resolve));
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

export function authStatusFor(providerId: ProviderId, name: string): AuthStatus {
  const s = rawAuthStatusFor(providerId, name);
  const keptFreshBy = keptFreshByFor(providerId, { shared: sharesDefaultLogin(providerId, name), serviceInstalled: serviceTarget() !== "not-installed", keepSignedIn: readKeepSignedIn() }, s.keptFreshBy);
  return { ...s, keptFreshBy };
}

function rawAuthStatusFor(providerId: ProviderId, name: string): AuthStatus {
  const now = Date.now();
  const cfg = provider(providerId).configDirFor(configDir(providerId, name));
  if (providerId === "claude") {
    const file = claudeCredentialFile(cfg);
    const fromFile = readText(file);
    return claudeAuthStatus(name, credentials.read(cfg), fromFile !== null ? fileMtimeMs(file) : null, now);
  }
  if (providerId === "codex") return codexAuthStatus(name, readText(provider("codex").credentialPath(cfg)), now);
  return antigravityAuthStatus(name, fs.existsSync(provider("antigravity").credentialPath(cfg)));
}

export function parseMemberArg(v: string | undefined, usageLine: string): { provider: ProviderId; name: string } {
  const m = v ? parseMember(v) : null;
  if (!m) die(usageLine);
  return m;
}
