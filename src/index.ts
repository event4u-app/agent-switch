#!/usr/bin/env node
/**
 * agent-switch — Claude Code multi-account profile switcher (macOS, Linux, Windows)
 *
 * Architecture: CLAUDE_CONFIG_DIR isolation. Each profile is its own config
 * dir with its own live login (own keychain entry); switching only changes
 * which dir new `claude` invocations point at. Nothing is snapshotted, so
 * nothing goes stale.
 *
 * Mechanisms adopted from realiti4/claude-swap (see ADOPTED.md):
 *   - hashed keychain service derivation per config dir
 *   - seeded, login-free `import` under Claude Code's own locks
 *   - settings sharing via write-through symlinks (+ opt-in history)
 *   - directory → profile mappings (nearest-ancestor resolution)
 *   - identity/usage via the OAuth profile/usage endpoints
 *   - live-session detection from sessions/{pid}.json
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

import {
  DEFAULT_CONFIG_DIR,
  DEFAULT_CONFIG_JSON,
  accountEmail,
  browserDir,
  configDir,
  die,
  ensureRoot,
  listProfiles,
  profileDir,
  profileExists,
  readJson,
  readState,
  requireProfile,
  writeState,
} from "./profiles.js";
import { credentialStore } from "./credentials.js";
import { withProperLock } from "./locks.js";
import { applySharing, removeSharing, syncSharing } from "./share.js";
import { detectShell, shellenvScript } from "./shellenv.js";
import { runDoctor } from "./doctor.js";
import {
  loadMappings,
  pruneMappings,
  removeMapping,
  resolveMapping,
  setMapping,
} from "./mappings.js";
import {
  accessTokenOf,
  fetchProfile,
  fetchUsage,
  formatUsage,
  liveSessionPids,
  readProfileCredential,
} from "./api.js";

// Per-OS credential store (keychain-then-file on darwin, file-only elsewhere).
const credentials = credentialStore();

// ---------- claude launcher --------------------------------------------------

function launchClaude(name: string, args: string[]): number {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: configDir(name) };
  const res = spawnSync("claude", args, { env, stdio: "inherit" });
  if (res.error && (res.error as NodeJS.ErrnoException).code === "ENOENT") {
    die("`claude` binary not found on PATH. Install Claude Code first.");
  }
  return res.status ?? 1;
}

// ---------- commands ---------------------------------------------------------

function cmdAdd(name?: string): void {
  if (!name) die("usage: agent-switch add <profile>");
  if (profileExists(name)) die(`profile "${name}" already exists`);
  ensureRoot();
  fs.mkdirSync(configDir(name), { recursive: true, mode: 0o700 });
  console.log(`Created profile "${name}".`);
  console.log(`Launching Claude Code for first login (run /login inside if not prompted)...`);
  launchClaude(name, []);
  const email = accountEmail(name);
  console.log(email ? `Profile "${name}" is linked to ${email}.` : `Profile "${name}" created.`);
  console.log(`Activate it with: agent-switch use ${name}`);
}

/**
 * Login-free migration of the default ~/.claude install into a profile.
 *
 * Adopted from claude-swap's session bootstrap:
 * 1. Take Claude Code's own locks (~/.claude.lock, ~/.claude.json.lock) so we
 *    can't capture a credential mid-rotation.
 * 2. Copy config; seed the profile with a plaintext .credentials.json — the
 *    supported path: Claude Code migrates it into the profile's hashed
 *    keychain entry on first write.
 * 3. Delete any stale hashed keychain entry first (Claude reads the keychain
 *    BEFORE the file, so a stale entry would shadow the seed).
 * 4. Set hasCompletedOnboarding + theme in .claude.json (load-bearing:
 *    claude shows onboarding when either is missing).
 */
async function cmdImport(name?: string): Promise<void> {
  if (!name) die("usage: agent-switch import <profile>");
  if (profileExists(name)) die(`profile "${name}" already exists`);
  if (!fs.existsSync(DEFAULT_CONFIG_DIR) && !fs.existsSync(DEFAULT_CONFIG_JSON)) {
    die("no default ~/.claude setup found to import");
  }
  ensureRoot();
  const dst = configDir(name);

  await withProperLock(DEFAULT_CONFIG_DIR, () =>
    withProperLock(DEFAULT_CONFIG_JSON, () => {
      // A stale OS-managed entry from an earlier profile at this exact path
      // would shadow the seed (darwin reads the keychain before the file) —
      // clear it before anything else. No-op off darwin.
      credentials.clearStale(dst);

      fs.mkdirSync(dst, { recursive: true, mode: 0o700 });
      if (fs.existsSync(DEFAULT_CONFIG_DIR)) {
        fs.cpSync(DEFAULT_CONFIG_DIR, dst, { recursive: true });
      }

      // Config: merge onboarding keys so the profile never re-onboards.
      const config = (fs.existsSync(DEFAULT_CONFIG_JSON) && readJson(DEFAULT_CONFIG_JSON)) || {};
      config.hasCompletedOnboarding = true;
      config.theme = config.theme || "dark";
      fs.writeFileSync(path.join(dst, ".claude.json"), JSON.stringify(config, null, 2) + "\n", {
        mode: 0o600,
      });

      // Credential seed via the per-OS store: keychain (darwin) or the default
      // install's plaintext .credentials.json (linux/win32), file fallback.
      const creds = credentials.readDefault(DEFAULT_CONFIG_DIR);
      if (creds) {
        fs.writeFileSync(path.join(dst, ".credentials.json"), creds, { mode: 0o600 });
      }
      return creds !== null;
    }),
  ).then((seeded) => {
    console.log(`Imported default setup into profile "${name}".`);
    if (seeded) {
      console.log(
        "Credentials were seeded — no re-login needed. Claude Code migrates the seed\n" +
          "into this profile's own keychain entry on first use.\n" +
          "IMPORTANT: the default install and this profile now share one OAuth lineage.\n" +
          "The first side to refresh its token invalidates the other — stop using the\n" +
          "bare default login and go through agent-switch from now on.",
      );
    } else {
      console.log(
        "No live credential found to seed (keychain locked or empty). Run\n" +
          `\`agent-switch run ${name}\` once and /login inside.`,
      );
    }
  });
}

function cmdUse(name?: string): void {
  const p = requireProfile(name, "use");
  writeState({ active: p });
  const email = accountEmail(p);
  console.log(`Active profile: ${p}${email ? ` (${email})` : ""}`);
  console.log("New `claude` sessions use this profile. Already-running sessions are unaffected.");
}

function cmdRun(name?: string, rest: string[] = []): void {
  const p = requireProfile(name, "run");
  process.exit(launchClaude(p, rest));
}

function cmdList(): void {
  const profiles = listProfiles();
  if (profiles.length === 0) {
    console.log("No profiles yet. Create one with: agent-switch add <name>");
    return;
  }
  const active = readState().active;
  for (const p of profiles) {
    const mark = p === active ? "*" : " ";
    const email = accountEmail(p) ?? "not logged in";
    const pids = liveSessionPids(p);
    const live = pids.length > 0 ? `  [${pids.length} live session${pids.length > 1 ? "s" : ""}]` : "";
    console.log(`${mark} ${p.padEnd(16)} ${email}${live}`);
  }
}

function cmdCurrent(): void {
  const active = readState().active;
  if (!active || !profileExists(active)) {
    console.log("(none — falling back to default ~/.claude)");
    return;
  }
  const email = accountEmail(active);
  console.log(`${active}${email ? ` (${email})` : ""}`);
}

function cmdWhoami(name?: string): void {
  const p = name ?? readState().active ?? undefined;
  if (!p) die("no profile given and none active");
  requireProfile(p, "whoami");
  console.log(accountEmail(p) ?? "not logged in yet");
}

/**
 * Per-profile identity + 5h/7d usage via the OAuth endpoints.
 * Read-only; degrades gracefully when the credential is unreadable
 * (keychain naming is an internal contract) or the API shape changes.
 */
async function cmdStatus(name?: string): Promise<void> {
  const profiles = name ? [requireProfile(name, "status")] : listProfiles();
  if (profiles.length === 0) die("no profiles");
  const active = readState().active;

  for (const p of profiles) {
    const mark = p === active ? "*" : " ";
    const email = accountEmail(p) ?? "not logged in";
    console.log(`${mark} ${p} — ${email}`);

    const creds = readProfileCredential(p);
    const token = creds ? accessTokenOf(creds) : null;
    if (!token) {
      console.log("  (credential not readable — profile may not have run yet)");
      continue;
    }
    const [profile, usage] = await Promise.all([fetchProfile(token), fetchUsage(token)]);
    const org = profile?.organization?.name ?? profile?.account?.email ?? null;
    if (org) console.log(`  org: ${org}`);
    const lines = usage ? formatUsage(usage) : [];
    if (lines.length > 0) lines.forEach((l) => console.log(l));
    else console.log("  (usage unavailable — token expired or API shape changed)");
  }
}

function cmdDir(): void {
  // Precedence: directory mapping (nearest ancestor of CWD) > active profile.
  const mapped = resolveMapping(process.cwd());
  if (mapped && profileExists(mapped.profile)) {
    console.log(configDir(mapped.profile));
    return;
  }
  const active = readState().active;
  if (active && profileExists(active)) console.log(configDir(active));
  // Empty output -> shell wrapper falls back to the default config dir.
}

function cmdMap(profile?: string, dir?: string): void {
  const p = requireProfile(profile, "map <profile> [dir]");
  const key = setMapping(dir ?? process.cwd(), p);
  console.log(`Mapped ${key} -> ${p}`);
  console.log("`claude` in this directory (and subdirectories) now uses this profile.");
}

function cmdUnmap(dir?: string): void {
  const target = dir ?? process.cwd();
  if (removeMapping(target)) console.log(`Removed mapping for ${target}`);
  else die(`no mapping for ${target}`);
}

function cmdMappings(): void {
  const mappings = loadMappings();
  const keys = Object.keys(mappings).sort();
  if (keys.length === 0) {
    console.log("No directory mappings. Create one with: agent-switch map <profile> [dir]");
    return;
  }
  for (const k of keys) console.log(`${k} -> ${mappings[k]}`);
}

function cmdShare(mode?: string, flags: string[] = []): void {
  const withHistory = flags.includes("--history");
  const sourceFlagIdx = flags.indexOf("--source");
  const sourceName = sourceFlagIdx >= 0 ? flags[sourceFlagIdx + 1] : undefined;
  const source =
    sourceName && sourceName !== "default"
      ? configDir(requireProfile(sourceName, "share --source"))
      : DEFAULT_CONFIG_DIR;

  const profiles = listProfiles();
  if (profiles.length === 0) die("no profiles");

  if (mode === "on") {
    if (!fs.existsSync(source)) die(`share source ${source} does not exist`);
    if (withHistory && process.platform === "win32") {
      die("--history requires POSIX symlinks (copies would fork history, not share it)");
    }
    console.log(`Sharing from ${source}${withHistory ? " (incl. history)" : ""}:`);
    for (const p of profiles) {
      if (configDir(p) === source) continue; // don't link the source onto itself
      const actions = applySharing(source, configDir(p), withHistory);
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
      if (configDir(p) === source) continue;
      const actions = syncSharing(source, configDir(p));
      console.log(`  ${p}: ${actions.length > 0 ? actions.join(", ") : "nothing to reconcile"}`);
    }
  } else if (mode === "off") {
    for (const p of profiles) {
      const actions = removeSharing(configDir(p));
      if (actions.length > 0) console.log(`  ${p}: ${actions.join(", ")}`);
    }
    console.log("Removed agent-switch-managed links (profile-own files were never touched).");
  } else {
    die("usage: agent-switch share on|sync|off [--history] [--source <profile|default>]");
  }
}

function cmdRemove(name?: string, force = false): void {
  const p = requireProfile(name, "remove");
  const state = readState();
  if (state.active === p && !force) {
    die(`"${p}" is the active profile. Switch away first or use --force.`);
  }
  const pids = liveSessionPids(p);
  if (pids.length > 0 && !force) {
    die(`profile "${p}" has live Claude Code sessions (PIDs ${pids.join(", ")}). Close them or use --force.`);
  }

  // OS credential entry first — on darwin the hashed service name can't be
  // recomputed once the config dir path is gone from our bookkeeping. Off
  // darwin this is a no-op (the credential file goes with the profile dir).
  const removedEntry = credentials.removeEntry(configDir(p));
  fs.rmSync(profileDir(p), { recursive: true, force: true });
  if (state.active === p) writeState({ active: null });
  const pruned = pruneMappings(p);

  console.log(`Removed profile "${p}".`);
  if (removedEntry) console.log("Removed its keychain credential entry.");
  if (pruned.length > 0) console.log(`Removed ${pruned.length} directory mapping(s).`);
}

async function cmdWeb(name?: string): Promise<void> {
  const p = requireProfile(name, "web");
  const userDataDir = browserDir(p);
  fs.mkdirSync(userDataDir, { recursive: true, mode: 0o700 });

  let chromium: any;
  try {
    const mod: string = "playwright"; // non-literal so tsc doesn't require the package
    ({ chromium } = (await import(mod)) as any);
  } catch {
    die(
      "playwright is not installed. Run:\n" +
        "  npm install playwright && npx playwright install chromium",
    );
  }

  console.log(`Opening claude.ai with the persistent browser profile "${p}"...`);
  console.log("Log in once — the session is stored in the profile and reused next time.");
  // `--start-maximized` is a Chromium arg honored on macOS, Linux, and Windows;
  // viewport:null lets the window drive the size. launchPersistentContext keeps
  // the user-data-dir per profile on every OS.
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
  console.log(`agent-switch — switch between multiple Claude Code accounts (macOS · Linux · Windows)

  agent-switch add <name>              create a new profile and log it in
  agent-switch import <name>           migrate the default ~/.claude setup (no re-login)
  agent-switch use <name>              set the active profile for new sessions
  agent-switch run <name> [args...]    launch claude on a profile without switching
  agent-switch list                    list profiles (* active, live sessions shown)
  agent-switch status [name]           identity + 5h/7d usage per profile
  agent-switch current                 show the active profile
  agent-switch whoami [name]           show the account email of a profile
  agent-switch dir                     resolve profile for CWD (mapping > active)
  agent-switch map <name> [dir]        map a directory (default: CWD) to a profile
  agent-switch unmap [dir]             remove a directory mapping
  agent-switch mappings                list directory mappings
  agent-switch share on|sync|off [--history] [--source <profile|default>]
                                  share settings/skills/commands (sync re-links forked files)
  agent-switch web <name>              open claude.ai in a persistent per-profile browser
  agent-switch remove <name> [--force] delete a profile (incl. its keychain entry)
  agent-switch shellenv [--shell zsh|bash|fish|powershell]
                                  print the shell integration snippet (auto-detects)
  agent-switch doctor                  per-OS self-check (claude on PATH, config, creds, links)`);
}

// ---------- main -------------------------------------------------------------

/** Value of a `--flag value` option, or undefined if absent. */
function flagValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const positional = rest.filter((a) => !a.startsWith("--"));
  switch (cmd) {
    case "add": return cmdAdd(positional[0]);
    case "import": return cmdImport(positional[0]);
    case "use": return cmdUse(positional[0]);
    case "run": return cmdRun(rest[0], rest.slice(1));
    case "list": case "ls": return cmdList();
    case "status": return cmdStatus(positional[0]);
    case "current": return cmdCurrent();
    case "whoami": return cmdWhoami(positional[0]);
    case "dir": return cmdDir();
    case "map": return cmdMap(positional[0], positional[1]);
    case "unmap": return cmdUnmap(positional[0]);
    case "mappings": return cmdMappings();
    case "share": return cmdShare(positional[0], rest.slice(1));
    case "web": return cmdWeb(positional[0]);
    case "remove": case "rm": return cmdRemove(positional[0], rest.includes("--force"));
    case "shellenv": return cmdShellenv(flagValue(rest, "--shell") ?? positional[0]);
    case "doctor": return process.exit(runDoctor());
    case "help": case "--help": case "-h": return usage();
    default: usage(); process.exit(cmd ? 1 : 0);
  }
}

main().catch((err) => die(String(err?.message ?? err)));
