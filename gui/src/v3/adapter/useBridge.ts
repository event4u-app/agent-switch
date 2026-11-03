/** A chat session's bridge, owned by the window (ADR-009): the history first
 *  (`timeline`), then the bridge's live events appended. The bridge holds the
 *  session's input lease, so this window is its only writer while it runs. */

import { useCallback, useEffect, useRef, useState } from "react";

import * as ipc from "../../ipc.js";
import type { AsEvent } from "../timeline.js";

export type BridgeStatus = "starting" | "ready" | "closed" | "error";

export interface BridgeState {
  events: AsEvent[];
  status: BridgeStatus;
  error: string | null;
  queued: number;
  mode: ipc.BridgeSpec["mode"];
  /** What the agent reported: the real session key (a new chat gets one), model, slash commands. */
  session: { key: string; model: string | null; commands: string[] } | null;
}

export interface BridgeActions {
  send: (text: string, attachments?: Attachment[]) => void;
  /** Add to the running turn (Codex steering); the bridge queues it where the agent cannot. */
  steer: (text: string) => void;
  approve: (id: string, always: boolean) => void;
  deny: (id: string) => void;
  answer: (id: string, answers: Record<string, string>) => void;
  interrupt: () => void;
  setModel: (model: string) => void;
  setMode: (mode: ipc.BridgeSpec["mode"]) => void;
  close: () => void;
}

/** An attachment the bridge turns into a content block or a staged `@file`. */
export type Attachment = { image: { mediaType: string; data: string } } | { file: { name: string; data: string } } | { path: string };

export interface BridgeDeps {
  open: typeof ipc.openBridge;
  history: (key: string) => Promise<AsEvent[]>;
}

const realDeps: BridgeDeps = { open: ipc.openBridge, history: (k) => ipc.sessionTimeline(k, 500).then((r) => r.events) };

/** Parse one bridge output line. Pure. */
export function bridgeLine(line: string): { event?: AsEvent; bridge?: { kind: string; message?: string; count?: number; mode?: string; key?: string; model?: string | null; commands?: string[] } } {
  try {
    const o = JSON.parse(line) as { event?: AsEvent; bridge?: string; message?: string; count?: number; mode?: string; key?: string; model?: string | null; commands?: unknown };
    if (o.event) return { event: o.event };
    if (typeof o.bridge === "string") {
      const commands = Array.isArray(o.commands) ? o.commands.filter((c): c is string => typeof c === "string") : undefined;
      return { bridge: { kind: o.bridge, message: o.message, count: o.count, mode: o.mode, key: o.key, model: o.model, commands } };
    }
  } catch {
    /* the bridge only writes JSON; anything else is not ours */
  }
  return {};
}

export function useBridge(spec: ipc.BridgeSpec | null, deps: BridgeDeps = realDeps): BridgeState & BridgeActions {
  const [s, set] = useState<BridgeState>({ events: [], status: "starting", error: null, queued: 0, mode: spec?.mode ?? "default", session: null });
  const proc = useRef<ipc.BridgeProcess | null>(null);
  const specKey = spec ? JSON.stringify(spec) : null;

  useEffect(() => {
    if (!spec) return;
    let alive = true;
    set({ events: [], status: "starting", error: null, queued: 0, mode: spec.mode, session: null });
    const onLine = (line: string) => {
      if (!alive) return;
      const r = bridgeLine(line);
      if (r.event) set((p) => ({ ...p, events: [...p.events, r.event!] }));
      else if (r.bridge?.kind === "ready") set((p) => ({ ...p, status: "ready" }));
      else if (r.bridge?.kind === "queued") set((p) => ({ ...p, queued: r.bridge!.count ?? 0 }));
      else if (r.bridge?.kind === "session" && r.bridge.key) set((p) => ({ ...p, session: { key: r.bridge!.key!, model: r.bridge!.model ?? null, commands: r.bridge!.commands ?? [] } }));
      else if (r.bridge?.kind === "error") set((p) => ({ ...p, error: r.bridge!.message ?? "bridge error", status: p.status === "starting" ? "error" : p.status }));
      else if (r.bridge?.kind === "exit") set((p) => ({ ...p, status: p.status === "error" ? "error" : "closed" }));
    };
    (async () => {
      // History first, so the live events continue it.
      const history = "key" in spec ? await deps.history(spec.key).catch(() => [] as AsEvent[]) : [];
      if (!alive) return;
      set((p) => ({ ...p, events: [...history, ...p.events] }));
      proc.current = await deps.open(spec, onLine, () => alive && set((p) => ({ ...p, status: p.status === "error" ? "error" : "closed" })));
    })().catch((e: unknown) => alive && set((p) => ({ ...p, status: "error", error: e instanceof Error ? e.message : String(e) })));
    return () => {
      alive = false;
      void proc.current?.send({ cmd: "close" }).catch(() => {});
      proc.current = null;
    };
    // specKey is the spec's identity; the object itself changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specKey, deps]);

  const send = useCallback((c: object) => void proc.current?.send(c).catch((e: unknown) => set((p) => ({ ...p, error: e instanceof Error ? e.message : String(e) }))), []);
  return {
    ...s,
    send: (text, attachments) => send({ cmd: "send", text, ...(attachments?.length ? { attachments } : {}) }),
    steer: (text) => send({ cmd: "steer", text }),
    approve: (id, always) => send({ cmd: "approve", id, always }),
    deny: (id) => send({ cmd: "deny", id }),
    answer: (id, answers) => send({ cmd: "answer", id, answers }),
    interrupt: () => send({ cmd: "interrupt" }),
    setModel: (model) => send({ cmd: "set-model", model }),
    setMode: (mode) => (set((p) => ({ ...p, mode })), send({ cmd: "set-mode", mode })),
    close: () => send({ cmd: "close" }),
  };
}
