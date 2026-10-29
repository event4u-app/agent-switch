/**
 * Record-and-deliver for every background engine. An engine records an event
 * in the shared notification log (CLI + daemon own it) and asks the
 * notification engine to sync, which fires the desktop / toast / pet sinks.
 * The bus decouples the writers (actions, update loops) from the one reader.
 * A write from another window (the tray popover) reaches the main window's
 * engine as a Tauri event.
 */

export const SYNC_EVENT = "notifications:sync";
const MAIN = "main";

function windowLabel(): string | null {
  try {
    return getCurrentWebviewWindow().label;
  } catch {
    return null; // not in Tauri (tests)
  }
}

import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { recordNotification } from "../../ipc.js";
import type { NotificationKind } from "../../notifications.js";

type Listener = () => void;
const listeners = new Set<Listener>();

/** Main-window side: local requests plus those other windows emit. */
export function onSyncRequest(l: Listener): () => void {
  listeners.add(l);
  let unlisten: (() => void) | null = null;
  let gone = false;
  if (windowLabel() === MAIN) {
    listen(SYNC_EVENT, () => l())
      .then((u) => (gone ? u() : (unlisten = u)))
      .catch(() => {});
  }
  return () => {
    gone = true;
    listeners.delete(l);
    unlisten?.();
  };
}

export function requestNotificationSync(): void {
  for (const l of listeners) l();
  const label = windowLabel();
  if (label && label !== MAIN) void emitTo(MAIN, SYNC_EVENT).catch(() => {});
}

/** Best-effort: a failed record never throws into the caller's flow.
 *  `repeat`: an identical notice is still its own moment (not collapsed). */
export async function notify(kind: NotificationKind, title: string, message: string, opts: { repeat?: boolean } = {}): Promise<void> {
  try {
    await recordNotification(kind, title, message, opts.repeat);
  } catch {
    /* best-effort — the log is the source of truth */
  }
  requestNotificationSync();
}
