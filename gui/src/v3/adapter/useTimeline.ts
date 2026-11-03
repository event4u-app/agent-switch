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

export function useTimeline(key: string | null, read: typeof ipc.sessionTimeline = ipc.sessionTimeline): TimelineState {
  const [s, set] = useState<TimelineState>({ events: [], version: null, newerThanFixtures: false, error: null, loaded: false });
  useEffect(() => {
    if (!key) return;
    let alive = true;
    const tick = () =>
      read(key)
        .then((r) => alive && set({ events: r.events, version: r.version, newerThanFixtures: r.newerThanFixtures, error: null, loaded: true }))
        .catch((e: unknown) => alive && set((p) => ({ ...p, error: e instanceof Error ? e.message : String(e), loaded: true })));
    void tick();
    const id = setInterval(() => document.visibilityState === "visible" && void tick(), TIMELINE_POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [key, read]);
  return s;
}
