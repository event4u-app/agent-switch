/**
 * `agent-switch launch <claude|codex> --config-dir DIR -- <args>`: what the shell
 * wrapper runs after `dir --guard` picked the account. An interactive start runs
 * in Agent Switch's host and this terminal becomes one view of it, so the app can
 * type into the same session (road-to-terminal-sessions-in-sync). Anything else
 * exits {@link LAUNCH_PLAIN_EXIT} and the wrapper starts the program as before.
 */

import { spawn } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { sessionAgentConfigEnv } from "../agent-config-root.js";
import { HostUnavailable, TmuxHost, type HostedSession, type StartOptions } from "../host/tmux-host.js";
import { configDir, listProfiles, readBinaryPath, readTerminalSync, ROOT } from "../profiles.js";
import { provider as providerOf } from "../providers.js";
import { readRemote, remoteControlArgs } from "../remote.js";
import { encodeProjectDir, listSessions, locateSession } from "../sessions.js";
import { LAUNCH_PLAIN_EXIT, terminalStartPlan, type StartContext, type SyncProvider } from "../terminal-sync.js";

export { LAUNCH_PLAIN_EXIT };
import { selfCommand, syncClaudeProfile } from "./shared.js";


/** Never carried from the outer shell: the outer terminal's own, and what the host sets per window. */
const NOT_CARRIED = ["TMUX", "TMUX_PANE", "TERM", "TERM_PROGRAM", "TERM_PROGRAM_VERSION", "TERM_SESSION_ID", "ITERM_SESSION_ID", "ITERM_PROFILE", "WINDOWID", "SHLVL", "PWD", "OLDPWD", "COLUMNS", "LINES", "AGENT_SWITCH_HOST_PANE", "CLAUDE_CONFIG_DIR", "CODEX_HOME"];

export interface LaunchHost {
  start(o: StartOptions): HostedSession;
  view(key: string, viewerId: string): string[];
  paneState(key: string): { dead: boolean; status: number | null } | null;
  closeView(viewerId: string): void;
  end(key: string): void;
}

export interface LaunchDeps {
  ctx: StartContext;
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** The account whose config dir `dir --guard` printed; null for one Agent Switch does not manage. */
  accountOfDir(provider: SyncProvider, dir: string): string | null;
  /** The account whose config holds this session's transcript. */
  accountHolding(provider: SyncProvider, sessionId: string): string | null;
  /** The folder's newest session on that account (`-c`). */
  newestInFolder(provider: SyncProvider, account: string, cwd: string): string | null;
  configDir(provider: SyncProvider, account: string): string;
  bin(provider: SyncProvider): string;
  /** Arguments the account always starts with (Remote Control). */
  extraArgs(provider: SyncProvider, account: string, cwd: string): string[];
  /** Environment the host sets for the window (agent-config's home). */
  extraEnv(provider: SyncProvider, account: string): Record<string, string>;
  envDir: string;
  host: LaunchHost;
  /** Join the view in this terminal. When `gone()` says the program ended, `close()` ends the view so the terminal returns. */
  attach(argv: string[], gone: () => boolean, close: () => void): Promise<"ended" | "detached">;
  log(message: string): void;
}

/** `export NAME='value'` lines for sh, one per variable a shell can name. Pure. */
export function envScript(env: NodeJS.ProcessEnv, skip: ReadonlySet<string>): string {
  let out = "";
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined || k === "_" || skip.has(k) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) continue;
    out += `export ${k}='${v.replace(/'/g, "'\\''")}'\n`;
  }
  return out;
}

export async function launch(provider: SyncProvider, dir: string, argv: readonly string[], d: LaunchDeps): Promise<number> {
  const plan = terminalStartPlan(provider, argv, d.ctx);
  if (plan.kind === "plain") return LAUNCH_PLAIN_EXIT;
  const routed = d.accountOfDir(provider, dir);
  if (!routed) return LAUNCH_PLAIN_EXIT;
  // A resume lands on the account that holds the transcript, whatever the folder routes to.
  const account = (plan.sessionId && d.accountHolding(provider, plan.sessionId)) || routed;
  let sessionId = plan.sessionId;
  let args = plan.args;
  if (plan.continue) {
    const newest = d.newestInFolder(provider, account, d.cwd);
    if (newest) {
      sessionId = newest;
      args = ["--resume", newest, ...args];
    }
  }
  const extraEnv = d.extraEnv(provider, account);
  fs.mkdirSync(d.envDir, { recursive: true, mode: 0o700 });
  const envFile = path.join(d.envDir, `${crypto.randomUUID()}.sh`);
  fs.writeFileSync(envFile, envScript(d.env, new Set([...NOT_CARRIED, ...Object.keys(extraEnv)])), { mode: 0o600 });
  let s: HostedSession;
  try {
    s = d.host.start({
      provider,
      account,
      configDir: d.configDir(provider, account),
      cwd: d.cwd,
      bin: d.bin(provider),
      args: [...(args.includes("--remote-control") ? [] : d.extraArgs(provider, account, d.cwd)), ...args],
      env: extraEnv,
      envFile,
      ...(sessionId ? { sessionId } : {}),
    });
  } catch (e) {
    fs.rmSync(envFile, { force: true });
    d.log(`agent-switch: could not start it in Agent Switch (${(e as Error).message}); starting it in this terminal only.`);
    return LAUNCH_PLAIN_EXIT;
  }
  const viewer = `term${crypto.randomBytes(4).toString("hex")}`;
  let how: "ended" | "detached";
  try {
    how = await d.attach(d.host.view(s.key, viewer), () => d.host.paneState(s.key)?.dead !== false, () => d.host.closeView(viewer));
  } finally {
    // The window removes it as soon as it starts; this covers a window that never did.
    fs.rmSync(envFile, { force: true });
  }
  const state = d.host.paneState(s.key);
  if (how === "ended" || !state || state.dead) {
    d.host.closeView(viewer);
    d.host.end(s.key);
    return state?.status ?? 0;
  }
  d.log(`agent-switch: ${s.key} keeps running in Agent Switch. Back to it here: agent-switch host attach ${s.key}`);
  return 0;
}

/** The real machine behind {@link launch}. */
export function realLaunchDeps(): LaunchDeps {
  const host = new TmuxHost(ROOT);
  return {
    ctx: {
      enabled: readTerminalSync(),
      platform: process.platform,
      tmux: TmuxHost.available(),
      stdinTty: !!process.stdin.isTTY,
      stdoutTty: !!process.stdout.isTTY,
      insideHost: !!process.env.AGENT_SWITCH_HOST_PANE,
    },
    cwd: process.cwd(),
    env: process.env,
    accountOfDir: (p, dir) => listProfiles(p).find((n) => path.resolve(configDir(p, n)) === path.resolve(dir)) ?? null,
    accountHolding: (p, id) => (p === "claude" ? listProfiles(p).find((n) => locateSession(configDir(p, n), id) !== null) ?? null : null),
    newestInFolder: (p, account, cwd) => {
      if (p !== "claude") return null;
      const dirName = encodeProjectDir(cwd);
      return listSessions(configDir(p, account), 200).find((r) => r.projectDir === dirName)?.sessionId ?? null;
    },
    configDir: (p, a) => configDir(p, a),
    bin: (p) => readBinaryPath(p) ?? providerOf(p).binary,
    extraArgs: (p, a, cwd) => remoteControlArgs(p, a, false, path.basename(cwd), readRemote()),
    extraEnv: (p, a) => sessionAgentConfigEnv(p, a),
    envDir: path.join(ROOT, "host", "env"),
    host: {
      start: (o) => {
        if (o.provider === "claude") syncClaudeProfile(o.configDir);
        return host.start(o, selfCommand());
      },
      view: (key, viewer) => host.view(key, viewer),
      paneState: (key) => host.paneState(key),
      closeView: (viewer) => host.closeView(viewer),
      end: (key) => void host.end(key),
    },
    attach: (argv, gone, close) =>
      new Promise((resolve) => {
        // The view runs in this terminal; tmux refuses to nest inside the user's own tmux unless TMUX is unset.
        const env = { ...process.env };
        delete env.TMUX;
        const child = spawn(argv[0], argv.slice(1), { stdio: "inherit", env });
        let ended = false;
        const tick = setInterval(() => {
          if (!gone()) return;
          ended = true;
          clearInterval(tick);
          // Closing the view lets tmux restore this terminal and exit on its own.
          close();
        }, 300);
        child.on("exit", () => {
          clearInterval(tick);
          resolve(ended || gone() ? "ended" : "detached");
        });
      }),
    log: (m) => console.error(m),
  };
}

/** `agent-switch launch <provider> --config-dir DIR -- <args…>` (the shell wrapper's call). */
export async function cmdLaunch(rest: readonly string[]): Promise<void> {
  const sep = rest.indexOf("--");
  const own = sep >= 0 ? rest.slice(0, sep) : [...rest];
  const argv = sep >= 0 ? rest.slice(sep + 1) : [];
  const provider = own[0];
  const at = own.indexOf("--config-dir");
  const dir = at >= 0 ? own[at + 1] : undefined;
  if ((provider !== "claude" && provider !== "codex") || !dir) {
    console.error("usage: agent-switch launch <claude|codex> --config-dir DIR -- <args…>");
    process.exit(LAUNCH_PLAIN_EXIT);
  }
  let code: number;
  try {
    code = await launch(provider, dir, argv, realLaunchDeps());
  } catch (e) {
    if (!(e instanceof HostUnavailable)) console.error(`agent-switch: ${(e as Error).message}; starting it in this terminal only.`);
    code = LAUNCH_PLAIN_EXIT;
  }
  process.exit(code);
}
