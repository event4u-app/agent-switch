/**
 * `agent-switch open <session> [--with <target>] [--file F] [--line N]`,
 * `agent-switch open-targets <session> [--json]`,
 * `agent-switch open-default <target> [--repo DIR]`,
 * `agent-switch open-terminal <terminal>` and
 * `agent-switch focus <session>` (road-to-agent-switch-v3-central Phase 5).
 */

import { spawn, spawnSync } from "node:child_process";
import * as path from "node:path";

import { die, ROOT } from "../profiles.js";
import { eventFile, lastHookCwd, readEvents } from "../hooks.js";
import { canonical, gitFacts } from "../git-facts.js";
import { readSessionHeader } from "../sessions.js";
import { liveSessions } from "../api.js";
import { configDir } from "../profiles.js";
import { confine, defaultTarget, menu, OpenRefused, openSettingsFile, plan, readOpenSettings, realEnv, TARGET_IDS, writeOpenSettings, type TargetId } from "../open-in.js";
import { focusSession, FocusFailed } from "../focus-terminal.js";
import { pickTerminal, terminals, TERMINAL_IDS, type TerminalId } from "../terminals.js";
import { githubRepo, prCacheFile, prsForHead, readPrCache } from "../pr-facts.js";
import { resolveSession } from "./library.js";
import { TmuxHost } from "../host/tmux-host.js";

interface Where {
  key: string;
  provider: string;
  account: string;
  sessionId: string;
  /** The worktree root, or the session's folder outside a repo. */
  root: string;
  /** The main checkout, for per-repo settings. */
  repo: string | null;
  remote: string | null;
  headSha: string | null;
}

function where(arg: string | undefined): Where {
  if (!arg) die("name a session (an id or provider/account/id; see agent-switch sessions)");
  const s = resolveSession(arg);
  if (!s) die(`unknown app "${arg}" and no session of that id (see agent-switch apps, agent-switch sessions)`);
  const [provider, account, sessionId] = s.key.split("/");
  const events = provider === "claude" ? readEvents(eventFile(ROOT, provider, account)) : [];
  const cwd = lastHookCwd(events, sessionId) ?? readSessionHeader(s.files.transcript).cwd;
  if (!cwd) die(`${s.key} names no folder`);
  const git = gitFacts(cwd);
  const root = git?.toplevel ?? cwd;
  // Per-repo settings key on the main checkout, so every worktree of a repo shares them.
  const common = git ? spawnSync("git", ["-C", root, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8", timeout: 1000 }).stdout?.trim() : "";
  const repo = git ? canonical(common ? path.dirname(common) : root) : null;
  return { key: s.key, provider, account, sessionId, root, repo, remote: git?.remote ?? null, headSha: git?.headSha ?? null };
}

export function cmdOpenSession(arg: string | undefined, flags: Record<string, string | boolean>): void {
  const w = where(arg);
  const settings = readOpenSettings(openSettingsFile(ROOT));
  const target = (typeof flags.with === "string" ? flags.with : defaultTarget(settings, w.repo, menu(realEnv, w.root, settings.terminal))) as TargetId | null;
  if (!target) die("no editor found to open it with; pass --with " + TARGET_IDS.join("|"));
  if (!TARGET_IDS.includes(target)) die(`--with is one of ${TARGET_IDS.join(", ")}`);
  let dir: string;
  let file: string | undefined;
  try {
    dir = confine(w.root);
    file = typeof flags.file === "string" ? confine(w.root, flags.file) : undefined;
  } catch (err) {
    if (err instanceof OpenRefused) die(err.message);
    throw err;
  }
  const line = typeof flags.line === "string" && /^[1-9]\d{0,6}$/.test(flags.line) ? Number(flags.line) : undefined;
  const p = plan(target, dir, realEnv, file, line, settings.terminal);
  if (!p) die(`${target} is not installed here`);
  if (flags["dry-run"]) return void console.log(JSON.stringify(p));
  spawn(p.program, p.args, { detached: true, stdio: "ignore" }).unref();
  writeOpenSettings(openSettingsFile(ROOT), { ...settings, lastUsed: target });
  console.log(`Opening ${w.key} in ${target}: ${dir}`);
}

/** The data behind the Open ▾ menu (spec §7.7). */
export function cmdOpenTargets(arg: string | undefined, flags: Record<string, string | boolean>): void {
  if (!arg) {
    // No session: what the Open-in settings page shows (spec §10.5).
    const s = readOpenSettings(openSettingsFile(ROOT));
    const targets = menu(realEnv, "/", s.terminal);
    const out = { default: defaultTarget(s, null, targets), perRepo: s.perRepo, lastUsed: s.lastUsed, targets, terminal: pickTerminal(s.terminal, realEnv), terminals: terminals(realEnv) };
    if (flags.json) return void console.log(JSON.stringify(out, null, 2));
    for (const e of targets) console.log(`  ${e.installed ? "•" : " "} ${e.target}${e.target === out.default ? "  (default)" : ""}${e.installed ? "" : "  not installed"}`);
    for (const [repo, t] of Object.entries(s.perRepo)) console.log(`  ${repo} → ${t}`);
    return;
  }
  const w = where(arg);
  const settings = readOpenSettings(openSettingsFile(ROOT));
  const entries = menu(realEnv, w.root, settings.terminal);
  const repo = githubRepo(w.remote);
  const pr = repo ? prsForHead(readPrCache(prCacheFile(ROOT)), repo, w.headSha)[0] ?? null : null;
  const out = {
    session: w.key,
    root: w.root,
    default: defaultTarget(settings, w.repo, entries),
    lastUsed: settings.lastUsed,
    targets: entries,
    // Only the app of the session's own tool. It opens the app: Claude Desktop
    // 4.29.0 takes no folder and cannot resume a CLI session (spike S9).
    agentApp: w.provider === "claude" ? { app: "claude-desktop", label: "Claude Desktop", note: "opens the app" } : w.provider === "codex" ? { app: "codex-desktop", label: "Codex", note: "opens the app" } : null,
    // Focus: a session in the user's own terminal. Attach: a session AS hosts (`host attach`).
    terminal: { focus: w.provider === "claude", attachTmux: TmuxHost.available() && !!new TmuxHost(ROOT).windowOf(w.key) },
    web: pr ? { pr: pr.url, checks: `${pr.url}/checks` } : null,
  };
  if (flags.json) return void console.log(JSON.stringify(out, null, 2));
  console.log(`${w.key} → ${w.root}`);
  for (const e of entries) console.log(`  ${e.installed ? "•" : " "} ${e.target}${e.target === out.default ? "  (default)" : ""}${e.target === out.lastUsed ? "  (last used)" : ""}${e.installed ? "" : "  not installed"}`);
  if (out.web) console.log(`  PR ${out.web.pr}`);
}

export function cmdOpenDefault(target: string | undefined, flags: Record<string, string | boolean>): void {
  if (!target || !TARGET_IDS.includes(target as TargetId)) die(`usage: agent-switch open-default ${TARGET_IDS.join("|")} [--repo DIR]`);
  const s = readOpenSettings(openSettingsFile(ROOT));
  if (typeof flags.repo === "string") s.perRepo[canonical(flags.repo)] = target as TargetId;
  else s.default = target as TargetId;
  writeOpenSettings(openSettingsFile(ROOT), s);
  console.log(typeof flags.repo === "string" ? `Default for ${canonical(flags.repo)}: ${target}.` : `Default: ${target}.`);
}

/** Which terminal app "Terminal" opens, and where a takeover's new window starts. */
export function cmdOpenTerminal(id: string | undefined): void {
  if (!id || !TERMINAL_IDS.includes(id as TerminalId)) die(`usage: agent-switch open-terminal ${TERMINAL_IDS.join("|")}`);
  const installed = terminals(realEnv).find((t) => t.id === id);
  if (!installed?.installed) die(`${id} is not installed here (installed: ${terminals(realEnv).filter((t) => t.installed).map((t) => t.id).join(", ") || "none"})`);
  const s = readOpenSettings(openSettingsFile(ROOT));
  writeOpenSettings(openSettingsFile(ROOT), { ...s, terminal: id as TerminalId });
  console.log(`Terminal: ${installed.name}.`);
}

export function cmdFocus(arg: string | undefined): void {
  const w = where(arg);
  if (w.provider !== "claude") die("focusing a terminal works for Claude sessions (their process is known)");
  const live = liveSessions(configDir("claude", w.account)).find((l) => l.sessionId === w.sessionId);
  if (!live) die(`${w.key} is not running`);
  try {
    const r = focusSession(live.pid);
    console.log(`Brought ${r.app} (${r.tty}) to the front.`);
  } catch (err) {
    if (err instanceof FocusFailed) die(err.fix ? `${err.message}. Fix: ${err.fix}` : err.message);
    throw err;
  }
}
