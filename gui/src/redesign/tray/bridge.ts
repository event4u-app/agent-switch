/**
 * Tray popover ⇄ main window. The popover is too small for sheets and dialogs:
 * any overlay it opens (Start session, an account, a near-limit decision) is
 * forwarded to the main window, which is shown and opens it there.
 */

import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import type { Overlay } from "../../vm/store.js";

export const TRAY_OPEN_EVENT = "tray:open";
export const MAIN_WINDOW = "main";

export type ForwardedOverlay = Exclude<Overlay, { kind: "none" } | { kind: "confirm" }>;

/** Overlays that survive the event bridge: plain data, no callbacks. */
export function forwardable(o: Overlay): o is ForwardedOverlay {
  return o.kind !== "none" && o.kind !== "confirm";
}

/** Tray side: show the main window, open `o` there, and hide the popover. */
export async function forwardToMain(o: ForwardedOverlay): Promise<void> {
  try {
    await emitTo(MAIN_WINDOW, TRAY_OPEN_EVENT, o);
    await invoke("show_window");
    await invoke("tray_hide");
  } catch {
    /* non-Tauri env */
  }
}

export async function openMainWindow(): Promise<void> {
  try {
    await invoke("show_window");
    await invoke("tray_hide");
  } catch {
    /* non-Tauri env */
  }
}

/** Main side: open what the tray forwarded, and tell Rust the popover exists
 *  (left click on the tray icon opens it instead of the window). */
export function useTrayRequests(open: (o: Overlay) => void): void {
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let gone = false;
    void invoke("set_tray_popover", { enabled: true }).catch(() => {});
    listen<ForwardedOverlay>(TRAY_OPEN_EVENT, (e) => {
      if (forwardable(e.payload)) open(e.payload);
    })
      .then((u) => {
        if (gone) u();
        else unlisten = u;
      })
      .catch(() => {});
    return () => {
      gone = true;
      unlisten?.();
    };
  }, [open]);
}
