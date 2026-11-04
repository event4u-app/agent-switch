/**
 * The decision sheet opens by itself when a session reaches its limit (owner
 * request 2026-11-04): a dialog the user confirms, never a switch on its own.
 * Once per item and version — a dismissed sheet stays dismissed until the item
 * changes (the next reset cycle, another stop). Remembered per viewer in
 * localStorage; a store that fails only means the sheet may open once more.
 */

import type { NeedItem } from "../needs.js";

const KEY = "agent-switch-limit-auto-opened";
const KEEP = 50;

/** What a remembered limit is keyed by: the item and the version it is at. */
export type LimitMark = Pick<NeedItem, "id" | "version">;

const keyOf = (n: LimitMark) => `${n.id}@${n.version}`;

/** The limit to open now: the first one not opened yet that has a session to move. */
export function limitToOpen(needs: readonly NeedItem[], opened: ReadonlySet<string>, hasSessions: (subject: string) => boolean): NeedItem | null {
  return needs.find((n) => n.kind === "limit" && !opened.has(keyOf(n)) && hasSessions(n.subject)) ?? null;
}

export function wasOpened(opened: ReadonlySet<string>, n: LimitMark): boolean {
  return opened.has(keyOf(n));
}

export function openedLimits(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function markLimitOpened(n: LimitMark): void {
  try {
    const all = [...openedLimits(), keyOf(n)];
    localStorage.setItem(KEY, JSON.stringify(all.slice(-KEEP)));
  } catch {
    /* a lost mark only reopens the sheet once more */
  }
}
