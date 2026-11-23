/** One session's timeline, read with `timeline --json` while it is on screen.
 *  A session running elsewhere grows on disk; the poll follows it. */

import { useEffect, useState } from "react";

import * as ipc from "../../ipc.js";
import type { AsEvent } from "../timeline.js";

export const TIMELINE_POLL_MS = 4000;

export interface TimelineState {
  events: AsEvent[];
  version: string | null;
  newerThanFixtures: boolean;
  error: string | null;
  loaded: boolean;
}

const EMPTY: TimelineState = { events: [], version: null, newerThanFixtures: false, error: null, loaded: false };

export function useTimeline(key: string | null, read: typeof ipc.sessionTimeline = ipc.sessionTimeline): TimelineState {
  // The state remembers which session it belongs to: another session's conversation is never shown under this one.
  const [s, set] = useState<{ owner: string | null; t: TimelineState }>({ owner: key, t: EMPTY });
  useEffect(() => {
    if (!key) return;
    let alive = true;
    const tick = () =>
      read(key)
        .then((r) => alive && set({ owner: key, t: { events: r.events, version: r.version, newerThanFixtures: r.newerThanFixtures, error: null, loaded: true } }))
        .catch((e: unknown) => alive && set((p) => ({ owner: key, t: { ...(p.owner === key ? p.t : EMPTY), error: e instanceof Error ? e.message : String(e), loaded: true } })));
    void tick();
    const id = setInterval(() => document.visibilityState === "visible" && void tick(), TIMELINE_POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [key, read]);
  return s.owner === key ? s.t : EMPTY;
}
