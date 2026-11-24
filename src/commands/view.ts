/**
 * `agent-switch view <session> chat|terminal` — the session bar's
 * `[Terminal | Chat]` switch (spec §6.2, road-to-agent-switch-v3-client
 * Phase 4). One conversation, one writer: to chat, the hosted window is parked
 * (its program replaced by a waiting notice) so the chat's bridge can resume
 * the conversation; to the terminal, the program comes back with `--resume`
 * once the bridge is gone. Only between turns, only for sessions hosted in
 * Agent Switch, only for Claude and Codex.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { configDir, die, readBinaryPath, ROOT } from "../profiles.js";
import { provider as providerOf } from "../providers.js";
import { alive as pidAlive, InputLeases } from "../host/lease.js";
import { TmuxHost, type HostedSession } from "../host/tmux-host.js";
import { turnInFlight } from "../telemetry.js";
import { listSessions } from "../sessions.js";

export class ViewRefused extends Error {}

/** Does `<configDir>/projects/<any>/<id>.jsonl` exist? No projects folder means no; any other read error counts as yes, so a resume is never dropped by mistake. */
export function hasClaudeTranscript(dir: string, id: string): boolean {
  const projects = path.join(dir, "projects");
  try {
    return fs.readdirSync(projects).some((p) => fs.existsSync(path.join(projects, p, `${id}.jsonl`)));
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "ENOENT";
  }
}

/** Providers whose terminal and chat share one conversation the bridge can resume. */
export const SHARED_CONVERSATION = new Set(["claude", "codex"]);

/** How the program comes back after the chat: resume the same conversation.
 *  A Claude session without one yet (no turn) starts again under its id instead. Pure. */
export function resumeArgs(provider: string, sessionId: string, hasConversation = true): string[] {
  if (provider === "codex") return ["resume", sessionId];
  return hasConversation ? ["--resume", sessionId] : [];
}

/** The parked window's program: this CLI, printing a notice and waiting. */
export function parkedArgv(key: string, cli = process.argv[1]): string[] {
  return [process.execPath, cli, "host", "parked", key];
}

export interface ViewDeps {
  host: Pick<TmuxHost, "list" | "park" | "respawn" | "unparked">;
  /** Is a turn running in the session right now? */
  turnRunning: (key: string) => boolean;
  /** Does a live writer other than the terminal (a chat's bridge) hold the session? */
  writer: (key: string) => string | null;
  bin: (provider: string) => string;
  configDir: (provider: string, account: string) => string;
  parked: (key: string) => string[];
  /** Has the session a conversation to resume (a transcript)? */
  hasConversation: (key: string) => boolean;
  /** Ask the chat's bridge holding `key` (only while it is still `writer`) to close and wait until it has gone. True when no writer holds it any more. */
  endChat?: (key: string, writer: string) => boolean;
  /** Hand a parked session over from a chat bridge this app lost track of (a reloaded window):
   *  it closes after any running turn and leaves the window parked. True when it has gone. */
  adoptChat?: (key: string, writer: string) => boolean;
}

function hosted(d: ViewDeps, key: string): HostedSession {
  const s = d.host.list().find((x) => x.key === key);
  if (!s) throw new ViewRefused("Chat needs a session hosted in Agent Switch");
  if (!SHARED_CONVERSATION.has(s.provider)) throw new ViewRefused(`${s.provider} sessions keep the view they started in`);
  return s;
}

/** Terminal → chat: park the window. The caller then starts the bridge. Already parked (the chat
 *  was the last view): a bridge still holding it from before is handed over, so a new one can start. */
export function toChat(d: ViewDeps, key: string): HostedSession {
  const s = hosted(d, key);
  if (s.parked) {
    const w = d.writer(key);
    if (!w) return s;
    if (!d.adoptChat?.(key, w)) throw new ViewRefused(`${key} is open in a chat elsewhere (${w}), or that chat is still in a turn — try again after it`);
    return hosted(d, key);
  }
  if (d.turnRunning(key)) throw new ViewRefused("a turn is running — switch after this turn");
  const w = d.writer(key);
  if (w) throw new ViewRefused(`${key} already has a writer (${w})`);
  return d.host.park(key, d.parked(key));
}

/** Chat → terminal: bring the program back, resuming the conversation. Idempotent.
 *  `takeOver` is the person's own switch: a chat bridge still holding the session (one a
 *  reloaded app window lost track of) is asked to close first; the bridge waits for a turn to end.
 *  `asHolder` is the bridge restoring its own window before it lets go of the lease. */
export function toTerminal(d: ViewDeps, key: string, opts: { takeOver?: boolean; asHolder?: string } = {}): HostedSession {
  let s = hosted(d, key);
  if (!s.parked) return s;
  const w = d.writer(key);
  if (w && w !== opts.asHolder) {
    if (!opts.takeOver || !d.endChat) throw new ViewRefused(`the chat still holds ${key} (${w}); close the chat first`);
    if (d.turnRunning(key)) throw new ViewRefused("a turn is running in the chat — switch after this turn");
    if (!d.endChat(key, w)) throw new ViewRefused(`the chat on ${key} (${w}) has not closed yet — a turn may still be running; it switches to the terminal when the chat ends`);
    // The bridge brings the terminal back itself when it ends.
    s = hosted(d, key);
    if (!s.parked) return s;
  }
  const back = d.host.respawn(key, { provider: s.provider, account: s.account, configDir: d.configDir(s.provider, s.account), cwd: s.cwd, bin: d.bin(s.provider), args: resumeArgs(s.provider, s.sessionId, d.hasConversation(key)) });
  d.host.unparked(back.key);
  return { ...back, parked: undefined };
}

export function realViewDeps(): ViewDeps {
  const host = new TmuxHost(ROOT);
  const leases = new InputLeases(ROOT);
  return {
    host,
    // Claude's transcript says whether a turn is open; Codex is checked by its bridge (app-server).
    turnRunning: (key) => {
      const [provider, account, id] = key.split("/");
      if (provider !== "claude" || !account || !id) return false;
      const row = listSessions(configDir("claude", account), 50).find((r) => r.sessionId === id);
      return !!row?.file && turnInFlight(row.file, Date.now(), 120_000);
    },
    writer: (key) => {
      const l = leases.read(key);
      return l && !leases.stale(l) ? `${l.holder.kind} ${l.holder.id}` : null;
    },
    bin: (p) => readBinaryPath(p as "claude" | "codex") ?? providerOf(p as "claude" | "codex").binary,
    configDir: (p, a) => configDir(p as "claude" | "codex", a),
    parked: (key) => parkedArgv(key),
    hasConversation: (key) => {
      const [provider, account, id] = key.split("/");
      if (provider !== "claude" || !account || !id) return true;
      return hasClaudeTranscript(configDir("claude", account), id);
    },
    endChat: (key, writer) => endBridge(leases, key, { expect: writer }),
    adoptChat: (key, writer) => endBridge(leases, key, { expect: writer, signal: (pid) => process.kill(pid, "SIGUSR2"), only: sameApp }),
  };
}

/** Is `pid` a bridge of the app that runs this CLI (its parent), or one whose app has gone (re-parented to init)? */
export function sameApp(pid: number, parentOf: (pid: number) => number | null = processParent): boolean {
  const p = parentOf(pid);
  return p !== null && (p === process.ppid || p === 1);
}

function processParent(pid: number): number | null {
  const r = spawnSync("ps", ["-o", "ppid=", "-p", String(pid)], { encoding: "utf8" });
  const n = Number(r.stdout?.trim());
  return r.status === 0 && Number.isInteger(n) && n > 0 ? n : null;
}

/** How long an explicit switch waits for a chat's bridge to close. */
export const END_CHAT_WAIT_MS = 10_000;

/** SIGTERM the bridge holding `key` (after any running turn it closes its agent, gives the window
 *  its program back and releases the lease), then wait for its process to end. Only a bridge is
 *  ever ended, and only the one that was checked (`expect`, as `writer` reports it). */
export function endBridge(leases: InputLeases, key: string, o: { expect?: string; waitMs?: number; signal?: (pid: number) => void; only?: (pid: number) => boolean } = {}): boolean {
  const { waitMs = END_CHAT_WAIT_MS, signal = (pid: number) => process.kill(pid, "SIGTERM") } = o;
  const l = leases.read(key);
  if (!l || leases.stale(l)) return true;
  if (!l.holder.id.startsWith("bridge:") || l.holder.pid === process.pid) return false;
  if (o.expect !== undefined && o.expect !== `${l.holder.kind} ${l.holder.id}`) return false;
  if (o.only && !o.only(l.holder.pid)) return false;
  try {
    signal(l.holder.pid);
  } catch {
    // gone already
  }
  const end = Date.now() + waitMs;
  while (pidAlive(l.holder.pid) && Date.now() < end) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  if (pidAlive(l.holder.pid)) return false;
  const now = leases.read(key);
  return !now || leases.stale(now);
}

/** After a chat's bridge ends: a parked hosted session gets its terminal back. Never throws. */
export function restoreAfterChat(key: string, deps?: ViewDeps, asHolder?: string): string | null {
  try {
    if (!deps && !TmuxHost.available()) return null;
    const d = deps ?? realViewDeps();
    const s = d.host.list().find((x) => x.key === key);
    if (!s?.parked) return null;
    return toTerminal(d, key, { asHolder }).key;
  } catch {
    return null;
  }
}

export function cmdView(arg: string | undefined, to: string | undefined, flags: Record<string, string | boolean>): void {
  if (!arg || (to !== "chat" && to !== "terminal")) die("usage: agent-switch view <session> chat|terminal [--json]");
  if (!TmuxHost.available()) die("Chat needs a session hosted in Agent Switch (hosting needs tmux)");
  try {
    const s = to === "chat" ? toChat(realViewDeps(), arg) : toTerminal(realViewDeps(), arg, { takeOver: true });
    if (flags.json) console.log(JSON.stringify({ ok: true, key: s.key, view: to }));
    else console.log(to === "chat" ? `${s.key} is open in the chat view; its window waits until the chat closes.` : `${s.key} is back in its terminal.`);
  } catch (err) {
    if (!(err instanceof ViewRefused)) throw err;
    if (flags.json) {
      console.log(JSON.stringify({ ok: false, error: err.message }));
      process.exitCode = 2;
      return;
    }
    die(err.message);
  }
}
