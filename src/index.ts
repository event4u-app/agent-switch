#!/usr/bin/env node
/**
 * agent-switch — multi-account profile switcher for Claude Code, Codex, and
 * Gemini (macOS, Linux, Windows).
 *
 * Architecture: config-dir isolation. Each profile is its own config dir with
 * its own live login, selected by the provider's env var (CLAUDE_CONFIG_DIR /
 * CODEX_HOME / GEMINI_CLI_HOME). Switching only changes which dir new
 * invocations point at — nothing is snapshotted, so nothing goes stale.
 *
 * On-disk layout: ~/.agent-switch/<provider>/<name>/config. v1 Claude profiles
 * (~/.agent-switch/<name>) are migrated on first run (see migrateLegacyLayout).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawn, spawnSync } from "node:child_process";

import {
  HOME,
  browserDir,
  configDir,
  die,
  ensureRoot,
  identity,
  listAllProfiles,
  listProfiles,
  migrateLegacyLayout,
  profileDir,
  profileExists,
  readJson,
  requireProfile,
  activeFor,
  setActive,
  labelFor,
  setLabel,
  clearLabel,
  renameProfile,
  isProfileLabel,
  PROFILE_LABELS,
  readAutoSwitch,
  readAutoSwitchAll,
  setAutoSwitch,
  readSwitchStrategy,
  setSwitchStrategy,
  SwitchStrategy,
  readOsNotifications,
  setOsNotifications,
  readProviders,
  enabledProviders,
  setProviderSurface,
  type ProviderSurface,
  ROOT,
} from "./profiles.js";
import { Provider, ProviderId, PROVIDER_IDS, provider, isProviderInstalled } from "./providers.js";
import { parseArgs, parseRun } from "./args.js";
import { credentialStore } from "./credentials.js";
import { withProperLock } from "./locks.js";
import { applySharing, removeSharing, syncSharing } from "./share.js";
import { detectShell, shellenvScript } from "./shellenv.js";
import { runDoctor } from "./doctor.js";
import {
  mappingRows,
  pruneMappings,
  removeMapping,
  resolveMapping,
  setMapping,
} from "./mappings.js";
import {
  accessTokenOf,
  fetchProfile,
  fetchUsage,
  liveSessionPids,
  readProfileCredential,
} from "./api.js";
import { UsageSnapshot, formatSnapshot, parseUsage } from "./usage.js";
import { readCodexUsage } from "./codex-usage.js";
import { redeemResetCredit } from "./codex-reset.js";
import {
  SessionRow,
  cleanupForkVehicle,
  listSessions,
  listCodexSessions,
  locateSession,
  locateCodexSession,
  markLive,
  sharedHistory,
  transferSession,
  transferCodexSession,
} from "./sessions.js";
import { isFresh, readDaemonState, readPid, PIDFILE, processAlive } from "./daemon.js";
import { cmdService, serviceUninstall } from "./service.js";
import { ContextReading, readContext, turnInFlight } from "./telemetry.js";
import {
  installHooks,
  uninstallHooks,
  hooksInstalled,
  readSettings,
  appendEvent,
  eventFile,
  profileFromConfigDir,
  HookEventRecord,
} from "./hooks.js";
import { readTelemetryConfig, writeTelemetryConfig } from "./notify.js";
import { resolveCcusageRunner, runCcusage, costBasisFor, TokenReport } from "./tokens.js";
import { appendNotification, readNotifications, clearNotifications, NotificationKind } from "./notifications.js";
import { APPS, buildLaunch, findApp, guiDataDir, isInstalled } from "./apps.js";
import {
  currentManagedSession,
  currentTmuxSessionName,
  newSessionArgs,
  readTmuxRegistry,
  recordManagedSession,
  respawnPaneArgs,
  sendKeysArgs,
  tmuxAvailable,
  tmuxSessionName,
} from "./tmux.js";

// Per-OS credential store (keychain-then-file on darwin, file-only elsewhere).
const credentials = credentialStore();
const CLAUDE_HOME = provider("claude").defaultConfigDir(); // ~/.claude
const CLAUDE_JSON = path.join(HOME, ".claude.json");

// ---------- launcher ---------------------------------------------------------

function launch(p: Provider, name: string, args: string[]): number {
  const env = { ...process.env, [p.envVar]: configDir(p.id, name) };
  const res = spawnSync(p.binary, args, { env, stdio: "inherit" });
  if (res.error && (res.error as NodeJS.ErrnoException).code === "ENOENT") {
    die(`\`${p.binary}\` binary not found on PATH. Install ${p.id} first.`);
  }
  return res.status ?? 1;
}

// ---------- commands ---------------------------------------------------------

function cmdAdd(providerId: ProviderId, name?: string): void {
  if (!name) die(`usage: agent-switch add [--provider ${providerId}] <profile>`);
  if (profileExists(providerId, name)) die(`profile "${name}" already exists for ${providerId}`);
  const p = provider(providerId);
  ensureRoot();
  fs.mkdirSync(configDir(providerId, name), { recursive: true, mode: 0o700 });
  console.log(`Created ${providerId} profile "${name}".`);
  console.log(`Launching ${p.binary} for first login (log in inside if prompted)...`);
  launch(p, name, []);
  const id = identity(providerId, name);
  console.log(id ? `Profile "${name}" is linked to ${id}.` : `Profile "${name}" created.`);
  console.log(`Activate it with: agent-switch use ${name}${providerId === "claude" ? "" : ` --provider ${providerId}`}`);
}

/**
 * Login-free import of the default Claude install into a profile. Takes Claude
 * Code's own locks so a credential can't be captured mid-rotation, copies the
 * config, seeds a plaintext .credentials.json (Claude re-migrates it into the
 * profile's hashed keychain entry), and sets the onboarding keys.
 */
async function importClaude(name: string): Promise<void> {
  if (!fs.existsSync(CLAUDE_HOME) && !fs.existsSync(CLAUDE_JSON)) {
    die("no default ~/.claude setup found to import");
  }
  ensureRoot();
  const dst = configDir("claude", name);

  const seeded = await withProperLock(CLAUDE_HOME, () =>
    withProperLock(CLAUDE_JSON, () => {
      credentials.clearStale(dst); // a stale hashed entry would shadow the seed (darwin)
      fs.mkdirSync(dst, { recursive: true, mode: 0o700 });
      if (fs.existsSync(CLAUDE_HOME)) fs.cpSync(CLAUDE_HOME, dst, { recursive: true });

      const config = (fs.existsSync(CLAUDE_JSON) && readJson(CLAUDE_JSON)) || {};
      config.hasCompletedOnboarding = true;
      config.theme = config.theme || "dark";
      fs.writeFileSync(path.join(dst, ".claude.json"), JSON.stringify(config, null, 2) + "\n", {
        mode: 0o600,
      });

      const creds = credentials.readDefault(CLAUDE_HOME);
      if (creds) fs.writeFileSync(path.join(dst, ".credentials.json"), creds, { mode: 0o600 });
      return creds !== null;
    }),
  );

  console.log(`Imported default Claude setup into profile "${name}".`);
  console.log(
    seeded
      ? "Credentials were seeded — no re-login needed. Claude Code migrates the seed into\n" +
          "this profile's own keychain entry on first use.\n" +
          "IMPORTANT: the default install and this profile now share one OAuth lineage — the\n" +
          "first side to refresh invalidates the other, so go through agent-switch from now on."
      : "No live credential found to seed (keychain locked/empty). Run `agent-switch run " +
          `${name}\` once and log in inside.`,
  );
}

/** Import a codex/gemini profile: copy the credential/identity files from the
 *  default install's config dir into the profile's config dir. */
function importFileProvider(p: Provider, name: string): void {
  const srcDir = p.defaultConfigDir();
  if (!fs.existsSync(srcDir)) die(`no default ${p.binary} install (${srcDir}) found to import`);
  const dstDir = p.configDirFor(configDir(p.id, name));
  fs.mkdirSync(dstDir, { recursive: true, mode: 0o700 });

  let seeded = false;
  for (const file of p.importFiles) {
    const src = path.join(srcDir, file);
    if (!fs.existsSync(src)) continue;
    fs.copyFileSync(src, path.join(dstDir, file));
    fs.chmodSync(path.join(dstDir, file), 0o600);
    if (path.join(srcDir, file) === p.credentialPath(srcDir)) seeded = true;
  }

  console.log(`Imported default ${p.binary} setup into profile "${name}".`);
  console.log(
    seeded
      ? `Credential seeded — no re-login needed.\nIMPORTANT: this profile shares one OAuth ` +
          `lineage with the default ${p.binary} login; go through agent-switch from now on.`
      : `No credential file found to seed. Run \`agent-switch run ${name} --provider ${p.id}\` ` +
          "and log in once.",
  );
}

async function cmdImport(providerId: ProviderId, name?: string): Promise<void> {
  if (!name) die(`usage: agent-switch import [--provider ${providerId}] <profile>`);
  if (profileExists(providerId, name)) die(`profile "${name}" already exists for ${providerId}`);
  if (providerId === "claude") return importClaude(name);
  return importFileProvider(provider(providerId), name);
}

function cmdUse(providerId: ProviderId, name?: string): void {
  const n = requireProfile(providerId, name, "use");
  setActive(providerId, n);
  const id = identity(providerId, n);
  console.log(`Active ${providerId} profile: ${n}${id ? ` (${id})` : ""}`);
  console.log(`New \`${provider(providerId).binary}\` sessions use this profile. Running sessions are unaffected.`);
}

function cmdDeactivate(providerId: ProviderId): void {
  const active = activeFor(providerId);
  if (!active) {
    console.log(`No active ${providerId} profile.`);
    return;
  }
  setActive(providerId, null);
  console.log(`Deactivated ${providerId} profile "${active}". No ${providerId} profile is active.`);
  console.log(`New \`${provider(providerId).binary}\` sessions fall back to the default install until you \`use\` one.`);
}

function cmdRun(providerId: ProviderId, name: string | undefined, args: string[]): void {
  const n = requireProfile(providerId, name, "run");
  const p = provider(providerId);
  // `--tmux` is an agent-switch flag, not a passthrough flag — strip it.
  const wantTmux = args.includes("--tmux");
  const passthrough = args.filter((a) => a !== "--tmux");

  if (wantTmux) {
    if (!tmuxAvailable()) {
      console.log("(--tmux unavailable — tmux not found or Windows; running normally.)");
    } else {
      // Wrap the session in an agent-switch-managed tmux session (recorded so
      // `takeover --in-place` knows this pane is ours to respawn).
      const sess = tmuxSessionName(providerId, n);
      recordManagedSession(sess, { provider: providerId, profile: n });
      const argv = newSessionArgs(sess, p.envVar, configDir(providerId, n), [p.binary, ...passthrough]);
      const res = spawnSync("tmux", argv, { stdio: "inherit" });
      process.exit(res.status ?? 1);
    }
  }
  process.exit(launch(p, n, passthrough));
}

function printProfileLine(providerId: ProviderId, name: string, showLive: boolean): void {
  const mark = activeFor(providerId) === name ? "*" : " ";
  const id = identity(providerId, name) ?? "not logged in";
  let live = "";
  if (showLive && providerId === "claude") {
    const pids = liveSessionPids(configDir("claude", name));
    if (pids.length > 0) live = `  [${pids.length} live session${pids.length > 1 ? "s" : ""}]`;
  }
  console.log(`${mark} ${name.padEnd(16)} ${id}${live}`);
}

function cmdList(providerId?: ProviderId, json = false): void {
  // An explicit --provider always lists that one; otherwise only enabled providers.
  const providers = providerId ? [providerId] : enabledProviders("cli");

  if (json) {
    // The GUI IPC contract: the profile list (identity/active/live) — NOT usage.
    // Usage stays behind `status --json` (active profile only, anti-rotation).
    const rows = providers.flatMap((pid) =>
      listProfiles(pid).map((n) => ({
        provider: pid,
        name: n,
        identity: identity(pid, n),
        label: labelFor(pid, n),
        active: activeFor(pid) === n,
        liveSessions: pid === "claude" ? liveSessionPids(configDir("claude", n)).length : 0,
      })),
    );
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  let any = false;
  for (const pid of providers) {
    const names = listProfiles(pid);
    if (names.length === 0) continue;
    any = true;
    console.log(`${pid}:`);
    for (const n of names) {
      process.stdout.write("  ");
      printProfileLine(pid, n, true);
    }
  }
  if (!any) console.log("No profiles yet. Create one with: agent-switch add <name> [--provider codex|gemini]");
}

function cmdCurrent(providerId?: ProviderId): void {
  const providers = providerId ? [providerId] : PROVIDER_IDS;
  for (const pid of providers) {
    const active = activeFor(pid);
    if (active && profileExists(pid, active)) {
      const id = identity(pid, active);
      console.log(`${pid}: ${active}${id ? ` (${id})` : ""}`);
    } else if (providerId) {
      console.log(`${pid}: (none — falling back to the default install)`);
    }
  }
}

function cmdWhoami(providerId: ProviderId, name?: string): void {
  const n = name ?? activeFor(providerId) ?? undefined;
  if (!n) die(`no profile given and none active for ${providerId}`);
  requireProfile(providerId, n, "whoami");
  console.log(identity(providerId, n) ?? "not logged in yet");
}

/** A Claude profile's usage snapshot via the OAuth endpoint; null if the
 *  credential is unreadable or the API shape is unknown. Codex/Gemini have no
 *  usage readout (verified), so this is Claude-only. */
async function claudeSnapshot(name: string): Promise<UsageSnapshot | null> {
  // Prefer the daemon's cache when it's fresh (< its own poll interval) — the
  // daemon is a cache, and the CLI works with or without it.
  const state = readDaemonState();
  if (state && isFresh(state, state.pollIntervalMs)) {
    const cached = state.profiles[`claude/${name}`];
    if (cached) return cached;
  }
  const creds = readProfileCredential(configDir("claude", name));
  const token = creds ? accessTokenOf(creds) : null;
  if (!token) return null;
  const raw = await fetchUsage(token);
  return raw ? parseUsage(raw) : null;
}

/**
 * Identity + (Claude only) usage. The default all-profile table is human-only.
 * `--json` emits the ACTIVE profile's snapshot ONLY — never a machine-readable
 * cross-account view (the anti-rotation boundary: no ranking material).
 */
async function cmdStatus(providerId?: ProviderId, name?: string, json = false): Promise<void> {
  if (json) {
    const pid = providerId ?? "claude";
    const active = name ?? activeFor(pid);
    if (!active || !profileExists(pid, active)) die(`no active ${pid} profile for --json`);
    const usage = pid === "claude"
      ? await claudeSnapshot(active)
      : pid === "codex"
        ? await readCodexUsage(configDir("codex", active))
        : null;
    const wc = worstLiveContext(pid, active);
    const context = wc
      ? { sessionId: wc.sessionId, pct: wc.pct, contextTokens: wc.contextTokens, windowTokens: wc.windowTokens, model: wc.model, confidence: wc.confidence }
      : null;
    console.log(JSON.stringify({ provider: pid, name: active, identity: identity(pid, active), usage, context }, null, 2));
    return;
  }

  const rows = name
    ? [{ provider: providerId ?? "claude", name: requireProfile(providerId ?? "claude", name, "status") }]
    : (providerId ? listProfiles(providerId).map((n) => ({ provider: providerId, name: n })) : listAllProfiles());
  if (rows.length === 0) die("no profiles");

  for (const { provider: pid, name: n } of rows as { provider: ProviderId; name: string }[]) {
    const mark = activeFor(pid) === n ? "*" : " ";
    console.log(`${mark} ${pid}/${n} — ${identity(pid, n) ?? "not logged in"}`);
    const wc = worstLiveContext(pid, n);
    if (wc) console.log(`  live context: ${formatContext(wc)}  (session ${wc.sessionId.slice(0, 8)})`);
    if (pid === "codex") {
      // Last-known from the newest rollout (no live endpoint); shows nothing
      // until this profile has run codex at least once.
      const snap = await readCodexUsage(configDir("codex", n));
      const lines = snap ? formatSnapshot(snap) : [];
      if (lines.length > 0) lines.forEach((l) => console.log(l));
      else console.log("  (usage unavailable — token expired or not logged in)");
      continue;
    }
    if (pid !== "claude") {
      console.log("  (no usage readout for this provider — shows own usage only where available)");
      continue;
    }
    const creds = readProfileCredential(configDir("claude", n));
    const token = creds ? accessTokenOf(creds) : null;
    if (!token) {
      console.log("  (credential not readable — profile may not have run yet)");
      continue;
    }
    const [profileInfo, raw] = await Promise.all([fetchProfile(token), fetchUsage(token)]);
    const org = profileInfo?.organization?.name ?? profileInfo?.account?.email ?? null;
    if (org) console.log(`  org: ${org}`);
    const lines = raw ? formatSnapshot(parseUsage(raw)) : [];
    if (lines.length > 0) lines.forEach((l) => console.log(l));
    else console.log("  (usage unavailable — token expired or API shape changed)");
  }
}

function cmdDir(providerId: ProviderId): void {
  // Precedence: directory mapping (nearest ancestor of CWD) > active-for-provider.
  const mapped = resolveMapping(process.cwd(), providerId);
  if (mapped && profileExists(providerId, mapped.name)) {
    console.log(configDir(providerId, mapped.name));
    return;
  }
  const active = activeFor(providerId);
  if (active && profileExists(providerId, active)) console.log(configDir(providerId, active));
  // Empty output -> shell wrapper falls back to the default config dir.
}

function cmdMap(providerId: ProviderId, name?: string, dir?: string): void {
  const n = requireProfile(providerId, name, `map [--provider ${providerId}] <profile> [dir]`);
  const key = setMapping(dir ?? process.cwd(), providerId, n);
  console.log(`Mapped ${key} -> ${providerId}/${n}`);
  console.log(`\`${provider(providerId).binary}\` in this directory (and subdirectories) now uses this profile.`);
}

function cmdUnmap(providerId: ProviderId | undefined, dir?: string): void {
  const target = dir ?? process.cwd();
  if (removeMapping(target, providerId)) console.log(`Removed mapping for ${target}${providerId ? ` (${providerId})` : ""}`);
  else die(`no mapping for ${target}${providerId ? ` (${providerId})` : ""}`);
}

function cmdMappings(): void {
  const rows = mappingRows();
  if (rows.length === 0) {
    console.log("No directory mappings. Create one with: agent-switch map <profile> [dir]");
    return;
  }
  for (const r of rows) console.log(`${r.path} -> ${r.provider}/${r.name}`);
}

// share + web are Claude-config concepts and stay Claude-scoped.
function cmdShare(mode?: string, flags: string[] = []): void {
  const withHistory = flags.includes("--history");
  const sourceFlagIdx = flags.indexOf("--source");
  const sourceName = sourceFlagIdx >= 0 ? flags[sourceFlagIdx + 1] : undefined;
  const source =
    sourceName && sourceName !== "default"
      ? configDir("claude", requireProfile("claude", sourceName, "share --source"))
      : CLAUDE_HOME;

  const profiles = listProfiles("claude");
  if (profiles.length === 0) die("no claude profiles");

  if (mode === "on") {
    if (!fs.existsSync(source)) die(`share source ${source} does not exist`);
    if (withHistory && process.platform === "win32") {
      die("--history requires POSIX symlinks (copies would fork history, not share it)");
    }
    console.log(`Sharing from ${source}${withHistory ? " (incl. history)" : ""}:`);
    for (const p of profiles) {
      if (configDir("claude", p) === source) continue;
      const actions = applySharing(source, configDir("claude", p), withHistory);
      console.log(`  ${p}: ${actions.length > 0 ? actions.join(", ") : "up to date"}`);
    }
    console.log(
      "Shared directories (skills/, commands/, agents/) write through the link. Shared files\n" +
        "(settings.json, ...) fork on an in-profile /config edit — run `agent-switch share sync`\n" +
        "to push a fork back to the source and re-link.",
    );
  } else if (mode === "sync") {
    console.log(`Reconciling forked links against ${source}:`);
    for (const p of profiles) {
      if (configDir("claude", p) === source) continue;
      const actions = syncSharing(source, configDir("claude", p));
      console.log(`  ${p}: ${actions.length > 0 ? actions.join(", ") : "nothing to reconcile"}`);
    }
  } else if (mode === "off") {
    for (const p of profiles) {
      const actions = removeSharing(configDir("claude", p));
      if (actions.length > 0) console.log(`  ${p}: ${actions.join(", ")}`);
    }
    console.log("Removed agent-switch-managed links (profile-own files were never touched).");
  } else {
    die("usage: agent-switch share on|sync|off [--history] [--source <profile|default>]");
  }
}

// ---------- session inventory + takeover (Claude; Codex lands per G0.3) ------

/** Relative age like "3m" / "2h" / "5d" for the sessions table. */
function ageOf(mtimeMs: number): string {
  const s = Math.max(0, Math.round((Date.now() - mtimeMs) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
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
function contextForRow(providerId: ProviderId, row: SessionRow): ContextReading | null {
  if (!row.file) return null;
  if (providerId !== "claude" && providerId !== "codex") return null;
  return readContext(providerId, row.file, { claudeVersion: claudeVersion() });
}

/** The worst (highest-utilization) LIVE session's context for a profile — the
 *  one-liner `status` surfaces. Own-profile only; live-marking is POSIX-only
 *  (win32 has none, so this returns null there). Claude/codex only. */
function worstLiveContext(providerId: ProviderId, name: string): (ContextReading & { sessionId: string }) | null {
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
function formatContext(c: ContextReading | null): string {
  if (!c) return "";
  const mark = c.confidence === "low" ? "~" : "";
  const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);
  if (c.pct !== null && c.windowTokens) return `${mark}${c.pct}% · ${k(c.contextTokens)}/${k(c.windowTokens)}`;
  return `${mark}${k(c.contextTokens)} tok`;
}

/**
 * `agent-switch hooks install|uninstall|status [profile]` — manage the
 * lifecycle push hooks in Claude profiles' settings.json. Additive,
 * marker-keyed, idempotent, share-aware (settings.json may be a shared,
 * fork-prone link — after an edit the user should run `share sync`). Claude
 * only (the hook contract is Claude Code's).
 */
function cmdHooks(sub?: string, name?: string): void {
  const action = sub ?? "status";
  if (!["install", "uninstall", "status"].includes(action)) {
    die("usage: agent-switch hooks install|uninstall|status [profile]");
  }
  const profiles = name ? [requireProfile("claude", name, "hooks")] : listProfiles("claude");
  if (profiles.length === 0) die("no claude profiles");

  let sharedWarn = false;
  for (const p of profiles) {
    const cfg = configDir("claude", p);
    if (action === "status") {
      console.log(`claude/${p}: ${hooksInstalled(readSettings(cfg)) ? "installed" : "not installed"}`);
      continue;
    }
    const res = action === "install" ? installHooks(cfg) : uninstallHooks(cfg);
    console.log(`claude/${p}: ${action} ${res.changed ? "done" : "(no change)"}`);
    if (res.changed) sharedWarn = true;
  }
  if (sharedWarn) {
    console.log(
      "\nsettings.json changed. If you use `share on`, run `agent-switch share sync` so the edit propagates and the link is restored.",
    );
  }
}

/**
 * `agent-switch tokens [profile] [--provider P] [--by-model] [--json]` — token
 * usage + cost per profile, delegated to ccusage (optional external tool). The
 * cost figure always carries its `costBasis`; subscription/OAuth profiles are
 * "notional" (API-equivalent, never real spend). Own-profile only.
 */
function cmdTokens(providerId: ProviderId, providerExplicit: boolean, name?: string, flags: Record<string, string | boolean> = {}): void {
  if (providerExplicit && providerId !== "claude" && providerId !== "codex") {
    die(`tokens supports claude and codex (not ${providerId})`);
  }
  const runner = resolveCcusageRunner();

  // `tokens status` — ccusage availability + version, CLI-appropriate freshness.
  if (name === "status") {
    if (!runner) { console.log("ccusage: not found on PATH. Install with `npm i -g ccusage`, or set AGENT_SWITCH_CCUSAGE='npx -y ccusage@latest'."); return; }
    const [cmd, ...prefix] = runner;
    const ver = spawnSync(cmd, [...prefix, "--version"], { encoding: "utf8", timeout: 60_000 }).stdout?.trim() || "(unknown)";
    console.log(`ccusage: ${ver}  ·  runner: ${runner.join(" ")}`);
    console.log("Token data is read live from ccusage on each `tokens` call (no cached rollup to go stale).");
    return;
  }

  if (!runner) {
    const msg = "Token tracking needs ccusage (an optional external tool we don't bundle).\n" +
      "  Install:   npm i -g ccusage      (or: brew install ccusage)\n" +
      "  Zero-install: run once with  AGENT_SWITCH_CCUSAGE='npx -y ccusage@latest' agent-switch tokens\n" +
      "Context monitoring (sessions/status/notify) works without it.";
    if (flags.json) { console.log(JSON.stringify({ error: "ccusage-not-found", hint: msg }, null, 2)); return; }
    die(msg);
  }

  const profiles = name ? [requireProfile(providerId, name, "tokens")] : listProfiles(providerId);
  if (profiles.length === 0) die(`no ${providerId} profiles`);

  const results: { profile: string; report: TokenReport | null }[] = [];
  for (const p of profiles) {
    const cfg = configDir(providerId, p);
    const basis = costBasisFor(readProfileCredential(cfg));
    results.push({ profile: p, report: runCcusage(runner, providerId, cfg, basis) });
  }

  if (flags.json) {
    console.log(JSON.stringify(results.map((r) => ({ provider: providerId, name: r.profile, tokens: r.report })), null, 2));
    return;
  }

  const fmtCost = (n: number, basis: string) => `$${n.toFixed(2)} (${basis})`;
  const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);
  for (const { profile: p, report } of results) {
    console.log(`${providerId}/${p}:`);
    if (!report) { console.log("  (no ccusage data — profile may not have run, or ccusage errored)"); continue; }
    if (flags["by-model"]) {
      const models = [...new Set(report.days.flatMap((d) => d.models))];
      console.log(`  models: ${models.join(", ") || "(none)"}`);
    }
    for (const d of report.days.slice(-14)) {
      console.log(`  ${d.date}  ${k(d.totalTokens)} tok  ${fmtCost(d.cost, report.costBasis)}`);
    }
    console.log(`  ── total: ${k(report.totals.totalTokens)} tok  ${fmtCost(report.totals.cost, report.costBasis)}`);
    if (report.costBasis === "notional") console.log("  (notional = API-equivalent value of subscription usage, not real spend)");
  }
}

/** Idle-guard window per provider (council #10): a Claude turn runs 15–60s, a
 *  Codex turn can be sub-second. In-flight = last transcript entry non-finalized
 *  AND younger than this. */
const IDLE_GUARD_MS: Record<string, number> = { claude: 15_000, codex: 5_000 };

/**
 * `agent-switch compact <profile> [--clear] [--dry-run] [--force] [--provider P]`
 * — type `/compact` (or `/clear`, gated) into the profile's agent-switch-MANAGED
 * tmux pane. MANAGED panes only (registry check); never a user's own terminal.
 * Refuses while a turn is in flight (idle guard) unless --force. Own-session.
 */
function cmdCompact(providerId: ProviderId, name?: string, flags: Record<string, string | boolean> = {}): void {
  if (providerId !== "claude" && providerId !== "codex") die(`compact supports claude and codex (not ${providerId})`);
  const profile = requireProfile(providerId, name, "compact");
  const clear = !!flags.clear;
  const dryRun = !!flags["dry-run"];
  const force = !!flags.force;
  const literal = clear ? "/clear" : "/compact";

  // 1. resolve the managed pane (profile-keyed; a profile has one managed name).
  const sess = tmuxSessionName(providerId, profile);
  const registry = readTmuxRegistry();
  if (!registry[sess]) {
    die(
      `no agent-switch-managed tmux pane for ${providerId}/${profile}.\n` +
        `We only ever type into panes we own. Start one with:  agent-switch run ${profile} --tmux\n` +
        `Or run this yourself in the session's terminal:  ${literal}`,
    );
  }

  // 2. /clear is destructive — gate behind --force (no interactive confirm in a one-shot CLI).
  if (clear && !force) {
    die("/clear discards the whole conversation. Re-run with --force if you really mean it (or use /compact to summarize instead).");
  }

  // 3. idle guard — never type into a running turn.
  const cfg = configDir(providerId, profile);
  const rows = providerId === "codex" ? listCodexSessions(cfg, 10) : listSessions(cfg, 10);
  if (providerId === "claude") markLive(cfg, rows);
  const target = rows.find((r) => r.live && r.file) ?? rows.find((r) => r.file);
  if (target?.file && !force && turnInFlight(target.file, Date.now(), IDLE_GUARD_MS[providerId] ?? 15_000)) {
    die(`a turn looks in-flight in ${providerId}/${profile} (last entry is unfinished + recent). Wait for it, or pass --force.`);
  }

  // 4. act (or dry-run).
  const argv = sendKeysArgs(sess, literal);
  if (dryRun) {
    console.log(`[dry-run] tmux ${argv.map((a) => (a.includes(" ") ? `'${a}'` : a)).join(" ")}`);
    return;
  }
  const res = spawnSync("tmux", argv, { stdio: "ignore" });
  if (res.status === 0) console.log(`Sent ${literal} to the managed pane "${sess}".`);
  else die(`tmux send-keys failed (is the pane still open?). Run ${literal} yourself in the session.`);
}

/**
 * `agent-switch alerts on|off|status [--threshold a,b]` — toggle whether the
 * daemon records context/usage crossings into the shared notification log
 * (off by default) and set the per-session context thresholds. Own-session
 * only. (Named `alerts` to avoid the `notify` command, which records a raw
 * notification event into the log.)
 */
function cmdAlerts(sub?: string, flags: Record<string, string | boolean> = {}): void {
  const action = sub ?? "status";
  const cfg = readTelemetryConfig(ROOT);
  if (typeof flags.threshold === "string") {
    const parsed = flags.threshold.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0 && n <= 100);
    if (parsed.length === 0) die("--threshold must be a comma-separated list of 1–100 numbers, e.g. --threshold 80,95");
    cfg.contextThresholds = parsed.sort((a, b) => a - b);
    writeTelemetryConfig(ROOT, cfg);
  }
  if (action === "on" || action === "off") {
    cfg.notify = action === "on";
    writeTelemetryConfig(ROOT, cfg);
  } else if (action !== "status") {
    die("usage: agent-switch alerts on|off|status [--threshold 80,95]");
  }
  if (flags.json) { console.log(JSON.stringify({ notify: cfg.notify, contextThresholds: cfg.contextThresholds }, null, 2)); return; }
  console.log(`notifications: ${cfg.notify ? "on" : "off"}  ·  context thresholds: ${cfg.contextThresholds.join(", ")}%`);
  if (!cfg.notify && action === "status") {
    console.log("(enable with `agent-switch alerts on`; the daemon records one coalesced notification per cycle when a live session crosses a threshold)");
  }
}

/**
 * Internal: the command Claude runs for each installed hook. Reads the hook's
 * stdin JSON and its own CLAUDE_CONFIG_DIR env, maps the dir back to a profile
 * (works even under a shared settings.json), and appends one event to the ring.
 * Silent + best-effort — a hook must never disrupt the session it fires in.
 */
function cmdHookEvent(): void {
  try {
    const raw = fs.readFileSync(0, "utf8"); // stdin
    const o = JSON.parse(raw);
    const cfg = process.env.CLAUDE_CONFIG_DIR;
    if (!cfg) return;
    const who = profileFromConfigDir(cfg, ROOT);
    if (!who) return;
    const rec: HookEventRecord = {
      event: typeof o.hook_event_name === "string" ? o.hook_event_name : "unknown",
      source: typeof o.source === "string" ? o.source : undefined,
      sessionId: typeof o.session_id === "string" ? o.session_id : undefined,
      at: new Date().toISOString(),
    };
    appendEvent(eventFile(ROOT, who.provider, who.profile), rec);
  } catch {
    // never throw from a hook
  }
}

/**
 * `agent-switch sessions [profile] [--recent N] [--json]` — recent (and, where
 * detectable, live) Claude Code sessions per profile. The JSON branch is the
 * GUI contract: a flat array, metadata only — transcript content never leaves
 * the profile dir (only the guarded first-line header is read).
 */
function cmdSessions(
  providerId: ProviderId,
  providerExplicit: boolean,
  name?: string,
  flags: Record<string, string | boolean> = {},
): void {
  if (providerExplicit && providerId !== "claude" && providerId !== "codex") {
    die(`sessions supports claude and codex for now (${providerId} parity is gated on its Phase-0 spike — see scripts/spikes/)`);
  }
  const recentFlag = flags.recent;
  const limit = typeof recentFlag === "string" ? Number(recentFlag) : 10;
  if (!Number.isFinite(limit) || limit < 1) die("--recent must be a positive number");

  const profiles = name ? [requireProfile(providerId, name, "sessions")] : listProfiles(providerId);
  if (profiles.length === 0) die(`no ${providerId} profiles`);

  const all: (SessionRow & { profile: string })[] = [];
  for (const p of profiles) {
    const cfg = configDir(providerId, p);
    // Codex stores date-partitioned rollout files (no encoded-cwd dir); its live
    // detection is not available via the Claude pid-file mechanism, so codex rows
    // stay recent-only (no live marking).
    const rows = providerId === "codex" ? listCodexSessions(cfg, limit) : listSessions(cfg, limit);
    if (providerId === "claude") markLive(cfg, rows); // POSIX: pid→cwd→dir match; win32: recent-only
    all.push(...rows.map((r) => ({ ...r, profile: p })));
  }

  if (flags.json) {
    console.log(
      JSON.stringify(
        all.map((r) => {
          const c = contextForRow(providerId, r);
          return {
            provider: providerId,
            ...r,
            context: c
              ? { pct: c.pct, contextTokens: c.contextTokens, windowTokens: c.windowTokens, model: c.model, confidence: c.confidence }
              : null,
          };
        }),
        null,
        2,
      ),
    );
    return;
  }
  const providerFlag = providerId === "claude" ? "" : ` --provider ${providerId}`;
  let any = false;
  for (const p of profiles) {
    const rows = all.filter((r) => r.profile === p);
    if (rows.length === 0) continue;
    any = true;
    console.log(`${providerId}/${p}:`);
    for (const r of rows) {
      const mark = r.live ? "*" : " ";
      const where = r.cwd ?? r.projectDir;
      const summary = r.summary ? `  ${r.summary}` : "";
      const ctx = formatContext(contextForRow(providerId, r));
      const ctxCol = ctx ? `  ${ctx}` : "";
      console.log(`${mark} ${r.sessionId}  ${where}  ${ageOf(r.mtimeMs)}${ctxCol}${r.live ? "  [live]" : ""}${summary}`);
    }
  }
  if (!any) {
    console.log(`No sessions found. Sessions appear after a \`${provider(providerId).binary}\` run on a profile.`);
  } else {
    console.log(`\nTake one over with: agent-switch takeover <session-id> --to <profile>${providerFlag}`);
  }
}

/** M5 fallback: open the resume in a NEW terminal (macOS Terminal.app), else
 *  print it. Used when --in-place is asked for but there is no managed pane. */
function spawnNewTerminal(command: string): void {
  if (process.platform === "darwin") {
    const script = `tell application "Terminal"\nactivate\ndo script "${command}"\nend tell`;
    spawnSync("osascript", ["-e", script], { stdio: "ignore" });
    console.log("Opened the resume in a new Terminal window — close the old window when you're done.");
  } else {
    console.log(`Open a new terminal and run:\n  ${command}\n(then close the old window).`);
  }
}

/**
 * In-place handoff. Inside an agent-switch-MANAGED tmux pane, replace the
 * running CLI with the resume command under the target profile's env (the pane
 * persists) — only ever a pane whose tmux session name is recorded as managed,
 * never a user's own terminal. Otherwise fall back to M5 (spawn a new terminal).
 * Exits the process.
 */
function resumeInPlace(providerId: ProviderId, target: string, resumeArgs: string[], resumeCommand: string): void {
  const mgmt = currentManagedSession(currentTmuxSessionName(), readTmuxRegistry());
  if (!mgmt) {
    spawnNewTerminal(resumeCommand); // M5 — no managed pane to respawn
    process.exit(0);
  }
  const sess = tmuxSessionName(mgmt.provider, mgmt.profile);
  const p = provider(providerId);
  const argv = respawnPaneArgs(sess, p.envVar, configDir(providerId, target), [p.binary, ...resumeArgs]);
  const res = spawnSync("tmux", argv, { stdio: "inherit" });
  recordManagedSession(sess, { provider: providerId, profile: target }); // pane now runs the target
  console.log(`Handed the session over to "${target}" in the managed tmux pane "${sess}".`);
  process.exit(res.status ?? 0);
}

/**
 * `agent-switch takeover <session-id> --to <profile>` — move a session between
 * two Claude profiles and resume it there. Move by default; `--keep-source`
 * copies and forces `--fork-session` on the target (fresh id there) so two
 * profiles never both own a file under one session id. See the roadmap's
 * guard order — every refusal here is a data-integrity rule, not polish.
 */
function cmdTakeover(
  providerId: ProviderId,
  providerExplicit: boolean,
  sessionId?: string,
  flags: Record<string, string | boolean> = {},
): void {
  if (providerExplicit && providerId !== "claude" && providerId !== "codex") {
    die(`takeover supports claude and codex for now (${providerId} parity is gated on its Phase-0 spike — see scripts/spikes/)`);
  }
  if (!sessionId || typeof flags.to !== "string") {
    die(
      "usage: agent-switch takeover <session-id> --to <profile> [--provider claude|codex] [--from <profile>] " +
        "[--keep-source] [--print-only] [--force] [--json]\n" +
        "       (list candidates with: agent-switch sessions)",
    );
  }
  const target = requireProfile(providerId, flags.to, "takeover --to");
  const keepSource = !!flags["keep-source"];
  const printOnly = !!flags["print-only"];
  const json = !!flags.json;
  const inPlace = !!flags["in-place"];
  if (inPlace && (printOnly || json)) die("--in-place cannot be combined with --print-only or --json.");
  if (inPlace && keepSource) {
    die("--in-place cannot be combined with --keep-source (the fork-cleanup needs a separate interactive step).");
  }

  if (providerId === "codex") {
    return takeoverCodex(sessionId, target, { keepSource, printOnly, json, inPlace, from: flags.from, force: !!flags.force });
  }

  // Source resolution: --from, or a scan across every Claude profile. More than
  // one hit means same-id divergence already exists — surface, never guess.
  const candidates = typeof flags.from === "string"
    ? [requireProfile("claude", flags.from, "takeover --from")]
    : listProfiles("claude");
  const hits = candidates
    .map((p) => ({ profile: p, loc: locateSession(configDir("claude", p), sessionId) }))
    .filter((h) => h.loc !== null);
  if (hits.length === 0) {
    die(`session ${sessionId} not found in any claude profile (see: agent-switch sessions)`);
  }
  if (hits.length > 1) {
    die(
      `session ${sessionId} exists in MULTIPLE profiles (${hits.map((h) => h.profile).join(", ")}) — ` +
        "the copies have diverged. Pick one explicitly with --from after inspecting them.",
    );
  }
  const { profile: source, loc } = hits[0] as { profile: string; loc: NonNullable<ReturnType<typeof locateSession>> };
  if (source === target) die(`session ${sessionId} is already in profile "${target}"`);

  // keep-source needs the interactive fork+cleanup step: without it the target
  // would keep a resumable copy under the ORIGINAL id — exactly the divergence
  // this command exists to prevent. (The GUI orchestrates this via --json later.)
  if (keepSource && (printOnly || json || !process.stdin.isTTY)) {
    die("--keep-source needs an interactive terminal (the fork's transfer copy is cleaned up after the session ends) — run it without --print-only/--json in a TTY");
  }

  const srcCfg = configDir("claude", source);
  const tgtCfg = configDir("claude", target);

  // Live guard: moving (or forking) under a running session risks interleaving
  // and appends into a file we just moved. Conservative by design: ANY live
  // session on the source profile blocks, `--force` overrides.
  const livePids = liveSessionPids(srcCfg);
  if (livePids.length > 0 && !flags.force) {
    die(
      `profile "${source}" has live Claude sessions (PIDs ${livePids.join(", ")}). ` +
        "Close them first (or --force if you are sure this session is not one of them).",
    );
  }

  const resumeArgs = ["--resume", sessionId, ...(keepSource ? ["--fork-session"] : [])];
  const resumeCommand = `agent-switch run ${target} -- ${resumeArgs.join(" ")}`;

  // Shared-history mode (`share on --history`): both profiles already see one
  // projects/ tree — file ops would be self-moves. Degrade to the resume step.
  if (sharedHistory(srcCfg, tgtCfg)) {
    if (json) {
      console.log(JSON.stringify({ sessionId, from: source, to: target, transferred: [], shared: true, resumeCommand }, null, 2));
      return;
    }
    console.log(`Profiles "${source}" and "${target}" share one history tree — nothing to move.`);
    console.log(`Resume on the target with:\n  ${resumeCommand}`);
    if (!printOnly && process.stdin.isTTY) process.exit(launch(provider("claude"), target, resumeArgs));
    return;
  }

  let result;
  try {
    result = transferSession(loc, tgtCfg, keepSource);
  } catch (err: any) {
    die(String(err?.message ?? err));
  }

  if (json) {
    console.log(JSON.stringify({ sessionId, from: source, to: target, transferred: result.actions, shared: false, resumeCommand }, null, 2));
    return;
  }
  console.log(`Session ${sessionId}: ${source} -> ${target}`);
  for (const a of result.actions) console.log(`  ${a}`);
  if (keepSource) {
    console.log("Resuming with --fork-session (fresh id on the target; note: session-scoped");
    console.log("permission approvals do not carry into a fork — Claude asks once more).");
    const rc = launch(provider("claude"), target, resumeArgs);
    // The fork got its own id; drop the vehicle copy that still carries the
    // original id, or both profiles would own that id (the g02 trap).
    cleanupForkVehicle(tgtCfg, loc.projectDir, sessionId);
    console.log(`Cleaned up the transfer copy (${sessionId}) on the target — the fork has its own id.`);
    process.exit(rc);
  }
  console.log(`Resume it with:\n  ${resumeCommand}`);
  if (inPlace) resumeInPlace("claude", target, resumeArgs, resumeCommand); // exits: respawn managed pane, else M5
  if (!printOnly && process.stdin.isTTY) process.exit(launch(provider("claude"), target, resumeArgs));
}

/**
 * Codex takeover — move-only (g03 outcome (a): a rollout moved into another
 * authenticated CODEX_HOME resumes immediately by id). Codex has no verified
 * fork spike, so `--keep-source` is refused rather than risk same-id
 * divergence, and no reliable pid-file live detection exists, so the absence of
 * a live-guard is surfaced instead of implied.
 */
function takeoverCodex(
  sessionId: string,
  target: string,
  opts: { keepSource: boolean; printOnly: boolean; json: boolean; inPlace: boolean; from: string | boolean | undefined; force: boolean },
): void {
  const { keepSource, printOnly, json, inPlace, from } = opts;
  if (keepSource) {
    die("--keep-source is not supported for codex: fork parity is unverified (no g0.2-equivalent spike), so a kept source would risk two homes owning one session id. Codex takeover is move-only.");
  }

  const candidates = typeof from === "string"
    ? [requireProfile("codex", from, "takeover --from")]
    : listProfiles("codex");
  const hits = candidates
    .map((p) => ({ profile: p, loc: locateCodexSession(configDir("codex", p), sessionId) }))
    .filter((h) => h.loc !== null);
  if (hits.length === 0) {
    die(`session ${sessionId} not found in any codex profile (see: agent-switch sessions --provider codex)`);
  }
  if (hits.length > 1) {
    die(
      `session ${sessionId} exists in MULTIPLE codex profiles (${hits.map((h) => h.profile).join(", ")}) — ` +
        "the copies have diverged. Pick one explicitly with --from after inspecting them.",
    );
  }
  const { profile: source, loc } = hits[0] as { profile: string; loc: NonNullable<ReturnType<typeof locateCodexSession>> };
  if (source === target) die(`session ${sessionId} is already in profile "${target}"`);

  const resumeArgs = ["resume", sessionId];
  const resumeCommand = `agent-switch run ${target} --provider codex -- ${resumeArgs.join(" ")}`;

  let result;
  try {
    result = transferCodexSession(loc, configDir("codex", target));
  } catch (err: any) {
    die(String(err?.message ?? err));
  }

  if (json) {
    console.log(JSON.stringify({ provider: "codex", sessionId, from: source, to: target, transferred: result.actions, shared: false, resumeCommand }, null, 2));
    return;
  }
  console.log(`Session ${sessionId}: codex ${source} -> ${target}`);
  for (const a of result.actions) console.log(`  ${a}`);
  console.log("Note: codex has no pid-file live detection — make sure no active codex session was running on the source profile.");
  console.log(`Resume it with:\n  ${resumeCommand}`);
  if (inPlace) resumeInPlace("codex", target, resumeArgs, resumeCommand); // exits
  if (!printOnly && process.stdin.isTTY) process.exit(launch(provider("codex"), target, resumeArgs));
}

function cmdRemove(providerId: ProviderId, name?: string, force = false): void {
  const n = requireProfile(providerId, name, "remove");
  if (activeFor(providerId) === n && !force) {
    die(`"${n}" is the active ${providerId} profile. Switch away first or use --force.`);
  }
  if (providerId === "claude") {
    const pids = liveSessionPids(configDir("claude", n));
    if (pids.length > 0 && !force) {
      die(`profile "${n}" has live Claude Code sessions (PIDs ${pids.join(", ")}). Close them or use --force.`);
    }
  }

  // Keychain entries exist only for claude (darwin); codex/gemini are file-based,
  // so computing a Claude hash for them would be a conceptual no-op — skip it.
  const removedEntry = providerId === "claude" ? credentials.removeEntry(configDir(providerId, n)) : false;
  fs.rmSync(profileDir(providerId, n), { recursive: true, force: true });
  if (activeFor(providerId) === n) setActive(providerId, null);
  clearLabel(providerId, n); // drop its label so it can't linger as an orphan
  const pruned = pruneMappings(providerId, n);

  console.log(`Removed ${providerId} profile "${n}".`);
  if (removedEntry) console.log("Removed its keychain credential entry.");
  if (pruned.length > 0) console.log(`Removed ${pruned.length} directory mapping(s).`);
}

/** Set or clear a profile's label (Work / Personal / Other). */
function cmdLabel(providerId: ProviderId, name?: string, label?: string): void {
  const n = requireProfile(providerId, name, "label");
  if (label === undefined || label === "none" || label === "clear") {
    setLabel(providerId, n, null);
    console.log(`Cleared label for ${providerId}/${n}.`);
    return;
  }
  if (!isProfileLabel(label)) {
    die(`invalid label "${label}" (choose: ${PROFILE_LABELS.join(", ")}, or "none" to clear)`);
  }
  setLabel(providerId, n, label);
  console.log(`Labeled ${providerId}/${n} as ${label}.`);
}

/** Enable/disable opt-in auto-switch, or show the current setting. */
/** Rename a profile (move its config dir + carry active/label/mappings). */
function cmdRename(providerId: ProviderId, from?: string, to?: string): void {
  const n = requireProfile(providerId, from, "rename");
  if (!to) die("usage: agent-switch rename <old> <new> [--provider P]");
  if (!/^[A-Za-z0-9._-]+$/.test(to)) {
    die("new name may contain only letters, numbers, dots, dashes and underscores.");
  }
  if (to === n) return; // no-op
  if (profileExists(providerId, to)) die(`profile "${to}" already exists for ${providerId}.`);
  if (providerId === "claude") {
    const pids = liveSessionPids(configDir("claude", n));
    if (pids.length > 0) die(`profile "${n}" has live Claude sessions (PIDs ${pids.join(", ")}). Close them first.`);
  }
  try {
    renameProfile(providerId, n, to);
  } catch (err: any) {
    die(String(err?.message ?? err));
  }
  for (const m of mappingRows()) {
    if (m.provider === providerId && m.name === n) setMapping(m.path, providerId, to);
  }
  console.log(`Renamed ${providerId} profile "${n}" → "${to}".`);
}

/** Manually redeem one banked rate-limit reset for a Codex profile. Consumes a
 *  real, scarce credit — the GUI gates this behind a confirmation. */
async function cmdReset(providerId: ProviderId, name?: string): Promise<void> {
  if (providerId !== "codex") die("reset is only available for codex (banked rate-limit resets).");
  const n = requireProfile("codex", name, "reset");
  const r = await redeemResetCredit(configDir("codex", n));
  if (r.ok) {
    console.log(`Redeemed a reset for codex/${n} (windows_reset=${r.windowsReset ?? "?"}).`);
  } else {
    die(`reset failed: ${r.reason ?? "unknown"}`);
  }
}

function cmdAutoswitch(
  providerId: ProviderId,
  providerExplicit: boolean,
  mode?: string,
  flags: Record<string, string | boolean> = {},
  value?: string,
): void {
  // `autoswitch strategy [reset-first|rotation-first]` — global switch behaviour.
  if (mode === "strategy") {
    if (value === "reset-first" || value === "rotation-first") {
      setSwitchStrategy(value as SwitchStrategy);
    } else if (value !== undefined) {
      die("usage: agent-switch autoswitch strategy [reset-first|rotation-first]");
    }
    if (flags.json) {
      console.log(JSON.stringify({ strategy: readSwitchStrategy() }));
    } else {
      console.log(`Auto-switch strategy: ${readSwitchStrategy()}.`);
    }
    return;
  }
  const thresholdFlag = flags.threshold;
  const threshold = typeof thresholdFlag === "string" ? Number(thresholdFlag) : undefined;
  if (threshold !== undefined && (!Number.isFinite(threshold) || threshold < 1 || threshold > 100)) {
    die("--threshold must be a number between 1 and 100");
  }
  if (mode === "on" || mode === "off") {
    // Auto-switch only makes sense where there is a usage readout to trigger on
    // (Claude today). Elsewhere there is nothing to act on, so enabling is refused.
    if (mode === "on" && !provider(providerId).hasUsageReadout) {
      die(`auto-switch is only available for providers with a usage readout (Claude, Codex).`);
    }
    const cfg = setAutoSwitch(providerId, { enabled: mode === "on", ...(threshold !== undefined ? { threshold } : {}) });
    console.log(`Auto-switch for ${providerId} ${cfg.enabled ? "ON" : "OFF"} (threshold ${cfg.threshold}%).`);
    if (cfg.enabled) {
      const strat = readSwitchStrategy();
      console.log(
        `Strategy: ${strat}${strat === "reset-first" ? " (redeem a banked reset before switching, Codex)" : ""}.\n` +
          `The daemon moves the active ${providerId} profile to the account with the most headroom once the\n` +
          "active one hits the threshold. Run `agent-switch service start` so the daemon is watching.",
      );
    }
    return;
  }
  if (mode === undefined || mode === "status") {
    if (flags.json) {
      // The GUI needs every provider's state at once (per-tab dots).
      console.log(JSON.stringify(readAutoSwitchAll()));
      return;
    }
    console.log(`strategy: ${readSwitchStrategy()}`);
    for (const p of providerExplicit ? [providerId] : PROVIDER_IDS) {
      const cfg = readAutoSwitch(p);
      console.log(`${p}: auto-switch ${cfg.enabled ? "ON" : "OFF"} (threshold ${cfg.threshold}%).`);
    }
    return;
  }
  die("usage: agent-switch autoswitch on|off|status|strategy [reset-first|rotation-first] [--provider P] [--threshold <1-100>] [--json]");
}

/**
 * Enable/disable a provider's surfaces (cli / ui), or show the current setting.
 * Disabling never deletes profiles — it only hides the provider from `list` and
 * the GUI; re-enabling restores everything. Default enabled: Claude + Codex.
 */
function cmdProviders(
  providerId: ProviderId,
  providerExplicit: boolean,
  mode?: string,
  flags: Record<string, string | boolean> = {},
): void {
  const surfaceFlag = typeof flags.surface === "string" ? flags.surface : undefined;
  if (surfaceFlag !== undefined && surfaceFlag !== "cli" && surfaceFlag !== "ui") {
    die("--surface must be cli or ui");
  }
  if (mode === "enable" || mode === "disable") {
    const enabled = mode === "enable";
    const surfaces: ProviderSurface[] = surfaceFlag ? [surfaceFlag as ProviderSurface] : ["cli", "ui"];
    const cfg = surfaces.reduce(
      (_acc, s) => setProviderSurface(providerId, s, enabled),
      readProviders()[providerId],
    );
    console.log(`${providerId}: cli ${cfg.cli ? "on" : "off"}, ui ${cfg.ui ? "on" : "off"}.`);
    return;
  }
  if (mode === undefined || mode === "status") {
    const all = readProviders();
    if (flags.json) {
      // The GUI needs every provider's enabled surfaces AND whether its binary
      // is installed (so it can show but not enable a missing provider) at once.
      const enriched = Object.fromEntries(
        PROVIDER_IDS.map((p) => [p, { ...all[p], installed: isProviderInstalled(p) }]),
      );
      console.log(JSON.stringify(enriched));
      return;
    }
    for (const p of providerExplicit ? [providerId] : PROVIDER_IDS) {
      const inst = isProviderInstalled(p) ? "installed" : "not installed";
      console.log(`${p}: cli ${all[p].cli ? "on" : "off"}, ui ${all[p].ui ? "on" : "off"} (${inst}).`);
    }
    return;
  }
  die("usage: agent-switch providers enable|disable|status [--provider P] [--surface cli|ui] [--json]");
}

/**
 * Remove agent-switch's own footprint. Deletes every profile (incl. Claude
 * keychain entries), the state/mappings, and stops+uninstalls the daemon. Does
 * NOT touch the provider CLIs' own default installs, nor `npm`/shell setup —
 * those are surfaced as manual follow-ups. Destructive → requires confirmation.
 */
function cmdUninstall(flags: Record<string, string | boolean> = {}): void {
  const claudeProfiles = listProfiles("claude");
  const allProfiles = listAllProfiles();
  if (!flags.force && !flags.yes) {
    console.log("This removes ALL agent-switch data:");
    console.log(`  - ${allProfiles.length} profile(s) and their configs under ${ROOT}`);
    console.log(`  - ${claudeProfiles.length} Claude keychain credential entr(y/ies) (macOS)`);
    console.log("  - directory mappings, active-profile state, and the background daemon/service");
    console.log("It does NOT touch your default claude/codex/gemini installs.");
    console.log("\nRe-run with --force to proceed:  agent-switch uninstall --force");
    return;
  }

  // Stop + uninstall the background service, and kill a manually-started daemon.
  try {
    serviceUninstall();
  } catch {
    /* best-effort */
  }
  const pid = readPid(PIDFILE);
  if (pid && processAlive(pid)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* best-effort */
    }
  }

  // Drop Claude keychain entries before deleting the dirs (darwin only; no-op elsewhere).
  let removedEntries = 0;
  for (const n of claudeProfiles) {
    if (credentials.removeEntry(configDir("claude", n))) removedEntries++;
  }

  fs.rmSync(ROOT, { recursive: true, force: true });

  console.log(`Removed ${allProfiles.length} profile(s) and all agent-switch data under ${ROOT}.`);
  if (removedEntries > 0) console.log(`Removed ${removedEntries} Claude keychain entr(y/ies).`);
  console.log("Follow-ups (manual, if you set them up):");
  console.log("  - `npm uninstall -g agent-switch`  (or `npm unlink -g agent-switch`)");
  console.log("  - remove the `agent-switch shellenv` line from your shell rc");
}

async function cmdWeb(name?: string): Promise<void> {
  const n = requireProfile("claude", name, "web");
  const userDataDir = browserDir("claude", n);
  fs.mkdirSync(userDataDir, { recursive: true, mode: 0o700 });

  let chromium: any;
  try {
    const mod: string = "playwright"; // non-literal so tsc doesn't require the package
    ({ chromium } = (await import(mod)) as any);
  } catch {
    die("playwright is not installed. Run:\n  npm install playwright && npx playwright install chromium");
  }

  console.log(`Opening claude.ai with the persistent browser profile "${n}"...`);
  console.log("Log in once — the session is stored in the profile and reused next time.");
  let context: any;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      viewport: null,
      args: ["--start-maximized"],
    });
  } catch (err: any) {
    die(
      `failed to launch a browser: ${err?.message ?? err}\n` +
        "On a headless Linux host there is no display to open — run this from a\n" +
        "desktop session, or ensure Chromium is installed: `npx playwright install chromium`.",
    );
  }
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto("https://claude.ai/");
  await new Promise<void>((resolve) => context.on("close", resolve));
}

// ---------- GUI app launch (foundation) --------------------------------------

function cmdApps(json = false): void {
  if (json) {
    const rows = APPS.map((a) => ({
      id: a.id,
      displayName: a.displayName,
      provider: a.provider,
      strategy: a.strategy,
      installed: isInstalled(a),
    }));
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (APPS.length === 0) {
    console.log("No GUI apps registered yet — support for desktop clients (Claude Desktop, Codex UI)");
    console.log("lands via their roadmaps. The launch layer (`agent-switch open`) is ready.");
    return;
  }
  for (const a of APPS) {
    const mark = isInstalled(a) ? "●" : "○";
    console.log(`${mark} ${a.id.padEnd(16)} ${a.displayName} (${a.provider}, ${a.strategy})`);
  }
}

const NOTIFICATION_KINDS: NotificationKind[] = ["success", "error", "warning", "info"];

/** `agent-switch notify --kind <k> --title <t> --message <m> [--json]` — record
 *  an event in the shared notification log. The GUI uses this for its own
 *  limit-fetch failures; the daemon appends directly via the module. `--json`
 *  echoes the created notification (or `null` when it was deduplicated). */
function cmdNotify(flags: Record<string, string | boolean>): void {
  const kind = typeof flags.kind === "string" ? flags.kind : "info";
  const title = typeof flags.title === "string" ? flags.title : "";
  const message = typeof flags.message === "string" ? flags.message : "";
  if (!NOTIFICATION_KINDS.includes(kind as NotificationKind)) {
    die(`usage: agent-switch notify --kind <${NOTIFICATION_KINDS.join("|")}> --title <t> --message <m> [--json]`);
  }
  if (!title && !message) die("agent-switch notify needs at least --title or --message");
  const created = appendNotification({ kind: kind as NotificationKind, title, message });
  if (flags.json) console.log(JSON.stringify(created));
}

/** `agent-switch os-notify [on|off|status] [--json]` — toggle whether the
 *  background daemon fires OS desktop notifications itself (for timeliness when
 *  the GUI is closed). Default off. */
function cmdOsNotify(sub: string | undefined, json = false): void {
  if (sub === "on" || sub === "off") setOsNotifications(sub === "on");
  else if (sub && sub !== "status") die("usage: agent-switch os-notify [on|off|status] [--json]");
  const enabled = readOsNotifications();
  if (json) console.log(JSON.stringify({ enabled }));
  else console.log(`Daemon OS notifications ${enabled ? "ON" : "OFF"}.`);
}

/** `agent-switch notifications [clear] [--json]` — list the recent
 *  notifications (newest first) or clear the log. */
function cmdNotifications(sub: string | undefined, json = false): void {
  if (sub === "clear") {
    clearNotifications();
    console.log(json ? "[]" : "Notifications cleared.");
    return;
  }
  const list = [...readNotifications()].reverse(); // newest first
  if (json) {
    console.log(JSON.stringify(list));
    return;
  }
  if (list.length === 0) {
    console.log("No notifications.");
    return;
  }
  for (const n of list) {
    const when = new Date(n.ts).toLocaleString();
    console.log(`[${when}] ${n.kind.toUpperCase()} ${n.title}${n.message ? ` — ${n.message}` : ""}`);
  }
}

/** Launch a registered GUI app on a profile, isolated (macOS). Profile: an
 *  explicit positional name, else the active profile for the app's provider. */
function cmdOpen(appId?: string, name?: string): void {
  if (!appId) die("usage: agent-switch open <app> [profile]   (see `agent-switch apps`)");
  const app = findApp(appId);
  if (!app) die(`unknown app "${appId}". See \`agent-switch apps\` for registered apps.`);
  if (process.platform !== "darwin") die("GUI app launch is macOS-only for now.");
  const n = name ?? activeFor(app.provider);
  if (!n) die(`no profile given and none active for ${app.provider} — pass a profile name.`);
  requireProfile(app.provider, n, "open");
  if (!isInstalled(app)) die(`${app.displayName} is not installed.`);
  let firstLaunch = false;
  if (app.strategy === "user-data-dir") {
    const dir = guiDataDir(app, n);
    firstLaunch = !fs.existsSync(dir);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); // lazy per-profile data dir
  }
  const spec = buildLaunch(app, n);
  spawn(spec.program, spec.args, { detached: true, stdio: "ignore" }).unref();
  console.log(`Opening ${app.displayName} on ${app.provider}/${n}...`);
  if (firstLaunch) {
    console.log("First launch of this profile — it opens logged-out; sign in once and the session");
    console.log("is saved to this profile. Quit other windows of this app before signing in.");
  }
}

function cmdShellenv(shellArg?: string): void {
  console.log(shellenvScript(detectShell(shellArg)));
}

function usage(): void {
  console.log(`agent-switch — switch accounts for Claude Code, Codex, and Gemini (macOS · Linux · Windows)

Provider defaults to claude; pass --provider codex|gemini for the others.

  agent-switch add [--provider P] <name>       create a profile and log it in
  agent-switch import [--provider P] <name>    migrate the default install (no re-login)
  agent-switch use [--provider P] <name>       set the active profile for a provider
  agent-switch deactivate [--provider P]       clear the active profile for a provider
  agent-switch run [--provider P] <name> [--tmux] [..]  launch the provider's CLI (--tmux = managed tmux session, POSIX)
  agent-switch list [--provider P] [--json]    list profiles, grouped by provider
  agent-switch status [--provider P] [name] [--json]   identity (+ Claude usage); --json = active only
  agent-switch current [--provider P]          show the active profile(s)
  agent-switch whoami [--provider P] [name]    show a profile's account identity
  agent-switch dir [--provider P]              resolve profile for CWD (mapping > active)
  agent-switch map [--provider P] <name> [dir] map a directory to a profile
  agent-switch unmap [--provider P] [dir]      remove a directory mapping
  agent-switch mappings                        list directory mappings
  agent-switch share on|sync|off [--history] [--source <profile|default>]   (Claude)
  agent-switch sessions [profile] [--recent N] [--json]   recent + live Claude sessions per profile (with context %)
  agent-switch hooks install|uninstall|status [profile]   manage lifecycle push hooks in Claude settings.json
  agent-switch alerts on|off|status [--threshold 80,95]   record context/usage crossings to the notification log (off by default)
  agent-switch compact <profile> [--clear] [--dry-run] [--force]   type /compact (or /clear) into the profile's managed tmux pane
  agent-switch tokens [profile] [--by-model] [--json]   token usage + cost per profile (via ccusage; subscription cost = notional)
  agent-switch takeover <id> --to <profile> [--from <profile>] [--keep-source] [--in-place] [--print-only] [--force]   move a session to another profile and resume it
  agent-switch web <name>                      claude.ai in a persistent browser (Claude)
  agent-switch remove [--provider P] <name> [--force]   delete a profile
  agent-switch label [--provider P] <name> [Work|Personal|Other|none]   tag a profile
  agent-switch autoswitch on|off|status [--provider P] [--threshold <1-100>]   per-provider auto-switch (default OFF)
  agent-switch reset <profile> --provider codex                                redeem one banked Codex rate-limit reset
  agent-switch rename <old> <new> [--provider P]                               rename a profile (name & keep its tag)
  agent-switch providers enable|disable|status [--provider P] [--surface cli|ui]   enable/disable a provider (default: Claude + Codex)
  agent-switch apps                            list launchable GUI apps (macOS)
  agent-switch open <app> [profile]            launch a GUI app on a profile, isolated (macOS)
  agent-switch shellenv [--shell zsh|bash|fish|powershell]   shell integration
  agent-switch service run|start|stop|status|install|uninstall   background usage daemon
  agent-switch notifications [clear] [--json]  recent notifications (auto-switches, fetch failures)
  agent-switch notify --kind K --title T --message M [--json]   record a notification event
  agent-switch os-notify [on|off|status] [--json]   daemon-side OS desktop notifications (default off)
  agent-switch uninstall [--force]             remove all agent-switch data + daemon
  agent-switch doctor                          per-OS, per-provider self-check`);
}

// ---------- main -------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const { cmd, providerId, providerExplicit, positional, flags } = parseArgs(argv);
  const rest = argv.slice(1); // args after the command (share/run parse these themselves)

  // One-time layout migration (v1 Claude profiles → provider-scoped). Quiet
  // unless it actually moves something. The `.layout-v2` marker makes this a
  // single existsSync after the first run, so there is no per-launch scan tax —
  // `dir` (the shell-prompt hot path) MUST still run it, or the first post-
  // upgrade `dir` would miss an un-migrated active profile and fall back to the
  // default config dir. Only pure help / shellenv (which emit text, touch no
  // profiles) skip it.
  if (cmd === "__hook-event") return cmdHookEvent(); // internal, silent, no migration

  if (cmd && !["help", "--help", "-h", "shellenv"].includes(cmd)) {
    const moved = migrateLegacyLayout();
    if (moved.length > 0) {
      // stderr, not stdout: `dir` is machine-consumed by the shell wrapper
      // (`dir="$(agent-switch dir 2>/dev/null)"`), so a status line on stdout
      // would pollute the resolved config path.
      console.error(`Migrated ${moved.length} Claude profile(s) to the new layout: ${moved.join(", ")}.`);
    }
  }

  switch (cmd) {
    case "add": return cmdAdd(providerId, positional[0]);
    case "import": return cmdImport(providerId, positional[0]);
    case "use": return cmdUse(providerId, positional[0]);
    case "deactivate": return cmdDeactivate(providerId);
    case "label": return cmdLabel(providerId, positional[0], positional[1]);
    case "autoswitch": return cmdAutoswitch(providerId, providerExplicit, positional[0], flags, positional[1]);
    case "reset": return cmdReset(providerId, positional[0]);
    case "rename": return cmdRename(providerId, positional[0], positional[1]);
    case "providers": return cmdProviders(providerId, providerExplicit, positional[0], flags);
    case "open": return cmdOpen(positional[0], positional[1]);
    case "apps": return cmdApps(!!flags.json);
    case "notify": return cmdNotify(flags);
    case "notifications": return cmdNotifications(positional[0], !!flags.json);
    case "os-notify": return cmdOsNotify(positional[0], !!flags.json);
    case "uninstall": return cmdUninstall(flags);
    case "run": { const r = parseRun(rest); return cmdRun(r.providerId, r.name, r.args); }
    case "list": case "ls": return cmdList(providerExplicit ? providerId : undefined, !!flags.json);
    case "status": return cmdStatus(providerExplicit ? providerId : undefined, positional[0], !!flags.json);
    case "current": return cmdCurrent(providerExplicit ? providerId : undefined);
    case "whoami": return cmdWhoami(providerId, positional[0]);
    case "dir": return cmdDir(providerId);
    case "map": return cmdMap(providerId, positional[0], positional[1]);
    case "unmap": return cmdUnmap(providerExplicit ? providerId : undefined, positional[0]);
    case "mappings": return cmdMappings();
    case "share": return cmdShare(positional[0], rest.slice(1));
    case "sessions": return cmdSessions(providerId, providerExplicit, positional[0], flags);
    case "hooks": return cmdHooks(positional[0], positional[1]);
    case "alerts": return cmdAlerts(positional[0], flags);
    case "compact": return cmdCompact(providerId, positional[0], flags);
    case "tokens": return cmdTokens(providerId, providerExplicit, positional[0], flags);
    case "takeover": return cmdTakeover(providerId, providerExplicit, positional[0], flags);
    case "web": return cmdWeb(positional[0]);
    case "remove": case "rm": return cmdRemove(providerId, positional[0], !!flags.force);
    case "shellenv": return cmdShellenv((flags.shell as string) ?? positional[0]);
    case "service": return cmdService(positional[0]);
    case "doctor": return process.exit(runDoctor());
    case "help": case "--help": case "-h": return usage();
    default: usage(); process.exit(cmd ? 1 : 0);
  }
}

main().catch((err) => die(String(err?.message ?? err)));
