/**
 * `agent-switch view <session> chat|terminal` — the session bar's
 * `[Terminal | Chat]` switch (spec §6.2, road-to-agent-switch-v3-client
 * Phase 4). One conversation, one writer: to chat, the hosted window is parked
 * (its program replaced by a waiting notice) so the chat's bridge can resume
 * the conversation; to the terminal, the program comes back with `--resume`
 * once the bridge is gone. Only between turns, only for sessions hosted in
 * Agent Switch, only for Claude and Codex.
 */

import { configDir, die, readBinaryPath, ROOT } from "../profiles.js";
import { provider as providerOf } from "../providers.js";
import { InputLeases } from "../host/lease.js";
import { TmuxHost, type HostedSession } from "../host/tmux-host.js";
import { turnInFlight } from "../telemetry.js";
import { listSessions } from "../sessions.js";

export class ViewRefused extends Error {}

/** Providers whose terminal and chat share one conversation the bridge can resume. */
export const SHARED_CONVERSATION = new Set(["claude", "codex"]);

/** How the program comes back after the chat: resume the same conversation. Pure. */
export function resumeArgs(provider: string, sessionId: string): string[] {
  return provider === "codex" ? ["resume", sessionId] : ["--resume", sessionId];
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
}

function hosted(d: ViewDeps, key: string): HostedSession {
  const s = d.host.list().find((x) => x.key === key);
  if (!s) throw new ViewRefused("Chat needs a session hosted in Agent Switch");
  if (!SHARED_CONVERSATION.has(s.provider)) throw new ViewRefused(`${s.provider} sessions keep the view they started in`);
  return s;
}

/** Terminal → chat: park the window. The caller then starts the bridge. */
export function toChat(d: ViewDeps, key: string): HostedSession {
  const s = hosted(d, key);
  if (s.parked) return s;
  if (d.turnRunning(key)) throw new ViewRefused("a turn is running — switch after this turn");
  const w = d.writer(key);
  if (w) throw new ViewRefused(`${key} already has a writer (${w})`);
  return d.host.park(key, d.parked(key));
}

/** Chat → terminal: bring the program back, resuming the conversation. Idempotent. */
export function toTerminal(d: ViewDeps, key: string): HostedSession {
  const s = hosted(d, key);
  if (!s.parked) return s;
  const w = d.writer(key);
  if (w) throw new ViewRefused(`the chat still holds ${key} (${w}); close the chat first`);
  const back = d.host.respawn(key, { provider: s.provider, account: s.account, configDir: d.configDir(s.provider, s.account), cwd: s.cwd, bin: d.bin(s.provider), args: resumeArgs(s.provider, s.sessionId) });
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
  };
}

/** After a chat's bridge ends: a parked hosted session gets its terminal back. Never throws. */
export function restoreAfterChat(key: string, deps?: ViewDeps): string | null {
  try {
    if (!deps && !TmuxHost.available()) return null;
    const d = deps ?? realViewDeps();
    const s = d.host.list().find((x) => x.key === key);
    if (!s?.parked) return null;
    return toTerminal(d, key).key;
  } catch {
    return null;
  }
}

export function cmdView(arg: string | undefined, to: string | undefined, flags: Record<string, string | boolean>): void {
  if (!arg || (to !== "chat" && to !== "terminal")) die("usage: agent-switch view <session> chat|terminal [--json]");
  if (!TmuxHost.available()) die("Chat needs a session hosted in Agent Switch (hosting needs tmux)");
  try {
    const s = to === "chat" ? toChat(realViewDeps(), arg) : toTerminal(realViewDeps(), arg);
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
