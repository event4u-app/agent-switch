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
import { spawnSync } from "node:child_process";

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
} from "./profiles.js";
import { Provider, ProviderId, PROVIDER_IDS, isProviderId, provider } from "./providers.js";
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
import { isFresh, readDaemonState } from "./daemon.js";
import { cmdService } from "./service.js";

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

function cmdRun(providerId: ProviderId, name: string | undefined, args: string[]): void {
  const n = requireProfile(providerId, name, "run");
  process.exit(launch(provider(providerId), n, args));
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

function cmdList(providerId?: ProviderId): void {
  const providers = providerId ? [providerId] : PROVIDER_IDS;
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
    const usage = pid === "claude" ? await claudeSnapshot(active) : null;
    console.log(JSON.stringify({ provider: pid, name: active, identity: identity(pid, active), usage }, null, 2));
    return;
  }

  const rows = name
    ? [{ provider: providerId ?? "claude", name: requireProfile(providerId ?? "claude", name, "status") }]
    : (providerId ? listProfiles(providerId).map((n) => ({ provider: providerId, name: n })) : listAllProfiles());
  if (rows.length === 0) die("no profiles");

  for (const { provider: pid, name: n } of rows as { provider: ProviderId; name: string }[]) {
    const mark = activeFor(pid) === n ? "*" : " ";
    console.log(`${mark} ${pid}/${n} — ${identity(pid, n) ?? "not logged in"}`);
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

  const removedEntry = credentials.removeEntry(configDir(providerId, n)); // darwin keychain only
  fs.rmSync(profileDir(providerId, n), { recursive: true, force: true });
  if (activeFor(providerId) === n) setActive(providerId, null);
  const pruned = pruneMappings(providerId, n);

  console.log(`Removed ${providerId} profile "${n}".`);
  if (removedEntry) console.log("Removed its keychain credential entry.");
  if (pruned.length > 0) console.log(`Removed ${pruned.length} directory mapping(s).`);
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

function cmdShellenv(shellArg?: string): void {
  console.log(shellenvScript(detectShell(shellArg)));
}

function usage(): void {
  console.log(`agent-switch — switch accounts for Claude Code, Codex, and Gemini (macOS · Linux · Windows)

Provider defaults to claude; pass --provider codex|gemini for the others.

  agent-switch add [--provider P] <name>       create a profile and log it in
  agent-switch import [--provider P] <name>    migrate the default install (no re-login)
  agent-switch use [--provider P] <name>       set the active profile for a provider
  agent-switch run [--provider P] <name> [..]  launch the provider's CLI on a profile
  agent-switch list [--provider P]             list profiles, grouped by provider
  agent-switch status [--provider P] [name] [--json]   identity (+ Claude usage); --json = active only
  agent-switch current [--provider P]          show the active profile(s)
  agent-switch whoami [--provider P] [name]    show a profile's account identity
  agent-switch dir [--provider P]              resolve profile for CWD (mapping > active)
  agent-switch map [--provider P] <name> [dir] map a directory to a profile
  agent-switch unmap [--provider P] [dir]      remove a directory mapping
  agent-switch mappings                        list directory mappings
  agent-switch share on|sync|off [--history] [--source <profile|default>]   (Claude)
  agent-switch web <name>                      claude.ai in a persistent browser (Claude)
  agent-switch remove [--provider P] <name> [--force]   delete a profile
  agent-switch shellenv [--shell zsh|bash|fish|powershell]   shell integration
  agent-switch service run|start|stop|status|install|uninstall   background usage daemon
  agent-switch doctor                          per-OS, per-provider self-check`);
}

// ---------- main -------------------------------------------------------------

/** Value of a `--flag value` option, or undefined if absent. */
function flagValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

/** Resolve --provider (default claude); explicit but invalid → error. */
function resolveProvider(args: string[]): ProviderId {
  const v = flagValue(args, "--provider");
  if (v === undefined) return "claude";
  if (!isProviderId(v)) die(`unknown provider "${v}" (choose: ${PROVIDER_IDS.join(", ")})`);
  return v;
}

/** For `run`: strip `--provider <val>`, take the profile name, pass the rest through. */
function parseRun(rest: string[]): { providerId: ProviderId; name?: string; args: string[] } {
  const providerId = resolveProvider(rest);
  const args = [...rest];
  const pi = args.indexOf("--provider");
  if (pi >= 0) args.splice(pi, 2);
  const name = args.shift();
  return { providerId, name, args };
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const positional = rest.filter((a) => !a.startsWith("--"));
  const providerId = resolveProvider(rest);

  // One-time layout migration (v1 Claude profiles → provider-scoped). Quiet
  // unless it actually moves something. Skipped for pure help.
  if (cmd && !["help", "--help", "-h", "shellenv"].includes(cmd)) {
    const moved = migrateLegacyLayout();
    if (moved.length > 0) {
      console.log(`Migrated ${moved.length} Claude profile(s) to the new layout: ${moved.join(", ")}.`);
    }
  }

  switch (cmd) {
    case "add": return cmdAdd(providerId, positional[0]);
    case "import": return cmdImport(providerId, positional[0]);
    case "use": return cmdUse(providerId, positional[0]);
    case "run": { const r = parseRun(rest); return cmdRun(r.providerId, r.name, r.args); }
    case "list": case "ls": return cmdList(flagValue(rest, "--provider") ? providerId : undefined);
    case "status": return cmdStatus(flagValue(rest, "--provider") ? providerId : undefined, positional[0], rest.includes("--json"));
    case "current": return cmdCurrent(flagValue(rest, "--provider") ? providerId : undefined);
    case "whoami": return cmdWhoami(providerId, positional[0]);
    case "dir": return cmdDir(providerId);
    case "map": return cmdMap(providerId, positional[0], positional[1]);
    case "unmap": return cmdUnmap(flagValue(rest, "--provider") ? providerId : undefined, positional[0]);
    case "mappings": return cmdMappings();
    case "share": return cmdShare(positional[0], rest.slice(1));
    case "web": return cmdWeb(positional[0]);
    case "remove": case "rm": return cmdRemove(providerId, positional[0], rest.includes("--force"));
    case "shellenv": return cmdShellenv(flagValue(rest, "--shell") ?? positional[0]);
    case "service": return cmdService(positional[0]);
    case "doctor": return process.exit(runDoctor());
    case "help": case "--help": case "-h": return usage();
    default: usage(); process.exit(cmd ? 1 : 0);
  }
}

main().catch((err) => die(String(err?.message ?? err)));
