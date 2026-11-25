/**
 * The tab strip's state (owner request 2026-11-05): the order the user gave the
 * tabs, which ones are pinned, and the recently closed ones to reopen.
 *
 * Always in this order: the main tab (a session or a page), then pinned tabs,
 * then page tabs, then session tabs (spec §6.1 keeps pages before sessions). The main tab stays
 * first — nothing moves before it, it is never pinned, it never closes (owner,
 * 2026-11-26). Dragging reorders a tab inside its own group; pinning moves it
 * to the end of the pinned group. A pinned tab does not close with the plain
 * close action — only when asked for by name.
 * Pure: every function returns a new state.
 */

export interface ClosedTab {
  id: string;
  /** Where it stood, to come back to the same place. */
  index: number;
  pinned: boolean;
}

export interface TabState {
  order: string[];
  pinned: string[];
  /** Most recently closed last. */
  closed: ClosedTab[];
}

export const EMPTY_TABS: TabState = { order: [], pinned: [], closed: [] };

/** How many closed tabs can be reopened. */
export const CLOSED_KEEP = 25;

export const isPageTab = (id: string): boolean => id.startsWith("page:");

/**
 * A session can have more than one tab (owner, 2026-11-25: duplicate a tab, open a session in a new
 * tab). The first one's id is the session key; each copy is `<key>#<n>`. Pure.
 */
export const sessionOf = (id: string): string => (isPageTab(id) ? id : id.replace(/#\d+$/, ""));

/** A fresh id for one more tab of the session (`<key>#2`, `#3`, …). Pure. */
export function copyId(s: TabState, key: string): string {
  let n = 2;
  while (s.order.includes(`${key}#${n}`)) n += 1;
  return `${key}#${n}`;
}

/**
 * Everything opens in the main tab (owner, 2026-11-25/26): sessions and pages alike (Arenas, Settings, a
 * review…) take the main tab's place; a session or page that already has a tab goes to it. With no main
 * tab, a new one. A new tab only when asked for. Returns the new state and the tab to show. Pure.
 */
export function openInDefault(s: TabState, key: string): { state: TabState; id: string } {
  const own = s.order.find((id) => (isPageTab(key) ? id === key : !isPageTab(id) && sessionOf(id) === key));
  if (own) return { state: s, id: own };
  const slot = mainTab(s);
  if (!slot) return { state: openTab(s, key), id: key };
  // The tab in the slot gives way: when it was the main tab, the session takes its place as the main tab.
  const order = s.order.map((id) => (id === slot ? key : id));
  return { state: settle({ ...s, order }, { ...s, order }), id: key };
}

/** One more tab: the session's own when it has none, else a copy, right after `after` when given. Pure. */
export function openAnother(s: TabState, key: string, after?: string): { state: TabState; id: string } {
  const has = s.order.some((id) => !isPageTab(id) && sessionOf(id) === key);
  const id = has ? copyId(s, key) : key;
  const at = after ? s.order.indexOf(after) : -1;
  const order = at < 0 ? [...s.order, id] : [...s.order.slice(0, at + 1), id, ...s.order.slice(at + 1)];
  return { state: settle({ ...s, order }, s), id };
}

/** -1 the main tab, 0 pinned, 1 pages, 2 sessions. */
export function groupOf(id: string, pinned: readonly string[], main: string | null = null): -1 | 0 | 1 | 2 {
  return id === main ? -1 : pinned.includes(id) ? 0 : isPageTab(id) ? 1 : 2;
}

/** The order with each group kept together, the user's order inside each; the main tab first. */
export function arrange(order: readonly string[], pinned: readonly string[], main: string | null = null): string[] {
  return ([-1, 0, 1, 2] as const).flatMap((g) => order.filter((id) => groupOf(id, pinned, main) === g));
}

const firstFree = (order: readonly string[], pinned: readonly string[]) => order.find((id) => !pinned.includes(id)) ?? null;

/** Regroup `next`; the main tab of `prev` stays the main tab while it is open and unpinned. */
function settle(next: TabState, prev: TabState = next): TabState {
  const pinned = next.pinned.filter((id) => next.order.includes(id));
  const was = firstFree(prev.order, prev.pinned);
  const main = was && next.order.includes(was) && !pinned.includes(was) ? was : firstFree(next.order, pinned);
  return { ...next, pinned, order: arrange(next.order, pinned, main) };
}

/** Open a tab (no-op when it is open): at the end of its group. */
export function openTab(s: TabState, id: string): TabState {
  if (s.order.includes(id)) return s;
  return settle({ ...s, order: [...s.order, id] }, s);
}

/** Seed the strip with tabs, pinned ones included; unknown pinned ids are dropped. */
export function seedTabs(s: TabState, ids: readonly string[], pinned: readonly string[]): TabState {
  const order = [...new Set([...ids, ...s.order])];
  const next = { ...s, order, pinned: [...new Set([...pinned, ...s.pinned])] };
  return settle(next, s.order.length ? s : next);
}

export function isPinned(s: TabState, id: string): boolean {
  return s.pinned.includes(id);
}

export function pinTab(s: TabState, id: string): TabState {
  // The main tab is never pinned: it stays first and takes what opens.
  if (!s.order.includes(id) || isPinned(s, id) || id === mainTab(s)) return s;
  return settle({ ...s, order: [...s.order.filter((x) => x !== id), id], pinned: [...s.pinned, id] }, s);
}

export function unpinTab(s: TabState, id: string): TabState {
  if (!isPinned(s, id)) return s;
  // First in its group, next to the pinned tabs it just left — after the main tab, never before it.
  return settle({ ...s, order: [id, ...s.order.filter((x) => x !== id)], pinned: s.pinned.filter((x) => x !== id) }, s);
}

/**
 * Close tabs. A pinned tab stays unless `force` names it closable — the plain
 * close (its button, middle click, "close others") never takes a pinned tab.
 */
export function closeTabs(s: TabState, ids: readonly string[], force = false): TabState {
  // The main tab never closes, by any path (owner, 2026-11-25).
  const main = mainTab(s);
  const gone = ids.filter((id) => s.order.includes(id) && id !== main && (force || !isPinned(s, id)));
  if (!gone.length) return s;
  const closed = [...s.closed, ...gone.map((id) => ({ id, index: s.order.indexOf(id), pinned: isPinned(s, id) }))].slice(-CLOSED_KEEP);
  return settle({ order: s.order.filter((id) => !gone.includes(id)), pinned: s.pinned.filter((id) => !gone.includes(id)), closed }, s);
}

export const closeTab = (s: TabState, id: string, force = false): TabState => closeTabs(s, [id], force);

/** Every unpinned tab but `id`. */
export const closeOthers = (s: TabState, id: string): TabState => closeTabs(s, s.order.filter((x) => x !== id));

/** The unpinned tabs to the right of `id`. */
export const closeToRight = (s: TabState, id: string): TabState => closeTabs(s, s.order.slice(s.order.indexOf(id) + 1));

/** The unpinned tabs to the left of `id` (the main tab stays). */
export const closeToLeft = (s: TabState, id: string): TabState => closeTabs(s, s.order.slice(0, Math.max(0, s.order.indexOf(id))));

/** Every unpinned tab. */
export const closeUnpinned = (s: TabState): TabState => closeTabs(s, s.order);

/** The tabs a close of `ids` would actually take (pinned ones stay). */
export const closable = (s: TabState, ids: readonly string[]): string[] => ids.filter((id) => s.order.includes(id) && !isPinned(s, id) && id !== mainTab(s));

/** The main tab: the first tab that is not pinned — a session or a page — always first in the strip. Everything opens there; it cannot be closed (owner, 2026-11-25/26). Pure. */
export const mainTab = (s: TabState): string | null => firstFree(s.order, s.pinned);

/**
 * Reopen the most recently closed tab that can still open (`exists`) and is
 * not open already; tabs that can no longer open are dropped on the way.
 */
export function reopenTab(s: TabState, exists: (id: string) => boolean): { state: TabState; id: string | null } {
  const closed = [...s.closed];
  while (closed.length) {
    const c = closed.pop()!;
    if (s.order.includes(c.id) || !exists(c.id)) continue;
    const order = [...s.order];
    order.splice(Math.min(c.index, order.length), 0, c.id);
    return { state: settle({ order, pinned: c.pinned ? [...s.pinned, c.id] : s.pinned, closed }, s), id: c.id };
  }
  return { state: { ...s, closed }, id: null };
}

/** Whether anything is left to reopen (a hint for the menu; reopen still checks). */
export const canReopen = (s: TabState): boolean => s.closed.some((c) => !s.order.includes(c.id));

/**
 * Drop `id` before or after `target`. A drop into another group lands at the
 * nearest end of the tab's own group: pinned tabs stay first.
 */
export function moveTab(s: TabState, id: string, target: string, side: "before" | "after"): TabState {
  const main = mainTab(s);
  // The main tab does not move, and nothing goes before it.
  if (id === target || id === main || !s.order.includes(id) || !s.order.includes(target)) return s;
  const rest = s.order.filter((x) => x !== id);
  const g = groupOf(id, s.pinned, main);
  const tg = groupOf(target, s.pinned, main);
  let at: number;
  if (tg === g) at = rest.indexOf(target) + (side === "after" ? 1 : 0);
  else {
    const own = rest.map((x, i) => [x, i] as const).filter(([x]) => groupOf(x, s.pinned) === g);
    at = tg < g ? (own.length ? own[0][1] : rest.length) : own.length ? own[own.length - 1][1] + 1 : 0;
  }
  rest.splice(at, 0, id);
  return settle({ ...s, order: rest }, s);
}

/** One step left (-1) or right (+1) inside the tab's own group; the main tab stays put. Pure. */
export function shiftTab(s: TabState, id: string, dir: -1 | 1): TabState {
  const main = mainTab(s);
  if (id === main) return s;
  const zone = s.order.filter((x) => groupOf(x, s.pinned, main) === groupOf(id, s.pinned, main));
  const to = zone[zone.indexOf(id) + dir];
  return to ? moveTab(s, id, to, dir < 0 ? "before" : "after") : s;
}

/** Whether `id` can take a step that way inside its group. */
export const canShift = (s: TabState, id: string, dir: -1 | 1): boolean => shiftTab(s, id, dir) !== s;

/** The tab to show after `id` closes: the one now at its place, else the last. */
export function nextActive(before: readonly string[], after: readonly string[], id: string, active: string | null): string | null {
  if (active !== id) return active && after.includes(active) ? active : (after[0] ?? null);
  const at = before.indexOf(id);
  return after[Math.min(at, after.length - 1)] ?? null;
}
