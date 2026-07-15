/**
 * Notification event log — a small persistent ring buffer shared by the daemon
 * (auto-switch results, poll failures) and the GUI (its own limit-fetch
 * failures). It is the single source of truth for the app's bell/flyout and the
 * "internal system" fallback when desktop notifications are unavailable.
 *
 * Stored at `~/.agent-switch/notifications.json` as a plain JSON array, oldest
 * first, capped at MAX_NOTIFICATIONS. Appends deduplicate an identical event
 * within DEDUP_WINDOW_MS so a persistent failure polled every few minutes does
 * not spam the list (and does not re-fire a desktop notification each cycle).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { ROOT } from "./profiles.js";

export type NotificationKind = "success" | "error" | "warning" | "info";

export interface Notification {
  /** Unique, monotonic-ish id (`<ts>-<rand>`); the GUI diffs on `ts`. */
  id: string;
  /** Unix epoch milliseconds. */
  ts: number;
  kind: NotificationKind;
  title: string;
  message: string;
  /** Set when the daemon already fired an OS desktop notification for this
   *  event, so the GUI does not show it a second time. */
  osNotified?: boolean;
}

export const NOTIFICATIONS_FILE = path.join(ROOT, "notifications.json");
export const MAX_NOTIFICATIONS = 25;
/** An identical event within this window is dropped instead of re-appended. */
export const DEDUP_WINDOW_MS = 30 * 60_000;

export function readNotifications(file: string = NOTIFICATIONS_FILE): Notification[] {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(raw) ? (raw as Notification[]) : [];
  } catch {
    return []; // missing / unreadable / malformed → empty, never throws
  }
}

function writeNotifications(list: Notification[], file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(list.slice(-MAX_NOTIFICATIONS)));
}

/**
 * Append an event (kept newest-last). Deduplicates a byte-identical
 * kind+title+message against the most recent entry within DEDUP_WINDOW_MS.
 * Returns the created notification, or `null` when it was deduplicated.
 */
export function appendNotification(
  event: Pick<Notification, "kind" | "title" | "message">,
  now: number = Date.now(),
  file: string = NOTIFICATIONS_FILE,
): Notification | null {
  const list = readNotifications(file);
  const last = list[list.length - 1];
  if (
    last &&
    last.kind === event.kind &&
    last.title === event.title &&
    last.message === event.message &&
    now - last.ts < DEDUP_WINDOW_MS
  ) {
    return null;
  }
  const created: Notification = {
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    ts: now,
    kind: event.kind,
    title: event.title,
    message: event.message,
  };
  writeNotifications([...list, created], file);
  return created;
}

export function clearNotifications(file: string = NOTIFICATIONS_FILE): void {
  writeNotifications([], file);
}

/** Mark a stored notification as already-OS-notified (set by the daemon after it
 *  fires a desktop notification, so the GUI does not re-notify). No-op if the id
 *  is gone (trimmed out of the ring). */
export function markOsNotified(id: string, file: string = NOTIFICATIONS_FILE): void {
  const list = readNotifications(file);
  const n = list.find((x) => x.id === id);
  if (!n) return;
  n.osNotified = true;
  writeNotifications(list, file);
}
