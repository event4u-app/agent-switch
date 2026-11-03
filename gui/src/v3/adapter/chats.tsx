/** The chats this window runs. A bridge must outlive its tab being hidden, so
 *  each runs in an invisible runner here and the tab only draws its state. */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import type * as ipc from "../../ipc.js";
import type { SessionRow } from "../../transforms.js";
import { notify as realNotify } from "../../redesign/engines/bus.js";
import type { AsEvent } from "../timeline.js";
import { useBridge, type BridgeActions, type BridgeDeps, type BridgeState } from "./useBridge.js";

export type Chat = BridgeState & BridgeActions;
type Notify = (kind: "warning" | "success", title: string, message: string) => void;

/** What deserves a notification when the window is hidden. Pure. */
export function noticeFor(e: AsEvent, title: string): { kind: "warning" | "success"; title: string; message: string } | null {
  if (e.t === "approval.requested") return { kind: "warning", title: `${title} needs your approval`, message: `${e.tool} ${e.summary}`.trim() };
  if (e.t === "question.requested") return { kind: "warning", title: `${title} asks you`, message: e.questions[0]?.question ?? "" };
  if (e.t === "turn.end" && e.ok) return { kind: "success", title: `${title} is done`, message: "The turn ended." };
  return null;
}

function Runner({ tab, spec, title, report, deps, notify }: { tab: string; spec: ipc.BridgeSpec; title: string; report: (tab: string, c: Chat) => void; deps?: BridgeDeps; notify: Notify }) {
  const chat = useBridge(spec, deps);
  const seen = useRef(0);
  // The actions are rebuilt every render but call the same bridge; report when the state moves.
  useEffect(() => {
    report(tab, chat);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, report, chat.events, chat.status, chat.error, chat.queued, chat.mode, chat.session]);
  useEffect(() => {
    // Only events that arrive live: the history read at the start is not news.
    const fresh = chat.events.slice(seen.current);
    seen.current = chat.events.length;
    if (chat.status !== "ready" || typeof document === "undefined" || document.visibilityState === "visible") return;
    for (const e of fresh) {
      const n = noticeFor(e, title);
      if (n) notify(n.kind, n.title, n.message);
    }
  }, [chat.events, chat.status, title, notify]);
  return null;
}

export interface Chats {
  /** Tab key → the chat's state. */
  states: ReadonlyMap<string, Chat>;
  /** Keys shown in the chat view (tab keys and the real session keys they became). */
  keys: ReadonlySet<string>;
  /** The tab a key belongs to, following a new chat to its real session key. */
  tabOf: (key: string) => string | undefined;
  /** A row per chat, for the sessions list and the session bar until the CLI lists it. */
  rows: SessionRow[];
  open: (tab: string, spec: ipc.BridgeSpec) => void;
  close: (tab: string) => void;
  runners: ReactNode;
}

export function useChats(titleOf: (key: string) => string, deps?: BridgeDeps, notify: Notify = (k, t, m) => void realNotify(k, t, m)): Chats {
  const [specs, setSpecs] = useState<Map<string, ipc.BridgeSpec>>(new Map());
  const [states, setStates] = useState<Map<string, Chat>>(new Map());
  const report = useCallback((tab: string, c: Chat) => setStates((m) => (m.get(tab) === c ? m : new Map(m).set(tab, c))), []);
  const alias = new Map<string, string>();
  for (const [tab, c] of states) if (c.session?.key && c.session.key !== tab) alias.set(c.session.key, tab);
  const keys = new Set<string>([...specs.keys(), ...alias.keys()]);
  const rows: SessionRow[] = [...specs].map(([tab, spec]) => {
    const c = states.get(tab);
    const [provider, profile, id] = tab.split("/");
    return {
      provider: provider === "codex" ? "codex" : "claude",
      profile,
      sessionId: id,
      projectDir: "",
      cwd: "new" in spec ? spec.new.cwd : null,
      mtimeMs: Date.now(),
      live: c?.status !== "closed" && c?.status !== "error",
      summary: "New chat",
      ...(c?.session?.model ? { context: { pct: 0, model: c.session.model, contextTokens: 0, windowTokens: 0, confidence: "low", source: "transcript" } as never } : {}),
    };
  });
  return {
    states,
    keys,
    rows,
    tabOf: (key) => (specs.has(key) ? key : alias.get(key)),
    open: (tab, spec) => setSpecs((m) => (m.has(tab) ? m : new Map(m).set(tab, spec))),
    close: (tab) => {
      states.get(tab)?.close();
      setSpecs((m) => {
        const n = new Map(m);
        n.delete(tab);
        return n;
      });
      setStates((m) => {
        const n = new Map(m);
        n.delete(tab);
        return n;
      });
    },
    runners: [...specs].map(([tab, spec]) => <Runner key={tab} tab={tab} spec={spec} title={titleOf(states.get(tab)?.session?.key ?? tab)} report={report} deps={deps} notify={notify} />),
  };
}
