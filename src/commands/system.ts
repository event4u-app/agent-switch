/**
 * Install-level commands: providers, uninstall, gui, check-update, update,
 * shellenv, tooling.
 */

import * as fs from "node:fs";
import {
  HOME,
  configDir,
  die,
  listAllProfiles,
  listProfiles,
  readProviders,
  setProviderSurface,
  readBinaryPaths,
  setBinaryPath,
  type ProviderSurface,
  ROOT,
} from "../profiles.js";
import { ProviderId, PROVIDER_IDS, provider, isProviderInstalled } from "../providers.js";
import { detectShell, installShellIntegration, shellenvScript } from "../shellenv.js";
import { shellIntegrationCheck } from "../doctor.js";
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
} from "../tooling.js";
import { releaseNoteBlocks } from "../release-notes.js";
import { launchGui, waitForExit } from "../gui-launch.js";
import { checkForUpdate, fetchReleases, releasesNewerThan, selfUpdate, type ReleaseInfo } from "../updates.js";
import { readPid, PIDFILE, processAlive } from "../daemon.js";
import { serviceAfterUpdate, serviceInstallFromDisk, serviceTarget, serviceUninstall } from "../service.js";
import { removeAllLaunchers } from "../launchers.js";
import { confirmAction, credentials, logActivity } from "./shared.js";

/**
 * Enable/disable a provider's surfaces (cli / ui), or show the current setting.
 * Disabling never deletes profiles — it only hides the provider from `list` and
 * the GUI; re-enabling restores everything. Default enabled: Claude + Codex.
 */
export function cmdProviders(
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
export function cmdUninstall(flags: Record<string, string | boolean> = {}): void {
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

/** Launch a registered GUI app on a profile, isolated (macOS). Profile: an
 *  explicit positional name, else the active profile for the app's provider. */
export async function cmdGui(afterPid?: string | boolean): Promise<void> {
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
export async function cmdCheckUpdate(json = false): Promise<void> {
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
export async function cmdUpdate(): Promise<void> {
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

export function cmdShellenv(shellArg?: string, sub?: string, json = false): void {
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
export function cmdTooling(json = false): void {
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
export async function cmdToolingNotes(id: string | undefined, flags: Record<string, string | boolean>): Promise<void> {
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
export function cmdToolingAction(action: ToolAction, id?: string): void {
  if (!id || !TOOL_IDS.includes(id as ToolId)) {
    die(`usage: agent-switch tooling ${action} <${TOOL_IDS.join("|")}>`);
  }
  process.exit(runToolAction(id as ToolId, action));
}
