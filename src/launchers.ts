/**
 * Managed desktop launchers (macOS): one small app per app × profile in
 * `~/Applications/Agent Switch/`, which a Dock or Spotlight click can start.
 *
 * Each launcher is an AppleScript applet (`osacompile`) whose only line runs
 * this CLI's `open <app> <profile>` — the same isolated start the app menu
 * uses, including "focus the window it already has". The original app is never
 * copied, patched or re-signed. A locally built applet carries no quarantine
 * flag, so Gatekeeper does not prompt; swapping its icon breaks the ad-hoc
 * seal, which is why the bundle is re-signed ad hoc afterwards.
 *
 * Every launcher made is recorded in `launchers.json`, so remove, repair and
 * uninstall touch exactly those bundles.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { findApp, type AppDescriptor } from "./apps.js";
import { ROOT } from "./profiles.js";
import { ProviderId } from "./providers.js";

const MANIFEST = path.join(ROOT, "launchers.json");

export interface LauncherEntry {
  app: string;
  provider: ProviderId;
  profile: string;
  path: string;
}

/** macOS-only paths: built with path.posix so they are right on any host. */
export function launchersDir(home: string = os.homedir()): string {
  return path.posix.join(home, "Applications", "Agent Switch");
}

export function launcherPath(app: AppDescriptor, profile: string, home: string = os.homedir()): string {
  return path.posix.join(launchersDir(home), `${app.displayName} – ${profile}.app`);
}

function asLiteral(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** The applet's single line: run `<node> <index.js> open <app> <profile>`,
 *  carrying a custom AGENT_SWITCH_HOME — a Dock start has none in its env. */
export function appleScriptFor(node: string, index: string, appId: string, profile: string, home?: string): string {
  const env = home ? `"AGENT_SWITCH_HOME=" & quoted form of ${asLiteral(home)} & " " & ` : "";
  return (
    `do shell script ${env}quoted form of ${asLiteral(node)} & " " & quoted form of ${asLiteral(index)}` +
    ` & " open " & quoted form of ${asLiteral(appId)} & " " & quoted form of ${asLiteral(profile)}`
  );
}

/** A brew/installer `bin/node` symlink that resolves to the running node — it
 *  survives an upgrade, the versioned path behind it does not. */
export function stableNode(
  execPath: string,
  candidates: readonly string[] = ["/opt/homebrew/bin/node", "/usr/local/bin/node"],
  realpath: (p: string) => string = (p) => fs.realpathSync(p),
): string {
  let running: string;
  try {
    running = realpath(execPath);
  } catch {
    return execPath;
  }
  for (const c of candidates) {
    try {
      if (realpath(c) === running) return c;
    } catch {
      /* not installed there */
    }
  }
  return execPath;
}

/** The main (non-helper) process started with exactly this `--user-data-dir`. */
export function findMainPid(psOutput: string, userDataDir: string): number | null {
  const flag = `--user-data-dir=${userDataDir}`;
  for (const line of psOutput.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(.*)$/);
    if (!m) continue;
    const args = m[2];
    const at = args.indexOf(flag);
    if (at < 0 || args.includes("--type=")) continue;
    const next = args[at + flag.length];
    if (next === undefined || next === " ") return Number(m[1]);
  }
  return null;
}

/** The regular Claude Desktop: its main process runs without a `--user-data-dir`. */
export function findRegularMainPid(psOutput: string): number | null {
  for (const line of psOutput.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(.*)$/);
    if (!m) continue;
    const args = m[2];
    if (!/\/Claude\.app\/Contents\/MacOS\/Claude(\s|$)/.test(args)) continue;
    if (args.includes("--type=") || args.includes("--user-data-dir=")) continue;
    return Number(m[1]);
  }
  return null;
}

/** Brings an already running profile instance to the front. False = none runs
 *  (or it could not be activated), so the caller starts one. */
export function findRunning(userDataDir: string | null): number | null {
  if (process.platform !== "darwin") return null;
  const ps = spawnSync("ps", ["-axo", "pid=,args="], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (ps.status !== 0) return null;
  return userDataDir === null ? findRegularMainPid(ps.stdout) : findMainPid(ps.stdout, userDataDir);
}

export function focusRunning(userDataDir: string): boolean {
  const pid = findRunning(userDataDir);
  if (pid === null) return false;
  // NSRunningApplication.activate needs no Accessibility/Automation permission.
  const js = `ObjC.import('AppKit'); const a = $.NSRunningApplication.runningApplicationWithProcessIdentifier(${pid}); a.isNil() ? 'no' : (a.activateWithOptions($.NSApplicationActivateAllWindows) ? 'yes' : 'no')`;
  const r = spawnSync("osascript", ["-l", "JavaScript", "-e", js], { encoding: "utf8" });
  return r.status === 0 && r.stdout.trim() === "yes";
}

export function upsertEntry(entries: readonly LauncherEntry[], e: LauncherEntry): LauncherEntry[] {
  return [...withoutEntry(entries, e.app, e.profile), e];
}

export function withoutEntry(entries: readonly LauncherEntry[], app: string, profile: string): LauncherEntry[] {
  return entries.filter((x) => !(x.app === app && x.profile === profile));
}

export function entriesFor(entries: readonly LauncherEntry[], provider: ProviderId, profile: string): LauncherEntry[] {
  return entries.filter((x) => x.provider === provider && x.profile === profile);
}

export function readLaunchers(): LauncherEntry[] {
  try {
    const raw = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
    return Array.isArray(raw) ? raw.filter((x) => x && typeof x.app === "string" && typeof x.profile === "string" && typeof x.path === "string") : [];
  } catch {
    return [];
  }
}

function writeLaunchers(entries: readonly LauncherEntry[]): void {
  fs.mkdirSync(ROOT, { recursive: true });
  fs.writeFileSync(MANIFEST, JSON.stringify(entries, null, 2) + "\n", { mode: 0o600 });
}

/** Where the app is installed (first Spotlight hit), or null. */
export function appBundlePath(app: AppDescriptor): string | null {
  const r = spawnSync("mdfind", [`kMDItemCFBundleIdentifier == '${app.bundleId}'`], { encoding: "utf8" });
  const hit = r.status === 0 ? r.stdout.split("\n").find((l) => l.endsWith(".app")) : undefined;
  return hit ?? null;
}

function appIcon(bundle: string): string | null {
  const r = spawnSync("plutil", ["-extract", "CFBundleIconFile", "raw", path.join(bundle, "Contents", "Info.plist")], { encoding: "utf8" });
  if (r.status !== 0) return null;
  const name = r.stdout.trim();
  const file = path.join(bundle, "Contents", "Resources", name.endsWith(".icns") ? name : `${name}.icns`);
  return fs.existsSync(file) ? file : null;
}

/** This CLI as the launcher should call it: a stable node + this index.js. */
function cliInvocation(): { node: string; index: string } {
  return { node: stableNode(process.execPath), index: path.join(path.dirname(fileURLToPath(import.meta.url)), "index.js") };
}

function run(cmd: string, args: string[]): void {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${(r.stderr || r.stdout).trim()}`);
}

/** Builds (or rebuilds) the launcher for app × profile and records it. */
export function createLauncher(app: AppDescriptor, profile: string): LauncherEntry {
  if (process.platform !== "darwin") throw new Error("launchers are macOS-only for now.");
  const bundle = appBundlePath(app);
  if (!bundle) throw new Error(`${app.displayName} is not installed.`);
  const target = launcherPath(app, profile);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // Built next to the target, then swapped in: a failed build leaves the old one.
  // The name must end in .app, or osacompile writes a bare script, not a bundle.
  const tmp = path.join(path.dirname(target), `.${path.basename(target, ".app")}.building.app`);
  fs.rmSync(tmp, { recursive: true, force: true });
  try {
    const { node, index } = cliInvocation();
    run("osacompile", ["-o", tmp, "-e", appleScriptFor(node, index, app.id, profile, process.env.AGENT_SWITCH_HOME)]);
    const icon = appIcon(bundle);
    if (icon) {
      // The applet's asset catalog would win over applet.icns and show a blank icon.
      fs.rmSync(path.join(tmp, "Contents", "Resources", "Assets.car"), { force: true });
      fs.copyFileSync(icon, path.join(tmp, "Contents", "Resources", "applet.icns"));
    }
    run("codesign", ["--force", "--sign", "-", tmp]);
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(tmp, target);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const entry: LauncherEntry = { app: app.id, provider: app.provider, profile, path: target };
  writeLaunchers(upsertEntry(readLaunchers(), entry));
  return entry;
}

/** Removes a recorded launcher; a path the manifest doesn't list is never deleted. */
export function removeLauncher(appId: string, profile: string): boolean {
  const entries = readLaunchers();
  const hit = entries.find((x) => x.app === appId && x.profile === profile);
  if (!hit) return false;
  fs.rmSync(hit.path, { recursive: true, force: true });
  writeLaunchers(withoutEntry(entries, appId, profile));
  return true;
}

export function removeLaunchersFor(provider: ProviderId, profile: string): number {
  const mine = entriesFor(readLaunchers(), provider, profile);
  for (const e of mine) removeLauncher(e.app, e.profile);
  return mine.length;
}

/** A renamed profile's launchers are rebuilt under the new name (best effort:
 *  one that can't be rebuilt is removed rather than left pointing at nothing). */
export function renameLaunchersFor(provider: ProviderId, from: string, to: string): void {
  for (const e of entriesFor(readLaunchers(), provider, from)) {
    removeLauncher(e.app, e.profile);
    const app = findApp(e.app);
    if (!app) continue;
    try {
      createLauncher(app, to);
    } catch {
      /* app gone — nothing to rebuild */
    }
  }
}

/** Rebuilds every recorded launcher — after a move of this CLI or a node upgrade. */
export function repairLaunchers(): { rebuilt: LauncherEntry[]; failed: { entry: LauncherEntry; reason: string }[] } {
  const rebuilt: LauncherEntry[] = [];
  const failed: { entry: LauncherEntry; reason: string }[] = [];
  for (const e of readLaunchers()) {
    const app = findApp(e.app);
    try {
      if (!app) throw new Error(`unknown app ${e.app}`);
      rebuilt.push(createLauncher(app, e.profile));
    } catch (err) {
      failed.push({ entry: e, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return { rebuilt, failed };
}

export function removeAllLaunchers(): number {
  const entries = readLaunchers();
  for (const e of entries) fs.rmSync(e.path, { recursive: true, force: true });
  writeLaunchers([]);
  return entries.length;
}
