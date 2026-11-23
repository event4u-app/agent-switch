/**
 * `agent-switch host start|list|end` — sessions that keep running when the
 * window closes (src/host/tmux-host.ts). Hosting is opt-in per start: a plain
 * `claude` keeps starting in the user's own terminal as before.
 */

import { sessionAgentConfigEnv } from "../agent-config-root.js";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";

import { openSettingsFile, readOpenSettings, realEnv } from "../open-in.js";
import { liveSessions } from "../api.js";
import { codexProfilesWithSession } from "../login-keepalive.js";
import { configDir, die, listProfiles, readBinaryPath, requireProfile, ROOT } from "../profiles.js";
import { provider, type ProviderId } from "../providers.js";
import { readRemote, remoteControlArgs } from "../remote.js";
import { adopt, AdoptRefused, withAdoptLock, type AdoptDeps } from "../host/adopt.js";
import { HostUnavailable, TmuxHost, hostingMode, type HostedSession } from "../host/tmux-host.js";
import { codexSessionMeta, listSessions, locateCodexSession, locateSession, readSessionHeader } from "../sessions.js";
import { stopBetweenTurns } from "./takeover.js";
import { turnInFlight } from "../telemetry.js";
import { commandPlan, terminalName } from "../terminals.js";
import { routedStart } from "./routing.js";
import { choiceArgs, newWorktree, removeWorktree, type MadeWorktree } from "../start-choice.js";
import { selfCommand, syncClaudeProfile } from "./shared.js";
import { hasClaudeTranscript, resumeArgs } from "./view.js";

const HOST_USAGE = "agent-switch host start [profile] [--provider P] [--cwd DIR] [--model M] [--effort E] [--worktree] [--remote-control] [--title T] | list [--json] | attach <session> [--new-window] | adopt <session> [--stop-source] [--force] [--json] | respawn <session> [--model M] [--effort E] | end <session> [--yes]";

const HOST_HELP = `usage: ${HOST_USAGE}

Sessions hosted in Agent Switch's own tmux server keep running when the window closes. Needs tmux.

  agent-switch host start [profile] [--provider P] [--cwd DIR]   start one; without a profile, on the account a plain start picks for the folder
      --model M --effort E    the model and thinking level, as for run
      --worktree              in a new git worktree of the folder (removed again when the start fails)
      --remote-control        Claude Remote Control for this session; --title T names it
  agent-switch host list [--json]              the hosted sessions
  agent-switch host attach <session>           join it in this terminal; detaching leaves it running
  agent-switch host attach <session> --new-window   join it in a new window of the terminal set with open-terminal (Warp cannot run a command, so Terminal opens instead)
  agent-switch host adopt <session> [--stop-source] [--force]   take over a Claude or Codex session from your own terminal, on the same account; one take-over per session at a time
      --stop-source           end a Claude source between turns first
      --force                 go past a running program that may be another session; never one that names this session
  agent-switch host respawn <session> [--model M] [--effort E]   restart it in place on another model or thinking level, between turns (Claude)
  agent-switch host end <session> [--yes]      stop it, after asking; its transcript stays`;

export async function cmdHost(providerId: ProviderId, sub: string | undefined, arg: string | undefined, flags: Record<string, string | boolean>): Promise<void> {
  if (flags.help === true || sub === "-h" || sub === "help") {
    console.log(HOST_HELP);
    return;
  }
  const action = sub ?? "list";
  if (action === "parked") {
    // The program of a hosted window while its conversation is open in the chat view.
    console.log(`\n  This session is open in the chat view of Agent Switch.\n  It comes back here when the chat closes, or switch with [Terminal] in the session bar.\n`);
    setInterval(() => {}, 1 << 30);
    return;
  }
  if (!["start", "list", "end", "attach", "respawn", "adopt"].includes(action)) die(`usage: ${HOST_USAGE}`);
  const mode = hostingMode(process.platform, TmuxHost.available());
  if (action === "list" && flags.json && mode === "ephemeral") {
    console.log(JSON.stringify({ mode, hosted: [], legacy: [] }));
    return;
  }
  if (mode === "ephemeral") {
    die(process.platform === "win32"
      ? "hosting needs tmux, which Windows does not have: a session started in the app there is ephemeral and ends when the app closes"
      : "hosting needs tmux (macOS: brew install tmux · Debian/Ubuntu: apt install tmux); without it a session started in the app is ephemeral");
  }
  const host = new TmuxHost(ROOT);
  try {
    if (action === "start") {
      // Antigravity is terminal-only: it runs hosted, but AS cannot read its sessions yet.
      if (providerId !== "claude" && providerId !== "codex" && providerId !== "antigravity") die(`hosting supports claude, codex and antigravity`);
      const asked = path.resolve(typeof flags.cwd === "string" ? flags.cwd : process.cwd());
      // No account named: the same routing, folder rules and guard as a plain start.
      const profile = arg ? requireProfile(providerId, arg, "host start") : routedStart(providerId, asked);
      const bin = readBinaryPath(providerId) ?? provider(providerId).binary;
      let choice: string[] = [];
      try {
        choice = choiceArgs(providerId, { ...(typeof flags.model === "string" ? { model: flags.model } : {}), ...(typeof flags.effort === "string" ? { effort: flags.effort } : {}) });
      } catch (e) {
        die((e as Error).message);
      }
      // R1: Claude Remote Control when asked for this session or on for the account (off by default).
      const args = [...remoteControlArgs(providerId, profile, flags["remote-control"] === true, typeof flags.title === "string" ? flags.title : path.basename(asked), readRemote()), ...choice];
      if (providerId === "claude") syncClaudeProfile(configDir(providerId, profile));
      // The account is routed by the folder asked for; the worktree is made last, and taken back when the start fails.
      let made: MadeWorktree | null = null;
      try {
        if (flags.worktree === true) made = newWorktree(asked, providerId);
      } catch (e) {
        die((e as Error).message);
      }
      const cwd = made?.cwd ?? asked;
      let s;
      try {
        s = host.start({ provider: providerId, account: profile, configDir: configDir(providerId, profile), cwd, bin, env: sessionAgentConfigEnv(providerId, profile), ...(args.length ? { args } : {}) }, selfCommand());
      } catch (e) {
        if (made) removeWorktree(made);
        throw e;
      }
      if (flags.json) console.log(JSON.stringify(s));
      else console.log(`Started ${s.key} in ${cwd}. It keeps running when you close the window; end it with: agent-switch host end ${s.key}`);
      return;
    }
    if (action === "attach") {
      if (!arg) die("usage: agent-switch host attach <session> [--new-window]");
      if (flags["new-window"]) {
        // From the app: the user's own terminal joins the same tmux session, so
        // typing there and in Agent Switch reaches the same agent.
        const cur = host.list().find((x) => x.key === arg);
        if (!cur) die(`no hosted session ${arg}`);
        const line = attachLine(selfCommand(), arg);
        const c = commandPlan(readOpenSettings(openSettingsFile(ROOT)).terminal, cur.cwd, line, realEnv);
        if (!c || spawnSync(c.plan.program, c.plan.args, { stdio: "ignore" }).status !== 0) die(`no terminal could be opened; run this in yours:\n  ${line}`);
        console.log(`Attached ${arg} in a new ${terminalName(c.id)} window. Closing that window leaves the session running.`);
        return;
      }
      // Detaching (or closing the terminal) removes only this view.
      const argv = host.view(arg, `cli${process.pid}`);
      const r = spawnSync(argv[0], argv.slice(1), { stdio: "inherit" });
      process.exitCode = r.status ?? 0;
      return;
    }
    if (action === "adopt") {
      // "Take over here": the session from the user's own terminal continues in
      // a hosted window on the same account (src/host/adopt.ts).
      if (!arg) die("usage: agent-switch host adopt <provider/account/session> [--stop-source] [--force] [--json]");
      let s: HostedSession;
      try {
        s = withAdoptLock(path.join(ROOT, "host", "adopt"), arg, () => adopt(adoptDeps(host), arg, { stopSource: flags["stop-source"] === true, force: flags.force === true }));
      } catch (e) {
        if (e instanceof AdoptRefused) die(e.message);
        throw e;
      }
      if (flags.json) console.log(JSON.stringify(s));
      else console.log(`${s.key} runs in Agent Switch now, in ${s.cwd}. Join it from a terminal with: agent-switch host attach ${s.key}`);
      return;
    }
    if (action === "respawn") {
      // Next-turn model and thinking (spike S8): restart the window on the same
      // session between turns. Typing /model or /effort would change the
      // account's defaults for every new session, so that is never done.
      const cur = arg ? host.list().find((x) => x.key === arg) : undefined;
      if (!cur) die("usage: agent-switch host respawn <session> [--model M] [--effort E]");
      if (cur.provider !== "claude") die("model and thinking changes are for hosted Claude sessions");
      const cfg = configDir("claude", cur.account);
      const rows = listSessions(cfg, 50);
      const row = rows.find((r) => r.sessionId === cur.sessionId);
      if (row?.file && !flags.force && turnInFlight(row.file, Date.now(), 15_000)) die(`a turn is running in ${cur.key}; the change applies from the next turn — try again when it ends, or pass --force`);
      // Before its first turn there is nothing to resume: the program starts again under its id.
      const args = [...resumeArgs("claude", cur.sessionId, hasClaudeTranscript(cfg, cur.sessionId)), ...(cur.remoteControl ? ["--remote-control", cur.remoteControl] : [])];
      if (typeof flags.model === "string") args.push("--model", flags.model);
      if (typeof flags.effort === "string") args.push("--effort", flags.effort);
      const moved = host.respawn(cur.key, { provider: "claude", account: cur.account, configDir: cfg, cwd: cur.cwd, bin: readBinaryPath("claude") ?? provider("claude").binary, args }, selfCommand());
      console.log(`Restarted ${moved.key}${flags.model ? ` on ${flags.model}` : ""}${flags.effort ? ` with ${flags.effort} thinking` : ""}; its next turn reads the history again.`);
      return;
    }
    if (action === "end") {
      if (!arg) die("usage: agent-switch host end <session> [--yes]");
      if (!host.list().some((s) => s.key === arg)) die(`no hosted session ${arg}`);
      if (!flags.yes && !(await confirm(`End ${arg}? The program in it stops; its transcript stays. [y/N] `))) {
        console.log("Not ended.");
        return;
      }
      host.end(arg);
      console.log(`Ended ${arg}.`);
      return;
    }
    const rows = host.list();
    const legacy = host.legacy();
    if (flags.json) {
      console.log(JSON.stringify({ mode, hosted: rows, legacy }));
      return;
    }
    if (rows.length === 0 && legacy.length === 0) console.log("No hosted sessions.");
    for (const r of rows) console.log(`${r.alive ? "*" : " "} ${r.key}  ${r.cwd}  since ${r.startedAt}`);
    for (const l of legacy) console.log(`  ${l.name}  (2.x tmux session of ${l.provider}/${l.profile}, read-only)`);
  } catch (err) {
    if (err instanceof HostUnavailable) die(err.message);
    throw err;
  }
}

/** The real world behind `adopt`: the accounts, transcripts and programs on this machine. */
function adoptDeps(host: TmuxHost): AdoptDeps {
  return {
    accounts: (p) => listProfiles(p),
    hosted: () => new Set(host.list().filter((h) => h.alive).map((h) => h.key)),
    locate: (p, account, id) => {
      const cfg = configDir(p, account);
      if (p === "claude") {
        const loc = locateSession(cfg, id);
        return loc ? { cwd: readSessionHeader(loc.jsonl).cwd } : null;
      }
      const loc = locateCodexSession(cfg, id);
      return loc ? { cwd: codexSessionMeta(loc.rollout)?.cwd ?? null } : null;
    },
    folderExists: (dir) => fs.existsSync(dir),
    liveClaude: (account) => liveSessions(configDir("claude", account)),
    codexRunning: (account) => codexProfilesWithSession([account]).has(account),
    stop: stopBetweenTurns,
    start: (o) => {
      const cfg = configDir(o.provider, o.account);
      if (o.provider === "claude") syncClaudeProfile(cfg);
      return host.start({ provider: o.provider, account: o.account, configDir: cfg, cwd: o.cwd, bin: readBinaryPath(o.provider) ?? provider(o.provider).binary, env: sessionAgentConfigEnv(o.provider, o.account), sessionId: o.sessionId, args: o.args }, selfCommand());
    },
  };
}

/** The line a terminal runs to join hosted session `key` through `prefix` (this CLI). */
export function attachLine(prefix: string, key: string): string {
  return `${prefix} host attach '${key.replace(/'/g, "'\\''")}'`;
}

/** Ending is its own, confirmed action. Without a terminal to ask on, it needs --yes. */
async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) die("ending a hosted session needs --yes when there is no terminal to ask on");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer: string = await new Promise((resolve) => rl.question(question, resolve));
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}
