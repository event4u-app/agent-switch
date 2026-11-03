/**
 * The ACP side of `agent-switch bridge` (v3.2 M15): any agent that speaks the
 * Agent Client Protocol (JSON-RPC over stdio) — Gemini CLI, OpenCode, Goose,
 * Qwen Code — drives the chat view through the same AS event model as Claude
 * and Codex.
 *
 * The bridge advertises no file system and no terminal: the agent uses its own
 * tools, and every permission it asks for becomes an `approval.requested` the
 * user answers. Nothing is approved without the user, and the bridge never sets
 * an agent mode (no remote loosening of what the agent may do).
 */

import type { ChildProcess, SpawnOptions } from "node:child_process";
import { spawn as nodeSpawn } from "node:child_process";

import { countHunks, toolSummary, type AsEvent, type DiffHunk } from "../timeline/events.js";
import type { BridgeCommand, BridgeOutput } from "./claude-bridge.js";
import { AppServer } from "./codex-bridge.js";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export const ACP_PROTOCOL_VERSION = 1;

/** Spawn an ACP agent: argv only, inherited env plus the search PATH. */
export function spawnAcp(bin: string, args: readonly string[], cwd: string, searchPath: string, spawn: (c: string, a: string[], o: SpawnOptions) => ChildProcess = nodeSpawn): AppServer {
  return new AppServer(spawn(bin, [...args], { cwd, env: { ...process.env, PATH: searchPath }, stdio: ["pipe", "pipe", "pipe"] }));
}

/** Text of an ACP content block; images count separately. Pure. */
function blockText(c: unknown): string {
  const b = obj(c);
  if (b.type === "text") return str(b.text);
  if (b.type === "resource_link") return str(b.uri);
  if (b.type === "resource") return str(obj(b.resource).text);
  return "";
}

/** Old and new text of one file → one unified hunk (common head and tail trimmed). Pure. */
export function textDiff(oldText: string, newText: string): DiffHunk[] {
  const a = oldText === "" ? [] : oldText.split("\n");
  const b = newText === "" ? [] : newText.split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const del = a.slice(head, a.length - tail).map((l) => `-${l}`);
  const add = b.slice(head, b.length - tail).map((l) => `+${l}`);
  if (!del.length && !add.length) return [];
  return [{ oldStart: head + 1, newStart: head + 1, lines: [...del, ...add] }];
}

/** ACP tool kinds → the tool names the chat view already draws. Pure. */
export function toolName(kind: string, title: string): string {
  switch (kind) {
    case "read":
      return "Read";
    case "edit":
      return "Edit";
    case "delete":
    case "move":
      return "Bash";
    case "search":
      return "Grep";
    case "execute":
      return "Bash";
    case "fetch":
      return "WebFetch";
    case "think":
      return "Think";
    default:
      return title || "Tool";
  }
}

/** Collects message chunks into one message per role run. */
export class Messages {
  private cur: { id: string; role: "user" | "assistant"; text: string; images: number } | null = null;
  private n = 0;
  constructor(private readonly emit: (e: AsEvent) => void, private readonly live: () => boolean) {}

  chunk(role: "user" | "assistant", content: unknown): void {
    if (this.cur && this.cur.role !== role) this.flush();
    if (!this.cur) {
      this.cur = { id: `acp-${role}-${++this.n}`, role, text: "", images: 0 };
      if (role === "user" && !this.live()) this.emit({ t: "turn", id: this.cur.id, at: null });
    }
    const t = blockText(content);
    if (obj(content).type === "image") this.cur.images++;
    this.cur.text += t;
    if (role === "assistant" && this.live() && t) this.emit({ t: "message.delta", id: this.cur.id, text: t });
  }

  flush(): void {
    if (!this.cur) return;
    const c = this.cur;
    this.cur = null;
    if (c.text || c.images) this.emit({ t: "message", id: c.id, role: c.role, text: c.text, images: c.images });
  }
}

/** One `session/update` → events. Message chunks go through `messages`. */
export function mapUpdate(u: Json, messages: Messages, emit: (e: AsEvent) => void, tools: Map<string, string>): void {
  const kind = str(u.sessionUpdate);
  if (kind === "user_message_chunk") return messages.chunk("user", u.content);
  if (kind === "agent_message_chunk") return messages.chunk("assistant", u.content);
  messages.flush();
  switch (kind) {
    case "agent_thought_chunk":
      return emit({ t: "thinking", id: `acp-thought-${tools.size}` });
    case "tool_call": {
      const id = str(u.toolCallId);
      const name = toolName(str(u.kind), str(u.title));
      tools.set(id, name);
      const input = { ...obj(u.rawInput), ...(arr(u.locations).length ? { file_path: str(obj(arr(u.locations)[0]).path) } : {}) };
      emit({ t: "tool.started", id, name, summary: str(u.title) || toolSummary(name, input), input, parentToolId: null });
      return toolContent(id, u, emit);
    }
    case "tool_call_update": {
      const id = str(u.toolCallId);
      toolContent(id, u, emit);
      const status = str(u.status);
      if (status === "completed" || status === "failed") emit({ t: "tool.finished", id, ok: status === "completed", summary: str(u.title) });
      return;
    }
    case "plan":
      return emit({ t: "plan", id: `acp-plan`, text: arr(u.entries).map((e) => `${obj(e).status === "completed" ? "[x]" : "[ ]"} ${str(obj(e).content)}`).join("\n") });
    case "available_commands_update":
    case "current_mode_update":
      return;
    default:
      return emit({ t: "unknown", kind: `acp:${kind || "update"}` });
  }
}

function toolContent(id: string, u: Json, emit: (e: AsEvent) => void): void {
  for (const c of arr(u.content)) {
    const b = obj(c);
    if (b.type !== "diff") continue;
    const hunks = textDiff(str(b.oldText), str(b.newText));
    emit({ t: "diff", toolId: id, path: str(b.path), ...countHunks(hunks), hunks });
  }
}

const STOP_OK = new Set(["end_turn", "max_tokens", "max_turn_requests"]);

export interface AcpBridgeOptions {
  /** `acp/<agent>/<session>`; the session part is empty for a new session. */
  key: string;
  sessionId: string | null;
  cwd: string;
  out: (o: BridgeOutput) => void;
  server: AppServer;
  onSession?: (sessionId: string) => void;
  onApprovals?: (open: { id: string; tool: string; summary: string }[]) => void;
}

interface OpenPermission {
  rpcId: number | string;
  tool: string;
  summary: string;
  options: { optionId: string; kind: string }[];
}

export class AcpBridge {
  private sessionId: string | null;
  private running = false;
  private loaded = false;
  private readonly queue: string[] = [];
  private readonly pending = new Map<string, OpenPermission>();
  private readonly tools = new Map<string, string>();
  private readonly messages: Messages;
  canLoad = false;

  constructor(private readonly o: AcpBridgeOptions) {
    this.sessionId = o.sessionId;
    this.messages = new Messages((e) => this.emit(e), () => this.loaded);
    o.server.onNotification = (m, p) => this.notify(m, p);
    o.server.onRequest = (id, m, p) => this.request(id, m, p);
    o.server.onExit = (code) => o.out({ bridge: "exit", code });
  }

  private emit(e: AsEvent): void {
    this.o.out({ event: e });
  }

  async start(): Promise<void> {
    const init = await this.o.server.call("initialize", {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: "agent-switch", version: "3.2" },
    });
    this.canLoad = obj(init.agentCapabilities).loadSession === true;
    const [, agent] = this.o.key.split("/");
    if (this.sessionId) {
      if (!this.canLoad) throw new Error(`${agent} cannot load a session over ACP — open it in the terminal`);
      await this.o.server.call("session/load", { sessionId: this.sessionId, cwd: this.o.cwd, mcpServers: [] });
      this.messages.flush();
    } else {
      const r = await this.o.server.call("session/new", { cwd: this.o.cwd, mcpServers: [] });
      this.sessionId = str(r.sessionId) || null;
      if (!this.sessionId) throw new Error(`${agent} answered session/new without a session id`);
      this.o.out({ bridge: "session", key: `acp/${agent}/${this.sessionId}`, model: null, mode: str(obj(r.modes).currentModeId) || null, commands: [] });
      this.o.onSession?.(this.sessionId);
    }
    this.loaded = true;
    this.o.out({ bridge: "ready", key: this.o.key, mode: "default" });
  }

  private notify(method: string, p: Json): void {
    if (method !== "session/update" || (this.sessionId && str(p.sessionId) && str(p.sessionId) !== this.sessionId)) return;
    mapUpdate(obj(p.update), this.messages, (e) => this.emit(e), this.tools);
  }

  private request(id: number | string, method: string, p: Json): void {
    if (method !== "session/request_permission") {
      // fs/* and terminal/* were not advertised; anything else is refused, never guessed at.
      this.o.server.send({ id, error: { code: -32601, message: `agent-switch does not offer ${method}` } });
      this.emit({ t: "unknown", kind: `acp-request:${method}` });
      return;
    }
    const call = obj(p.toolCall);
    const approvalId = str(call.toolCallId) || String(id);
    const tool = this.tools.get(approvalId) ?? toolName(str(call.kind), str(call.title));
    const input = obj(call.rawInput);
    const summary = str(call.title) || toolSummary(tool, input);
    const options = arr(p.options).map((x) => ({ optionId: str(obj(x).optionId), kind: str(obj(x).kind) }));
    this.pending.set(approvalId, { rpcId: id, tool, summary, options });
    this.approvalsChanged();
    this.emit({ t: "approval.requested", id: approvalId, tool, summary, input });
  }

  private approvalsChanged(): void {
    this.o.onApprovals?.([...this.pending.entries()].map(([id, p]) => ({ id, tool: p.tool, summary: p.summary })));
  }

  private async turn(text: string): Promise<void> {
    this.running = true;
    const id = `local-${Date.now()}`;
    this.emit({ t: "turn", id, at: new Date().toISOString() });
    this.emit({ t: "message", id, role: "user", text, images: 0 });
    const started = Date.now();
    try {
      const r = await this.o.server.call("session/prompt", { sessionId: this.sessionId, prompt: [{ type: "text", text }] });
      this.messages.flush();
      const stop = str(r.stopReason);
      if (stop === "refusal") this.emit({ t: "error", message: "the agent refused the turn" });
      this.emit({ t: "turn.end", ok: STOP_OK.has(stop), durationMs: Date.now() - started, costUsd: null });
    } catch (e) {
      this.messages.flush();
      this.emit({ t: "error", message: e instanceof Error ? e.message : String(e) });
      this.emit({ t: "turn.end", ok: false, durationMs: Date.now() - started, costUsd: null });
    }
    this.cancelOpen();
    this.running = false;
    const next = this.queue.shift();
    this.o.out({ bridge: "queued", count: this.queue.length });
    if (next !== undefined) void this.turn(next);
  }

  /** A turn that ended leaves no permission open. */
  private cancelOpen(): void {
    for (const [id, p] of this.pending) {
      this.o.server.respond(p.rpcId, { outcome: { outcome: "cancelled" } });
      this.emit({ t: "approval.resolved", id, decision: "deny" });
    }
    if (this.pending.size) (this.pending.clear(), this.approvalsChanged());
  }

  command(c: BridgeCommand): void {
    switch (c.cmd) {
      case "send":
      case "steer":
        if (this.running) {
          this.queue.push(c.text);
          this.o.out({ bridge: "queued", count: this.queue.length });
        } else void this.turn(c.text);
        return;
      case "approve":
      case "deny": {
        const p = this.pending.get(c.id);
        if (!p) return this.o.out({ bridge: "error", message: `no open approval ${c.id}` });
        const want = c.cmd === "deny" ? ["reject_once", "reject_always"] : c.always ? ["allow_always", "allow_once"] : ["allow_once"];
        const opt = want.map((k) => p.options.find((x) => x.kind === k)).find(Boolean);
        if (!opt) return this.o.out({ bridge: "error", message: `the agent offered no ${want[0]} option` });
        this.pending.delete(c.id);
        this.approvalsChanged();
        this.o.server.respond(p.rpcId, { outcome: { outcome: "selected", optionId: opt.optionId } });
        this.emit({ t: "approval.resolved", id: c.id, decision: c.cmd === "approve" ? "allow" : "deny" });
        return;
      }
      case "interrupt":
        this.queue.length = 0;
        if (this.sessionId && this.running) this.o.server.send({ method: "session/cancel", params: { sessionId: this.sessionId } });
        this.cancelOpen();
        return;
      case "answer":
        return this.command({ cmd: "send", text: Object.entries(c.answers).map(([q, a]) => `${q} → ${a}`).join("\n") });
      case "review":
      case "set-model":
      case "set-mode":
        return this.o.out({ bridge: "error", message: `${c.cmd} is not offered for ACP agents — set it in the agent itself` });
      case "close":
        this.o.server.close();
        return;
    }
  }

  get openApprovals(): string[] {
    return [...this.pending.keys()];
  }
}
