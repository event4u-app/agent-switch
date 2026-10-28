/**
 * Usage auto-refresh (classic window's 1 s ticker): while "Auto-refresh limits"
 * is on, reload when the persisted deadline passes, then push the deadline a
 * full interval out. A changed interval re-bases the deadline at once. The
 * settings live in localStorage and are read each tick, so Settings › General
 * needs no channel to this engine.
 */

import { useEffect, useRef } from "react";
import { getAutoRefreshLimits, getNextUsageRefreshAt, getRefreshMinutes, setNextUsageRefreshAt } from "../../settings-store.js";
import { useAS } from "../../vm/store.js";

export const USAGE_TICK_MS = 1000;

export interface RefreshTickState {
  minutes: number;
}

/** One tick. Returns the deadline to publish when it moved, and whether to reload. */
export function usageTick(
  state: RefreshTickState,
  now: number,
  read: { minutes: number; autoRefresh: boolean; deadline: number },
): { deadline: number | null; reload: boolean } {
  if (read.minutes !== state.minutes) {
    state.minutes = read.minutes;
    return { deadline: now + read.minutes * 60_000, reload: false };
  }
  if (!read.deadline) return { deadline: now + read.minutes * 60_000, reload: false };
  if (read.autoRefresh && now >= read.deadline) return { deadline: now + read.minutes * 60_000, reload: true };
  return { deadline: null, reload: false };
}

export function useUsageAutoRefresh(tickMs: number = USAGE_TICK_MS): void {
  const s = useAS();
  const sRef = useRef(s);
  sRef.current = s;
  useEffect(() => {
    const state: RefreshTickState = { minutes: getRefreshMinutes() };
    const id = setInterval(() => {
      const r = usageTick(state, Date.now(), {
        minutes: getRefreshMinutes(),
        autoRefresh: getAutoRefreshLimits(),
        deadline: getNextUsageRefreshAt(),
      });
      if (r.deadline != null) {
        setNextUsageRefreshAt(r.deadline);
        sRef.current.update({ usageNextAt: r.deadline });
      }
      if (r.reload) void sRef.current.reload();
    }, tickMs);
    return () => clearInterval(id);
  }, [tickMs]);
}
