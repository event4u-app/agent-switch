/**
 * `agent-switch host start|list|end` — sessions that keep running when the
 * window closes (src/host/tmux-host.ts). Hosting is opt-in per start: a plain
 * `claude` keeps starting in the user's own terminal as before.
 */

import { spawnSync } from "node:child_process";
import * as path from "node:path";
import * as readline from "node:readline";

import { appendPick } from "../picks.js";
import { configDir, die, readBinaryPath, requireProfile, ROOT } from "../profiles.js";
import { provider, type ProviderId } from "../providers.js";
import { HostUnavailable, TmuxHost, hostingMode } from "../host/tmux-host.js";
import { listSessions } from "../sessions.js";
import { turnInFlight } from "../telemetry.js";
import { resolveDir } from "./routing.js";

export async function cmdHost(providerId: ProviderId, sub: string | undefined, arg: string | undefined, flags: Record<string, string | boolean>): Promise<void> {
  const action = sub ?? "list";
  if (!["start", "list", "end", "attach", "respawn"].includes(action)) die("usage: agent-switch host start [profile] [--provider P] [--cwd DIR] | list | attach <session> | respawn <session> [--model M] [--effort E] | end <session> [--yes]");
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
      const cwd = path.resolve(typeof flags.cwd === "string" ? flags.cwd : process.cwd());
      // No account named: the same routing, folder rules and guard as a plain start.
      const profile = arg ? requireProfile(providerId, arg, "host start") : routed(providerId, cwd);
      const bin = readBinaryPath(providerId) ?? provider(providerId).binary;
      const s = host.start({ provider: providerId, account: profile, configDir: configDir(providerId, profile), cwd, bin }, hookCommandPrefix());
      if (flags.json) console.log(JSON.stringify(s));
      else console.log(`Started ${s.key} in ${cwd}. It keeps running when you close the window; end it with: agent-switch host end ${s.key}`);
      return;
    }
    if (action === "attach") {
      if (!arg) die("usage: agent-switch host attach <session>");
      // Detaching (or closing the terminal) removes only this view.
      const argv = host.view(arg, `cli${process.pid}`);
      const r = spawnSync(argv[0], argv.slice(1), { stdio: "inherit" });
      process.exitCode = r.status ?? 0;
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
      const args = ["--resume", cur.sessionId];
      if (typeof flags.model === "string") args.push("--model", flags.model);
      if (typeof flags.effort === "string") args.push("--effort", flags.effort);
      const moved = host.respawn(cur.key, { provider: "claude", account: cur.account, configDir: cfg, cwd: cur.cwd, bin: readBinaryPath("claude") ?? provider("claude").binary, args }, hookCommandPrefix());
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

/** The hook command must reach this very CLI, wherever it is installed; the
 *  hooks run it through a shell, so each part is single-quoted. */
function hookCommandPrefix(): string {
  const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  return process.argv[1] ? `${q(process.execPath)} ${q(process.argv[1])}` : "agent-switch";
}

function routed(providerId: ProviderId, cwd: string): string {
  const r = resolveDir(providerId, false, cwd);
  appendPick({ provider: providerId, chosen: r.name ? `${providerId}/${r.name}` : null, why: r.why, blocked: r.blocked, note: r.note });
  if (r.blocked) die(`not starting here — ${r.blocked}`);
  if (!r.name) die(`no ${providerId} account to start on`);
  if (r.note) console.error(`agent-switch: ${r.note}.`);
  return r.name;
}

/** Ending is its own, confirmed action. Without a terminal to ask on, it needs --yes. */
async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) die("ending a hosted session needs --yes when there is no terminal to ask on");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer: string = await new Promise((resolve) => rl.question(question, resolve));
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}
