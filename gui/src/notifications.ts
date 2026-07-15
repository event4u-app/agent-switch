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
  /** The daemon already fired an OS notification for this event → the GUI skips
   *  its own desktop notification / toast (still shown in the flyout). */
  osNotified?: boolean;
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

export type DesktopPermission = "granted" | "denied" | "default" | "unavailable";

/** Current OS permission state for desktop notifications (for the settings UI).
 *  `unavailable` when the plugin can't be reached (non-Tauri env). */
export async function desktopPermission(): Promise<DesktopPermission> {
  try {
    return (await isPermissionGranted()) ? "granted" : "default";
  } catch {
    return "unavailable";
  }
}

/** Explicitly request desktop-notification permission (settings "Enable" path).
 *  Returns the resulting state. */
export async function requestDesktopPermission(): Promise<DesktopPermission> {
  try {
    if (await isPermissionGranted()) return "granted";
    return (await requestPermission()) === "granted" ? "granted" : "denied";
  } catch {
    return "unavailable";
  }
}
