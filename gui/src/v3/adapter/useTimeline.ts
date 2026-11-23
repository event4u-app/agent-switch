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
) => Promise<{ events: AsEvent[]; version: string | null; newerThanFixtures: boolean; from?: number; earlierPrompts?: number; hidden?: Record<string, number>; truncated?: boolean }>;

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
  /** Only the end is shown and nothing more can be loaded: the read left out the head of the
   *  file (a subagent's, bounded), or older events a reader that cannot page did not return. */
  cut: boolean;
}

const EMPTY: TimelineState = { events: [], version: null, newerThanFixtures: false, error: null, loaded: false, earlier: null, hidden: {}, cut: false };

const realRead: TimelineRead = (key, at) => ipc.sessionTimeline(key, at ?? {});

interface Loaded {
  events: AsEvent[];
  version: string | null;
  newerThanFixtures: boolean;
  /** Index of the first loaded event, and the prompts before it; null prompts: the reader cannot page. */
  from: number;
  prompts: number | null;
  hidden: Record<string, number>;
  truncated: boolean;
}

export function useTimeline(key: string | null, read: TimelineRead = realRead): TimelineState {
  // The state remembers which session it belongs to: another session's conversation is never shown under this one.
  const [s, set] = useState<{ owner: string | null; data: Loaded | null; error: string | null; loaded: boolean }>({ owner: key, data: null, error: null, loaded: false });
  /** The earliest index loaded on demand; null: only the newest page. */
  const start = useRef<{ owner: string | null; at: number | null }>({ owner: key, at: null });
  /** Reads are numbered as they go out; an answer older than the one shown is dropped, so the view never rolls back. */
  const seq = useRef({ issued: 0, shown: 0 });
  /** The snapshot shown, for the load-earlier merge (state updaters cannot report back). */
  const shown = useRef<{ owner: string | null; data: Loaded | null }>({ owner: key, data: null });
  /** The current poll, so a load that finds a gap can read it at once. */
  const poll = useRef<() => Promise<void>>(async () => {});
  const show = useCallback((owner: string, data: Loaded) => {
    shown.current = { owner, data };
    set({ owner, data, error: null, loaded: true });
  }, []);
  useEffect(() => {
    if (!key) return;
    let alive = true;
    start.current = { owner: key, at: null };
    shown.current = { owner: key, data: null };
    const tick = () => {
      const at = start.current.at;
      const n = ++seq.current.issued;
      return (at === null ? read(key) : read(key, { from: at }))
        .then((r) => {
          // A page read before earlier turns arrived would drop them again; an older answer would roll back.
          if (!alive || start.current.owner !== key || start.current.at !== at || n < seq.current.shown) return;
          seq.current.shown = n;
          show(key, { events: r.events, version: r.version, newerThanFixtures: r.newerThanFixtures, from: r.from ?? 0, prompts: r.earlierPrompts ?? null, hidden: r.hidden ?? {}, truncated: r.truncated === true });
        })
        .catch((e: unknown) => alive && set((p) => ({ ...(p.owner === key ? p : { data: null }), owner: key, error: e instanceof Error ? e.message : String(e), loaded: true })));
    };
    poll.current = async () => void (await tick());
    void tick();
    const id = setInterval(() => document.visibilityState === "visible" && void tick(), TIMELINE_POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
      poll.current = async () => {};
    };
  }, [key, read, show]);

  const data = s.owner === key ? s.data : null;
  const load = useCallback(async () => {
    if (!key || !data || data.from === 0) return;
    const end = data.from;
    const r = await read(key, { before: end });
    if (start.current.owner !== key) return;
    const from = r.from ?? 0;
    start.current = { owner: key, at: from };
    // Joined by event index with what is shown now, which a poll may have moved on meanwhile.
    const cur = shown.current.owner === key ? shown.current.data : null;
    if (!cur) return;
    if (cur.from > end) {
      // The newest page moved past the loaded one: the events between are read, never skipped.
      await poll.current();
      return;
    }
    seq.current.shown = ++seq.current.issued;
    if (cur.from <= from) return;
    const before = r.events.slice(0, cur.from - from);
    show(key, { ...cur, events: [...before, ...cur.events], from, prompts: r.earlierPrompts ?? 0 });
  }, [key, read, data, show]);
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
    cut: !!data && (data.truncated || (data.from > 0 && data.prompts === null)),
  };
}
