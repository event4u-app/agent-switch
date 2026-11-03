/** The reads only the v3 window needs, polled next to the 2.11 engines. Each
 *  feed keeps its last good value and the time it was read; a failing read
 *  leaves the previous value in place, so one broken CLI call never blanks a
 *  zone. */

import { useEffect, useRef, useState } from "react";

import * as ipc from "../../ipc.js";
import type { SessionRow } from "../../transforms.js";
import type { AwayDigest, NeedItem } from "../needs.js";
import type { EngineHealth, HistoryRow, HostList, LibraryList, OpenTargetsGlobal } from "./feeds.js";

export const FEEDS_POLL_MS = 10_000;
/** Library and Open-in settings change only through the app: every 6th tick. */
export const SLOW_EVERY = 6;

export interface V3Feeds {
  needs: { items: NeedItem[]; away: AwayDigest | null; history: HistoryRow[] } | null;
  engine: EngineHealth | null;
  host: HostList | null;
  library: LibraryList | null;
  openTargets: OpenTargetsGlobal | null;
  /** `sessions --provider codex --json`; the 2.11 poll reads Claude only. */
  codexRows: SessionRow[];
  /** Feed name → epoch ms of its last good read. */
  readAt: Partial<Record<FeedName, number>>;
}

export type FeedName = "needs" | "engine" | "host" | "library" | "openTargets" | "codexRows";

export const emptyFeeds = (): V3Feeds => ({ needs: null, engine: null, host: null, library: null, openTargets: null, codexRows: [], readAt: {} });

export interface FeedDeps {
  needs: () => Promise<NonNullable<V3Feeds["needs"]>>;
  engine: () => Promise<EngineHealth>;
  host: () => Promise<HostList>;
  library: () => Promise<LibraryList>;
  openTargets: () => Promise<OpenTargetsGlobal>;
  codexRows: () => Promise<SessionRow[]>;
}

export const realDeps: FeedDeps = {
  needs: ipc.listNeeds,
  engine: ipc.engineStatus,
  host: ipc.hostList,
  library: ipc.libraryList,
  openTargets: ipc.openTargetsGlobal,
  codexRows: () => ipc.listSessions(undefined, 20, "codex"),
};

/** One poll round. `slow` adds the reads that change rarely. */
export async function pollFeeds(prev: V3Feeds, deps: FeedDeps, slow: boolean, now: number): Promise<V3Feeds> {
  const names: FeedName[] = ["needs", "engine", "host", "codexRows", ...(slow ? (["library", "openTargets"] as FeedName[]) : [])];
  const results = await Promise.allSettled(names.map((n) => deps[n]()));
  const next: V3Feeds = { ...prev, readAt: { ...prev.readAt } };
  results.forEach((r, i) => {
    if (r.status !== "fulfilled") return;
    const n = names[i];
    (next as unknown as Record<FeedName, unknown>)[n] = r.value;
    next.readAt[n] = now;
  });
  return next;
}

/** Poll the v3 feeds; a hidden window polls every other tick. `refresh()` runs
 *  a full round now (after an action). */
export function useV3Feeds(deps: FeedDeps = realDeps): { feeds: V3Feeds; refresh: () => void } {
  const [feeds, setFeeds] = useState<V3Feeds>(emptyFeeds);
  const ref = useRef(feeds);
  ref.current = feeds;
  const kick = useRef<() => void>(() => {});
  useEffect(() => {
    let alive = true;
    let busy = false;
    let tick = 0;
    const round = async (slow: boolean) => {
      if (busy) return;
      busy = true;
      try {
        const next = await pollFeeds(ref.current, deps, slow, Date.now());
        if (alive) setFeeds(next);
      } finally {
        busy = false;
      }
    };
    kick.current = () => void round(true);
    void round(true);
    const id = setInterval(() => {
      tick++;
      if (document.visibilityState === "hidden" && tick % 2 === 1) return;
      void round(tick % SLOW_EVERY === 0);
    }, FEEDS_POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [deps]);
  return { feeds, refresh: () => kick.current() };
}
