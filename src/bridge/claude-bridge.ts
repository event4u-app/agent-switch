/**
 * The Claude side of `agent-switch bridge` (ADR-009): one `claude -p` stream-json
 * process per chat session. It maps the agent's output onto AS events, answers
 * approval requests only when the user does, and queues messages typed during a
 * turn until the turn ends (spec §13.4).
 *
 * Approvals stay real: no `bypassPermissions`, no `--bare`. The permission mode
 * is passed on every start because `-p` resume does not restore it.
 */

import type { ChildProcess, SpawnOptions } from "node:child_process";
import { spawn as nodeSpawn } from "node:child_process";
import * as crypto from "node:crypto";

import { AttachmentRefused, resolveAttachment, type Incoming } from "./attachments.js";
import { claudeState, fromClaudeLine } from "../timeline/claude.js";
import { toolSummary } from "../timeline/events.js";
import type { AsEvent } from "../timeline/events.js";

export const PERMISSION_MODES = ["default", "acceptEdits", "plan"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

export type { Incoming as Attachment } from "./attachments.js";

/** What the window sends; one JSON object per stdin line. */
export type BridgeCommand =
  | { cmd: "send"; text: string; attachments?: Incoming[] }
  /** Add to the running turn where the agent supports it (Codex); queued otherwise. */
  | { cmd: "steer"; text: string }
  | { cmd: "approve"; id: string; always?: boolean }
  | { cmd: "deny"; id: string; message?: string }
  /** Answers to an open question, by question text. */
  | { cmd: "answer"; id: string; answers: Record<string, string> }
  | { cmd: "interrupt" }
  /** Ask the agent for a code review (Codex `review/start`); Claude has none. */
  | { cmd: "review"; target: "uncommitted" | { baseBranch: string } }
  | { cmd: "set-model"; model: string }
  | { cmd: "set-mode"; mode: PermissionMode }
  | { cmd: "close" };

/** What the bridge writes; one JSON object per stdout line. */
export type BridgeOutput =
  | { bridge: "ready"; key: string; mode: PermissionMode }
  | { bridge: "queued"; count: number }
  /** What the agent reported at the start of a turn: the real session id (for a new one), model, mode, slash commands. */
  | { bridge: "session"; key: string; model: string | null; mode: string | null; commands: string[] }
  | { bridge: "exit"; code: number | null }
  | { bridge: "error"; message: string }
  | { event: AsEvent };

export interface ClaudeBridgeOptions {
  key: string;
  bin: string;
  configDir: string;
  cwd: string;
  /** Resume this session; null starts a new one. */
  sessionId: string | null;
  mode: PermissionMode;
  model?: string;
  /** Where dropped files outside the session's folder are copied. */
  staging?: string;
  /** Told the session id once the agent names it (a new session has none before). */
  onSession?: (sessionId: string) => void;
  /** Told whenever the open approvals change, so the Needs-you queue can show them. */
  onApprovals?: (open: { id: string; tool: string; summary: string }[]) => void;
  out: (o: BridgeOutput) => void;
  spawn?: (cmd: string, args: string[], opts: SpawnOptions) => ChildProcess;
}

type Json = Record<string, unknown>;

export function claudeArgs(o: Pick<ClaudeBridgeOptions, "sessionId" | "mode" | "model">): string[] {
  if (!PERMISSION_MODES.includes(o.mode)) throw new Error(`permission mode ${String(o.mode)} is not offered in the client`);
  return [
    "-p",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--permission-prompt-tool", "stdio",
    "--permission-mode", o.mode,
    ...(o.sessionId ? ["--resume", o.sessionId] : []),
    ...(o.model ? ["--model", o.model] : []),
  ];
}

export class ClaudeBridge {
  private child: ChildProcess | null = null;
  private buf = "";
  private readonly st = claudeState();
  private running = false;
  private readonly queue: Json[] = [];
  /** Open approval requests: id → the agent's request, for "always allow". */
  private readonly pending = new Map<string, Json>();
  private mode: PermissionMode;
  private announced = false;

  constructor(private readonly o: ClaudeBridgeOptions) {
    this.mode = o.mode;
  }

  start(): void {
    const spawn = this.o.spawn ?? nodeSpawn;
    const child = spawn(this.o.bin, claudeArgs({ sessionId: this.o.sessionId, mode: this.mode, model: this.o.model }), {
      cwd: this.o.cwd,
      env: { ...process.env, CLAUDE_CONFIG_DIR: this.o.configDir },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (d: string) => this.onData(d));
    child.stderr?.on("data", () => {
      /* the agent's own diagnostics; the events carry what the window needs */
    });
    // A start that fails (binary missing) emits no exit: end the bridge here, or it waits forever.
    child.on("error", (err) => {
      this.o.out({ bridge: "error", message: err.message });
      this.o.out({ bridge: "exit", code: null });
    });
    child.on("exit", (code) => this.o.out({ bridge: "exit", code }));
    this.o.out({ bridge: "ready", key: this.o.key, mode: this.mode });
  }

  private write(o: Json): void {
    this.child?.stdin?.write(JSON.stringify(o) + "\n");
  }

  private onData(d: string): void {
    this.buf += d;
    let i: number;
    while ((i = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 1);
      if (!line.trim()) continue;
      let e: Json;
      try {
        e = JSON.parse(line) as Json;
      } catch {
        this.o.out({ event: { t: "unknown", kind: "unparsable" } });
        continue;
      }
      if (e.type === "control_request" && (e.request as Json | undefined)?.subtype === "can_use_tool") {
        this.pending.set(String(e.request_id), e);
        this.approvalsChanged();
      }
      if (e.type === "system" && e.subtype === "init" && !this.announced) {
        this.announced = true;
        const [provider, account] = this.o.key.split("/");
        const commands = Array.isArray(e.slash_commands) ? (e.slash_commands as unknown[]).filter((c): c is string => typeof c === "string") : [];
        this.o.out({ bridge: "session", key: `${provider}/${account}/${String(e.session_id)}`, model: typeof e.model === "string" ? e.model : null, mode: typeof e.permissionMode === "string" ? e.permissionMode : null, commands });
        this.o.onSession?.(String(e.session_id));
      }
      for (const ev of fromClaudeLine(e, this.st)) {
        this.o.out({ event: ev });
        if (ev.t === "turn.end") this.turnEnded();
      }
    }
  }

  private approvalsChanged(): void {
    this.o.onApprovals?.(
      [...this.pending.entries()].map(([id, e]) => {
        const r = (e.request ?? {}) as Json;
        const tool = String(r.tool_name ?? "");
        return { id, tool, summary: toolSummary(tool, (r.input ?? {}) as Record<string, unknown>) };
      }),
    );
  }

  private turnEnded(): void {
    this.running = false;
    const next = this.queue.shift();
    if (next) this.dispatch(next);
    this.o.out({ bridge: "queued", count: this.queue.length });
  }

  private dispatch(msg: Json): void {
    this.running = true;
    this.write(msg);
    // The stream does not echo the user's message; the timeline shows it when it is sent.
    const content = (msg.message as Json).content;
    const blocks = Array.isArray(content) ? (content as Json[]) : [];
    const id = `local-${crypto.randomUUID()}`;
    const text = typeof content === "string" ? content : blocks.filter((b) => b.type === "text").map((b) => String(b.text)).join("\n");
    this.o.out({ event: { t: "turn", id, at: new Date().toISOString() } });
    this.o.out({ event: { t: "message", id, role: "user", text, images: blocks.filter((b) => b.type === "image").length } });
  }

  /** Content for a user message: images as blocks, files as `@` references in the text. */
  static content(text: string, attachments: Incoming[] = [], opts: { cwd: string; staging: string } = { cwd: "/", staging: "/" }): unknown[] | string {
    const resolved = attachments.map((a) => resolveAttachment(a, opts));
    const refs = resolved.flatMap((r) => (r.kind === "ref" ? [r.ref] : []));
    const full = [text, ...refs].filter(Boolean).join(" ");
    const images = resolved.flatMap((r) => (r.kind === "image" ? [{ type: "image", source: { type: "base64", media_type: r.mediaType, data: r.data } }] : []));
    return images.length ? [...(full ? [{ type: "text", text: full }] : []), ...images] : full;
  }

  command(c: BridgeCommand): void {
    switch (c.cmd) {
      case "steer":
      case "send": {
        let content: unknown;
        try {
          content = ClaudeBridge.content(c.text, c.cmd === "send" ? c.attachments : undefined, { cwd: this.o.cwd, staging: this.o.staging ?? this.o.cwd });
        } catch (err) {
          if (err instanceof AttachmentRefused || (err as NodeJS.ErrnoException).code) return this.o.out({ bridge: "error", message: (err as Error).message });
          throw err;
        }
        const msg = { type: "user", message: { role: "user", content } };
        if (this.running) {
          this.queue.push(msg);
          this.o.out({ bridge: "queued", count: this.queue.length });
        } else this.dispatch(msg);
        return;
      }
      case "approve":
      case "deny": {
        const req = this.pending.get(c.id);
        if (!req) return this.o.out({ bridge: "error", message: `no open approval ${c.id}` });
        this.pending.delete(c.id);
        this.approvalsChanged();
        const r = (req.request ?? {}) as Json;
        const response =
          c.cmd === "approve"
            ? {
                behavior: "allow",
                updatedInput: r.input ?? {},
                // "Always allow" adds the very rule the terminal prompt would have offered.
                ...(c.always && Array.isArray(r.permission_suggestions) ? { updatedPermissions: r.permission_suggestions } : {}),
              }
            : { behavior: "deny", message: c.message || "Denied in Agent Switch" };
        this.write({ type: "control_response", response: { subtype: "success", request_id: c.id, response } });
        this.o.out({ event: { t: "approval.resolved", id: c.id, decision: c.cmd === "approve" ? "allow" : "deny" } });
        return;
      }
      case "answer": {
        const req = this.pending.get(c.id);
        if (!req) return this.o.out({ bridge: "error", message: `no open question ${c.id}` });
        this.pending.delete(c.id);
        this.approvalsChanged();
        const input = ((req.request ?? {}) as Json).input ?? {};
        this.write({ type: "control_response", response: { subtype: "success", request_id: c.id, response: { behavior: "allow", updatedInput: { ...(input as Json), answers: c.answers } } } });
        return;
      }
      case "interrupt":
        this.queue.length = 0;
        this.write({ type: "control_request", request_id: crypto.randomUUID(), request: { subtype: "interrupt" } });
        if (this.pending.size) {
          this.pending.clear();
          this.approvalsChanged();
        }
        return;
      case "set-model":
        this.write({ type: "control_request", request_id: crypto.randomUUID(), request: { subtype: "set_model", model: c.model } });
        return;
      case "set-mode":
        if (!PERMISSION_MODES.includes(c.mode)) return this.o.out({ bridge: "error", message: `permission mode ${String(c.mode)} is not offered in the client` });
        this.mode = c.mode;
        this.write({ type: "control_request", request_id: crypto.randomUUID(), request: { subtype: "set_permission_mode", mode: c.mode } });
        return;
      case "review":
        return this.o.out({ bridge: "error", message: "Claude has no review command here; ask for a review in the chat" });
      case "close":
        this.child?.stdin?.end();
        return;
    }
  }

  /** Open approvals, for tests and the lease check. */
  get openApprovals(): string[] {
    return [...this.pending.keys()];
  }
  get isRunning(): boolean {
    return this.running;
  }
  get queued(): number {
    return this.queue.length;
  }
}
