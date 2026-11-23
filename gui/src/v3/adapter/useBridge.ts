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
  /** The loaded history starts at index `from`; `prompts` lie before it. Null when all of it is loaded. */
  earlier: { from: number; prompts: number } | null;
  /** Cards from the history: asked before this chat opened, so this bridge cannot answer them. */
  stale: ReadonlySet<string>;
}

export interface BridgeActions {
  send: (text: string, attachments?: Attachment[]) => void;
  /** Add to the running turn (Codex steering); the bridge queues it where the agent cannot. */
  steer: (text: string) => void;
  approve: (id: string, always: boolean) => void;
  /** `message` tells the agent why (a skipped question says it was skipped). */
  deny: (id: string, message?: string) => void;
  answer: (id: string, answers: Record<string, string>) => void;
  interrupt: () => void;
  /** Codex: ask the agent to review the uncommitted changes. */
  review: () => void;
  setModel: (model: string) => void;
  setMode: (mode: ipc.BridgeSpec["mode"]) => void;
  close: () => void;
  /** Read the turns before the loaded history and put them in front. */
  loadEarlier: () => Promise<void>;
  /** Every event of the conversation, reading what is not loaded. */
  allEvents: () => Promise<AsEvent[]>;
}

/** An attachment the bridge turns into a content block or a staged `@file`. */
export type Attachment = { image: { mediaType: string; data: string } } | { file: { name: string; data: string } } | { path: string };

/** One page of history: the newest one, or the one ending before index `before`; `all` reads from the start. */
export type HistoryPage = { events: AsEvent[]; from: number; earlierPrompts: number };

export interface BridgeDeps {
  open: typeof ipc.openBridge;
  history: (key: string, before?: number, all?: boolean) => Promise<HistoryPage>;
}

const realDeps: BridgeDeps = { open: ipc.openBridge, history: (k, before, all) => ipc.sessionTimeline(k, { before, ...(all ? { from: 0 } : {}) }) };

/** The ids of approval and question cards in `events`: from history they cannot be answered over a new bridge. Pure. */
export function cardIds(events: readonly AsEvent[]): string[] {
  return events.flatMap((e) => (e.t === "approval.requested" || e.t === "question.requested" ? [e.id] : []));
}

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

/** A bridge error: before the chat is up it is why it could not start; after, it goes into the
 *  conversation where it happened (an answer the agent did not take), so it is never silent. Pure. */
export function failed(p: BridgeState, message: string): BridgeState {
  if (p.status === "starting") return { ...p, error: message, status: "error" };
  return { ...p, error: message, events: p.status === "ready" ? [...p.events, { t: "error", message }] : p.events };
}

export function useBridge(spec: ipc.BridgeSpec | null, deps: BridgeDeps = realDeps): BridgeState & BridgeActions {
  const [s, set] = useState<BridgeState>({ events: [], status: "starting", error: null, queued: 0, mode: spec?.mode ?? "default", session: null, earlier: null, stale: new Set() });
  const proc = useRef<ipc.BridgeProcess | null>(null);
  const specKey = spec ? JSON.stringify(spec) : null;

  useEffect(() => {
    if (!spec) return;
    let alive = true;
    set({ events: [], status: "starting", error: null, queued: 0, mode: spec.mode, session: null, earlier: null, stale: new Set() });
    const onLine = (line: string) => {
      if (!alive) return;
      const r = bridgeLine(line);
      if (r.event) set((p) => ({ ...p, events: [...p.events, r.event!] }));
      else if (r.bridge?.kind === "ready") set((p) => ({ ...p, status: "ready" }));
      else if (r.bridge?.kind === "queued") set((p) => ({ ...p, queued: r.bridge!.count ?? 0 }));
      else if (r.bridge?.kind === "session" && r.bridge.key) set((p) => ({ ...p, session: { key: r.bridge!.key!, model: r.bridge!.model ?? null, commands: r.bridge!.commands ?? [] } }));
      else if (r.bridge?.kind === "error") set((p) => failed(p, r.bridge!.message ?? "bridge error"));
      else if (r.bridge?.kind === "exit") set((p) => ({ ...p, status: p.status === "error" ? "error" : "closed" }));
    };
    (async () => {
      // History first, so the live events continue it.
      const none: HistoryPage = { events: [], from: 0, earlierPrompts: 0 };
      const h = "key" in spec ? await deps.history(spec.key).catch(() => none) : none;
      if (!alive) return;
      set((p) => ({ ...p, events: [...h.events, ...p.events], earlier: h.from > 0 ? { from: h.from, prompts: h.earlierPrompts } : null, stale: new Set([...p.stale, ...cardIds(h.events)]) }));
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

  const send = useCallback((c: object) => void proc.current?.send(c).catch((e: unknown) => set((p) => failed(p, e instanceof Error ? e.message : String(e)))), []);
  return {
    ...s,
    send: (text, attachments) => send({ cmd: "send", text, ...(attachments?.length ? { attachments } : {}) }),
    steer: (text) => send({ cmd: "steer", text }),
    approve: (id, always) => send({ cmd: "approve", id, always }),
    deny: (id, message) => send({ cmd: "deny", id, ...(message ? { message } : {}) }),
    answer: (id, answers) => send({ cmd: "answer", id, answers }),
    interrupt: () => send({ cmd: "interrupt" }),
    review: () => send({ cmd: "review", target: "uncommitted" }),
    setModel: (model) => send({ cmd: "set-model", model }),
    setMode: (mode) => (set((p) => ({ ...p, mode })), send({ cmd: "set-mode", mode })),
    close: () => send({ cmd: "close" }),
    loadEarlier: async () => {
      const at = s.earlier;
      if (!spec || !("key" in spec) || !at) return;
      const h = await deps.history(spec.key, at.from);
      // Live events only ever append, so the history page goes in front of everything loaded.
      set((p) => (p.earlier?.from === at.from ? { ...p, events: [...h.events, ...p.events], earlier: h.from > 0 ? { from: h.from, prompts: h.earlierPrompts } : null, stale: new Set([...p.stale, ...cardIds(h.events)]) } : p));
    },
    allEvents: async () => {
      if (!spec || !("key" in spec) || !s.earlier) return s.events;
      const h = await deps.history(spec.key, s.earlier.from, true);
      return [...h.events, ...s.events];
    },
  };
}
