/**
 * The v3 session host on tmux (ADR-006; spike S5 in
 * agents/evidence/v3-phase0-spikes-2026-11.md).
 *
 * - One private tmux server per user: `tmux -L as-<uid> -f /dev/null`. The
 *   user's own tmux server and tmux.conf are never touched.
 * - Every hosted session is one window of the session `host`, so any number of
 *   sessions can run on the same account.
 * - Programs start by argv (`new-window … -- <bin> <args…>`): nothing is ever
 *   typed into a shell.
 * - Claude starts with a session id chosen here (`--session-id`), so AS knows
 *   the id before the first hook fires, and with AS's hooks added through
 *   `--settings` (S3: added next to the user's own, never replacing them).
 * - The registry (`<root>/host/sessions.json`, 0600) and the tmux server both
 *   outlive the app; a new Host instance finds every session again.
 * - Sessions in the 2.x per-profile names (`asw-<provider>-<profile>` on the
 *   user's default server, src/tmux.ts) are listed read-only for one release.
 */

import { spawnSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { buildHookEntry, HOOK_EVENTS, relayPath } from "../hooks.js";
import { readTmuxRegistry, type TmuxRegistry } from "../tmux.js";

export const HOST_SESSION = "host";

export interface HostedSession {
  /** ADR-007 session key: provider/account/sessionId. */
  key: string;
  provider: string;
  account: string;
  sessionId: string;
  /** tmux window id (`@12`), stable for the window's lifetime. */
  window: string;
  cwd: string;
  startedAt: string;
  /** The conversation is open in the chat view; the window shows a notice instead of the program. */
  parked?: boolean;
  /** Started with Claude Remote Control under this name (v3.2 R1); a respawn keeps it. */
  remoteControl?: string;
}

export interface HostedRow extends HostedSession {
  /** The program in the window has exited (pane dead) or the window is gone. */
  alive: boolean;
}

export interface LegacyRow {
  name: string;
  provider: string;
  profile: string;
  legacy: true;
}

export interface StartOptions {
  provider: "claude" | "codex" | string;
  account: string;
  /** The account's config dir: becomes CLAUDE_CONFIG_DIR / CODEX_HOME. */
  configDir: string;
  cwd: string;
  /** The provider binary; tests pass a stub. */
  bin: string;
  /** Extra argv after the ones the host adds (e.g. `--model`, `--resume`). */
  args?: string[];
  /** Extra environment (e.g. the lineage contract's AGENT_SWITCH_PARENT_*). */
  env?: Record<string, string>;
  /** Claude only: a session id to use instead of a fresh one. */
  sessionId?: string;
}

// Antigravity reads its account from HOME (src/providers.ts).
const ENV_FOR: Record<string, string> = { claude: "CLAUDE_CONFIG_DIR", codex: "CODEX_HOME", antigravity: "HOME" };

export class HostUnavailable extends Error {}

/**
 * What "Host in Agent Switch" can promise on this machine. `persistent`: tmux
 * keeps the session when the window closes. `ephemeral`: no tmux (Windows, until
 * a native host exists) — a session started in the app lives in the app's own
 * terminal and ends with it, and every surface must say so. Pure.
 */
export function hostingMode(platform: NodeJS.Platform, tmuxPresent: boolean): "persistent" | "ephemeral" {
  return platform !== "win32" && tmuxPresent ? "persistent" : "ephemeral";
}

export class TmuxHost {
  readonly socket: string;
  private readonly registryFile: string;
  readonly settingsFile: string;

  constructor(readonly root: string, opts: { socket?: string; tmux?: string } = {}) {
    // AGENT_SWITCH_HOST_SOCKET: tests and side-by-side installs use their own server.
    this.socket = opts.socket ?? process.env.AGENT_SWITCH_HOST_SOCKET ?? `as-${typeof process.getuid === "function" ? process.getuid() : "user"}`;
    this.tmuxBin = opts.tmux ?? "tmux";
    this.registryFile = path.join(root, "host", "sessions.json");
    this.settingsFile = path.join(root, "host", "hooks-settings.json");
  }

  private readonly tmuxBin: string;

  private tmux(args: string[]): { ok: boolean; out: string; err: string } {
    const r = spawnSync(this.tmuxBin, ["-L", this.socket, "-f", "/dev/null", ...args], { encoding: "utf8" });
    if (r.error) throw new HostUnavailable(`tmux is not available (${(r.error as NodeJS.ErrnoException).code ?? r.error.message})`);
    return { ok: r.status === 0, out: r.stdout ?? "", err: (r.stderr ?? "").trim() };
  }

  static available(tmux = "tmux"): boolean {
    if (process.platform === "win32") return false;
    return spawnSync(tmux, ["-V"], { stdio: "ignore" }).status === 0;
  }

  private readRegistry(): Record<string, HostedSession> {
    try {
      const o = JSON.parse(fs.readFileSync(this.registryFile, "utf8"));
      return o && typeof o === "object" ? o : {};
    } catch {
      return {};
    }
  }

  private writeRegistry(reg: Record<string, HostedSession>): void {
    fs.mkdirSync(path.dirname(this.registryFile), { recursive: true, mode: 0o700 });
    const tmp = `${this.registryFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(reg, null, 2) + "\n", { mode: 0o600 });
    fs.renameSync(tmp, this.registryFile);
  }

  /** The `--settings` file that carries AS's hooks into hosted Claude sessions. */
  ensureHookSettings(bin = "agent-switch"): string {
    const hooks = Object.fromEntries(HOOK_EVENTS.map((ev) => [ev, [buildHookEntry(bin, relayPath(this.root))]]));
    fs.mkdirSync(path.dirname(this.settingsFile), { recursive: true, mode: 0o700 });
    fs.writeFileSync(this.settingsFile, JSON.stringify({ hooks }, null, 2) + "\n", { mode: 0o600 });
    return this.settingsFile;
  }

  /** `-e NAME=value` pairs for a window: the account's config dir, the
   *  session's own key as AGENT_SWITCH_HOST_PANE (so any provider's process can
   *  tell it runs in an AS-hosted window), and the caller's extras. Pure. */
  static envArgs(o: Pick<StartOptions, "provider" | "configDir" | "env">, key: string): string[] {
    const envVar = ENV_FOR[o.provider];
    const env: Record<string, string> = { ...(envVar ? { [envVar]: o.configDir } : {}), AGENT_SWITCH_HOST_PANE: key, ...(o.env ?? {}) };
    for (const k of Object.keys(env)) if (!/^[A-Z_][A-Z0-9_]*$/.test(k)) throw new Error(`bad env name ${k}`);
    return Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  }

  /** The argv the window runs. Pure. */
  static programArgv(o: StartOptions, sessionId: string, settingsFile: string | null): string[] {
    const argv = [o.bin];
    if (o.provider === "claude") {
      const resuming = (o.args ?? []).includes("--resume");
      if (!resuming) argv.push("--session-id", sessionId);
      if (settingsFile) argv.push("--settings", settingsFile);
    }
    return [...argv, ...(o.args ?? [])];
  }

  start(o: StartOptions, hookBin = "agent-switch"): HostedSession {
    if (!/^[a-z][a-z0-9-]*$/.test(o.provider)) throw new Error(`bad provider ${o.provider}`);
    if (!o.account || o.account.includes("/")) throw new Error(`bad account ${o.account}`);
    if (o.sessionId !== undefined && !/^[0-9a-f-]{8,64}$/i.test(o.sessionId)) throw new Error("bad session id");
    const sessionId = o.sessionId ?? crypto.randomUUID();
    const key = `${o.provider}/${o.account}/${sessionId}`;
    const envArgs = TmuxHost.envArgs(o, key);
    const settings = o.provider === "claude" ? this.ensureHookSettings(hookBin) : null;
    const argv = TmuxHost.programArgv(o, sessionId, settings);
    const name = `${o.account}:${sessionId.slice(0, 8)}`;
    const exists = this.tmux(["has-session", "-t", `=${HOST_SESSION}`]).ok;
    const r = exists
      ? this.tmux(["new-window", "-d", "-P", "-F", "#{window_id}", "-t", `=${HOST_SESSION}:`, "-n", name, "-c", o.cwd, ...envArgs, "--", ...argv])
      : this.tmux(["new-session", "-d", "-P", "-F", "#{window_id}", "-s", HOST_SESSION, "-n", name, "-x", "200", "-y", "50", "-c", o.cwd, ...envArgs, "--", ...argv]);
    if (!r.ok) throw new Error(`tmux could not start the session: ${r.err}`);
    // Keep a finished program's window, so its last screen can still be read.
    this.tmux(["set-option", "-w", "-t", r.out.trim(), "remain-on-exit", "on"]);
    const hosted: HostedSession = {
      key,
      provider: o.provider,
      account: o.account,
      sessionId,
      window: r.out.trim(),
      cwd: o.cwd,
      startedAt: new Date().toISOString(),
      ...(o.args?.includes("--remote-control") ? { remoteControl: o.args[o.args.indexOf("--remote-control") + 1] } : {}),
    };
    const reg = this.readRegistry();
    reg[hosted.key] = hosted;
    this.writeRegistry(reg);
    return hosted;
  }

  /** Every hosted session the registry knows, with whether its window still runs. */
  list(): HostedRow[] {
    const reg = this.readRegistry();
    const live = new Map<string, boolean>();
    const r = this.tmux(["list-windows", "-t", `=${HOST_SESSION}`, "-F", "#{window_id} #{pane_dead}"]);
    if (r.ok) for (const line of r.out.split("\n").filter(Boolean)) {
      const [id, dead] = line.split(" ");
      live.set(id, dead !== "1");
    }
    return Object.values(reg).map((s) => ({ ...s, alive: live.get(s.window) ?? false }));
  }

  /** 2.x managed sessions on the user's default server, read-only. */
  legacy(registry: TmuxRegistry = readTmuxRegistry()): LegacyRow[] {
    return Object.entries(registry).map(([name, s]) => ({ name, provider: s.provider, profile: s.profile, legacy: true as const }));
  }

  /** The visible text of a hosted session's window. */
  capture(key: string, lines = 50): string | null {
    const s = this.readRegistry()[key];
    if (!s) return null;
    const r = this.tmux(["capture-pane", "-p", "-J", "-t", s.window, "-S", `-${Math.max(1, Math.min(lines, 5000))}`]);
    return r.ok ? r.out : null;
  }

  /**
   * Replace the program in a hosted session's window, keeping the window: the
   * in-place takeover (another account) and a next-turn model change both use
   * it, between turns. The session keeps its id; its key follows the account.
   */
  respawn(key: string, o: StartOptions, hookBin = "agent-switch"): HostedSession {
    const reg = this.readRegistry();
    const cur = reg[key];
    if (!cur) throw new Error(`no hosted session ${key}`);
    if (!o.account || o.account.includes("/")) throw new Error(`bad account ${o.account}`);
    const nextKey = `${cur.provider}/${o.account}/${cur.sessionId}`;
    const settings = cur.provider === "claude" ? this.ensureHookSettings(hookBin) : null;
    const argv = TmuxHost.programArgv({ ...o, provider: cur.provider }, cur.sessionId, settings);
    const r = this.tmux(["respawn-pane", "-k", "-t", cur.window, "-c", o.cwd, ...TmuxHost.envArgs({ ...o, provider: cur.provider }, nextKey), "--", ...argv]);
    if (!r.ok) throw new Error(`tmux could not restart the session: ${r.err}`);
    const next: HostedSession = { ...cur, key: nextKey, account: o.account, cwd: o.cwd };
    delete reg[key];
    reg[nextKey] = next;
    this.writeRegistry(reg);
    return next;
  }

  /**
   * Park a hosted session for the chat view (road-to-agent-switch-v3-client
   * Phase 4): the program in its window is replaced by `argv` (a notice that
   * waits), so the chat's bridge is the conversation's only writer. The window,
   * the key and the registry entry stay; `respawn` brings the program back.
   */
  park(key: string, argv: string[]): HostedSession {
    const reg = this.readRegistry();
    const cur = reg[key];
    if (!cur) throw new Error(`no hosted session ${key}`);
    const r = this.tmux(["respawn-pane", "-k", "-t", cur.window, "-c", cur.cwd, "-e", `AGENT_SWITCH_HOST_PANE=${key}`, "--", ...argv]);
    if (!r.ok) throw new Error(`tmux could not park the session: ${r.err}`);
    reg[key] = { ...cur, parked: true };
    this.writeRegistry(reg);
    return reg[key];
  }

  /** Mark a hosted session as no longer parked (after `respawn` restored its program). */
  unparked(key: string): void {
    const reg = this.readRegistry();
    if (!reg[key]) return;
    delete reg[key].parked;
    this.writeRegistry(reg);
  }

  /**
   * A view of one hosted session for one viewer: a session linked to `host`
   * (so each viewer can show its own window) that tmux destroys when the viewer
   * detaches. Closing a view never ends the hosted session. Returns the argv
   * that attaches a terminal to it.
   */
  view(key: string, viewerId: string): string[] {
    const s = this.readRegistry()[key];
    if (!s) throw new Error(`no hosted session ${key}`);
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(viewerId)) throw new Error("bad viewer id");
    const name = `view-${viewerId}`;
    if (!this.tmux(["has-session", "-t", `=${name}`]).ok) {
      const r = this.tmux(["new-session", "-d", "-s", name, "-t", `=${HOST_SESSION}`]);
      if (!r.ok) throw new Error(`tmux could not open a view: ${r.err}`);
      this.tmux(["set-option", "-t", `=${name}`, "destroy-unattached", "on"]);
    }
    this.tmux(["select-window", "-t", `=${name}:${s.window}`]);
    return [this.tmuxBin, "-L", this.socket, "-f", "/dev/null", "attach-session", "-t", `=${name}`];
  }

  /** End a hosted session: kill its window and forget it. Explicit, never a side effect of closing a view. */
  end(key: string): boolean {
    const reg = this.readRegistry();
    const s = reg[key];
    if (!s) return false;
    this.tmux(["kill-window", "-t", s.window]);
    delete reg[key];
    this.writeRegistry(reg);
    return true;
  }

  /** Stop the whole private server (tests, uninstall). */
  killServer(): void {
    this.tmux(["kill-server"]);
  }

  /** For callers that need the raw window target (the input lease). */
  windowOf(key: string): string | null {
    return this.readRegistry()[key]?.window ?? null;
  }

  /** Exposed for the lease: run one tmux command on the private server. */
  run(args: string[]): { ok: boolean; out: string; err: string } {
    return this.tmux(args);
  }
}
