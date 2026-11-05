/**
 * The tab strip's state (owner request 2026-11-05): the order the user gave the
 * tabs, which ones are pinned, and the recently closed ones to reopen.
 *
 * Three groups, always in this order: pinned tabs, then page tabs, then session
 * tabs (spec §6.1 keeps pages before sessions). Dragging reorders a tab inside
 * its own group; pinning moves it to the end of the pinned group. A pinned tab
 * does not close with the plain close action — only when asked for by name.
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

export function groupOf(id: string, pinned: readonly string[]): 0 | 1 | 2 {
  return pinned.includes(id) ? 0 : isPageTab(id) ? 1 : 2;
}

/** The order with each group kept together, the user's order inside each. */
export function arrange(order: readonly string[], pinned: readonly string[]): string[] {
  return ([0, 1, 2] as const).flatMap((g) => order.filter((id) => groupOf(id, pinned) === g));
}

function settle(s: TabState): TabState {
  const pinned = s.pinned.filter((id) => s.order.includes(id));
  return { ...s, pinned, order: arrange(s.order, pinned) };
}

/** Open a tab (no-op when it is open): at the end of its group. */
export function openTab(s: TabState, id: string): TabState {
  if (s.order.includes(id)) return s;
  return settle({ ...s, order: [...s.order, id] });
}

/** Seed the strip with tabs, pinned ones included; unknown pinned ids are dropped. */
export function seedTabs(s: TabState, ids: readonly string[], pinned: readonly string[]): TabState {
  const order = [...new Set([...ids, ...s.order])];
  return settle({ ...s, order, pinned: [...new Set([...pinned, ...s.pinned])] });
}

export function isPinned(s: TabState, id: string): boolean {
  return s.pinned.includes(id);
}

export function pinTab(s: TabState, id: string): TabState {
  if (!s.order.includes(id) || isPinned(s, id)) return s;
  return settle({ ...s, order: [...s.order.filter((x) => x !== id), id], pinned: [...s.pinned, id] });
}

export function unpinTab(s: TabState, id: string): TabState {
  if (!isPinned(s, id)) return s;
  // First in its group, next to the pinned tabs it just left.
  return settle({ ...s, order: [id, ...s.order.filter((x) => x !== id)], pinned: s.pinned.filter((x) => x !== id) });
}

/**
 * Close tabs. A pinned tab stays unless `force` names it closable — the plain
 * close (its button, middle click, "close others") never takes a pinned tab.
 */
export function closeTabs(s: TabState, ids: readonly string[], force = false): TabState {
  const gone = ids.filter((id) => s.order.includes(id) && (force || !isPinned(s, id)));
  if (!gone.length) return s;
  const closed = [...s.closed, ...gone.map((id) => ({ id, index: s.order.indexOf(id), pinned: isPinned(s, id) }))].slice(-CLOSED_KEEP);
  return settle({ order: s.order.filter((id) => !gone.includes(id)), pinned: s.pinned.filter((id) => !gone.includes(id)), closed });
}

export const closeTab = (s: TabState, id: string, force = false): TabState => closeTabs(s, [id], force);

/** Every unpinned tab but `id`. */
export const closeOthers = (s: TabState, id: string): TabState => closeTabs(s, s.order.filter((x) => x !== id));

/** The unpinned tabs to the right of `id`. */
export const closeToRight = (s: TabState, id: string): TabState => closeTabs(s, s.order.slice(s.order.indexOf(id) + 1));

/** Every unpinned tab. */
export const closeUnpinned = (s: TabState): TabState => closeTabs(s, s.order);

/** The tabs a close of `ids` would actually take (pinned ones stay). */
export const closable = (s: TabState, ids: readonly string[]): string[] => ids.filter((id) => s.order.includes(id) && !isPinned(s, id));

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
    return { state: settle({ order, pinned: c.pinned ? [...s.pinned, c.id] : s.pinned, closed }), id: c.id };
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
  if (id === target || !s.order.includes(id) || !s.order.includes(target)) return s;
  const rest = s.order.filter((x) => x !== id);
  const g = groupOf(id, s.pinned);
  const tg = groupOf(target, s.pinned);
  let at: number;
  if (tg === g) at = rest.indexOf(target) + (side === "after" ? 1 : 0);
  else {
    const own = rest.map((x, i) => [x, i] as const).filter(([x]) => groupOf(x, s.pinned) === g);
    at = tg < g ? (own.length ? own[0][1] : rest.length) : own.length ? own[own.length - 1][1] + 1 : 0;
  }
  rest.splice(at, 0, id);
  return settle({ ...s, order: rest });
}

/** The tab to show after `id` closes: the one now at its place, else the last. */
export function nextActive(before: readonly string[], after: readonly string[], id: string, active: string | null): string | null {
  if (active !== id) return active && after.includes(active) ? active : (after[0] ?? null);
  const at = before.indexOf(id);
  return after[Math.min(at, after.length - 1)] ?? null;
}
