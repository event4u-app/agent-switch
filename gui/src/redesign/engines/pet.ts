/**
 * The desktop pet and the tray from the main window's side:
 *
 * - on open: show the pet when it is enabled with "always" presence, and play
 *   the one-time welcome (claimPetWelcome holds the once-flag);
 * - a clicked pet bubble only NAVIGATES here — switching stays behind the
 *   near-limit sheet's explicit click;
 * - after every load: the tray tooltip carries the active Claude account's
 *   worst live-session context fill, and the pet's mood dot + "working" badge
 *   follow the same number (classic window, refresh cadence).
 */

import { useEffect, useRef } from "react";
import { claimPetWelcome, listSessions, onPetAction, petEmitContext, petEmitNotification, petShow, setTrayTooltip } from "../../ipc.js";
import { showAppWindow } from "../../notifications.js";
import { PET_WELCOME, type BubbleAction } from "../../pet/model.js";
import { getPetEnabled, getPetPresence } from "../../settings-store.js";
import { contextTrayTooltip, isProviderWorking, worstLiveContextPct } from "../../transforms.js";
import type { Account, Attention } from "../../vm/types.js";
import { useAS, type Overlay, type Screen, type SettingsTab } from "../../vm/store.js";

export type PetRoute = { go: Screen; tab?: SettingsTab } | { open: Overlay };

/** Where a clicked bubble leads in the redesigned window. */
export function petRoute(action: BubbleAction | string, attention: readonly Attention[]): PetRoute {
  switch (action) {
    case "switch": {
      const limit = attention.find((a) => a.kind === "near-limit");
      return limit ? { open: { kind: "limit", attentionId: limit.id } } : { open: { kind: "notifications" } };
    }
    case "updates":
      return { go: "settings", tab: "updates" };
    case "ecosystem":
    case "tooling":
      return { go: "tools" };
    case "pet-settings":
      return { go: "settings", tab: "pet" };
    default:
      return { open: { kind: "notifications" } };
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Show-on-open + the one-time welcome. */
export async function petStartup(deps = { claimPetWelcome, petShow, petEmitNotification, sleep }): Promise<void> {
  if (!getPetEnabled()) return;
  if (getPetPresence() === "always") void deps.petShow();
  if (!(await deps.claimPetWelcome())) return;
  const created = await deps.petShow();
  await deps.sleep(created ? 1200 : 200);
  await deps.petEmitNotification("info", PET_WELCOME, "pet-settings", true);
}

/** Active Claude accounts (the ones a running `claude` reads). */
export function activeClaude(accounts: readonly Account[]): string[] {
  return accounts.filter((a) => a.tool === "claude" && a.isDefault).map((a) => a.name);
}

export async function pushContext(accounts: readonly Account[], now: number = Date.now()): Promise<void> {
  const sessions = await listSessions(undefined, 20);
  const active = activeClaude(accounts);
  const pct = worstLiveContextPct(sessions, active);
  await setTrayTooltip(contextTrayTooltip(pct));
  if (getPetEnabled()) void petEmitContext(pct, isProviderWorking(sessions, active, now));
}

export function usePetAndTray(): void {
  const s = useAS();
  const sRef = useRef(s);
  sRef.current = s;

  useEffect(() => {
    void petStartup().catch(() => {});
    let unlisten: (() => void) | null = null;
    let gone = false;
    void onPetAction((action) => {
      void showAppWindow();
      const r = petRoute(action, sRef.current.attention);
      if ("go" in r) sRef.current.go(r.go, r.tab);
      else sRef.current.open(r.open);
    }).then((fn) => {
      if (gone) fn();
      else unlisten = fn;
    });
    return () => {
      gone = true;
      unlisten?.();
    };
  }, []);

  // Best-effort and non-blocking: a tray hiccup never touches the window.
  useEffect(() => {
    if (s.readiness === "starting") return;
    void pushContext(s.accounts).catch(() => {});
  }, [s.accounts, s.readiness]);
}
