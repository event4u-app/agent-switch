/**
 * What the window remembers between starts, next to the appearance: the open
 * session tabs, the active one, and the Sessions window's view (spec §4a of
 * the gap report; §5.2 density). Nothing here names an account or a file.
 */

import { liveOrder, type RowSession } from "./sessions.js";

export interface WindowLayout {
  tabs: string[];
  /** Pinned tabs, page tabs (`page:<id>`) included; they come back after a restart. */
  pinned?: string[];
  active: string | null;
  comfortable: boolean;
  groupByProject: boolean;
  pinnedOnly: boolean;
}

export interface LayoutStore {
  load(): Partial<WindowLayout> | null;
  save(l: WindowLayout): void;
}

export const LAYOUT_KEY = "agent-switch-v3-layout";

/** A stored layout, field by field; anything malformed is dropped, never thrown. Pure. */
export function parseLayout(raw: string | null): Partial<WindowLayout> | null {
  if (!raw) return null;
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object") return null;
  const v = o as Record<string, unknown>;
  const out: Partial<WindowLayout> = {};
  if (Array.isArray(v.tabs)) out.tabs = v.tabs.filter((t): t is string => typeof t === "string").slice(0, 20);
  if (Array.isArray(v.pinned)) out.pinned = v.pinned.filter((t): t is string => typeof t === "string").slice(0, 20);
  if (typeof v.active === "string" || v.active === null) out.active = v.active as string | null;
  for (const k of ["comfortable", "groupByProject", "pinnedOnly"] as const) if (typeof v[k] === "boolean") out[k] = v[k] as boolean;
  return out;
}

/**
 * The tabs the window opens on: the saved ones that still exist, else the
 * first live session (needs you → CI failing → working), else none. Pure.
 */
export function startTabs(saved: Partial<WindowLayout> | null, sessions: readonly RowSession[]): { tabs: string[]; active: string | null } {
  const known = new Set(sessions.map((s) => s.key));
  const tabs = (saved?.tabs ?? []).filter((k) => known.has(k));
  if (tabs.length) return { tabs, active: saved?.active && tabs.includes(saved.active) ? saved.active : tabs[0] };
  const first = liveOrder(sessions)[0];
  return first ? { tabs: [first.key], active: first.key } : { tabs: [], active: null };
}

/** The window's store in localStorage; a missing or blocked store remembers nothing. */
export const localLayout: LayoutStore = {
  load() {
    try {
      return parseLayout(localStorage.getItem(LAYOUT_KEY));
    } catch {
      return null;
    }
  },
  save(l) {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(l));
    } catch {
      /* blocked: this start only */
    }
  },
};
