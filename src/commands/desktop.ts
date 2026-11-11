/**
 * GUI apps and Claude Desktop: desktop, web, apps, open, launcher, app-settings.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { browserDir, die, requireProfile, activeFor } from "../profiles.js";
import { APPS, buildLaunch, findApp, guiDataDir, isInstalled } from "../apps.js";
import { copyDesktopSettings, DEFAULT_DATA_DIR, hasSettingsLayout } from "../desktop-settings.js";
import {
  createLauncher,
  findRunning,
  focusRunning,
  readLaunchers,
  removeLauncher,
  repairLaunchers,
} from "../launchers.js";
import { desktopScan, logActivity, tildePath } from "./shared.js";
import { setRelation, syncDesktopBeforeLaunch } from "../follow.js";

/** Which accounts ran sessions in each Claude Desktop instance; `mismatch` =
 *  a profile's own instance signed in with another account. */
export function cmdDesktop(json: boolean): void {
  const { instances } = desktopScan();
  const shown = instances.filter((i) => i.accounts.length > 0);
  if (json) return void console.log(JSON.stringify(shown, null, 2));
  if (!shown.length) return void console.log("No Claude Desktop sessions found.");
  for (const i of shown) {
    console.log(`${i.profile ? `${i.profile}'s instance` : "Claude Desktop"} (${tildePath(i.dir)})`);
    for (const a of i.accounts) console.log(`  ${a.profile ?? "an account without a profile"} (${a.accountUuid.slice(0, 8)})${i.profile && a.profile !== i.profile ? "  <- not this profile's account" : ""}`);
  }
}

export async function cmdWeb(name?: string): Promise<void> {
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

/**
 * The sign-in browser of last resort (road-to-a-chat-that-reads-well 5.3): a
 * Playwright Chromium with the account's own profile folder, used as `$BROWSER`
 * when no Chromium-family browser is installed. The automation flag is left off,
 * yet Google may still refuse its SSO here — the caller says so.
 */
export async function cmdSignInBrowser(url: string | undefined, flags: Record<string, string | boolean>): Promise<void> {
  const dir = typeof flags.dir === "string" ? flags.dir : null;
  if (!url || !/^https?:\/\//.test(url) || !dir) die("usage: agent-switch sign-in-browser --dir <profile browser dir> <http(s) url>");
  let chromium: any;
  try {
    const mod: string = "playwright";
    ({ chromium } = (await import(mod)) as any);
  } catch {
    die("playwright is not installed. Run:\n  npm install playwright && npx playwright install chromium");
  }
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const context = await chromium.launchPersistentContext(dir, { headless: false, viewport: null, ignoreDefaultArgs: ["--enable-automation"] });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(url);
  await new Promise<void>((resolve) => context.on("close", resolve));
}

export function cmdApps(json = false): void {
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

export function cmdOpen(appId?: string, name?: string): void {
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
  if (app.id === "claude-desktop") {
    try {
      const r = syncDesktopBeforeLaunch(n);
      if (r && r.state !== "applied" && r.state !== "off") console.error(`agent-switch: ${app.displayName} on ${n} not fully in step — ${r.detail}`);
    } catch {
      /* the app opens with what it has */
    }
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
export function cmdLauncher(sub: string | undefined, args: string[], flags: Record<string, string | boolean>): void {
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
export function cmdAppSettings(sub: string | undefined, args: string[], flags: Record<string, string | boolean>): void {
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
  if (app.id === "claude-desktop") setRelation("claude-desktop", toProfile, { source: from, enabled: true });
  logActivity("settings", `${app.provider}/${toProfile}`, `copied ${app.displayName} settings from ${from}`, "user ran `agent-switch app-settings copy`");
  if (flags.json) return void console.log(JSON.stringify({ app: app.id, from, to: toProfile, ...r }, null, 2));
  if (!r.copied.length) return void console.log(`Nothing to copy — ${from} has no ${app.displayName} settings yet.`);
  console.log(`Copied ${r.copied.join(", ")} from ${from} to ${app.provider}/${toProfile}.`);
  if (r.backups.length) console.log(`Previous files kept as ${r.backups.map((b) => path.basename(b)).join(", ")}.`);
  console.log("Logins, chats and account-bound preferences were not copied.");
}
