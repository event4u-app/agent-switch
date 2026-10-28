import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import * as ipc from "../../ipc.js";
import { AcRoot } from "../../ui/AcRoot.js";
import { createActions } from "../../vm/actions.js";
import { emptyViewModel, loadViewModel } from "../../vm/load.js";
import { ASProvider, useAS } from "../../vm/store.js";
import { forwardable, forwardToMain, openMainWindow } from "./bridge.js";
import { Tray } from "./Tray.js";

export const TRAY_MAX_HEIGHT = 720;

/** Overlays opened in the popover go to the main window. */
function TrayBridge() {
  const s = useAS();
  const { overlay, close } = s;
  useEffect(() => {
    if (overlay.kind === "none") return;
    if (forwardable(overlay)) void forwardToMain(overlay);
    close();
  }, [overlay, close]);
  return null;
}

/** Re-read on every show; Escape hides the popover. */
function TrayLifecycle() {
  const { reload } = useAS();
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let gone = false;
    try {
      getCurrentWebviewWindow()
        .onFocusChanged(({ payload: focused }) => {
          if (focused) void reload();
        })
        .then((u) => (gone ? u() : (unlisten = u)))
        .catch(() => {});
    } catch {
      /* non-Tauri env */
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void invoke("tray_hide").catch(() => {});
    };
    window.addEventListener("keydown", onKey);
    return () => {
      gone = true;
      unlisten?.();
      window.removeEventListener("keydown", onKey);
    };
  }, [reload]);
  return null;
}

/** The window follows the card's height (Rust keeps it anchored to the icon). */
function useFitWindow() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const fit = () => {
      const height = Math.min(Math.ceil(el.getBoundingClientRect().height), TRAY_MAX_HEIGHT);
      if (height > 0) void invoke("tray_resize", { height }).catch(() => {});
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, []);
  return ref;
}

function TrayFrame() {
  const ref = useFitWindow();
  return (
    <div ref={ref} className="w-[340px]">
      <TrayBridge />
      <TrayLifecycle />
      <Tray onOpenApp={() => void openMainWindow()} onQuit={() => void ipc.quitApp().catch(() => {})} />
    </div>
  );
}

/** Second entry (tray.html): the tray popover over the same view model. */
export default function TrayApp() {
  return (
    <AcRoot>
      <ASProvider initial={emptyViewModel()} load={loadViewModel} actions={createActions}>
        <TrayFrame />
      </ASProvider>
    </AcRoot>
  );
}
