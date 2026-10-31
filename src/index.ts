#!/usr/bin/env node
/**
 * agent-switch — multi-account profile switcher for Claude Code, Codex, and
 * Antigravity (macOS, Linux, Windows).
 *
 * Architecture: config-dir isolation. Each profile is its own config dir with
 * its own live login, selected by the provider's env var (CLAUDE_CONFIG_DIR /
 * CODEX_HOME / HOME). Switching only changes which dir new
 * invocations point at — nothing is snapshotted, so nothing goes stale.
 *
 * On-disk layout: ~/.agent-switch/<provider>/<name>/config. v1 Claude profiles
 * (~/.agent-switch/<name>) are migrated on first run (see migrateLegacyLayout).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
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
  colorOf,
  isDisabled,
  setSharesDefaultLogin,
  sharesDefaultLogin,
  setDisabled,
  setColor,
  isProfileColor,
  PROFILE_COLORS,
  renameProfile,
  isProfileLabel,
  PROFILE_LABELS,
  readAutoSwitch,
  readAutoSwitchAll,
  setAutoSwitch,
  type AutoSwitchTag,
  readOsNotifications,
  setOsNotifications,
  readKeepSignedIn,
  setKeepSignedIn,
  readProviders,
  setProviderSurface,
  readBinaryPath,
  readGuard,
  setGuard,
  readBinaryPaths,
  setBinaryPath,
  type ProviderSurface,
  ROOT,
  resetRebindKillSwitch,
} from "./profiles.js";
import { browserWrapperScript, defaultBrowserDeps, listBrowsers, locateBrowser } from "./browsers.js";
import { Provider, ProviderId, PROVIDER_IDS, provider, isProviderInstalled, resolveBinary } from "./providers.js";
import { borrowerOf, discardBinding, readBinding, rebind, releaseBorrowedAccount, restoreRebind } from "./rebind.js";
import { buildRebindDialog, resolveRebindChoice, selectableRows, type RebindDialogCandidate } from "./rebind-dialog.js";
import { parseArgs, parseRun, resolveProviderValue } from "./args.js";
import { extractBrief, writeBrief, sweepBriefs, seedPrompt } from "./handoff.js";
import { credentialStore } from "./credentials.js";
import { withProperLock } from "./locks.js";
import { applySharing, removeSharing, syncSharing, sharedLinkHealth, PROMPT_HISTORY } from "./share.js";
import { assertNotFull, exportConfig, importConfig } from "./config-transfer.js";
import { detectShell, installShellIntegration, shellenvScript } from "./shellenv.js";
import { runDoctor, shellIntegrationCheck } from "./doctor.js";
import { appendActivity, readActivity, ACTIVITY_MAX_LINES, type ActivityKind } from "./activity.js";
import { readGuiSettings, writeGuiSettings, applyGuiSetting, type GuiSettingUpdate } from "./gui-settings.js";
import { readProtection, setProtection, renameProtection, forgetProtection } from "./protection.js";
import {
  POOL_PREFIX,
  addPoolMember,
  createPool,
  deletePool,
  findPool,
  isPoolRef,
  parseMember,
  poolIdOf,
  readPools,
  removePoolMember,
  renamePool,
  renamePoolMember,
  suggestPoolsFromLabels,
} from "./pools.js";
import { resolveForDir, type CachedUsage } from "./dir-resolve.js";
import {
  antigravityAuthStatus,
  claudeAuthStatus,
  claudeCredentialFile,
  codexAuthStatus,
  fileMtimeMs,
  readText,
  type AuthStatus,
  keptFreshByFor,
} from "./auth-status.js";
import {
  TOOL_IDS,
  ToolAction,
  ToolId,
  checkTooling,
  formatToolNotes,
  formatToolingLines,
  runToolAction,
  toolNotesRefusal,
  toolReleaseRepo,
} from "./tooling.js";
import { releaseNoteBlocks } from "./release-notes.js";
import { HistorySample, LATEST_FILE, readHistory, readLatestSnapshot, recordHistorySample, writeLatestSnapshot } from "./history.js";
import { launchGui, waitForExit } from "./gui-launch.js";
import {
  GUARD_POLICIES,
  GUARD_REFUSED_EXIT,
  GuardPolicy,
  GuardVerdict,
  LoadInspection,
  OVERRIDE_ENV,
  guardVerdict,
  inspectLoad,
  isGuardPolicy,
  overrideFromEnv,
  renderGuardMessage,
} from "./single-load.js";
import { checkForUpdate, fetchReleases, releasesNewerThan, selfUpdate, type ReleaseInfo } from "./updates.js";
import {
  mappingRows,
  pruneMappings,
  removeMapping,
  resolveMapping,
  setMapping,
  setPaused,
  normalizePath,
} from "./mappings.js";
import {
  checkAuth,
  fetchProfile,
  fetchUsage,
  liveSessionPids,
} from "./api.js";
import { claudeLoginRefreshAllowed, defaultFreshenDeps, usageToken } from "./token-freshen.js";
import { UsageSnapshot, formatSnapshot, parseUsage } from "./usage.js";
import { readCodexUsage } from "./codex-usage.js";
import { redeemResetCredit } from "./codex-reset.js";
import {
  SessionRow,
  assertValidSessionId,
  cleanupForkVehicle,
  codexSessionCommand,
  deleteSession,
  detectRunningClaudeProfile,
  listSessions,
  listCodexSessions,
  locateSession,
  locateCodexSession,
  markLive,
  openQuestion,
  restoreSession,
  sharedHistory,
  sweepTrash,
  transferSession,
  transferCodexSession,
  trashedSessionExists,
} from "./sessions.js";
import { cacheMaxAgeMs, snapshotFresh, readDaemonState, readPid, PIDFILE, processAlive } from "./daemon.js";
import { cmdService, serviceAfterUpdate, serviceInstall, serviceInstallFromDisk, serviceTarget, serviceUninstall } from "./service.js";
import { fileURLToPath } from "node:url";
import { ContextReading, readContext, turnInFlight } from "./telemetry.js";
import { readPreview, type SessionPreview } from "./session-preview.js";
import {
  installHooks,
  uninstallHooks,
  hooksInstalled,
  readSettings,
  appendEvent,
  eventFile,
  profileFromConfigDir,
  readEvents,
  waitingSessions,
  HookEventRecord,
} from "./hooks.js";
import { readTelemetryConfig, writeTelemetryConfig } from "./notify.js";
import { appendNotification, readNotifications, clearNotifications, NotificationKind } from "./notifications.js";
import { APPS, buildLaunch, findApp, guiDataDir, isInstalled } from "./apps.js";
import { copyDesktopSettings, DEFAULT_DATA_DIR, hasSettingsLayout } from "./desktop-settings.js";
import {
  createLauncher,
  findRunning,
  focusRunning,
  readLaunchers,
  removeAllLaunchers,
  removeLauncher,
  removeLaunchersFor,
  renameLaunchersFor,
  repairLaunchers,
} from "./launchers.js";
import { DESKTOP_LIVE_MS, moveDesktopSession, scanDesktop, type DesktopInstance, type DesktopLocation } from "./desktop-sessions.js";
import { ensureAgyKeychain } from "./agy-keychain.js";
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

/** Record one of agent-switch's own actions in the activity log (never a token). */
function logActivity(kind: ActivityKind, target: string | null, action: string, reason: string, ok = true): void {
  appendActivity({ kind, target, action, reason, ok });
}


// ---------- single-load guard ------------------------------------------------
//
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

function checkSingleLoad(
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

// ---------- launcher ---------------------------------------------------------

function launch(p: Provider, name: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}): number {
  const home = configDir(p.id, name);
  const env: NodeJS.ProcessEnv = { ...process.env, ...extraEnv, [p.envVar]: home };
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

// ---------- commands ---------------------------------------------------------

function cmdAdd(providerId: ProviderId, name: string | undefined, browserId?: string): void {
  if (!name) die(`usage: agent-switch add [--provider ${providerId}] <profile> [--browser B]`);
  if (profileExists(providerId, name)) die(`profile "${name}" already exists for ${providerId}`);
  const p = provider(providerId);
  const env = browserId ? browserEnv(browserId, providerId) : {};
  ensureRoot();
  const dir = configDir(providerId, name);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // A bare `claude` in a fresh config dir opens Claude Code's setup screens, not
  // the sign-in; skip them the way `import` does and run the sign-in itself.
  if (providerId === "claude") seedClaudeOnboarding(dir);
  console.log(`Created ${providerId} profile "${name}".`);
  const loginArgs = LOGIN_ARGS[providerId];
  console.log(
    loginArgs.length
      ? `Signing it in with \`${[p.binary, ...loginArgs].join(" ")}\` (finish it in the browser if one opens)...`
      : `Launching ${p.binary} for first login (log in inside if prompted)...`,
  );
  const code = launch(p, name, loginArgs, env);
  const id = identity(providerId, name);
  const after = authStatusFor(providerId, name);
  const ok = !!id || after.state === "connected" || after.state === "expiring";
  logActivity("login", `${providerId}/${name}`, ok ? "signed in (new profile)" : "created, sign-in not confirmed", "user ran `agent-switch add`", ok);
  const flag = providerId === "claude" ? "" : ` --provider ${providerId}`;
  if (!ok && loginArgs.length) {
    console.error(
      `Profile "${name}" was created but is not signed in yet${code !== 0 ? ` (${p.binary} exited with ${code})` : ""}. Finish it with: agent-switch login ${name}${flag}`,
    );
    process.exit(1);
  }
  console.log(id ? `Profile "${name}" is signed in as ${id}.` : ok ? `Profile "${name}" is signed in.` : `Profile "${name}" created.`);
  console.log(`Activate it with: agent-switch use ${name}${flag}`);
}

/** Mark Claude Code's first-run setup as done in a new profile (theme taken
 *  from the default install), so its first start goes straight to work. */
function seedClaudeOnboarding(dir: string): void {
  const file = path.join(dir, ".claude.json");
  const config = (fs.existsSync(file) && readJson(file)) || {};
  const theme = (fs.existsSync(CLAUDE_JSON) && readJson(CLAUDE_JSON)?.theme) || "dark";
  config.hasCompletedOnboarding = true;
  config.theme = config.theme || theme;
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}

/**
 * `$BROWSER` for a sign-in in one specific browser. Only Claude Code is verified
 * to follow it; codex on macOS opens the system default regardless, so it is
 * told rather than silently ignored.
 */
function browserEnv(browserId: string, providerId: ProviderId): NodeJS.ProcessEnv {
  if (process.platform === "win32") die("--browser is not supported on Windows yet.");
  const deps = defaultBrowserDeps(HOME);
  const located = locateBrowser(browserId, deps);
  if (!located) {
    const installed = listBrowsers(deps).map((b) => b.id).join(", ") || "(none found)";
    die(`browser "${browserId}" is not installed. Installed: ${installed}`);
  }
  if (providerId !== "claude") {
    console.log(`Note: ${provider(providerId).binary} opens your default browser itself. If that is the wrong one, open the link it prints in ${browserId} — the sign-in works from any browser.`);
  }
  if (process.platform !== "darwin") return { BROWSER: located };
  const wrapper = path.join(ROOT, "browsers", browserId);
  fs.mkdirSync(path.dirname(wrapper), { recursive: true, mode: 0o700 });
  fs.writeFileSync(wrapper, browserWrapperScript(located), { mode: 0o700 });
  fs.chmodSync(wrapper, 0o700);
  return { BROWSER: wrapper };
}

function cmdBrowsers(json: boolean): void {
  const list = listBrowsers(defaultBrowserDeps(HOME));
  if (json) return void console.log(JSON.stringify(list, null, 2));
  if (list.length === 0) return void console.log("No supported browsers found.");
  for (const b of list) console.log(`${b.id.padEnd(16)} ${b.name}`);
}

/** The provider's own sign-in command for an existing profile. Antigravity's
 *  agy has no separate login command; it prompts when it starts signed out. */
const LOGIN_ARGS: Record<ProviderId, string[]> = {
  claude: ["auth", "login"],
  codex: ["login"],
  antigravity: [],
};

/**
 * Sign an existing profile in again — `add` refuses a name that exists, and a
 * login the provider cleared (signed out, refresh window ended) needs exactly
 * this. Runs the provider's own sign-in under the profile's config dir, then
 * reads the stored login back: the identity in the config outlives a sign-out,
 * so only the credential proves the sign-in happened.
 */
function cmdLogin(providerId: ProviderId, name: string | undefined, browserId?: string): void {
  const n = requireProfile(providerId, name, "login");
  const p = provider(providerId);
  const env = browserId ? browserEnv(browserId, providerId) : {};
  console.log(`Signing ${providerId}/${n} in with \`${[p.binary, ...LOGIN_ARGS[providerId]].join(" ")}\` (finish it in the browser if one opens)...`);
  const code = launch(p, n, LOGIN_ARGS[providerId], env);
  const after = authStatusFor(providerId, n);
  const ok = after.state === "connected" || after.state === "expiring";
  logActivity("login", `${providerId}/${n}`, ok ? "signed in again" : "sign-in not confirmed", "user ran `agent-switch login`", ok);
  if (!ok) {
    console.error(`${providerId}/${n} is still not signed in (${after.detail})${code !== 0 ? ` — ${p.binary} exited with ${code}` : ""}.`);
    process.exit(1);
  }
  // Its own sign-in ends the lineage it shared with the default install.
  if (sharesDefaultLogin(providerId, n)) setSharesDefaultLogin(providerId, n, false);
  const id = identity(providerId, n);
  console.log(`${providerId}/${n} is signed in${id ? ` as ${id}` : ""}.`);
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
  if (seeded) setSharesDefaultLogin("claude", name, true);

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

/** Import a file-based provider profile (e.g. codex): copy the credential/identity
 *  files from the default install's config dir into the profile's config dir. */
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
  if (seeded) setSharesDefaultLogin(p.id, name, true);

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
  if (isDisabled(providerId, n)) die(`${n} is disabled — turn it back on first: agent-switch enable ${n}${providerId === "claude" ? "" : ` --provider ${providerId}`}`);
  setActive(providerId, n);
  logActivity("switch", `${providerId}/${n}`, "set as active profile", "user ran `agent-switch use`");
  const id = identity(providerId, n);
  console.log(`Active ${providerId} profile: ${n}${id ? ` (${id})` : ""}`);
  console.log(`New \`${provider(providerId).binary}\` sessions use this profile. Running sessions are unaffected.`);

  // `use` loads nothing — it states an intent — so it NEVER blocks. But it is
  // the cheapest possible moment to tell the user that the profile they just
  // pointed at is already busy, before they type the command that gets refused.
  const check = checkSingleLoad(providerId, n, { context: "use" });
  if (check.message) {
    console.log("");
    console.warn(check.message);
  }
}

function cmdDeactivate(providerId: ProviderId): void {
  const active = activeFor(providerId);
  if (!active) {
    console.log(`No active ${providerId} profile.`);
    return;
  }
  setActive(providerId, null);
  logActivity("switch", `${providerId}/${active}`, "deactivated", "user ran `agent-switch deactivate`");
  console.log(`Deactivated ${providerId} profile "${active}". No ${providerId} profile is active.`);
  console.log(`New \`${provider(providerId).binary}\` sessions fall back to the default install until you \`use\` one.`);
}

function cmdRun(providerId: ProviderId, name: string | undefined, args: string[], cwd?: string): void {
  const n = requireProfile(providerId, name, "run");
  if (cwd !== undefined) {
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) die(`no such folder: ${cwd}`);
    process.chdir(cwd);
  }
  const p = provider(providerId);
  // `--tmux` and `--force` are agent-switch flags, not passthrough flags — strip
  // them before the rest reaches the provider binary.
  const wantTmux = args.includes("--tmux");
  const forced = args.includes("--force");
  const passthrough = args.filter((a) => a !== "--tmux" && a !== "--force");

  // agent-switch spawns the binary itself here, so this is the strongest
  // enforcement point: refuse before anything is launched.
  const guard = checkSingleLoad(providerId, n, { forced, offerForceFlag: true });
  if (guard.message) console.error(guard.verdict === "refuse" ? `error: ${guard.message}` : guard.message);
  if (guard.verdict === "refuse") process.exit(GUARD_REFUSED_EXIT);

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
    // More than one session on one account is the state the single-load guard
    // exists to prevent, so it is marked rather than blending into the count.
    if (pids.length > 1) live = `  ⚠️  [loaded ${pids.length}× — ${pids.length} live sessions]`;
    else if (pids.length === 1) live = "  [1 live session]";
  }
  console.log(`${mark} ${name.padEnd(16)} ${id}${live}`);
}

function cmdList(providerId?: ProviderId, json = false): void {
  // An explicit --provider always lists that one; otherwise every provider that
  // is enabled on ANY surface. Gating on the CLI surface alone would silently
  // drop a UI-only provider's profiles (e.g. Antigravity, cli:false/ui:true) —
  // the GUI reads `list --json` for every tab, so it must see them too.
  const cfg = readProviders();
  const providers = providerId ? [providerId] : PROVIDER_IDS.filter((p) => cfg[p].cli || cfg[p].ui);

  if (json) {
    // The GUI IPC contract: the profile list (identity/active/live) — NOT usage.
    // Usage stays behind `status --json` (active profile only, anti-rotation).
    const rows = providers.flatMap((pid) =>
      listProfiles(pid).map((n) => ({
        provider: pid,
        name: n,
        identity: identity(pid, n),
        label: labelFor(pid, n),
        color: colorOf(pid, n),
        disabled: isDisabled(pid, n),
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
  if (!any) console.log("No profiles yet. Create one with: agent-switch add <name> [--provider codex|antigravity]");
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
 *  credential is unreadable or the API shape is unknown. Codex/Antigravity have no
 *  usage readout (verified), so this is Claude-only. */
async function claudeSnapshot(name: string): Promise<UsageSnapshot | null> {
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
    // Feed the 30-day usage history from the GUI's own fetches: the GUI polls
    // every displayed profile on each refresh, so recording the fresh snapshot
    // here (throttled to ~hourly) fills the chart for all profiles without
    // depending on the background daemon or an "active" profile being set.
    if (usage) {
      recordHistorySample(path.join(profileDir(pid, active), "usage-history.json"), usage);
      // Unthrottled: `dir` balances on usage only while it is minutes old.
      writeLatestSnapshot(path.join(profileDir(pid, active), LATEST_FILE), usage);
    }
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
    const token = usageToken(configDir("claude", n), defaultFreshenDeps(readBinaryPath("claude")), claudeLoginRefreshAllowed(n));
    if (!token) {
      const auth = authStatusFor("claude", n);
      console.log(
        auth.state === "sign-in-needed"
          ? `  (signed out — sign in again: agent-switch login ${n})`
          : "  (credential not readable — profile may not have run yet)",
      );
      continue;
    }
    const [profileInfo, raw] = await Promise.all([fetchProfile(token), fetchUsage(token)]);
    const org = profileInfo?.organization?.name ?? profileInfo?.account?.email ?? null;
    if (org) console.log(`  org: ${org}`);
    const lines = raw ? formatSnapshot(parseUsage(raw)) : [];
    if (lines.length > 0) lines.forEach((l) => console.log(l));
    else if (profileInfo) console.log("  (usage unavailable — API shape changed?)");
    else {
      // Both profile and usage came back empty — disambiguate a dead login from
      // a transient/offline failure with one read-only probe (no token write).
      const auth = await checkAuth(configDir("claude", n));
      console.log(
        auth === "expired"
          ? `  (login expired — run \`agent-switch run ${n}\` and /login again)`
          : "  (usage unavailable — offline, or the login expired)",
      );
    }
  }
}

/** Cached usage for one profile: the daemon's snapshot or the newest history
 *  sample, whichever is newer. Local reads only — `dir` runs on every start. */
function cachedUsage(providerId: ProviderId, name: string): CachedUsage {
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
    const windows = last.windows.map((w) => ({ key: w.key, label: w.key, utilization: w.utilization, resetsAt: resetOf(w.key) }));
    return { snapshot: { windows, routines: null, capturedAt: last.at }, capturedMs: histMs };
  }
  return { snapshot: daemonSnap, capturedMs: isNaN(daemonMs) ? null : daemonMs };
}

function tildePath(p: string): string {
  return p === HOME || p.startsWith(HOME + path.sep) ? "~" + p.slice(HOME.length) : p;
}

/** Profile names are validated by `profileDir`, which exits on a bad name —
 *  a pool ref or a stale mapping must never kill the shell wrapper's hot path. */
function profileExistsSafe(providerId: ProviderId, name: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(name) && profileExists(providerId, name);
}

function resolveDir(providerId: ProviderId, plain = false): { name: string | null; why: string[]; blocked?: string } {
  return resolveForDir({
    providerId,
    mapping: plain ? null : resolveMapping(process.cwd(), providerId),
    names: listProfiles(providerId),
    threshold: (n) => readProtection(providerId, n).thresholdPct,
    active: activeFor(providerId),
    exists: (n) => profileExistsSafe(providerId, n),
    signedIn: (n) => identity(providerId, n) !== null,
    disabled: (n) => isDisabled(providerId, n),
    sharesDefaultLogin: (n) => profileExistsSafe(providerId, n) && sharesDefaultLogin(providerId, n),
    pool: (id) => findPool(id),
    usage: (n) => cachedUsage(providerId, n),
    // Only providers that write a live-session signal can report one; the
    // check runs for pool members only.
    live: (n) => provider(providerId).hasLiveSessionSignal && liveSessionPids(configDir(providerId, n)).length > 0,
    guard: readGuard(),
    now: Date.now(),
    displayPath: tildePath,
  });
}

/**
 * Resolve which profile a shell wrapper should load: directory mapping (nearest
 * ancestor of CWD) > active-for-provider. Empty output → the wrapper falls back
 * to the default config dir.
 *
 * With `--guard`, stdout is unchanged (the wrapper still reads the path from
 * it) and the guard speaks on STDERR, exiting {@link GUARD_REFUSED_EXIT} on a
 * refusal. Splitting the streams is what lets one command both feed the wrapper
 * and talk to the human; a distinct exit code is what lets the wrapper block on
 * a refusal without ever blocking on a missing or older `agent-switch`.
 */
function cmdDir(providerId: ProviderId, guarded = false, json = false, plain = false): void {
  const r = resolveDir(providerId, plain);
  if (json) {
    console.log(
      JSON.stringify(
        {
          profile: r.name ? `${providerId}/${r.name}` : null,
          configDir: r.name ? configDir(providerId, r.name) : null,
          why: r.why,
          ...(r.blocked ? { blocked: r.blocked } : {}),
        },
        null,
        2,
      ),
    );
    if (r.blocked) process.exit(GUARD_REFUSED_EXIT);
    return;
  }
  // A folder rule that cannot be served refuses — starting on an account
  // outside the rule is the one outcome the rule exists to prevent.
  if (r.blocked) {
    console.error(`agent-switch: not starting here — ${r.blocked}.`);
    process.exit(GUARD_REFUSED_EXIT);
  }
  const name = r.name;
  if (!name) return;
  console.log(configDir(providerId, name));
  if (!guarded) return;

  // A wrapper cannot pass `--force` (it would reach the provider binary), so
  // only the env override is offered here.
  const guard = checkSingleLoad(providerId, name, { offerForceFlag: false });
  if (guard.message) console.error(`agent-switch: ${guard.message}`);
  if (guard.verdict === "refuse") process.exit(GUARD_REFUSED_EXIT);
}

function cmdMap(providerId: ProviderId, name?: string, dir?: string, flags: Record<string, string | boolean> = {}): void {
  if (flags.pause || flags.resume) {
    // `map --pause [dir]`: the positional is the folder, there is no profile.
    const target = name ?? process.cwd();
    const on = !!flags.pause;
    if (!setPaused(target, providerId, on)) die(`no mapping for ${target} (${providerId})`);
    console.log(on
      ? `Paused the ${providerId} rule for ${normalizePath(target)} — it stays listed but no longer picks the account. Resume: agent-switch map --resume ${target}`
      : `Resumed the ${providerId} rule for ${normalizePath(target)}.`);
    return;
  }
  if (name && isPoolRef(name)) {
    const pool = findPool(poolIdOf(name));
    if (!pool) die(`no pool "${poolIdOf(name)}" — create it with: agent-switch pool create <name>`);
    const key = setMapping(dir ?? process.cwd(), providerId, `${POOL_PREFIX}${pool.id}`);
    console.log(`Mapped ${key} -> pool ${pool.id} (${providerId})`);
    console.log(`\`${provider(providerId).binary}\` here starts on the ${providerId} member of "${pool.name}" with the most fresh headroom. See why: agent-switch dir --json`);
    return;
  }
  const n = requireProfile(providerId, name, `map [--provider ${providerId}] <profile|pool:<id>> [dir]`);
  const key = setMapping(dir ?? process.cwd(), providerId, n);
  console.log(`Mapped ${key} -> ${providerId}/${n}`);
  console.log(`\`${provider(providerId).binary}\` in this directory (and subdirectories) now uses this profile.`);
}

function cmdUnmap(providerId: ProviderId | undefined, dir?: string): void {
  const target = dir ?? process.cwd();
  if (removeMapping(target, providerId)) console.log(`Removed mapping for ${target}${providerId ? ` (${providerId})` : ""}`);
  else die(`no mapping for ${target}${providerId ? ` (${providerId})` : ""}`);
}

function cmdMappings(json = false): void {
  const rows = mappingRows();
  if (json) {
    console.log(JSON.stringify(rows.map((r) => ({ path: r.path, provider: r.provider, target: r.name, paused: r.paused }))));
    return;
  }
  if (rows.length === 0) {
    console.log("No directory mappings. Create one with: agent-switch map <profile> [dir]");
    return;
  }
  for (const r of rows) {
    const line = isPoolRef(r.name) ? `${r.path} -> ${r.name} (${r.provider})` : `${r.path} -> ${r.provider}/${r.name}`;
    console.log(r.paused ? `${line}  [paused]` : line);
  }
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
      "Prompt history (history.jsonl — what ↑ and Ctrl+R search) is shared too; a profile's own\n" +
        "file was merged in and kept as history.jsonl.pre-share.\n" +
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
  } else if (mode === "status") {
    // Report the REAL state (from each profile's link manifest), not a cached
    // flag: sharing is active when any profile carries agent-switch-managed links.
    const rows = profiles
      .filter((p) => configDir("claude", p) !== source)
      .map((p) => {
        const links = sharedLinkHealth(configDir("claude", p));
        const prompts = links.some((l) => l.name === PROMPT_HISTORY && l.state === "linked");
        return { name: p, shared: links.length > 0, prompts };
      });
    const active = rows.some((r) => r.shared);
    if (flags.includes("--json")) {
      console.log(JSON.stringify({ active, source: sourceName ?? "default", profiles: rows }));
      return;
    }
    console.log(`share: ${active ? "on" : "off"} (source ${sourceName ?? "default"})`);
    for (const r of rows) console.log(`  ${r.name}: ${r.shared ? "shared" : "own"}${r.shared && !r.prompts ? " (prompt history not linked — run share on)" : ""}`);
  } else {
    die("usage: agent-switch share on|sync|off|status [--history] [--source <profile|default>]");
  }
}

/**
 * `agent-switch config export|import <profile> [--full]` — move a Claude
 * profile's SHARED config (settings.json, keybindings.json, CLAUDE.md, skills/,
 * commands/, agents/) between machines as a JSON bundle. Config-ONLY — it never
 * touches credentials. Claude-scoped (config lives under the Claude layout).
 *
 *   export → the bundle goes to STDOUT (pipe it: `| gpg -c > backup.gpg`), all
 *            status on STDERR so stdout stays a clean bundle.
 *   import → reads a bundle from STDIN into the profile's config dir.
 *   --full → REFUSED (would bundle live OAuth tokens; account-takeover vector).
 */
function cmdConfig(sub?: string, name?: string, flags: Record<string, string | boolean> = {}): void {
  try {
    assertNotFull(!!flags.full);
  } catch (e) {
    die((e as Error).message);
  }

  if (sub === "export") {
    const n = requireProfile("claude", name, "config export");
    const bundle = exportConfig(configDir("claude", n));
    // Status on stderr — stdout is the bundle (so `... | gpg -c > backup.gpg` works).
    console.error(`Exported config-only bundle for claude/${n} (SHARED_ITEMS allowlist; no credentials).`);
    process.stdout.write(bundle + "\n");
    return;
  }

  if (sub === "import") {
    const n = requireProfile("claude", name, "config import");
    let input: string;
    try {
      input = fs.readFileSync(0, "utf8"); // stdin
    } catch {
      die("config import reads a bundle from stdin — pipe one in (e.g. `gpg -d backup.gpg | agent-switch config import <profile>`).");
    }
    let written: string[];
    try {
      written = importConfig(configDir("claude", n), input);
    } catch (e) {
      die((e as Error).message);
    }
    console.error(`Imported ${written.length} config file(s) into claude/${n} (config-only; no credentials):`);
    for (const w of written) console.error(`  ${w}`);
    return;
  }

  die("usage: agent-switch config export|import <profile>   (config-only; pipe export | gpg -c > backup.gpg)");
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
    // Session awareness: surface "Claude needs you / finished" as a notification
    // the GUI routes to the pet. dedupe=false — each turn is a distinct moment,
    // so a solo session's repeated turns are never collapsed. Best-effort; a hook
    // must never throw.
    if (rec.event === "Notification") {
      appendNotification({ kind: "warning", title: "Claude is waiting", message: `${who.provider}/${who.profile} needs your input.` }, undefined, undefined, false);
    } else if (rec.event === "Stop") {
      appendNotification({ kind: "info", title: "Claude finished", message: `${who.provider}/${who.profile} finished its turn.` }, undefined, undefined, false);
    }
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

function desktopScan() {
  const byAccount = new Map<string, string>();
  for (const p of listProfiles("claude")) {
    const uuid = readJson(path.join(configDir("claude", p), ".claude.json"))?.oauthAccount?.accountUuid;
    if (typeof uuid === "string") byAccount.set(uuid, p);
  }
  return scanDesktop({ instances: desktopInstances(), claudeHome: CLAUDE_HOME, profileOf: (u) => byAccount.get(u) ?? null, now: Date.now() });
}

/** Which accounts ran sessions in each Claude Desktop instance; `mismatch` =
 *  a profile's own instance signed in with another account. */
function cmdDesktop(json: boolean): void {
  const { instances } = desktopScan();
  const shown = instances.filter((i) => i.accounts.length > 0);
  if (json) return void console.log(JSON.stringify(shown, null, 2));
  if (!shown.length) return void console.log("No Claude Desktop sessions found.");
  for (const i of shown) {
    console.log(`${i.profile ? `${i.profile}'s instance` : "Claude Desktop"} (${tildePath(i.dir)})`);
    for (const a of i.accounts) console.log(`  ${a.profile ?? "an account without a profile"} (${a.accountUuid.slice(0, 8)})${i.profile && a.profile !== i.profile ? "  <- not this profile's account" : ""}`);
  }
}

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

  const all: (SessionRow & { profile: string; surface?: string })[] = [];
  // Claude Desktop's own sessions, filed by account (see desktop-sessions.ts).
  const desktop = providerId === "claude" ? desktopScan().rows : [];
  for (const p of profiles) {
    const cfg = configDir(providerId, p);
    // Codex stores date-partitioned rollout files (no encoded-cwd dir); its live
    // detection is not available via the Claude pid-file mechanism, so codex rows
    // stay recent-only (no live marking).
    const rows: (SessionRow & { surface?: string })[] = providerId === "codex" ? listCodexSessions(cfg, limit) : listSessions(cfg, limit);
    if (providerId === "claude") markLive(cfg, rows); // POSIX: pid→cwd→dir match; win32: recent-only
    if (providerId === "claude") {
      const mtime = new Map(rows.map((r) => [r.sessionId, r.mtimeMs]));
      const waiting = waitingSessions(readEvents(eventFile(ROOT, providerId, p)), (id) => mtime.get(id) ?? null);
      // Hooks report a prompt; an open question also shows in the transcript itself.
      for (const r of rows) {
        const why = (r.file ? openQuestion(r.file) : null) ?? waiting.get(r.sessionId) ?? null;
        if (why) Object.assign(r, { waiting: true, waitingFor: why });
      }
    }
    const own = new Set(rows.map((r) => r.sessionId));
    for (const d of desktop) if (d.profile === p && !own.has(d.sessionId)) {
      const q = d.file ? openQuestion(d.file) : null;
      rows.push(q ? { ...d, waiting: true, waitingFor: q } : d);
    }
    rows.sort((a, b) => b.mtimeMs - a.mtimeMs);
    all.push(...rows.slice(0, limit).map((r) => ({ ...r, profile: p })));
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

/**
 * `agent-switch sessions preview <id> [--provider claude|codex] [--from <profile>]`
 * — the first few conversation turns of ONE session, for the GUI's collapsible
 * preview. Uses the sanctioned bounded reader (src/session-preview.ts, ADR-002):
 * a capped head read, fenced, degraded to an EMPTY preview on any failure or
 * unknown id (never an error — the GUI degrades to "no preview"). Codex is
 * deferred (opaque/often-compressed rollout) → always an empty preview. JSON.
 */
function cmdSessionsPreview(
  providerId: ProviderId,
  providerExplicit: boolean,
  sessionId?: string,
  flags: Record<string, string | boolean> = {},
): void {
  if (providerExplicit && providerId !== "claude" && providerId !== "codex") {
    die(`sessions preview supports claude and codex (not ${providerId})`);
  }
  if (!sessionId) {
    die("usage: agent-switch sessions preview <session-id> [--provider claude|codex] [--from <profile>]");
  }
  try {
    assertValidSessionId(sessionId);
  } catch (e) {
    die((e as Error).message);
  }

  const empty: SessionPreview = { messages: [], truncated: false };
  const emit = (preview: SessionPreview, profile: string | null) =>
    console.log(JSON.stringify({ provider: providerId, profile, sessionId, ...preview }, null, 2));

  if (providerId === "codex") {
    emit(empty, null); // deferred: opaque, often .zst-compressed rollout blob (ADR-002)
    return;
  }

  const candidates = typeof flags.from === "string"
    ? [requireProfile("claude", flags.from, "sessions preview --from")]
    : listProfiles("claude");
  const hits = candidates
    .map((p) => ({ profile: p, loc: locateSession(configDir("claude", p), sessionId) }))
    .filter((h) => h.loc !== null);
  if (hits.length === 0) {
    emit(empty, null); // unknown id → empty preview, never an error
    return;
  }
  const { profile, loc } = hits[0] as { profile: string; loc: NonNullable<ReturnType<typeof locateSession>> };
  emit(readPreview("claude", loc.jsonl) ?? empty, profile);
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
 * `agent-switch handoff extract <id> --from <profile> --to <targetProvider> [--print-only] [--json]`
 * — compose a metadata-only brief from the SOURCE session (`--provider`/`--from`)
 * for handing off to `--to` (target provider). Writes a 0600 brief file unless
 * `--print-only`. Reads no transcript body.
 *
 * `agent-switch handoff seed --to <profile> [--provider P] --brief <path>` —
 * open the TARGET agent INTERACTIVELY (pty) with a prompt that references the
 * brief BY PATH (content never enters argv). The source session is untouched.
 */
function cmdHandoff(
  providerId: ProviderId,
  sub?: string,
  positional: string[] = [],
  flags: Record<string, string | boolean> = {},
): void {
  if (sub === "extract") {
    const sessionId = positional[0];
    if (!sessionId || typeof flags.to !== "string") {
      die("usage: agent-switch handoff extract <session-id> --from <profile> --to <target-provider> [--provider claude|codex] [--print-only] [--json]");
    }
    try {
      assertValidSessionId(sessionId);
    } catch (e) {
      die((e as Error).message);
    }
    const targetProvider = resolveProviderValue(flags.to);
    const srcProfile = requireProfile(providerId, typeof flags.from === "string" ? flags.from : undefined, "handoff extract --from");
    const cfg = configDir(providerId, srcProfile);
    const brief = extractBrief({ provider: providerId, profile: srcProfile, sessionId, configDir: cfg, targetProvider });
    sweepBriefs(cfg);
    if (flags["print-only"]) {
      if (flags.json) console.log(JSON.stringify({ provider: providerId, profile: srcProfile, sessionId, targetProvider, brief }, null, 2));
      else console.log(brief);
      return;
    }
    const briefPath = writeBrief(cfg, sessionId, brief);
    if (flags.json) console.log(JSON.stringify({ provider: providerId, profile: srcProfile, sessionId, targetProvider, briefPath }, null, 2));
    else console.log(`Wrote handoff brief: ${briefPath}\nSeed the target with: agent-switch handoff seed --to <profile> --provider ${targetProvider} --brief ${briefPath}`);
    return;
  }

  if (sub === "seed") {
    if (typeof flags.to !== "string" || typeof flags.brief !== "string") {
      die("usage: agent-switch handoff seed --to <profile> [--provider claude|codex] --brief <path>");
    }
    const target = requireProfile(providerId, flags.to, "handoff seed --to");
    const briefPath = path.resolve(flags.brief);
    if (!fs.existsSync(briefPath)) die(`brief not found: ${briefPath}`);
    const prompt = seedPrompt(briefPath);
    if (flags["print-only"]) {
      console.log(`agent-switch run ${target} --provider ${providerId} -- ${JSON.stringify(prompt)}`);
      return;
    }
    // Interactive launch (auth is interactive — spike h1). Source untouched.
    cmdRun(providerId, target, [prompt]);
    return;
  }

  die("usage: agent-switch handoff extract|seed ...");
}

/**
 * `agent-switch sessions rm <id> [--provider claude|codex] [--from <profile>]
 * [--purge] [--yes] [--ack <id>] [--json]` — delete ONE session. Claude: a
 * recoverable trash-move (undo via `sessions restore`), `--purge` for true
 * deletion. Codex: the native `codex archive` (trash) / `codex delete` (purge),
 * because Codex owns its store format (.zst / indexes). Guards: strict id
 * validation, no-`--force`-over-live (Claude pids re-checked HERE; Codex mtime
 * freshness), multi-profile ambiguity refusal, shared-history acknowledgment.
 * `--yes` is mandatory (the GUI passes it after its own confirmation).
 */
function cmdSessionsRm(
  providerId: ProviderId,
  providerExplicit: boolean,
  sessionId?: string,
  flags: Record<string, string | boolean> = {},
): void {
  if (providerExplicit && providerId !== "claude" && providerId !== "codex") {
    die(`sessions rm supports claude and codex (not ${providerId})`);
  }
  if (!sessionId) {
    die("usage: agent-switch sessions rm <session-id> [--provider claude|codex] [--from <profile>] [--purge] [--yes] [--json]");
  }
  try {
    assertValidSessionId(sessionId);
  } catch (e) {
    die((e as Error).message);
  }
  const purge = !!flags.purge;
  const json = !!flags.json;
  if (!flags.yes) die("refusing to delete without --yes (the GUI passes it after its own confirmation)");

  if (providerId === "codex") return sessionsRmCodex(sessionId, flags, purge, json);

  const candidates = typeof flags.from === "string"
    ? [requireProfile("claude", flags.from, "sessions rm --from")]
    : listProfiles("claude");
  const hits = candidates
    .map((p) => ({ profile: p, loc: locateSession(configDir("claude", p), sessionId) }))
    .filter((h) => h.loc !== null);
  if (hits.length === 0) die(`session ${sessionId} not found in any claude profile (see: agent-switch sessions)`);
  if (hits.length > 1) {
    die(`session ${sessionId} exists in MULTIPLE profiles (${hits.map((h) => h.profile).join(", ")}) — pick one with --from`);
  }
  const { profile, loc } = hits[0] as { profile: string; loc: NonNullable<ReturnType<typeof locateSession>> };
  const cfg = configDir("claude", profile);

  // Live-guard, re-checked at exec time. --force does NOT override delete.
  const livePids = liveSessionPids(cfg);
  if (livePids.length > 0) {
    die(`profile "${profile}" has live Claude sessions (PIDs ${livePids.join(", ")}). Stop the session first — --force does not override delete.`);
  }

  // Shared-history: deleting removes the transcript for EVERY profile sharing the tree.
  const sharers = listProfiles("claude").filter(
    (p) => p !== profile && sharedHistory(cfg, configDir("claude", p)),
  );
  if (sharers.length > 0 && flags.ack !== sessionId) {
    die(`profiles [${sharers.join(", ")}] share this history tree — deleting removes the session for all of them. Re-run with --ack ${sessionId} to confirm.`);
  }

  const res = deleteSession(loc, { purge });
  sweepTrash(cfg);
  if (json) {
    console.log(JSON.stringify({ provider: "claude", profile, sessionId, ...res }, null, 2));
    return;
  }
  if (res.mode === "trash") {
    console.log(`Trashed claude session ${sessionId} from "${profile}". Restore: agent-switch sessions restore ${res.trashId} --from ${profile}`);
  } else {
    console.log(`Purged claude session ${sessionId} from "${profile}" (irreversible).`);
    if (res.residue.length) console.log(`  could not remove: ${res.residue.join(", ")}`);
  }
}

/** Codex delete path — native `codex archive`/`delete` in the profile's
 *  CODEX_HOME (codex exits 0 even on not-found, so success is read from output). */
function sessionsRmCodex(sessionId: string, flags: Record<string, string | boolean>, purge: boolean, json: boolean): void {
  const candidates = typeof flags.from === "string"
    ? [requireProfile("codex", flags.from, "sessions rm --from")]
    : listProfiles("codex");
  const hits = candidates
    .map((p) => ({ profile: p, loc: locateCodexSession(configDir("codex", p), sessionId) }))
    .filter((h) => h.loc !== null);
  if (hits.length === 0) die(`session ${sessionId} not found in any codex profile`);
  if (hits.length > 1) {
    die(`session ${sessionId} exists in MULTIPLE codex profiles (${hits.map((h) => h.profile).join(", ")}) — pick one with --from`);
  }
  const { profile, loc } = hits[0] as { profile: string; loc: NonNullable<ReturnType<typeof locateCodexSession>> };
  const cfg = configDir("codex", profile);

  // Codex has no live-pid signal → mtime-freshness proxy; typed --ack overrides.
  const ageMs = Date.now() - fs.statSync(loc.rollout).mtimeMs;
  if (ageMs < 60_000 && flags.ack !== sessionId) {
    die(`codex session ${sessionId} was written ${Math.round(ageMs / 1000)}s ago and may be live (codex has no liveness signal). Re-run with --ack ${sessionId} if it is idle.`);
  }

  const action = purge ? "delete" : "archive";
  const p = provider("codex");
  const env: NodeJS.ProcessEnv = { ...process.env, [p.envVar]: cfg };
  const r = spawnSync(resolveBinary(p.binary, readBinaryPath(p.id)), codexSessionCommand(action, sessionId), { env, encoding: "utf8" });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  if (/no .*session.*found/i.test(out)) die(`codex could not find session ${sessionId} in "${profile}": ${out}`);
  if (r.status && r.status !== 0) die(`codex ${action} failed: ${out || `exit ${r.status}`}`);
  if (json) {
    console.log(JSON.stringify({ provider: "codex", profile, sessionId, mode: purge ? "purge" : "trash", action }, null, 2));
    return;
  }
  console.log(
    purge
      ? `Deleted codex session ${sessionId} from "${profile}" via \`codex delete\` (irreversible).`
      : `Archived codex session ${sessionId} from "${profile}" via \`codex archive\`. Restore: agent-switch sessions restore ${sessionId} --provider codex --from ${profile}`,
  );
}

/**
 * `agent-switch sessions restore <handle> [--provider codex] [--from <profile>]`
 * — undo a delete. Claude: `<handle>` is the trash-id; the owning profile is
 * scanned (or `--from`). Codex: `<handle>` is the session id; runs native
 * `codex unarchive` and needs `--from` for the CODEX_HOME.
 */
function cmdSessionsRestore(
  providerId: ProviderId,
  providerExplicit: boolean,
  handle?: string,
  flags: Record<string, string | boolean> = {},
): void {
  if (providerExplicit && providerId !== "claude" && providerId !== "codex") {
    die(`sessions restore supports claude and codex (not ${providerId})`);
  }
  if (!handle) die("usage: agent-switch sessions restore <trash-id|session-id> [--provider codex] [--from <profile>]");

  if (providerId === "codex") {
    try {
      assertValidSessionId(handle);
    } catch (e) {
      die((e as Error).message);
    }
    if (typeof flags.from !== "string") die("codex restore needs --from <profile> (the session's home)");
    const profile = requireProfile("codex", flags.from, "sessions restore --from");
    const p = provider("codex");
    const env: NodeJS.ProcessEnv = { ...process.env, [p.envVar]: configDir("codex", profile) };
    const r = spawnSync(resolveBinary(p.binary, readBinaryPath(p.id)), codexSessionCommand("unarchive", handle), { env, encoding: "utf8" });
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
    if (/no .*session.*found/i.test(out)) die(`codex could not find an archived session ${handle} in "${profile}": ${out}`);
    console.log(`Unarchived codex session ${handle} in "${profile}".`);
    return;
  }

  const candidates = typeof flags.from === "string"
    ? [requireProfile("claude", flags.from, "sessions restore --from")]
    : listProfiles("claude");
  const owner = candidates.find((p) => trashedSessionExists(configDir("claude", p), handle));
  if (!owner) {
    die(`no trashed session "${handle}" found${typeof flags.from === "string" ? ` in ${flags.from}` : ""} (use the trash-id printed when you deleted it)`);
  }
  const r = restoreSession(configDir("claude", owner), handle);
  console.log(`Restored claude session to ${r.restored} in "${owner}".`);
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
    const desktop = desktopScan().locations.filter((l) => l.sessionId === sessionId && candidates.includes(l.profile));
    if (desktop.length > 0) return takeoverDesktop(sessionId, target, desktop, { keepSource, inPlace, json, force: !!flags.force });
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
 * Takeover of a Claude Desktop (Code tab) session: its metadata is re-filed
 * under the target account in the target profile's own Desktop window. The
 * transcript sits in the shared ~/.claude and stays, so nothing resumes in a
 * terminal — the session continues in that window. The source window must be
 * closed: an open one keeps the session in memory and may write it back.
 */
function takeoverDesktop(
  sessionId: string,
  target: string,
  hits: DesktopLocation[],
  opts: { keepSource: boolean; inPlace: boolean; json: boolean; force: boolean },
): void {
  if (hits.length > 1) {
    die(
      `session ${sessionId} is filed in more than one Claude Desktop window (${hits.map((h) => `${h.profile} in ${tildePath(h.instance.dir)}`).join(", ")}) — ` +
        "delete the stale one in Claude Desktop, or pick one with --from.",
    );
  }
  const [loc] = hits;
  if (opts.keepSource) die("--keep-source is not supported for a Claude Desktop session: Desktop has no fork, so it can only move.");
  if (opts.inPlace) die("--in-place does not apply to a Claude Desktop session — it continues in a Desktop window, not a terminal.");
  if (loc.profile === target) die(`session ${sessionId} already runs on "${target}"`);
  const app = findApp("claude-desktop");
  if (!app) die("Claude Desktop is not a registered app here");
  const account = readJson(path.join(configDir("claude", target), ".claude.json"))?.oauthAccount;
  if (typeof account?.accountUuid !== "string" || typeof account?.organizationUuid !== "string") {
    die(`profile "${target}" has no signed-in account to file the session under — sign it in first.`);
  }
  const pid = findRunning(loc.instance.profile === null ? null : loc.instance.dir);
  if (pid !== null && !opts.force) {
    die(`the Claude Desktop window holding this session is open (pid ${pid}) — quit it first so it can't write the session back (or --force).`);
  }
  if (loc.live && !opts.force) {
    die(`session ${sessionId} was active in the last ${DESKTOP_LIVE_MS / 60_000} minutes — let it finish first (or --force).`);
  }
  let moved: ReturnType<typeof moveDesktopSession>;
  try {
    moved = moveDesktopSession(loc, { dir: guiDataDir(app, target), accountUuid: account.accountUuid, orgUuid: account.organizationUuid });
  } catch (err) {
    die(String((err as Error)?.message ?? err));
  }
  const resumeCommand = `agent-switch open claude-desktop ${target}`;
  if (opts.json) {
    console.log(JSON.stringify({ sessionId, from: loc.profile, to: target, surface: "desktop-app", transferred: moved.actions, shared: false, resumeCommand }, null, 2));
    return;
  }
  console.log(`Session ${sessionId}: ${loc.profile} -> ${target} (Claude Desktop)`);
  for (const a of moved.actions) console.log(`  ${a}`);
  console.log(`Continue it in ${target}'s Claude Desktop window (reopen the window if it is open and the session is missing):\n  ${resumeCommand}`);
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

/**
 * Ask before a destructive or scarce-credit action. `--yes` skips the question.
 * Off a terminal there is nobody to ask, so the action proceeds as it always
 * did (scripts and the GUI, which confirms in its own UI, keep working) and a
 * note on stderr says how to make that explicit.
 */
async function confirmAction(question: string, yes: boolean): Promise<boolean> {
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

async function cmdRemove(providerId: ProviderId, name?: string, force = false, yes = false): Promise<void> {
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
  // An active rebind keeps both original credentials in two Keychain stash
  // entries. Deleting the profile would orphan them — restore first.
  const binding = providerId === "claude" ? readBinding(configDir("claude", n)) : null;
  if (binding && !force) {
    die(
      `profile "${n}" is rebound to "${binding.boundToProfile}"'s account. Restore it first: ` +
        `agent-switch rebind --restore --profile ${n} — or use --force to drop the rebind (its stashed credentials are deleted).`,
    );
  }

  // The reverse case: another profile is serving THIS profile's account. Its
  // restore would write into the store of a profile that no longer exists.
  const borrower = providerId === "claude" ? borrowerOf(n) : null;
  if (borrower && !force) {
    die(
      `profile "${n}"'s account is currently borrowed by "${borrower}" (rebind). Restore it first: ` +
        `agent-switch rebind --restore --profile ${borrower} — or use --force to restore "${borrower}" and then remove "${n}".`,
    );
  }

  const who = identity(providerId, n);
  if (!(await confirmAction(`Remove ${providerId} profile "${n}"${who ? ` (${who})` : ""} and its login? This cannot be undone.`, yes))) {
    console.log("Cancelled — nothing removed.");
    return;
  }

  // Keychain entries exist only for claude (darwin); codex/antigravity are file-based,
  // so computing a Claude hash for them would be a conceptual no-op — skip it.
  let restoredBorrower: string | null = null;
  if (borrower) {
    try {
      restoredBorrower = await releaseBorrowedAccount(n);
    } catch (e) {
      die(`could not restore "${borrower}" first, so "${n}" was not removed: ${(e as Error).message}`);
    }
    if (restoredBorrower) logActivity("rebind", `claude/${restoredBorrower}`, `restored own account (was on ${n})`, "user ran `agent-switch remove --force`");
  }
  const droppedRebind = binding ? discardBinding(n) : false;
  const removedEntry = providerId === "claude" ? credentials.removeEntry(configDir(providerId, n)) : false;
  removeLaunchersFor(providerId, n); // they would start a profile that no longer exists
  fs.rmSync(profileDir(providerId, n), { recursive: true, force: true });
  if (activeFor(providerId) === n) setActive(providerId, null);
  clearLabel(providerId, n); // drop its label so it can't linger as an orphan
  const pruned = pruneMappings(providerId, n);
  forgetProtection(providerId, n);
  renamePoolMember(`${providerId}/${n}`, null);
  logActivity("remove", `${providerId}/${n}`, "profile removed", yes ? "user ran `agent-switch remove --yes`" : "user ran `agent-switch remove`");

  console.log(`Removed ${providerId} profile "${n}".`);
  if (restoredBorrower) console.log(`Restored "${restoredBorrower}" to its own account first (it was borrowing "${n}").`);
  if (droppedRebind) console.log(`Dropped its active rebind (stashed credentials deleted; "${binding!.boundToProfile}" keeps its own login).`);
  if (removedEntry) console.log("Removed its keychain credential entry.");
  if (pruned.length > 0) console.log(`Removed ${pruned.length} directory mapping(s).`);
}

/** Set or clear a profile's label (Work / Personal / Other). */
function cmdLabel(providerId: ProviderId, name?: string, label?: string): void {
  // The profile need NOT exist yet: a label is independent state keyed by
  // provider/name, and the GUI sets the tag up front while `add` runs the login
  // in a terminal. Requiring the profile here made that set fail (and the GUI
  // swallowed the error), so a new profile's tag was silently lost.
  if (!name) die(`usage: agent-switch label <profile> [${PROFILE_LABELS.join("|")}|none] [--provider P]`);
  if (label === undefined || label === "none" || label === "clear") {
    setLabel(providerId, name, null);
    console.log(`Cleared label for ${providerId}/${name}.`);
    return;
  }
  if (!isProfileLabel(label)) {
    die(`invalid label "${label}" (choose: ${PROFILE_LABELS.join(", ")}, or "none" to clear)`);
  }
  setLabel(providerId, name, label);
  console.log(`Labeled ${providerId}/${name} as ${label}.`);
}

/** Disable keeps a profile (login, history, settings) but takes it out of every
 *  pick: no active slot, no pool or folder rule, no background polling. */
/** `mark-shared <name> [--off]`: mark (or unmark) a profile as sharing the
 *  default install's login — for imports made before `import` set the mark. */
function cmdMarkShared(providerId: ProviderId, name: string | undefined, off: boolean): void {
  const n = requireProfile(providerId, name, "mark-shared");
  setSharesDefaultLogin(providerId, n, !off);
  console.log(
    off
      ? `${providerId}/${n} no longer counts as sharing the default install's login.`
      : `${providerId}/${n} now counts as sharing the default install's login: agent-switch never refreshes it and never starts it by balancing. \`agent-switch login ${n}\` gives it its own login.`,
  );
}

function cmdDisable(providerId: ProviderId, name: string | undefined, disabled: boolean): void {
  const n = requireProfile(providerId, name, disabled ? "disable" : "enable");
  const wasActive = activeFor(providerId) === n;
  setDisabled(providerId, n, disabled);
  if (!disabled) return void console.log(`Turned ${providerId}/${n} back on.`);
  console.log(`Disabled ${providerId}/${n}. Nothing was deleted; \`agent-switch enable ${n}\` turns it back on.`);
  if (wasActive) console.log(`It was the active ${providerId} profile — new sessions now use the default login until you pick another.`);
}

/**
 * Make this CLI the one terminals and the background service use. Each app runs
 * it on start, so a dev build and an installed app each bring their own CLI:
 * the shell wrapper reads <home>/active-cli, and a service installed from the
 * other CLI is re-installed onto this one. An uninstalled service stays so.
 */
function cmdActivate(json: boolean): void {
  const cli = fs.realpathSync(fileURLToPath(import.meta.url));
  ensureRoot();
  fs.writeFileSync(path.join(ROOT, "active-cli"), `${cli}\n`, { mode: 0o600 });
  const before = serviceTarget();
  if (before === "other-cli") serviceInstall(() => {});
  const service = before === "other-cli" ? "repointed" : before === "this-cli" ? "unchanged" : "not-installed";
  if (json) return void console.log(JSON.stringify({ cli, service }));
  console.log(`Terminals now use ${cli}.`);
  if (service === "repointed") console.log("The background service was moved onto it.");
  if (service === "not-installed") console.log("The background service isn't installed (agent-switch service install).");
}

function cmdColor(providerId: ProviderId, name?: string, color?: string): void {
  // Like a label, independent state keyed by provider/name: the GUI picks the
  // colour before `add` has created the profile.
  if (!name) die(`usage: agent-switch color <profile> [${PROFILE_COLORS.join("|")}|none] [--provider P]`);
  if (color === undefined || color === "none" || color === "clear") {
    setColor(providerId, name, null);
    console.log(`Cleared the colour of ${providerId}/${name}.`);
    return;
  }
  if (!isProfileColor(color)) die(`invalid colour "${color}" (choose: ${PROFILE_COLORS.join(", ")}, or "none" to clear)`);
  setColor(providerId, name, color);
  console.log(`Coloured ${providerId}/${name} ${color}.`);
}

/** Enable/disable opt-in near-limit notifications (notify + suggest, never an
 *  automatic switch), or show the current setting. */
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
  renameProtection(providerId, n, to);
  renamePoolMember(`${providerId}/${n}`, `${providerId}/${to}`);
  renameLaunchersFor(providerId, n, to);
  console.log(`Renamed ${providerId} profile "${n}" → "${to}".`);
}

/** Manually redeem one banked rate-limit reset for a Codex profile. Consumes a
 *  real, scarce credit — the GUI gates this behind a confirmation. */
async function cmdReset(providerId: ProviderId, name?: string, yes = false): Promise<void> {
  if (providerId !== "codex") die("reset is only available for codex (banked rate-limit resets).");
  const n = requireProfile("codex", name, "reset");
  if (!(await confirmAction(`Redeem one banked rate-limit reset for codex/${n}? Credits are scarce and cannot be returned.`, yes))) {
    console.log("Cancelled — nothing redeemed.");
    return;
  }
  const r = await redeemResetCredit(configDir("codex", n));
  logActivity("redeem", `codex/${n}`, r.ok ? "redeemed one banked reset" : `redeem failed: ${r.reason ?? "unknown"}`, "user ran `agent-switch reset`", r.ok);
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
): void {
  const thresholdFlag = flags.threshold;
  const threshold = typeof thresholdFlag === "string" ? Number(thresholdFlag) : undefined;
  if (threshold !== undefined && (!Number.isFinite(threshold) || threshold < 1 || threshold > 100)) {
    die("--threshold must be a number between 1 and 100");
  }
  // --tag <all|work|personal|other>: restrict switch targets to accounts with
  // that label (case-insensitive). "all" clears the filter.
  const tagFlag = flags.tag;
  let tag: AutoSwitchTag | undefined;
  if (typeof tagFlag === "string") {
    const low = tagFlag.toLowerCase();
    const matched = low === "all" ? "all" : PROFILE_LABELS.find((l) => l.toLowerCase() === low);
    if (!matched) die("--tag must be one of: all, work, personal, other");
    tag = matched as AutoSwitchTag;
  }
  if (mode === "on" || mode === "off") {
    // Auto-switch only makes sense where there is a usage readout to trigger on
    // (Claude today). Elsewhere there is nothing to act on, so enabling is refused.
    if (mode === "on" && !provider(providerId).hasUsageReadout) {
      die(`auto-switch is only available for providers with a usage readout (Claude, Codex).`);
    }
    const cfg = setAutoSwitch(providerId, {
      enabled: mode === "on",
      ...(threshold !== undefined ? { threshold } : {}),
      ...(tag !== undefined ? { tag } : {}),
    });
    const tagNote = cfg.tag === "all" ? "" : `, tag ${cfg.tag}`;
    console.log(`Near-limit notifications for ${providerId} ${cfg.enabled ? "ON" : "OFF"} (threshold ${cfg.threshold}%${tagNote}).`);
    if (cfg.enabled) {
      console.log(
        `Once the active ${providerId} profile hits the threshold, the daemon NOTIFIES you and SUGGESTS the\n` +
          "account with the most headroom — it never switches automatically; switching stays a manual action.\n" +
          "On Codex it also tells you when a banked reset is available — redeeming one stays your call (`agent-switch reset`).\n" +
          "Run `agent-switch service start` so the daemon is watching.",
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
    for (const p of providerExplicit ? [providerId] : PROVIDER_IDS) {
      const cfg = readAutoSwitch(p);
      const tagNote = cfg.tag === "all" ? "" : `, tag ${cfg.tag}`;
      console.log(`${p}: near-limit notifications ${cfg.enabled ? "ON" : "OFF"} (threshold ${cfg.threshold}%${tagNote}).`);
    }
    return;
  }
  die("usage: agent-switch autoswitch on|off|status [--provider P] [--threshold <1-100>] [--tag all|work|personal|other] [--json]");
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
  // Link the provider's CLI binary when it isn't on PATH — the user points us at
  // it (from the GUI Providers tab or here). `unlink` reverts to PATH resolution.
  if (mode === "link") {
    const binPath = typeof flags.path === "string" ? flags.path : undefined;
    if (!binPath) die(`usage: agent-switch providers link --provider ${providerId} --path <path-to-binary>`);
    if (!fs.existsSync(binPath)) die(`no file at "${binPath}" — pass the full path to the ${provider(providerId).binary} binary.`);
    setBinaryPath(providerId, binPath);
    console.log(`Linked ${providerId} binary → ${binPath}`);
    return;
  }
  if (mode === "unlink") {
    setBinaryPath(providerId, null);
    console.log(`Unlinked ${providerId} binary (back to PATH resolution).`);
    return;
  }
  if (mode === undefined || mode === "status") {
    const all = readProviders();
    const links = readBinaryPaths();
    if (flags.json) {
      // The GUI needs every provider's enabled surfaces, whether its binary is
      // usable (installed on PATH or linked), and any linked path — so it can
      // show, link, and enable a provider that isn't on PATH — all at once.
      const enriched = Object.fromEntries(
        PROVIDER_IDS.map((p) => [p, { ...all[p], installed: isProviderInstalled(p, links[p]), binaryPath: links[p] ?? null }]),
      );
      console.log(JSON.stringify(enriched));
      return;
    }
    for (const p of providerExplicit ? [providerId] : PROVIDER_IDS) {
      const inst = isProviderInstalled(p, links[p]) ? (links[p] ? `linked: ${links[p]}` : "installed") : "not installed";
      console.log(`${p}: cli ${all[p].cli ? "on" : "off"}, ui ${all[p].ui ? "on" : "off"} (${inst}).`);
    }
    return;
  }
  die("usage: agent-switch providers enable|disable|link|unlink|status [--provider P] [--surface cli|ui] [--path <bin>] [--json]");
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
    console.log("  - app launchers it created in ~/Applications/Agent Switch");
    console.log("It does NOT touch your default claude/codex/antigravity installs.");
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

  // Launchers live in ~/Applications, outside ROOT, and are listed in its manifest.
  const removedLaunchers = removeAllLaunchers();
  fs.rmSync(ROOT, { recursive: true, force: true });

  console.log(`Removed ${allProfiles.length} profile(s) and all agent-switch data under ${ROOT}.`);
  if (removedLaunchers > 0) console.log(`Removed ${removedLaunchers} app launcher(s) from ~/Applications/Agent Switch.`);
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
      copiesSettings: hasSettingsLayout(a.id),
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
  // --repeat: each occurrence is its own moment (a session waiting again), so
  // an identical notice is not collapsed into the last one.
  const created = appendNotification({ kind: kind as NotificationKind, title, message }, undefined, undefined, !flags.repeat);
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
  else {
    console.log(`Daemon OS notifications ${enabled ? "ON" : "OFF"}.`);
    if (enabled && process.platform === "darwin") console.log("On macOS the daemon shows none itself — the Agent Switch app shows them while it runs.");
  }
}

/** `agent-switch keep-signed-in [on|off|status] [--json]` — whether the
 *  service lets Claude Code refresh a lapsed login (token-freshen.ts). Default
 *  on; Claude only — Codex and Antigravity refresh only when their own CLI runs. */
function cmdKeepSignedIn(sub: string | undefined, json = false): void {
  if (sub === "on" || sub === "off") {
    const on = sub === "on";
    if (readKeepSignedIn() !== on) {
      setKeepSignedIn(on);
      logActivity("settings", null, `keep accounts signed in ${on ? "on" : "off"}`, "user changed it");
    }
  } else if (sub && sub !== "status") die("usage: agent-switch keep-signed-in [on|off|status] [--json]");
  const enabled = readKeepSignedIn();
  if (json) console.log(JSON.stringify({ enabled }));
  else console.log(`Keep accounts signed in ${enabled ? "ON" : "OFF"} (Claude accounts; needs the background service).`);
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
async function cmdGui(afterPid?: string | boolean): Promise<void> {
  // Launch the tray/menubar GUI — downloads its prebuilt artifact from the
  // matching GitHub Release on first use, then caches it (see gui-launch.ts).
  // `--after-pid` is the GUI's restart: it quits and hands over to this run,
  // which launches the version THIS CLI is on — after an update, the new one.
  if (afterPid !== undefined) {
    const pid = Number(afterPid);
    if (!Number.isInteger(pid) || pid <= 0) die("usage: agent-switch gui [--after-pid <pid>]");
    if (!(await waitForExit(pid))) die(`the GUI (pid ${pid}) did not quit — start it again with \`agent-switch gui\`.`);
  }
  try {
    const result = await launchGui();
    console.log(result === "already-running" ? "The agent-switch GUI is already running." : "Launched the agent-switch GUI.");
  } catch (err: any) {
    die(String(err?.message ?? err));
  }
}

/** `agent-switch check-update` — compare the running version against the latest
 *  GitHub release (read-only; the same check the GUI runs). */
async function cmdCheckUpdate(json = false): Promise<void> {
  const c = await checkForUpdate();
  if (json) {
    console.log(JSON.stringify(c));
    return;
  }
  switch (c.kind) {
    case "uptodate":
      console.log(`agent-switch ${c.current} — up to date (latest ${c.latest}).`);
      break;
    case "available":
      console.log(`Update available: ${c.current} → ${c.release.tag}\n  ${c.release.url}\n  Run \`agent-switch update\` to install it.`);
      break;
    case "no-releases":
      console.log(`agent-switch ${c.current} — no releases published yet.`);
      break;
    case "error":
      console.log(`agent-switch ${c.current} — update check failed: ${c.message}`);
      break;
  }
}

/** `agent-switch update` — self-update to the latest published version via npm. */
async function cmdUpdate(): Promise<void> {
  const c = await checkForUpdate();
  if (c.kind === "uptodate") return void console.log(`Already on the latest version (${c.current}).`);
  if (c.kind === "no-releases") return void console.log("No releases published yet — nothing to update to.");
  if (c.kind === "available") console.log(`Updating ${c.current} → ${c.release.tag} via npm…`);
  else console.log(`Update check failed (${c.message}); attempting \`npm install\` anyway…`);
  const code = selfUpdate();
  logActivity("update", null, code === 0 ? "self-update installed" : `self-update failed (exit ${code})`, "user ran `agent-switch update`", code === 0);
  if (code === 0) await serviceAfterSelfUpdate();
  process.exit(code);
}

/** Keeps the usage service on the version just installed. Without it the
 *  balanced start has no fresh usage to weigh. */
async function serviceAfterSelfUpdate(): Promise<void> {
  switch (serviceAfterUpdate(serviceTarget(), !!process.stdin.isTTY)) {
    case "reinstall":
      console.log("Restarting the background service on the new version…");
      if (serviceInstallFromDisk() !== 0) console.error("Couldn't restart the service — run `agent-switch service install`.");
      return;
    case "ask":
      if (await confirmAction("Install the background service that keeps usage fresh (starts at login)?", false)) {
        if (serviceInstallFromDisk() !== 0) console.error("Couldn't install the service — run `agent-switch service install`.");
      } else console.log("Skipped. Install it any time with `agent-switch service install`.");
      return;
    case "hint":
      console.log("Tip: `agent-switch service install` keeps usage fresh so starts can be balanced.");
      return;
    case "leave":
      console.log("The background service runs another agent-switch build — left as it is.");
  }
}

function cmdOpen(appId?: string, name?: string): void {
  if (!appId) die("usage: agent-switch open <app> [profile]   (see `agent-switch apps`)");
  const app = findApp(appId);
  if (!app) die(`unknown app "${appId}". See \`agent-switch apps\` for registered apps.`);
  if (process.platform !== "darwin") die("GUI app launch is macOS-only for now.");
  const n = name ?? activeFor(app.provider);
  if (!n) die(`no profile given and none active for ${app.provider} — pass a profile name.`);
  requireProfile(app.provider, n, "open");
  if (!isInstalled(app)) die(`${app.displayName} is not installed.`);
  // A second launch on the same data dir would only hit the app's single-instance
  // lock — bring the window that profile already has to the front instead.
  if (app.strategy !== "env" && focusRunning(guiDataDir(app, n))) {
    console.log(`${app.displayName} on ${app.provider}/${n} is already open — brought it to the front.`);
    return;
  }
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


/** `agent-switch launcher add|remove <app> <profile>` · `list [--json]` · `repair`. */
function cmdLauncher(sub: string | undefined, args: string[], flags: Record<string, string | boolean>): void {
  const target = (verb: string) => {
    const app = findApp(args[0] ?? "");
    if (!app) die(`usage: agent-switch launcher ${verb} <app> <profile>   (see \`agent-switch apps\`)`);
    const n = requireProfile(app.provider, args[1], `launcher ${verb}`);
    return { app, n };
  };
  switch (sub) {
    case "add": {
      const { app, n } = target("add");
      try {
        const e = createLauncher(app, n);
        logActivity("launcher", `${app.provider}/${n}`, `created ${app.displayName} launcher`, "user ran `agent-switch launcher add`");
        console.log(`Created ${e.path}`);
        console.log("Start it from Spotlight or drag it into the Dock. It opens the app on this account only.");
      } catch (err) {
        die(err instanceof Error ? err.message : String(err));
      }
      return;
    }
    case "remove": case "rm": {
      const { app, n } = target("remove");
      if (!removeLauncher(app.id, n)) die(`no ${app.displayName} launcher for ${app.provider}/${n}.`);
      logActivity("launcher", `${app.provider}/${n}`, `removed ${app.displayName} launcher`, "user ran `agent-switch launcher remove`");
      console.log(`Removed the ${app.displayName} launcher for ${app.provider}/${n}.`);
      return;
    }
    case "repair": {
      const r = repairLaunchers();
      for (const e of r.rebuilt) console.log(`Rebuilt ${e.path}`);
      for (const f of r.failed) console.error(`Couldn't rebuild ${f.entry.path}: ${f.reason}`);
      if (!r.rebuilt.length && !r.failed.length) console.log("No launchers to repair.");
      if (r.failed.length) process.exit(1);
      return;
    }
    case "list": case undefined: {
      const rows = readLaunchers().map((e) => ({ ...e, exists: fs.existsSync(e.path) }));
      if (flags.json) return void console.log(JSON.stringify(rows, null, 2));
      if (!rows.length) return void console.log("No launchers. Create one with `agent-switch launcher add <app> <profile>`.");
      for (const r of rows) console.log(`${r.exists ? "●" : "○ missing"} ${r.app.padEnd(16)} ${r.provider}/${r.profile}  ${r.path}`);
      return;
    }
    default:
      die("usage: agent-switch launcher add|remove <app> <profile> | list [--json] | repair");
  }
}

/** `agent-switch app-settings copy <app> --from <profile|default> --to <profile>`. */
function cmdAppSettings(sub: string | undefined, args: string[], flags: Record<string, string | boolean>): void {
  const app = findApp(args[0] ?? "");
  const from = typeof flags.from === "string" ? flags.from : null;
  const to = typeof flags.to === "string" ? flags.to : null;
  if (sub !== "copy" || !app || !from || !to) die("usage: agent-switch app-settings copy <app> --from <profile|default> --to <profile>");
  if (!hasSettingsLayout(app.id)) die(`copying settings is not supported for ${app.displayName}.`);
  if (from === to) die("--from and --to are the same profile.");
  const toProfile = requireProfile(app.provider, to, "app-settings copy");
  const fromDir = from === "default" ? DEFAULT_DATA_DIR[app.id] : guiDataDir(app, requireProfile(app.provider, from, "app-settings copy"));
  const toDir = guiDataDir(app, toProfile);
  if (!fs.existsSync(fromDir)) die(`${from === "default" ? `The default ${app.displayName}` : `${app.provider}/${from}`} has no ${app.displayName} data yet.`);
  // The running app rewrites its own files on quit and would undo the copy.
  if (findRunning(toDir)) die(`${app.displayName} is open on ${app.provider}/${toProfile} — quit it first, then copy.`);
  const r = copyDesktopSettings(app.id, fromDir, toDir);
  logActivity("settings", `${app.provider}/${toProfile}`, `copied ${app.displayName} settings from ${from}`, "user ran `agent-switch app-settings copy`");
  if (flags.json) return void console.log(JSON.stringify({ app: app.id, from, to: toProfile, ...r }, null, 2));
  if (!r.copied.length) return void console.log(`Nothing to copy — ${from} has no ${app.displayName} settings yet.`);
  console.log(`Copied ${r.copied.join(", ")} from ${from} to ${app.provider}/${toProfile}.`);
  if (r.backups.length) console.log(`Previous files kept as ${r.backups.map((b) => path.basename(b)).join(", ")}.`);
  console.log("Logins, chats and account-bound preferences were not copied.");
}

/**
 * `agent-switch guard [block|warn|off]` — read or set the single-load policy.
 * The bare form also reports what is loaded RIGHT NOW, because "what is my
 * policy" and "is anything currently doubled" are the same question in practice.
 */
function cmdGuard(value?: string, json = false): void {
  if (value !== undefined) {
    if (!isGuardPolicy(value)) {
      die(`unknown guard policy "${value}" (choose: ${GUARD_POLICIES.join(", ")})`);
    }
    setGuard(value);
    logActivity("guard", null, `set ${value}`, "user ran `agent-switch guard`");
  }
  const policy = readGuard();

  // Every profile of every provider that can report a live session.
  const rows: { provider: ProviderId; name: string; sessions: number }[] = [];
  for (const pid of PROVIDER_IDS) {
    if (!provider(pid).hasLiveSessionSignal) continue;
    for (const n of listProfiles(pid)) {
      const count = liveSessionPids(configDir(pid, n)).length;
      if (count > 0) rows.push({ provider: pid, name: n, sessions: count });
    }
  }

  if (json) {
    console.log(JSON.stringify({ policy, loaded: rows }, null, 2));
    return;
  }

  const explain: Record<GuardPolicy, string> = {
    block: "a second session on a profile that is already loaded is refused",
    warn: "a second session is reported, then allowed",
    off: "no check at all",
  };
  console.log(`Single-load guard: ${policy} — ${explain[policy]}.`);

  if (rows.length === 0) {
    console.log("No profile is currently loaded by a live session.");
  } else {
    console.log("");
    for (const r of rows) {
      const doubled = r.sessions > 1;
      const mark = doubled ? "⚠️ " : "  ";
      const detail = doubled ? `loaded ${r.sessions}× — this is what the guard exists to prevent` : "1 live session";
      console.log(`${mark} ${`${r.provider}/${r.name}`.padEnd(24)} ${detail}`);
    }
  }

  const inert = PROVIDER_IDS.filter((pid) => !provider(pid).hasLiveSessionSignal && listProfiles(pid).length > 0);
  if (inert.length > 0) {
    console.log("");
    console.log(`Not covered: ${inert.join(", ")} — these CLIs do not register a running session on disk,`);
    console.log("so agent-switch has no way to tell a second load from a first.");
  }
  if (policy !== "off") {
    console.log("");
    console.log(`Override once: ${OVERRIDE_ENV}=1 <binary>    ·    Change: agent-switch guard <${GUARD_POLICIES.join("|")}>`);
  }
}

function cmdShellenv(shellArg?: string, sub?: string, json = false): void {
  if (sub !== "install") return void console.log(shellenvScript(detectShell(shellArg)));
  const shell = detectShell(shellArg);
  const present = shellIntegrationCheck(HOME).status === "ok";
  const r = installShellIntegration(shell, HOME, present);
  if (json) return void console.log(JSON.stringify(r));
  console.log(
    r.alreadyInstalled
      ? "The shell integration is already installed."
      : `Added the shell integration to ${r.file}. Open a new terminal (or run: source ${r.file}) and \`${shell === "powershell" ? "claude" : "type claude"}\` uses agent-switch.`,
  );
}

/** `agent-switch tooling` — ecosystem tool readout (agent-config, rtk, provider
 *  CLIs). `--json` is the GUI IPC contract: the GUI renders this readout and
 *  never shells out to detect on its own. */
function cmdTooling(json = false): void {
  const tools = checkTooling();
  if (json) {
    console.log(JSON.stringify(tools, null, 2));
    return;
  }
  console.log(`agent-switch tooling — platform ${process.platform}\n`);
  for (const l of formatToolingLines(tools)) console.log(l);
  // This readout stays offline by contract; the notes command is where the
  // network lives, so point at it rather than fetching here.
  console.log("\nWhat changed in a release: `agent-switch tooling notes [<tool>]`");
}

/**
 * `agent-switch tooling notes [<tool>] [--latest] [--json]` — read what an
 * ecosystem update actually contains, in the terminal.
 *
 * Deliberately a SEPARATE subcommand: `tooling` (no args) is a local, offline
 * readout the GUI consumes over `--json`, and that contract stays. This one
 * fetches, and says so in the help.
 *
 * Default tool is `agent-config` (the one agent-switch announces updates for).
 * Shown: every release newer than the installed version, newest first — so
 * someone several versions behind reads all of them, not just the last. Up to
 * date or not installed → the newest release, so the command always answers.
 * A tool with no verified release source gets a named refusal, never an
 * invented source.
 */
async function cmdToolingNotes(id: string | undefined, flags: Record<string, string | boolean>): Promise<void> {
  const toolId = (id ?? "agent-config") as ToolId;
  if (!TOOL_IDS.includes(toolId)) {
    die(`usage: agent-switch tooling notes [<${TOOL_IDS.join("|")}>] [--latest] [--json]`);
  }
  const repo = toolReleaseRepo(toolId);
  if (!repo) die(toolNotesRefusal(toolId));

  const installed = checkTooling({ ids: [toolId] })[0]?.version ?? null;
  let releases: ReleaseInfo[] = [];
  let failure: string | null = null;
  try {
    releases = await fetchReleases(repo);
  } catch (e) {
    failure = e instanceof Error ? e.message : String(e);
  }
  const latest = releases[0]?.tag ?? null;
  // Unread first; when there is nothing unread (up to date, not installed, or
  // the list is empty) fall back to the newest release so the command answers.
  const unread = installed ? releasesNewerThan(releases, installed) : [];
  const selected = unread.length > 0 ? unread : releases.slice(0, 1);
  const view = { id: toolId, installed, latest, releases: flags.latest ? selected.slice(0, 1) : selected };

  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          ...view,
          repo,
          error: failure,
          releases: view.releases.map((r) => ({ ...r, blocks: releaseNoteBlocks(r.notes) })),
        },
        null,
        2,
      ),
    );
    return;
  }
  for (const line of formatToolNotes(view)) console.log(line);
  if (failure) console.log(`\nCould not reach the release source (${failure}) — showing what was available.`);
}

/** `agent-switch tooling install|upgrade <id>` — run the tool's per-platform
 *  install/upgrade command as a visible child process (the GUI runs this inside
 *  its embedded terminal). Exit code = the child's exit code. */
function cmdToolingAction(action: ToolAction, id?: string): void {
  if (!id || !TOOL_IDS.includes(id as ToolId)) {
    die(`usage: agent-switch tooling ${action} <${TOOL_IDS.join("|")}>`);
  }
  process.exit(runToolAction(id as ToolId, action));
}

/**
 * `agent-switch usage history [--provider claude] [--profile <name>] [--json]`
 * — the daemon-recorded usage-history ring per profile (same file the daemon
 * appends: `<profileDir>/usage-history.json`). `--json` is the GUI contract:
 * `[{ profile, samples: [{ at, windows }] }]`. Own-profile data only.
 */
function cmdUsageHistory(providerId: ProviderId, sub?: string, flags: Record<string, string | boolean> = {}): void {
  if (sub !== "history") die("usage: agent-switch usage history [--provider P] [--profile <name>] [--json]");
  const profiles = typeof flags.profile === "string"
    ? [requireProfile(providerId, flags.profile, "usage history --profile")]
    : listProfiles(providerId);
  if (profiles.length === 0) die(`no ${providerId} profiles`);

  const rows: { profile: string; samples: HistorySample[] }[] = profiles.map((p) => ({
    profile: p,
    samples: readHistory(path.join(profileDir(providerId, p), "usage-history.json")),
  }));

  if (flags.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  for (const r of rows) {
    if (r.samples.length === 0) {
      console.log(`${providerId}/${r.profile}: no usage history yet (the daemon records samples — agent-switch service start)`);
      continue;
    }
    const first = r.samples[0].at;
    const last = r.samples[r.samples.length - 1].at;
    console.log(`${providerId}/${r.profile}: ${r.samples.length} sample${r.samples.length === 1 ? "" : "s"} (${first} → ${last})`);
  }
}

function usage(): void {
  console.log(`agent-switch — switch accounts for Claude Code, Codex, and Antigravity (macOS · Linux · Windows)

Provider defaults to claude; pass --provider codex|antigravity for the others.
Run with no command to launch the tray/menubar GUI (single-instance).

  agent-switch add [--provider P] <name> [--browser B]   create a profile and sign it in
  agent-switch login [--provider P] <name> [--browser <id>]   sign an existing profile in again (after a sign-out / expired login); --browser opens the Claude sign-in in that browser
  agent-switch browsers [--json]               browsers --browser can open (macOS / Linux)
  agent-switch import [--provider P] <name>    migrate the default install (no re-login)
  agent-switch mark-shared [--provider P] <name> [--off]   mark a profile as sharing the default install's login (never refreshed or balanced)
  agent-switch use [--provider P] <name>       set the active profile for a provider
  agent-switch deactivate [--provider P]       clear the active profile for a provider
  agent-switch run [--provider P] <name> [--tmux] [..]  launch the provider's CLI (--tmux = managed tmux session, POSIX)
  agent-switch list [--provider P] [--json]    list profiles, grouped by provider
  agent-switch status [--provider P] [name] [--json]   identity (+ Claude usage); --json = active only
  agent-switch current [--provider P]          show the active profile(s)
  agent-switch whoami [--provider P] [name]    show a profile's account identity
  agent-switch dir [--provider P] [--guard] [--json] [--plain]   resolve profile for CWD (rule > balanced pick > active); --json adds why
  agent-switch guard [block|warn|off]          one profile, one live session (default warn on new installs)
  agent-switch map [--provider P] <name|pool:<id>> [dir]   map a directory to a profile or a pool
  agent-switch map --pause|--resume [--provider P] [dir]   pause a folder rule (kept, but skipped) or turn it back on
  agent-switch unmap [--provider P] [dir]      remove a directory mapping
  agent-switch mappings                        list directory mappings
  agent-switch share on|sync|off|status [--history] [--source <profile|default>] [--json]   (Claude)
  agent-switch config export|import <profile>   config-only cross-machine bundle to stdout / from stdin (settings, keybindings, CLAUDE.md, skills/, commands/, agents/ — NEVER credentials; pipe export | gpg -c)
  agent-switch sessions [profile] [--recent N] [--json]   recent + live Claude sessions per profile (with context %)
  agent-switch hooks install|uninstall|status [profile]   manage lifecycle push hooks in Claude settings.json
  agent-switch alerts on|off|status [--threshold 80,95]   record context/usage crossings to the notification log (off by default)
  agent-switch compact <profile> [--clear] [--dry-run] [--force]   type /compact (or /clear) into the profile's managed tmux pane
  agent-switch takeover <id> --to <profile> [--from <profile>] [--keep-source] [--in-place] [--print-only] [--force]   move a session to another profile and resume it
  agent-switch rebind [<account>] [--profile <p>]   |   rebind --restore [--profile <p>]   |   rebind --reset   switch a RUNNING profile's account (macOS; no <account> = interactive picker; --restore reverses; --reset re-enables after a circuit-breaker trip)
  agent-switch web <name>                      claude.ai in a persistent browser (Claude)
  agent-switch remove [--provider P] <name> [--force] [--yes]   delete a profile (asks on a terminal; --yes skips)
  agent-switch label [--provider P] <name> [Work|Personal|Other|none]   tag a profile
  agent-switch desktop [--json]                which accounts ran sessions in each Claude Desktop instance
  agent-switch activate [--json]               make this CLI the one terminals and the background service use
  agent-switch disable|enable [--provider P] <name>   keep a profile but stop using it / turn it back on
  agent-switch color [--provider P] <name> [orange|red|yellow|green|teal|blue|purple|pink|none]   pick a profile's colour
  agent-switch autoswitch on|off|status [--provider P] [--threshold <1-100>]   notify + suggest near a usage limit; never switches automatically (default OFF)
  agent-switch reset <profile> --provider codex [--yes]                        redeem one banked Codex rate-limit reset (asks on a terminal)
  agent-switch protection [--json] | protection set <provider/name> [--on|--off] [--threshold N]   per-profile limit warning (default on, 98%)
  agent-switch pool [list|create|rename|delete|add|remove|suggest] [--json]    optional groups a folder rule can point at
  agent-switch auth-status [--provider P] [--json]   per-profile login state from the provider's store (no tokens)
  agent-switch activity [--limit N] [--json]   what agent-switch itself did, and why
  agent-switch rename <old> <new> [--provider P]                               rename a profile (name & keep its tag)
  agent-switch providers enable|disable|status [--provider P] [--surface cli|ui]   enable/disable a provider (default: Claude + Codex)
  agent-switch [gui] [--after-pid <pid>]       launch the tray/menubar GUI (the default with no command; won't start a second if one is running; --after-pid waits for that process to quit first — the GUI's restart)
  agent-switch check-update [--json]           check GitHub Releases for a newer version
  agent-switch update                          self-update to the latest version (via npm); restarts the service on it, or offers to install one
  agent-switch apps                            list launchable GUI apps (macOS)
  agent-switch open <app> [profile]            launch a GUI app on a profile, isolated; focuses it if already open (macOS)
  agent-switch launcher add|remove <app> <profile> | list [--json] | repair   Dock/Spotlight launcher per account in ~/Applications/Agent Switch (macOS)
  agent-switch app-settings copy <app> --from <profile|default> --to <profile> [--json]   copy desktop settings (MCP, preferences, extensions) — never logins
  agent-switch shellenv [--shell zsh|bash|fish|powershell]   shell integration
  agent-switch shellenv install [--shell S] [--json]   add it to your shell's startup file
  agent-switch service run|start|stop|status|install|uninstall   background usage daemon
  agent-switch notifications [clear] [--json]  recent notifications (usage-limit suggestions, fetch failures)
  agent-switch notify --kind K --title T --message M [--json]   record a notification event
  agent-switch os-notify [on|off|status] [--json]   daemon-side OS desktop notifications, Linux/Windows (default off; macOS: the app shows them)
  agent-switch keep-signed-in [on|off|status] [--json]   let the service keep Claude logins from lapsing (default on)
  agent-switch uninstall [--force]             remove all agent-switch data + daemon
  agent-switch usage history [--provider P] [--profile <name>] [--json]   daemon-recorded usage samples per profile
  agent-switch tooling [--json]                ecosystem tool readout (agent-config, rtk, provider CLIs)
  agent-switch tooling install|upgrade <tool>  install/upgrade an ecosystem tool (agent-config, rtk, claude, codex)
  agent-switch tooling notes [<tool>] [--latest] [--json]   read an ecosystem tool's release notes (default agent-config; fetches from GitHub)
  agent-switch doctor [--json]                  per-OS, per-provider self-check`);
}

/**
 * The interactive limit dialog (Phase 4) — `agent-switch rebind` with no account
 * and no `--restore`. Gathers the OTHER claude profiles + their usage, pre-selects
 * the best-headroom profile as a convenience, and prompts the user to pick. Only
 * an explicit selection switches (via `rebind`); cancel stays put. The user
 * interaction IS the compliance line — there is NO automatic switch anywhere in
 * here. macOS-only for the actual switch; a non-TTY stdin prints the suggested
 * command instead of hanging on a prompt no one can answer.
 */
async function rebindDialog(running: string): Promise<void> {
  const others = listProfiles("claude").filter((n) => n !== running);
  const candidates: RebindDialogCandidate[] = [];
  for (const n of others) {
    // Same usage read path `status` uses (daemon cache when fresh, else the
    // OAuth /usage endpoint); null when unreadable — the row shows no %.
    candidates.push({ name: n, snapshot: await claudeSnapshot(n), label: labelFor("claude", n) });
  }
  const dialog = buildRebindDialog(candidates, running);
  const rows = selectableRows(dialog);
  if (rows.length === 0) {
    die(`no other claude profile to rebind "${running}" to — add one with \`agent-switch add <name>\`.`);
  }

  // Non-interactive stdin: never hang. Print the pre-selected profile + the exact
  // command that performs the switch, then return (no switch — the user has to run it).
  if (!process.stdin.isTTY) {
    const sug = dialog.suggestedProfile;
    if (sug) {
      console.error(`Suggested profile (most headroom): ${sug}`);
      console.error(`Switch "${running}" to it with:  agent-switch rebind ${sug} --profile ${running}`);
    } else {
      console.error(`No usage data to pre-select a profile. Switch with:  agent-switch rebind <account> --profile ${running}`);
    }
    return;
  }

  // The actual switch is macOS-only (the Linux/Windows credential backend is
  // unproven — spike R0.1). Refuse before prompting rather than after a pick.
  if (process.platform !== "darwin") {
    die("rebind is macOS-only for now (the Linux/Windows credential backend is unproven — spike R0.1).");
  }

  console.log(`Rebind "${running}" to which account? A running Claude session adopts it on its next message.`);
  rows.forEach((r, i) => {
    const marker = r.profile === dialog.suggestedProfile ? "  ← suggested (most headroom)" : "";
    const label = r.label ? ` [${r.label}]` : "";
    const util = r.maxUtil === null ? "usage n/a" : `${r.maxUtil}% used`;
    console.log(`  ${i + 1}) ${(r.profile + label).padEnd(24)} ${util}${marker}`);
  });
  const enterHint = dialog.suggestedProfile ?? "(no suggestion)";
  console.log(`  [enter] = ${enterHint}   ·   q = cancel (stay on "${running}")`);

  const SIGINT = "\u0003"; // sentinel distinct from empty input (empty = accept the suggestion)
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.on("SIGINT", () => resolve(SIGINT)); // Ctrl-C -> cancel, no switch
    rl.question("> ", (a) => resolve(a));
  });
  rl.close();

  if (answer === SIGINT) {
    console.log(`\nStayed on "${running}" — no switch.`);
    return;
  }
  const choice = resolveRebindChoice(answer, dialog);
  if (choice.kind === "cancel") {
    console.log(`Stayed on "${running}" — no switch.`);
    return;
  }
  if (choice.kind === "invalid") {
    console.log(`No valid selection — stayed on "${running}".`);
    return;
  }
  try {
    const r = await rebind({ account: choice.profile, profile: running });
    logActivity("rebind", `claude/${running}`, `now serves ${choice.profile}'s account`, "user picked it in the rebind dialog");
    console.log(r.uxNote);
  } catch (e) {
    die((e as Error).message);
  }
}

/**
 * `agent-switch rebind <account> [--profile <p>]` — point a RUNNING profile's
 * credential store at another account, so a live Claude session adopts it on its
 * next message (macOS; the user-interaction switch, ADR-003). `--restore` reverses
 * it. With NO account and NO `--restore`, opens the interactive limit dialog
 * ({@link rebindDialog}). Claude only; the target + running profiles must be logged in.
 */
async function cmdRebind(
  providerId: ProviderId,
  providerExplicit: boolean,
  account: string | undefined,
  flags: Record<string, string | boolean>,
): Promise<void> {
  if (providerExplicit && providerId !== "claude") die(`rebind supports claude only (not ${providerId})`);
  // Resolve which running profile rebind targets: explicit --profile wins; else
  // prefer the profile that actually has a LIVE session (rebind's whole point is
  // the running session, which may not be the "active" default-for-new-processes
  // profile). Only auto-target when exactly one profile is running — a credential
  // write must never guess across ambiguity — otherwise keep the active fallback.
  const explicitProfile = typeof flags.profile === "string" ? flags.profile : undefined;
  let profile = explicitProfile ?? activeFor("claude") ?? undefined;
  if (!explicitProfile) {
    const running = detectRunningClaudeProfile(listProfiles("claude"), (p) => configDir("claude", p));
    if (running.kind === "single") {
      if (running.profile !== profile) {
        console.log(`Auto-detected the running claude profile "${running.profile}" (its session is live) — targeting it. Pass --profile to override.`);
      }
      profile = running.profile;
    } else if (running.kind === "ambiguous") {
      console.log(
        `Multiple running claude profiles (${running.profiles.join(", ")}) — ` +
          `${profile ? `using the active profile "${profile}"` : "no active default"}; pass --profile <name> to target a specific one.`,
      );
    }
  }

  if (flags.reset) {
    // Kill-switch reset (ADR-003): clear `disabled` + the failure counter so a
    // circuit-breaker trip (or a manual disable) no longer refuses rebind.
    resetRebindKillSwitch();
    console.log("rebind re-enabled — circuit-breaker cleared (disabled=false, consecutiveFailures=0).");
    return;
  }

  if (flags.restore) {
    if (!profile) die("usage: agent-switch rebind --restore [--profile <p>] — no active claude profile to restore");
    requireProfile("claude", profile, "rebind --restore --profile");
    try {
      const r = await restoreRebind({ profile });
      logActivity("rebind", `claude/${profile}`, `restored own account (was on ${r.wasBoundTo})`, "user ran `agent-switch rebind --restore`");
      console.log(`Restored "${r.restoredProfile}" to its own account (was rebound to "${r.wasBoundTo}").`);
    } catch (e) {
      die((e as Error).message);
    }
    return;
  }

  if (!account) {
    // No account + no --restore → the interactive limit dialog (Phase 4). The
    // switch is user-interaction-gated: the picker pre-selects the best-headroom
    // profile as a convenience, but only an explicit pick switches.
    if (!profile) die("no running claude profile — pass --profile <name> or set one active with `asw <name>`.");
    requireProfile("claude", profile, "rebind --profile");
    return rebindDialog(profile);
  }
  if (!profile) die("no running claude profile — pass --profile <name> or set one active with `asw <name>`.");
  requireProfile("claude", account, "rebind");
  requireProfile("claude", profile, "rebind --profile");
  try {
    const r = await rebind({ account, profile });
    logActivity("rebind", `claude/${profile}`, `now serves ${account}'s account`, "user ran `agent-switch rebind`");
    console.log(r.uxNote);
  } catch (e) {
    die((e as Error).message);
  }
}

// ---------- gui-settings / activity / auth-status / protection / pool ----------

/** `gui-settings [--json]` · `gui-settings set pet-welcomed` ·
 *  `gui-settings set autostart enabled|disabled --by first-run|user` ·
 *  `gui-settings set autostart-degraded --reason <text>|none`. The GUI's
 *  file-backed preferences (see gui-settings.ts); prints the result as JSON. */
function cmdGuiSettings(sub: string | undefined, args: string[], flags: Record<string, string | boolean>): void {
  const usageLine = "usage: agent-switch gui-settings [--json] | gui-settings set pet-welcomed | set autostart enabled|disabled --by first-run|user | set autostart-degraded --reason <text>|none";
  if (sub === undefined || sub === "get" || sub === "status") {
    console.log(JSON.stringify(readGuiSettings(), null, 2));
    return;
  }
  if (sub !== "set") die(usageLine);
  const [key, value] = args;
  let u: GuiSettingUpdate;
  if (key === "pet-welcomed") u = { key };
  else if (key === "autostart" && (value === "enabled" || value === "disabled")) {
    const by = flags.by === "first-run" || flags.by === "user" ? flags.by : die(usageLine);
    u = { key, state: value, by };
  } else if (key === "autostart-degraded") {
    const reason = typeof flags.reason === "string" ? flags.reason : die(usageLine);
    u = { key, reason: reason === "none" ? null : reason };
  } else die(usageLine);
  const before = readGuiSettings();
  let after;
  try {
    after = applyGuiSetting(before, u);
  } catch (e) {
    die((e as Error).message);
  }
  writeGuiSettings(after);
  if (u.key === "autostart" && JSON.stringify(after.autostart) !== JSON.stringify(before.autostart)) {
    logActivity("autostart", null, `start at login ${u.state}`, u.by === "user" ? "user changed it in the desktop app" : "first-run default, confirmed with the OS");
  }
  if (u.key === "autostart-degraded" && u.reason) {
    logActivity("autostart", null, "start at login could not be confirmed", "first-run default; retried next launch", false);
  }
  console.log(JSON.stringify(after, null, 2));
}

function cmdActivity(flags: Record<string, string | boolean>): void {
  const limit = typeof flags.limit === "string" ? Number(flags.limit) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) die("--limit must be a whole number of at least 1");
  const entries = readActivity(limit ?? (flags.json ? undefined : 50));
  if (flags.json) {
    console.log(JSON.stringify({ entries, capacity: ACTIVITY_MAX_LINES }, null, 2));
    return;
  }
  if (entries.length === 0) {
    console.log("No activity recorded yet.");
    return;
  }
  for (const e of entries) {
    console.log(`${e.at}  ${e.ok ? " " : "!"} ${e.kind.padEnd(10)} ${e.target ?? "-"}  ${e.action} — ${e.reason}`);
  }
}

function authStatusFor(providerId: ProviderId, name: string): AuthStatus {
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

function cmdAuthStatus(providerId: ProviderId | undefined, json: boolean): void {
  const rows = (providerId ? listProfiles(providerId).map((n) => ({ provider: providerId, name: n })) : listAllProfiles()).map((r) =>
    authStatusFor(r.provider, r.name),
  );
  if (json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (rows.length === 0) return void console.log("No profiles.");
  for (const r of rows) {
    const exp = r.expiresAt ? `, ends ${r.expiresAt}` : "";
    console.log(`${`${r.provider}/${r.name}`.padEnd(24)} ${r.state}${exp} — ${r.detail}`);
  }
}

function parseMemberArg(v: string | undefined, usageLine: string): { provider: ProviderId; name: string } {
  const m = v ? parseMember(v) : null;
  if (!m) die(usageLine);
  return m;
}

function cmdProtection(sub: string | undefined, args: string[], flags: Record<string, string | boolean>): void {
  const usageLine = "usage: agent-switch protection [--json] | protection set <provider/name> [--on|--off] [--threshold <1-100>]";
  if (sub === undefined || sub === "status" || sub === "list") {
    const rows = listAllProfiles().map((p) => ({ profile: `${p.provider}/${p.name}`, ...readProtection(p.provider, p.name) }));
    if (flags.json) return void console.log(JSON.stringify(rows, null, 2));
    if (rows.length === 0) return void console.log("No profiles.");
    for (const r of rows) console.log(`${r.profile.padEnd(24)} ${r.enabled ? "on " : "off"}  at ${r.thresholdPct}%`);
    console.log("\nA warning when a profile reaches its threshold — nothing is paused or switched.");
    return;
  }
  if (sub !== "set") die(usageLine);
  const m = parseMemberArg(args[0], usageLine);
  requireProfile(m.provider, m.name, "protection set");
  if (flags.on && flags.off) die("pass either --on or --off, not both");
  const threshold = typeof flags.threshold === "string" ? Number(flags.threshold) : undefined;
  if (threshold !== undefined && !(Number.isInteger(threshold) && threshold >= 1 && threshold <= 100)) die("--threshold must be a whole number between 1 and 100");
  if (!flags.on && !flags.off && threshold === undefined) die(usageLine);
  const next = setProtection(m.provider, m.name, {
    ...(flags.on ? { enabled: true } : {}),
    ...(flags.off ? { enabled: false } : {}),
    ...(threshold !== undefined ? { thresholdPct: threshold } : {}),
  });
  logActivity("protection", `${m.provider}/${m.name}`, `${next.enabled ? "on" : "off"} at ${next.thresholdPct}%`, "user ran `agent-switch protection set`");
  if (flags.json) return void console.log(JSON.stringify({ profile: `${m.provider}/${m.name}`, ...next }, null, 2));
  console.log(`Session protection for ${m.provider}/${m.name}: ${next.enabled ? "on" : "off"} at ${next.thresholdPct}%.`);
}

function poolMappings(id: string): string[] {
  return mappingRows().filter((r) => r.name === `${POOL_PREFIX}${id}`).map((r) => `${r.path} (${r.provider})`);
}

function cmdPool(sub: string | undefined, args: string[], flags: Record<string, string | boolean>): void {
  const usageLine =
    "usage: agent-switch pool [list] [--json] | pool create <name> | pool rename <id> <name> | pool delete <id> | pool add <id> <provider/name> | pool remove <id> <provider/name> | pool suggest [--confirm] [--json]";
  const json = !!flags.json;
  const out = (v: unknown, text: string) => console.log(json ? JSON.stringify(v, null, 2) : text);
  try {
    switch (sub) {
      case undefined:
      case "list": {
        const pools = readPools().map((p) => ({ ...p, rules: poolMappings(p.id) }));
        if (json) return void console.log(JSON.stringify(pools, null, 2));
        if (pools.length === 0) return void console.log("No pools. Pools are optional — create one with: agent-switch pool create <name>");
        for (const p of pools) {
          console.log(`${p.id}  "${p.name}"  ${p.members.length ? p.members.join(", ") : "(no members)"}${p.rules.length ? `  · folders: ${p.rules.join(", ")}` : ""}`);
        }
        return;
      }
      case "create": {
        if (!args[0]) die(usageLine);
        const p = createPool(args.join(" "));
        logActivity("pool", p.id, "created", "user ran `agent-switch pool create`");
        return out(p, `Created pool ${p.id} ("${p.name}"). Add members: agent-switch pool add ${p.id} <provider/name>`);
      }
      case "rename": {
        if (!args[0] || !args[1]) die(usageLine);
        const p = renamePool(args[0], args.slice(1).join(" "));
        logActivity("pool", p.id, `renamed to "${p.name}"`, "user ran `agent-switch pool rename`");
        return out(p, `Pool ${p.id} is now called "${p.name}" (its id and folder rules are unchanged).`);
      }
      case "delete": {
        if (!args[0]) die(usageLine);
        const rules = poolMappings(args[0]);
        if (rules.length > 0) die(`pool "${args[0]}" is used by folder rules: ${rules.join(", ")}. Remove them first (agent-switch unmap <dir>).`);
        deletePool(args[0]);
        logActivity("pool", args[0], "deleted", "user ran `agent-switch pool delete`");
        return out({ deleted: args[0] }, `Deleted pool ${args[0]}. Its profiles are untouched.`);
      }
      case "add":
      case "remove": {
        if (!args[0]) die(usageLine);
        const m = parseMemberArg(args[1], usageLine);
        if (sub === "add") requireProfile(m.provider, m.name, "pool add");
        const key = `${m.provider}/${m.name}`;
        const p = sub === "add" ? addPoolMember(args[0], key) : removePoolMember(args[0], key);
        logActivity("pool", p.id, `${sub === "add" ? "added" : "removed"} ${key}`, `user ran \`agent-switch pool ${sub}\``);
        return out(p, `${sub === "add" ? "Added" : "Removed"} ${key} ${sub === "add" ? "to" : "from"} pool ${p.id}.`);
      }
      case "suggest": {
        const proposals = suggestPoolsFromLabels();
        if (!flags.confirm) {
          if (json) return void console.log(JSON.stringify({ preview: true, proposals }, null, 2));
          if (proposals.length === 0) return void console.log("No labelled profiles — nothing to suggest.");
          console.log("Preview — nothing is created until you run `agent-switch pool suggest --confirm`:");
          for (const p of proposals) console.log(`  ${p.id}  ${p.members.join(", ")}${p.exists ? "  (exists — skipped)" : ""}`);
          return;
        }
        const created: string[] = [];
        for (const prop of proposals) {
          if (prop.exists) continue;
          const pool = createPool(prop.name);
          for (const m of prop.members) addPoolMember(pool.id, m);
          created.push(pool.id);
          logActivity("pool", pool.id, `created from label ${prop.name}`, "user confirmed `agent-switch pool suggest`");
        }
        return out({ created }, created.length ? `Created pools: ${created.join(", ")}.` : "Nothing to create.");
      }
      default:
        die(usageLine);
    }
  } catch (e) {
    die((e as Error).message);
  }
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

  // A bare `agent-switch` (no command) launches the GUI, which reads profiles —
  // so it runs the migration too. Only pure help / shellenv skip it.
  if (cmd === undefined || !["help", "--help", "-h", "shellenv"].includes(cmd)) {
    const moved = migrateLegacyLayout();
    if (moved.length > 0) {
      // stderr, not stdout: `dir` is machine-consumed by the shell wrapper
      // (`dir="$(agent-switch dir --provider … --guard)"`), so a status line on
      // stdout would pollute the resolved config path. Since the single-load
      // guard needs to speak, the wrapper no longer discards stderr — this
      // one-time migration note is now visible to the user, which is right.
      console.error(`Migrated ${moved.length} Claude profile(s) to the new layout: ${moved.join(", ")}.`);
    }
  }

  switch (cmd) {
    case "add": return cmdAdd(providerId, positional[0], typeof flags.browser === "string" ? flags.browser : undefined);
    case "login": return cmdLogin(providerId, positional[0], typeof flags.browser === "string" ? flags.browser : undefined);
    case "browsers": return cmdBrowsers(!!flags.json);
    case "import": return cmdImport(providerId, positional[0]);
    case "use": return cmdUse(providerId, positional[0]);
    case "deactivate": return cmdDeactivate(providerId);
    case "label": return cmdLabel(providerId, positional[0], positional[1]);
    case "color": case "colour": return cmdColor(providerId, positional[0], positional[1]);
    case "activate": return cmdActivate(!!flags.json);
    case "desktop": return cmdDesktop(!!flags.json);
    case "disable": return cmdDisable(providerId, positional[0], true);
    case "enable": return cmdDisable(providerId, positional[0], false);
    case "mark-shared": return cmdMarkShared(providerId, positional[0], !!flags.off);
    case "autoswitch": return cmdAutoswitch(providerId, providerExplicit, positional[0], flags);
    case "reset": return cmdReset(providerId, positional[0], !!flags.yes);
    case "rename": return cmdRename(providerId, positional[0], positional[1]);
    case "providers": return cmdProviders(providerId, providerExplicit, positional[0], flags);
    case "gui": return cmdGui(flags["after-pid"]);
    case "update": case "upgrade": return cmdUpdate();
    case "check-update": case "check-updates": return cmdCheckUpdate(!!flags.json);
    case "open": return cmdOpen(positional[0], positional[1]);
    case "launcher": case "launchers": return cmdLauncher(positional[0], positional.slice(1), flags);
    case "app-settings": return cmdAppSettings(positional[0], positional.slice(1), flags);
    case "apps": return cmdApps(!!flags.json);
    case "notify": return cmdNotify(flags);
    case "notifications": return cmdNotifications(positional[0], !!flags.json);
    case "os-notify": return cmdOsNotify(positional[0], !!flags.json);
    case "keep-signed-in": return cmdKeepSignedIn(positional[0], !!flags.json);
    case "uninstall": return cmdUninstall(flags);
    case "run": {
      let r: ReturnType<typeof parseRun>;
      try { r = parseRun(rest); } catch (e) { die((e as Error).message); }
      return cmdRun(r.providerId, r.name, r.args, r.cwd);
    }
    case "handoff": return cmdHandoff(providerId, positional[0], positional.slice(1), flags);
    case "list": case "ls": return cmdList(providerExplicit ? providerId : undefined, !!flags.json);
    case "status": return cmdStatus(providerExplicit ? providerId : undefined, positional[0], !!flags.json);
    case "current": return cmdCurrent(providerExplicit ? providerId : undefined);
    case "whoami": return cmdWhoami(providerId, positional[0]);
    case "dir": return cmdDir(providerId, !!flags.guard, !!flags.json, !!flags.plain);
    case "guard": return cmdGuard(positional[0], !!flags.json);
    case "map": return cmdMap(providerId, positional[0], positional[1], flags);
    case "unmap": return cmdUnmap(providerExplicit ? providerId : undefined, positional[0]);
    case "mappings": return cmdMappings(rest.includes("--json"));
    case "share": return cmdShare(positional[0], rest.slice(1));
    case "config": return cmdConfig(positional[0], positional[1], flags);
    case "sessions":
      if (positional[0] === "rm") return cmdSessionsRm(providerId, providerExplicit, positional[1], flags);
      if (positional[0] === "restore") return cmdSessionsRestore(providerId, providerExplicit, positional[1], flags);
      if (positional[0] === "preview") return cmdSessionsPreview(providerId, providerExplicit, positional[1], flags);
      return cmdSessions(providerId, providerExplicit, positional[0], flags);
    case "hooks": return cmdHooks(positional[0], positional[1]);
    case "alerts": return cmdAlerts(positional[0], flags);
    case "compact": return cmdCompact(providerId, positional[0], flags);
    case "takeover": return cmdTakeover(providerId, providerExplicit, positional[0], flags);
    case "rebind": return cmdRebind(providerId, providerExplicit, positional[0], flags);
    case "web": return cmdWeb(positional[0]);
    case "remove": case "rm": return cmdRemove(providerId, positional[0], !!flags.force, !!flags.yes);
    case "shellenv":
      return positional[0] === "install"
        ? cmdShellenv(flags.shell as string | undefined, "install", !!flags.json)
        : cmdShellenv((flags.shell as string) ?? positional[0]);
    case "service": return cmdService(positional[0]);
    case "usage": return cmdUsageHistory(providerId, positional[0], flags);
    case "tooling":
      if (positional[0] === "install" || positional[0] === "upgrade") {
        return cmdToolingAction(positional[0], positional[1]);
      }
      if (positional[0] === "notes") return cmdToolingNotes(positional[1], flags);
      if (positional[0] !== undefined) {
        die(`usage: agent-switch tooling [install|upgrade <${TOOL_IDS.join("|")}>] [notes [<tool>]] [--json]`);
      }
      return cmdTooling(!!flags.json);
    case "doctor": return process.exit(await runDoctor(!!flags.json));
    case "auth-status": return cmdAuthStatus(providerExplicit ? providerId : undefined, !!flags.json);
    case "activity": return cmdActivity(flags);
    case "protection": return cmdProtection(positional[0], positional.slice(1), flags);
    case "pool": case "pools": return cmdPool(positional[0], positional.slice(1), flags);
    case "gui-settings": return cmdGuiSettings(positional[0], positional.slice(1), flags);
    case "help": case "--help": case "-h": return usage();
    // A bare `agent-switch` (no command) launches the GUI; an unknown command
    // still prints usage and exits non-zero.
    default:
      if (cmd === undefined) return cmdGui();
      usage();
      process.exit(1);
  }
}

main().catch((err) => die(String(err?.message ?? err)));
