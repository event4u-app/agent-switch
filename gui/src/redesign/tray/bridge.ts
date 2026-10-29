/**
 * Tray popover ⇄ main window. The popover is too small for sheets and dialogs:
 * any overlay it opens (Start session, an account, a near-limit decision) is
 * forwarded to the main window, which is shown and opens it there. Screens
 * (Tools, Health) travel the same way on their own event.
 *
 * The event payload crosses a window boundary, so the main side trusts nothing
 * in it: only a whitelist of plain-data overlays, validated field by field and
 * rebuilt without extra keys. Never a terminal — that would run a command.
 */

import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef } from "react";
import type { Overlay, Screen } from "../../vm/store.js";
import type { ViewModel } from "../../vm/types.js";
import { appFor } from "../screens/logic.js";

export const TRAY_OPEN_EVENT = "tray:open";
export const TRAY_GO_EVENT = "tray:go";
export const TRAY_APP_EVENT = "tray:app";
export const MAIN_WINDOW = "main";

export type ForwardedOverlay = Extract<Overlay, { kind: "start" | "account" | "session" | "limit" | "notifications" }>;
export type ForwardedScreen = Extract<Screen, "tools" | "health">;

const FORWARDED_SCREENS: readonly ForwardedScreen[] = ["tools", "health"];

const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const optStr = (v: unknown): boolean => v === undefined || typeof v === "string";

/** The overlay `x` stands for, rebuilt from its validated fields; null for
 *  anything outside the whitelist or of the wrong shape. */
export function forwardedOverlay(x: unknown): ForwardedOverlay | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  switch (o.kind) {
    case "start": {
      if (!optStr(o.cwd) || !optStr(o.tool) || !optStr(o.accountId)) return null;
      const out: ForwardedOverlay = { kind: "start" };
      if (o.cwd !== undefined) out.cwd = o.cwd as string;
      if (o.tool !== undefined) out.tool = o.tool as string;
      if (o.accountId !== undefined) out.accountId = o.accountId as string;
      return out;
    }
    case "account":
      return str(o.id) ? { kind: "account", id: o.id } : null;
    case "session":
      return str(o.id) ? { kind: "session", id: o.id } : null;
    case "limit":
      return str(o.attentionId) ? { kind: "limit", attentionId: o.attentionId } : null;
    case "notifications":
      return { kind: "notifications" };
    default:
      return null;
  }
}

/** Overlays that survive the event bridge: whitelisted plain data, no callbacks. */
export function forwardable(o: unknown): o is ForwardedOverlay {
  return forwardedOverlay(o) !== null;
}

/** Main side: the app request `x` stands for, or null. Trusts nothing in the
 *  payload — the account must exist, be usable, and its tool's detected desktop
 *  app must be exactly `appId`; the CLI then launches only a registered app. */
export function appRequest(vm: Pick<ViewModel, "accounts" | "surfaces">, x: unknown): { appId: string; accountId: string } | null {
  if (!x || typeof x !== "object") return null;
  const { appId, accountId } = x as Record<string, unknown>;
  if (!str(appId) || !str(accountId)) return null;
  const a = vm.accounts.find((acc) => acc.id === accountId);
  if (!a || a.disabled || a.state === "signed-out" || a.state === "wrong-account") return null;
  return appFor(vm, a.tool) === appId ? { appId, accountId } : null;
}

export function forwardedScreen(x: unknown): ForwardedScreen | null {
  return FORWARDED_SCREENS.find((s) => s === x) ?? null;
}

async function showMainAndHide(): Promise<void> {
  await invoke("show_window");
  await invoke("tray_hide");
}

/** Tray side: show the main window, open `o` there, and hide the popover. */
export async function forwardToMain(o: ForwardedOverlay): Promise<void> {
  try {
    await emitTo(MAIN_WINDOW, TRAY_OPEN_EVENT, o);
    await showMainAndHide();
  } catch {
    /* non-Tauri env */
  }
}

/** Tray side: show the main window on `screen`, and hide the popover. */
export async function goInMain(screen: ForwardedScreen): Promise<void> {
  try {
    await emitTo(MAIN_WINDOW, TRAY_GO_EVENT, screen);
    await showMainAndHide();
  } catch {
    /* non-Tauri env */
  }
}

/** Tray side: have the main window launch `appId` on the account. The app opens
 *  on its own, so only the popover goes away. */
export async function openAppFromTray(appId: string, accountId: string): Promise<void> {
  try {
    await emitTo(MAIN_WINDOW, TRAY_APP_EVENT, { appId, accountId });
    await invoke("tray_hide");
  } catch {
    /* non-Tauri env */
  }
}

export async function openMainWindow(): Promise<void> {
  try {
    await showMainAndHide();
  } catch {
    /* non-Tauri env */
  }
}

function useListen<T>(event: string, handle: (payload: T) => void): void {
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let gone = false;
    listen<T>(event, (e) => handle(e.payload))
      .then((u) => {
        if (gone) u();
        else unlisten = u;
      })
      .catch(() => {});
    return () => {
      gone = true;
      unlisten?.();
    };
  }, [event, handle]);
}

/** Main side: open what the tray forwarded (validated), and tell Rust the
 *  popover exists (left click on the tray icon opens it instead of the window). */
export function useTrayRequests(open: (o: Overlay) => void, go?: (screen: Screen) => void, openApp?: (payload: unknown) => void): void {
  useEffect(() => {
    void invoke("set_tray_popover", { enabled: true }).catch(() => {});
  }, []);
  const onOpen = useCallbackRef((payload: unknown) => {
    const o = forwardedOverlay(payload);
    if (o) open(o);
  });
  const onGo = useCallbackRef((payload: unknown) => {
    const screen = forwardedScreen(payload);
    if (screen && go) go(screen);
  });
  const onApp = useCallbackRef((payload: unknown) => openApp?.(payload));
  useListen(TRAY_OPEN_EVENT, onOpen);
  useListen(TRAY_APP_EVENT, onApp);
  useListen(TRAY_GO_EVENT, onGo);
}

/** A stable callback that always calls the latest `fn`. */
function useCallbackRef<A extends unknown[]>(fn: (...a: A) => void): (...a: A) => void {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...a: A) => ref.current(...a), []);
}
