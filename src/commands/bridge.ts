/**
 * `agent-switch bridge <session> [--mode M] [--model M]` and
 * `agent-switch bridge --new [profile] [--provider P] --cwd DIR` — the chat
 * view's connection to one session (ADR-009). JSON lines both ways: commands on
 * stdin, `{event}` / `{bridge}` lines on stdout.
 *
 * `agent-switch timeline <session> [--json] [--limit N] [--before N]` — the same
 * session's history, read-only (ADR-010).
 */

import * as path from "node:path";
import * as readline from "node:readline";

import { ClaudeBridge, PERMISSION_MODES, type BridgeCommand, type BridgeOutput, type PermissionMode } from "../bridge/claude-bridge.js";
import { AppServer, CodexBridge } from "../bridge/codex-bridge.js";
import { liveSessions } from "../api.js";
import { eventFile, lastHookCwd, readEvents } from "../hooks.js";
import { InputLeases, LeaseHeld, type Holder } from "../host/lease.js";
import { configDir, die, readBinaryPath, requireProfile, ROOT } from "../profiles.js";
import { provider as providerOf, type ProviderId } from "../providers.js";
import { readSessionHeader } from "../sessions.js";
import { readClaudeTranscript } from "../timeline/claude.js";
import { fromCodexThread } from "../timeline/codex.js";
import type { AsEvent } from "../timeline/events.js";
import { resolveSession } from "./library.js";
import { resolveDir } from "./routing.js";

export const LEASE_RENEW_MS = 5_000;
const DEFAULT_PAGE = 200;

export interface Target {
  key: string;
  provider: ProviderId;
  account: string;
  sessionId: string | null;
  cwd: string;
  transcript: string | null;
}

/** A session id or key → where it lives and runs. */
export function target(arg: string): Target {
  const s = resolveSession(arg);
  if (!s) die(`no Claude or Codex session ${arg}`);
  const [provider, account, sessionId] = s.key.split("/") as [ProviderId, string, string];
  const events = provider === "claude" ? readEvents(eventFile(ROOT, provider, account)) : [];
  const cwd = lastHookCwd(events, sessionId) ?? readSessionHeader(s.files.transcript).cwd;
  if (!cwd) die(`${s.key} names no folder`);
  return { key: s.key, provider, account, sessionId, cwd, transcript: s.files.transcript };
}

/** Events of one page, newest last: `limit` events ending before index `before`. Pure. */
export function page(events: readonly AsEvent[], limit = DEFAULT_PAGE, before?: number): { events: AsEvent[]; from: number; total: number } {
  const end = Math.max(0, Math.min(before ?? events.length, events.length));
  const from = Math.max(0, end - limit);
  return { events: events.slice(from, end), from, total: events.length };
}

async function codexHistory(t: Target): Promise<AsEvent[]> {
  const server = AppServer.spawn(readBinaryPath("codex") ?? providerOf("codex").binary, configDir("codex", t.account));
  try {
    await server.initialize();
    const r = await server.call("thread/read", { threadId: t.sessionId, includeTurns: true });
    return fromCodexThread(r);
  } finally {
    server.close();
  }
}

export async function cmdTimeline(arg: string | undefined, flags: Record<string, string | boolean>): Promise<void> {
  if (!arg) die("usage: agent-switch timeline <session> [--json] [--limit N] [--before N]");
  const t = target(arg);
  let events: AsEvent[];
  let version: string | null = null;
  let newerThanFixtures = false;
  if (t.provider === "codex") events = await codexHistory(t);
  else {
    const r = readClaudeTranscript(t.transcript!);
    events = r.events;
    version = r.version;
    newerThanFixtures = r.newerThanFixtures;
  }
  const n = (v: string | boolean | undefined) => (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : undefined);
  const p = page(events, n(flags.limit) ?? DEFAULT_PAGE, n(flags.before));
  if (flags.json) return void console.log(JSON.stringify({ key: t.key, provider: t.provider, version, newerThanFixtures, ...p }));
  for (const e of p.events) {
    if (e.t === "message") console.log(`${e.role === "user" ? "›" : " "} ${e.text.split("\n")[0]}`);
    else if (e.t === "tool.started") console.log(`  ${e.name} ${e.summary}`);
  }
}

/** Refuse a session that runs elsewhere: the bridge must be its only writer. */
function runsElsewhere(t: Target): boolean {
  if (!t.sessionId || t.provider !== "claude") return false;
  return liveSessions(configDir("claude", t.account)).some((s) => s.sessionId === t.sessionId);
}

export async function cmdBridge(providerId: ProviderId, arg: string | undefined, flags: Record<string, string | boolean>): Promise<void> {
  const mode = (typeof flags.mode === "string" ? flags.mode : "default") as PermissionMode;
  if (!PERMISSION_MODES.includes(mode)) die(`--mode is one of ${PERMISSION_MODES.join(", ")} (approvals are never bypassed)`);
  const model = typeof flags.model === "string" ? flags.model : undefined;
  let t: Target;
  if (flags.new) {
    const cwd = path.resolve(typeof flags.cwd === "string" ? flags.cwd : process.cwd());
    const routed = arg ? requireProfile(providerId, arg, "bridge") : resolveDir(providerId, false, cwd).name;
    if (!routed) die(`no ${providerId} account to start on`);
    t = { key: `${providerId}/${routed}/new`, provider: providerId, account: routed, sessionId: null, cwd, transcript: null };
  } else {
    if (!arg) die("usage: agent-switch bridge <session> [--mode default|acceptEdits|plan] [--model M] · bridge --new [profile] --cwd DIR");
    t = target(arg);
    if (runsElsewhere(t)) die(`${t.key} is running in a terminal; open it there, or take it over first`);
  }

  const out = (o: BridgeOutput) => process.stdout.write(JSON.stringify(o) + "\n");
  const leases = new InputLeases(ROOT);
  const holder: Holder = { id: `bridge:${process.pid}`, pid: process.pid, kind: "app" };
  if (t.sessionId) {
    try {
      leases.acquire(t.key, holder);
    } catch (err) {
      if (err instanceof LeaseHeld) {
        out({ bridge: "error", message: err.message });
        process.exitCode = 3;
        return;
      }
      throw err;
    }
  }
  const renew = t.sessionId ? setInterval(() => leases.acquire(t.key, holder), LEASE_RENEW_MS) : null;
  const done = () => {
    if (renew) clearInterval(renew);
    if (t.sessionId) leases.release(t.key, holder);
  };

  let send: (c: BridgeCommand) => void;
  let finished: Promise<void>;
  if (t.provider === "codex") {
    const server = AppServer.spawn(readBinaryPath("codex") ?? providerOf("codex").binary, configDir("codex", t.account));
    finished = new Promise((res) => {
      const b = new CodexBridge({ key: t.key, threadId: t.sessionId, cwd: t.cwd, server, out: (o) => (out(o), "bridge" in o && o.bridge === "exit" && res()) });
      send = (c) => b.command(c);
      b.start().catch((e: unknown) => out({ bridge: "error", message: e instanceof Error ? e.message : String(e) }));
    });
  } else {
    finished = new Promise((res) => {
      const b = new ClaudeBridge({
        key: t.key,
        bin: readBinaryPath("claude") ?? providerOf("claude").binary,
        configDir: configDir("claude", t.account),
        cwd: t.cwd,
        sessionId: t.sessionId,
        mode,
        model,
        out: (o) => (out(o), "bridge" in o && o.bridge === "exit" && res()),
      });
      send = (c) => b.command(c);
      b.start();
    });
  }

  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    try {
      send(JSON.parse(line) as BridgeCommand);
    } catch {
      out({ bridge: "error", message: "not a JSON command" });
    }
  });
  rl.on("close", () => send({ cmd: "close" }));
  await finished;
  rl.close();
  done();
}
