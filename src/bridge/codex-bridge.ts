/**
 * The Codex side of `agent-switch bridge` (ADR-009): one `codex app-server`
 * (JSON-RPC over stdio) per chat session. History comes from `thread/read`,
 * live items from `item/*` notifications, approvals from the server's
 * `item/*\/requestApproval` requests, answered only when the user does.
 *
 * Steering (`turn/steer`) is Codex's own way to add to a running turn; the
 * bridge uses it for "interrupt now" style follow-ups only when asked.
 */

import type { ChildProcess, SpawnOptions } from "node:child_process";
import { spawn as nodeSpawn } from "node:child_process";

import { fromCodexItem, fromCodexThread } from "../timeline/codex.js";
import type { AsEvent } from "../timeline/events.js";
import type { BridgeCommand, BridgeOutput } from "./claude-bridge.js";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export class AppServer {
  private id = 0;
  private buf = "";
  private readonly waiting = new Map<number, { res: (v: Json) => void; rej: (e: Error) => void }>();
  onNotification: (method: string, params: Json) => void = () => {};
  onRequest: (id: number | string, method: string, params: Json) => void = () => {};
  onExit: (code: number | null) => void = () => {};

  constructor(private readonly child: ChildProcess) {
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (d: string) => this.onData(d));
    child.on("exit", (code) => {
      for (const w of this.waiting.values()) w.rej(new Error("codex app-server exited"));
      this.waiting.clear();
      this.onExit(code);
    });
  }

  static spawn(bin: string, codexHome: string, spawn: (c: string, a: string[], o: SpawnOptions) => ChildProcess = nodeSpawn): AppServer {
    return new AppServer(spawn(bin, ["app-server"], { env: { ...process.env, CODEX_HOME: codexHome }, stdio: ["pipe", "pipe", "pipe"] }));
  }

  private onData(d: string): void {
    this.buf += d;
    let i: number;
    while ((i = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 1);
      if (!line.trim()) continue;
      let m: Json;
      try {
        m = JSON.parse(line) as Json;
      } catch {
        continue;
      }
      if (m.id !== undefined && m.method === undefined) {
        const w = this.waiting.get(Number(m.id));
        if (!w) continue;
        this.waiting.delete(Number(m.id));
        if (m.error) w.rej(new Error(str(obj(m.error).message) || "codex app-server error"));
        else w.res(obj(m.result));
      } else if (m.id !== undefined) this.onRequest(m.id as number | string, str(m.method), obj(m.params));
      else this.onNotification(str(m.method), obj(m.params));
    }
  }

  private send(o: Json): void {
    this.child.stdin?.write(JSON.stringify({ jsonrpc: "2.0", ...o }) + "\n");
  }

  call(method: string, params: Json = {}): Promise<Json> {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.waiting.set(id, { res, rej });
      this.send({ id, method, params });
    });
  }

  respond(id: number | string, result: Json): void {
    this.send({ id, result });
  }

  async initialize(): Promise<void> {
    await this.call("initialize", { clientInfo: { name: "agent-switch", version: "3.1" } });
    this.send({ method: "initialized" });
  }

  close(): void {
    this.child.stdin?.end();
  }
}

export interface CodexBridgeOptions {
  key: string;
  threadId: string | null;
  cwd: string;
  out: (o: BridgeOutput) => void;
  server: AppServer;
  onSession?: (threadId: string) => void;
  onApprovals?: (open: { id: string; tool: string; summary: string }[]) => void;
}

/** Approval decisions per request method. */
const ACCEPT: Record<string, { once: string; always: string; deny: string }> = {
  "item/commandExecution/requestApproval": { once: "accept", always: "acceptForSession", deny: "decline" },
  "item/fileChange/requestApproval": { once: "accept", always: "acceptForSession", deny: "decline" },
};

export class CodexBridge {
  private threadId: string | null;
  private turnId: string | null = null;
  private readonly queue: string[] = [];
  private readonly pending = new Map<string, { rpcId: number | string; method: string; tool: string; summary: string }>();

  private approvalsChanged(): void {
    this.o.onApprovals?.([...this.pending.entries()].map(([id, p]) => ({ id, tool: p.tool, summary: p.summary })));
  }

  constructor(private readonly o: CodexBridgeOptions) {
    this.threadId = o.threadId;
    o.server.onNotification = (m, p) => this.notify(m, p);
    o.server.onRequest = (id, m, p) => this.request(id, m, p);
    o.server.onExit = (code) => o.out({ bridge: "exit", code });
  }

  private emit(e: AsEvent): void {
    this.o.out({ event: e });
  }

  async start(): Promise<void> {
    await this.o.server.initialize();
    if (this.threadId) {
      const r = await this.o.server.call("thread/read", { threadId: this.threadId, includeTurns: true });
      for (const e of fromCodexThread(r)) this.emit(e);
      await this.o.server.call("thread/resume", { threadId: this.threadId, excludeTurns: true, cwd: this.o.cwd });
    } else {
      const r = await this.o.server.call("thread/start", { cwd: this.o.cwd });
      this.threadId = str(obj(r.thread).id) || null;
      if (this.threadId) {
        const [provider, account] = this.o.key.split("/");
        this.o.out({ bridge: "session", key: `${provider}/${account}/${this.threadId}`, model: str(r.model) || null, mode: null, commands: [] });
        this.o.onSession?.(this.threadId);
      }
    }
    this.o.out({ bridge: "ready", key: this.o.key, mode: "default" });
  }

  private notify(method: string, p: Json): void {
    if (method === "turn/started") this.turnId = str(obj(p.turn).id) || this.turnId;
    else if (method === "item/completed") for (const e of fromCodexItem(p.item)) this.emit(e);
    else if (method === "item/agentMessage/delta") this.emit({ t: "message.delta", id: str(p.itemId), text: str(p.delta) });
    else if (method === "turn/completed") {
      const turn = obj(p.turn);
      const status = str(turn.status);
      if (turn.error) this.emit({ t: "error", message: str(obj(turn.error).message) || "the turn failed" });
      this.emit({ t: "turn.end", ok: status === "completed", durationMs: null, costUsd: null });
      this.turnId = null;
      const next = this.queue.shift();
      if (next !== undefined) void this.startTurn(next);
      this.o.out({ bridge: "queued", count: this.queue.length });
    } else if (method === "error") this.emit({ t: "error", message: str(obj(p.error).message) || "codex error" });
  }

  private request(id: number | string, method: string, p: Json): void {
    if (!ACCEPT[method]) {
      // A request the client cannot answer (tool calls, elicitation): refuse it rather than hang the turn.
      this.o.server.respond(id, {});
      this.emit({ t: "unknown", kind: `codex-request:${method}` });
      return;
    }
    const approvalId = str(p.approvalId) || str(p.itemId) || String(id);
    const command = str(p.command);
    this.pending.set(approvalId, { rpcId: id, method, tool: method.includes("fileChange") ? "Edit" : "Bash", summary: command || str(p.reason) });
    this.approvalsChanged();
    this.emit({ t: "approval.requested", id: approvalId, tool: method.includes("fileChange") ? "Edit" : "Bash", summary: command || str(p.reason), input: command ? { command } : {} });
  }

  private async startTurn(text: string): Promise<void> {
    const id = `local-${Date.now()}`;
    this.emit({ t: "turn", id, at: new Date().toISOString() });
    this.emit({ t: "message", id, role: "user", text, images: 0 });
    try {
      const r = await this.o.server.call("turn/start", { threadId: this.threadId, input: [{ type: "text", text }] });
      this.turnId = str(obj(r.turn).id) || this.turnId;
    } catch (e) {
      this.o.out({ bridge: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  command(c: BridgeCommand): void {
    switch (c.cmd) {
      case "send":
        if (this.turnId) {
          this.queue.push(c.text);
          this.o.out({ bridge: "queued", count: this.queue.length });
        } else {
          this.turnId = "starting";
          void this.startTurn(c.text);
        }
        return;
      case "approve":
      case "deny": {
        const p = this.pending.get(c.id);
        if (!p) return this.o.out({ bridge: "error", message: `no open approval ${c.id}` });
        this.pending.delete(c.id);
        this.approvalsChanged();
        const d = ACCEPT[p.method];
        this.o.server.respond(p.rpcId, { decision: c.cmd === "deny" ? d.deny : c.always ? d.always : d.once });
        this.emit({ t: "approval.resolved", id: c.id, decision: c.cmd === "approve" ? "allow" : "deny" });
        return;
      }
      case "steer":
        return this.steer(c.text);
      case "review": {
        if (!this.threadId) return this.o.out({ bridge: "error", message: "the thread has not started yet" });
        const target = c.target === "uncommitted" ? { type: "uncommittedChanges" } : { type: "baseBranch", branch: c.target.baseBranch };
        void this.o.server.call("review/start", { threadId: this.threadId, target }).catch((e: unknown) => this.o.out({ bridge: "error", message: e instanceof Error ? e.message : String(e) }));
        return;
      }
      case "interrupt":
        this.queue.length = 0;
        if (this.threadId && this.turnId && this.turnId !== "starting") void this.o.server.call("turn/interrupt", { threadId: this.threadId, turnId: this.turnId }).catch(() => {});
        return;
      case "answer":
        // Codex asks no structured questions over this protocol; the answer goes as the next message.
        return this.command({ cmd: "send", text: Object.entries(c.answers).map(([q, a]) => `${q} → ${a}`).join("\n") });
      case "set-model":
      case "set-mode":
        // Codex takes model and approval policy per turn (turn/start); the next turn uses them.
        return;
      case "close":
        this.o.server.close();
        return;
    }
  }

  /** Codex steering: add `text` to the running turn instead of queueing it. */
  steer(text: string): void {
    if (!this.threadId || !this.turnId || this.turnId === "starting") return this.command({ cmd: "send", text });
    void this.o.server.call("turn/steer", { threadId: this.threadId, expectedTurnId: this.turnId, input: [{ type: "text", text }] }).catch((e: unknown) =>
      this.o.out({ bridge: "error", message: e instanceof Error ? e.message : String(e) }),
    );
  }

  get openApprovals(): string[] {
    return [...this.pending.keys()];
  }
}
