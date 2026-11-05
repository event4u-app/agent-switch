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

import { die, migrateLegacyLayout, ROOT } from "./profiles.js";
import { parseArgs, parseExec, parseRun } from "./args.js";
import { runDoctor } from "./doctor.js";
import { TOOL_IDS } from "./tooling.js";
import { currentVersion } from "./updates.js";
import { printCswapList } from "./cswap-list.js";
import { cmdService } from "./service.js";
import { cmdAppSettings, cmdApps, cmdDesktop, cmdLauncher, cmdOpen, cmdSignInBrowser, cmdWeb } from "./commands/desktop.js";
import { usage } from "./commands/help.js";
import { cmdClaudeSettings } from "./commands/claude-settings.js";
import {
  cmdActivate,
  cmdAdd,
  cmdBrowsers,
  cmdColor,
  cmdCurrent,
  cmdDeactivate,
  cmdDisable,
  cmdImport,
  cmdLabel,
  cmdList,
  cmdLogin,
  cmdMarkShared,
  cmdRemove,
  cmdRename,
  cmdRun,
  cmdUse,
  cmdWhoami,
} from "./commands/profiles.js";
import { cmdRebind } from "./commands/rebind.js";
import { cmdStore } from "./commands/store.js";
import { cmdFocus, cmdOpenDefault, cmdOpenTerminal, cmdOpenSession, cmdOpenTargets } from "./commands/open-in.js";
import { findApp } from "./apps.js";
import { cmdCleanup, cmdLibrary, cmdResume } from "./commands/library.js";
const LIBRARY_ACTIONS = new Set(["library", "pin", "unpin", "name", "tag", "untag", "archive", "unarchive", "search", "keep", "vault"]);
import { visibilityFile, writeVisibility } from "./app-visibility.js";
import { cmdPr, cmdWorktrees } from "./commands/pr.js";
import { cmdChanges } from "./commands/changes.js";
import { cmdBridge, cmdFiles, cmdTimeline } from "./commands/bridge.js";
import { cmdAgents } from "./commands/agents.js";
import { cmdNeedsAnswer, cmdRemote } from "./commands/remote.js";
import { cmdDiff } from "./commands/diff.js";
import { cmdView } from "./commands/view.js";
import { cmdMcp } from "./commands/mcp.js";
import { cmdEngine } from "./commands/engine.js";
import { cmdNeeds } from "./commands/needs.js";
import { cmdHost } from "./commands/host.js";
import { cmdDir, cmdExec, cmdStrategy, cmdGuard, cmdMap, cmdMappings, cmdPicks, cmdPool, cmdUnmap } from "./commands/routing.js";
import {
  cmdAlerts,
  cmdCompact,
  cmdHookEvent,
  cmdHooks,
  cmdSessions,
  cmdSessionsPreview,
  cmdSessionsRestore,
  cmdSessionsRm,
} from "./commands/sessions.js";
import {
  cmdActivity,
  cmdGuiSettings,
  cmdKeepSignedIn,
  cmdAutoReset,
  cmdNotifications,
  cmdNotify,
  cmdOsNotify,
} from "./commands/settings.js";
import { cmdConfig, cmdShare } from "./commands/sharing.js";
import {
  cmdCheckUpdate,
  cmdGui,
  cmdProviders,
  cmdShellenv,
  cmdTooling,
  cmdToolingAction,
  cmdToolingNotes,
  cmdUninstall,
  cmdUpdate,
} from "./commands/system.js";
import { cmdHandoff, cmdTakeover } from "./commands/takeover.js";
import { cmdContinue } from "./commands/continue.js";
import { cmdLimits, cmdLink, cmdMcpServe, cmdSwitch } from "./commands/link.js";
import { cmdAuthStatus, cmdAutoswitch, cmdProtection, cmdReset, cmdStatus, cmdUsageHistory } from "./commands/usage.js";

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
    case "add": return cmdAdd(providerId, positional[0], typeof flags.browser === "string" ? flags.browser : undefined, !!flags.isolated);
    case "login": return cmdLogin(providerId, positional[0], typeof flags.browser === "string" ? flags.browser : undefined, !!flags.isolated);
    case "browsers": return cmdBrowsers(!!flags.json);
    case "import": return cmdImport(providerId, positional[0]);
    case "use": return cmdUse(providerId, positional[0]);
    case "deactivate": return cmdDeactivate(providerId);
    case "label": return cmdLabel(providerId, positional[0], positional[1]);
    case "color": case "colour": return cmdColor(providerId, positional[0], positional[1]);
    case "activate": return cmdActivate(!!flags.json, !!flags.auto);
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
    // `open <app> [profile]` opens a desktop app on an account; `open <session> [--with …]` opens a session's folder.
    case "open": return flags.with !== undefined || flags.file !== undefined || (positional[0] && !findApp(positional[0])) ? cmdOpenSession(positional[0], flags) : cmdOpen(positional[0], positional[1]);
    case "open-targets": return cmdOpenTargets(positional[0], flags);
    case "open-default": return cmdOpenDefault(positional[0], flags);
    case "open-terminal": return cmdOpenTerminal(positional[0]);
    case "focus": return cmdFocus(positional[0]);
    case "launcher": case "launchers": return cmdLauncher(positional[0], positional.slice(1), flags);
    case "app-settings": return cmdAppSettings(positional[0], positional.slice(1), flags);
    case "apps": return cmdApps(!!flags.json);
    case "notify": return cmdNotify(flags);
    case "notifications": return cmdNotifications(positional[0], !!flags.json);
    case "os-notify": return cmdOsNotify(positional[0], !!flags.json);
    case "keep-signed-in": return cmdKeepSignedIn(positional[0], !!flags.json);
    case "auto-reset": return cmdAutoReset(positional[0], !!flags.json);
    case "uninstall": return cmdUninstall(flags);
    case "run": {
      let r: ReturnType<typeof parseRun>;
      try { r = parseRun(rest); } catch (e) { die((e as Error).message); }
      return cmdRun(r.providerId, r.name, r.args, r.cwd, { tmux: r.tmux, force: r.force });
    }
    case "handoff": return cmdHandoff(providerId, positional[0], positional.slice(1), flags);
    case "list": case "ls":
      if ("format" in flags) return printCswapList(flags, false);
      return cmdList(providerExplicit ? providerId : undefined, !!flags.json);
    case "--list": return printCswapList(flags, true); // claude-swap list schema v1
    case "--version": case "version": return void console.log(currentVersion());
    case "status": return cmdStatus(providerExplicit ? providerId : undefined, positional[0], !!flags.json);
    case "current": return cmdCurrent(providerExplicit ? providerId : undefined);
    case "whoami": return cmdWhoami(providerId, positional[0]);
    case "dir": return cmdDir(providerId, !!flags.guard, !!flags.json, !!flags.plain, typeof flags.exclude === "string" ? flags.exclude.split(",").map((x) => x.trim()).filter(Boolean) : []);
    case "continue": return cmdContinue(positional[0], typeof flags.text === "string" ? flags.text : undefined);
    case "strategy": return cmdStrategy(providerId, positional[0], !!flags.json);
    case "exec": {
      let e: ReturnType<typeof parseExec>;
      try { e = parseExec(rest); } catch (err) { die((err as Error).message); }
      return cmdExec(e);
    }
    case "guard": return cmdGuard(positional[0], !!flags.json);
    case "map": return cmdMap(providerId, positional[0], positional[1], flags);
    case "unmap": return cmdUnmap(providerExplicit ? providerId : undefined, positional[0]);
    case "mappings": return cmdMappings(rest.includes("--json"));
    case "share": return cmdShare(positional[0], rest.slice(1));
    case "claude-settings": return cmdClaudeSettings(positional[0], positional.slice(1), flags);
    case "config": return cmdConfig(positional[0], positional[1], flags);
    case "sessions":
      if (positional[0] === "rm") return cmdSessionsRm(providerId, providerExplicit, positional[1], flags);
      if (positional[0] === "restore") return cmdSessionsRestore(providerId, providerExplicit, positional[1], flags);
      if (positional[0] === "preview") return cmdSessionsPreview(providerId, providerExplicit, positional[1], flags);
      if (positional[0] && LIBRARY_ACTIONS.has(positional[0])) return cmdLibrary(positional[0], positional[1], positional.slice(2).join(" ") || undefined, flags);
      if (positional[0] === "cleanup") return cmdCleanup(flags);
      if (positional[0] === "resume") return cmdResume(positional[1], flags);
      return cmdSessions(providerId, providerExplicit, positional[0], flags);
    case "hooks": return cmdHooks(positional[0], positional[1], providerExplicit ? providerId : "claude");
    case "store": return cmdStore(positional[0], flags);
    case "app-visibility":
      if (positional[0] !== "visible" && positional[0] !== "hidden") die("usage: agent-switch app-visibility visible|hidden");
      return writeVisibility(visibilityFile(ROOT), positional[0] === "visible");
    case "pr": return cmdPr(positional[0], flags);
    case "worktrees": return cmdWorktrees(flags);
    case "changes": return cmdChanges(positional[0], flags);
    case "timeline": return cmdTimeline(positional[0], flags);
    case "bridge": return cmdBridge(providerId, positional[0], flags);
    case "agents": return cmdAgents(positional, flags, rest.includes("--") ? rest.slice(rest.indexOf("--") + 1) : undefined);
    case "files": return cmdFiles(positional[0], flags);
    case "diff": return cmdDiff(positional[0], positional[1], flags);
    case "view": return cmdView(positional[0], positional[1], flags);
    case "mcp": return positional[0] === "serve" ? cmdMcpServe() : cmdMcp(positional[0], positional[1], flags);
    case "engine": return cmdEngine(positional[0], flags);
    case "needs":
      if (positional[0] === "allow" || positional[0] === "deny") return cmdNeedsAnswer(positional[0], positional[1], positional[2], flags);
      return cmdNeeds(positional[0], positional[1], flags);
    case "remote": return cmdRemote(positional[0], positional[1], positional[2], flags);
    case "host": return cmdHost(providerId, positional[0], positional[1], flags);
    case "alerts": return cmdAlerts(positional[0], flags);
    case "compact": return cmdCompact(providerId, positional[0], flags);
    case "takeover": return cmdTakeover(providerId, providerExplicit, positional[0], flags);
    case "rebind": return cmdRebind(providerId, providerExplicit, positional[0], flags);
    case "web": return cmdWeb(positional[0]);
    case "sign-in-browser": return cmdSignInBrowser(positional[0], flags);
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
    case "picks": return cmdPicks(flags);
    case "limits": return cmdLimits(providerExplicit ? providerId : undefined, flags);
    case "switch": return cmdSwitch(positional[0], positional.slice(1), flags);
    case "link": return cmdLink(positional[0], !!flags.json);
    case "protection": return cmdProtection(positional[0], positional.slice(1), flags);
    case "pool": case "pools": return cmdPool(positional[0], positional.slice(1), flags);
    case "gui-settings": return cmdGuiSettings(positional[0], positional.slice(1), flags);
    case "help": case "--help": case "-h": return usage();
    // A bare `agent-switch` (no command) launches the GUI; an unknown command
    // still prints usage and exits non-zero.
    default:
      if (cmd === undefined) return cmdGui();
      usage();
      // exitCode, not exit(): the usage text is larger than a pipe buffer, and
      // exit() would drop the part still queued for a piped stdout.
      process.exitCode = 1;
      return;
  }
}

main().catch((err) => die(String(err?.message ?? err)));
