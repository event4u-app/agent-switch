/**
 * GUI notification layer. The event log itself is owned by the CLI
 * (`agent-switch notifications`) and shared with the daemon; this module only
 * mirrors the record shape and wraps the Tauri desktop-notification plugin.
 *
 * Desktop notifications are best-effort: when the OS denies permission (or the
 * plugin is unavailable, e.g. in tests), `sendDesktopNotification` returns false
 * and the caller relies on the in-window bell/flyout as the guaranteed fallback.
 */

import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

export type NotificationKind = "success" | "error" | "warning" | "info";

export interface AppNotification {
  id: string;
  /** Unix epoch milliseconds. */
  ts: number;
  kind: NotificationKind;
  title: string;
  message: string;
}

/**
 * Fire a desktop notification if the OS permits it, requesting permission once
 * on first use. Returns true when a desktop notification was shown; false when
 * permission is unavailable/denied so the caller can fall back to the window.
 */
export async function sendDesktopNotification(title: string, body: string): Promise<boolean> {
  try {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (!granted) return false;
    sendNotification({ title, body });
    return true;
  } catch {
    return false; // plugin unavailable (non-Tauri env) → in-window fallback
  }
}
