/** One session's timeline, read with `timeline --json` while it is on screen.
 *  A session running elsewhere grows on disk; the poll follows it. The first read
 *  is the newest page; earlier turns load on demand, and from then on the poll
 *  reads everything from the earliest loaded index, so nothing in between is lost. */

import { useCallback, useEffect, useRef, useState } from "react";

import * as ipc from "../../ipc.js";
import type { AsEvent } from "../timeline.js";

export const TIMELINE_POLL_MS = 4000;

/** One read: no `at` is the newest page; `before` the page ending there; `from` every event from there on.
 *  A reader that cannot page (a subagent's) omits `earlierPrompts`, and no load-more is offered. */
export type TimelineRead = (
  key: string,
  at?: { before?: number; from?: number },
) => Promise<{ events: AsEvent[]; version: string | null; newerThanFixtures: boolean; from?: number; earlierPrompts?: number; hidden?: Record<string, number> }>;

export interface TimelineState {
  events: AsEvent[];
  version: string | null;
  newerThanFixtures: boolean;
  error: string | null;
  loaded: boolean;
  /** Turns before the loaded part: how many prompts, and how to read them. Null when all is loaded. */
  earlier: { prompts: number; load: () => Promise<void>; all: () => Promise<AsEvent[]> } | null;
  /** Bookkeeping lines the CLI left out, by kind. */
  hidden: Record<string, number>;
}

const EMPTY: TimelineState = { events: [], version: null, newerThanFixtures: false, error: null, loaded: false, earlier: null, hidden: {} };

const realRead: TimelineRead = (key, at) => ipc.sessionTimeline(key, at ?? {});

interface Loaded {
  events: AsEvent[];
  version: string | null;
  newerThanFixtures: boolean;
  /** Index of the first loaded event, and the prompts before it; null prompts: the reader cannot page. */
  from: number;
  prompts: number | null;
  hidden: Record<string, number>;
}

export function useTimeline(key: string | null, read: TimelineRead = realRead): TimelineState {
  // The state remembers which session it belongs to: another session's conversation is never shown under this one.
  const [s, set] = useState<{ owner: string | null; data: Loaded | null; error: string | null; loaded: boolean }>({ owner: key, data: null, error: null, loaded: false });
  /** The earliest index loaded on demand; null: only the newest page. */
  const start = useRef<{ owner: string | null; at: number | null }>({ owner: key, at: null });
  useEffect(() => {
    if (!key) return;
    let alive = true;
    start.current = { owner: key, at: null };
    const tick = () => {
      const at = start.current.at;
      return (at === null ? read(key) : read(key, { from: at }))
        .then((r) => {
          // A page read before earlier turns arrived would drop them again.
          if (!alive || start.current.owner !== key || start.current.at !== at) return;
          set({ owner: key, data: { events: r.events, version: r.version, newerThanFixtures: r.newerThanFixtures, from: r.from ?? 0, prompts: r.earlierPrompts ?? null, hidden: r.hidden ?? {} }, error: null, loaded: true });
        })
        .catch((e: unknown) => alive && set((p) => ({ ...(p.owner === key ? p : { data: null }), owner: key, error: e instanceof Error ? e.message : String(e), loaded: true })));
    };
    void tick();
    const id = setInterval(() => document.visibilityState === "visible" && void tick(), TIMELINE_POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [key, read]);

  const data = s.owner === key ? s.data : null;
  const load = useCallback(async () => {
    if (!key || !data || data.from === 0) return;
    const r = await read(key, { before: data.from });
    if (start.current.owner !== key) return;
    const from = r.from ?? 0;
    start.current = { owner: key, at: from };
    set((p) => (p.owner === key && p.data ? { ...p, data: { ...p.data, events: [...r.events, ...p.data.events], from, prompts: r.earlierPrompts ?? 0 } } : p));
  }, [key, read, data]);
  const all = useCallback(async () => {
    if (!key || !data || data.from === 0) return data?.events ?? [];
    const r = await read(key, { from: 0, before: data.from });
    return [...r.events, ...data.events];
  }, [key, read, data]);

  if (s.owner !== key) return EMPTY;
  return {
    events: data?.events ?? [],
    version: data?.version ?? null,
    newerThanFixtures: data?.newerThanFixtures ?? false,
    error: s.error,
    loaded: s.loaded,
    earlier: data && data.from > 0 && data.prompts !== null ? { prompts: data.prompts, load, all } : null,
    hidden: data?.hidden ?? {},
  };
}
