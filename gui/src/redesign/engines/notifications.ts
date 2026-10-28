/**
 * The notification fire path (ported from the classic window's
 * syncNotifications): re-read the shared log, refresh the sheet + badge, and
 * deliver each event newer than the last one delivered to up to three sinks —
 * the desktop pet, an OS desktop notification, and an in-window toast as the
 * fallback when the desktop can't show it. Events from before the window
 * opened are never delivered (they still list in the sheet).
 */

import { useCallback, useEffect, useRef } from "react";
import { getOsNotify, installSessionHooks, listNotifications, petDeliver } from "../../ipc.js";
import {
  onNotificationClick,
  sendDesktopNotification,
  showAppWindow,
  type AppNotification,
  type NotificationKind,
} from "../../notifications.js";
import { bubbleAction, decidePetRouting, type PetTier } from "../../pet/model.js";
import { getMutedKinds, getNotifLastRead, getPetEnabled, getPetReactKinds, getPetTier, getSessionMonitoring } from "../../settings-store.js";
import { noticeFromNotification } from "../../vm/build.js";
import { useAS, type Toast } from "../../vm/store.js";
import { onSyncRequest } from "./bus.js";

/** While session monitoring is on, the log is re-read this often so a "Claude
 *  finished / is waiting" hook reaches the pet within seconds. */
export const SESSION_NOTIFY_POLL_MS = 5000;
/** At most this many fresh events are delivered per sync. */
export const MAX_DELIVER = 5;

export interface FireContext {
  petEnabled: boolean;
  petTier: PetTier;
  petKinds: NotificationKind[];
  muted: NotificationKind[];
  /** The "Desktop notifications" master; off → the toast stands in. */
  osNotify: boolean;
}

export interface FireSinks {
  pet(n: AppNotification): void;
  desktop(title: string, body: string): Promise<boolean>;
  toast(n: AppNotification): void;
}

const TOAST_TONE: Record<NotificationKind, NonNullable<Toast["tone"]>> = {
  success: "ok",
  error: "alert",
  warning: "warn",
  info: "info",
};

export function toastFor(n: AppNotification): Omit<Toast, "id"> {
  return { text: n.message ? `${n.title} — ${n.message}` : n.title, tone: TOAST_TONE[n.kind] };
}

/** Events newer than `since`, and the new high-water mark. */
export function freshSince(list: readonly AppNotification[], since: number): { fresh: AppNotification[]; since: number } {
  const fresh = list.filter((n) => n.ts > since);
  return { fresh, since: fresh.length ? Math.max(since, ...fresh.map((n) => n.ts)) : since };
}

/** Deliver fresh events. The pet is gated by its OWN per-kind set (not the
 *  desktop mutes); in tier "pet-only" it replaces desktop + toast for the
 *  events it handles. Events the daemon already showed, and muted kinds, skip
 *  desktop + toast. */
export async function deliver(fresh: readonly AppNotification[], ctx: FireContext, sinks: FireSinks): Promise<void> {
  const muted = new Set(ctx.muted);
  for (const n of fresh.slice(0, MAX_DELIVER)) {
    const routing = decidePetRouting({
      petEnabled: ctx.petEnabled,
      tier: ctx.petTier,
      petKinds: ctx.petKinds,
      kind: n.kind,
      osNotified: !!n.osNotified,
    });
    if (routing.toPet) sinks.pet(n);
    if (n.osNotified || muted.has(n.kind)) continue;
    if (routing.suppressDesktopAndToast) continue;
    const shown = ctx.osNotify ? await sinks.desktop(n.title, n.message) : false;
    if (!shown) sinks.toast(n);
  }
}

async function readFireContext(): Promise<FireContext> {
  return {
    petEnabled: getPetEnabled(),
    petTier: getPetTier(),
    petKinds: getPetReactKinds(),
    muted: getMutedKinds(),
    osNotify: await getOsNotify().catch(() => false),
  };
}

export function useNotificationEngine(): void {
  const s = useAS();
  const sRef = useRef(s);
  sRef.current = s;
  const sinceRef = useRef(Date.now());
  const running = useRef<Promise<void> | null>(null);

  const sync = useCallback(async () => {
    // One sync at a time; a request during a run waits for it, then re-reads.
    while (running.current) await running.current;
    const run = (async () => {
      const list = await listNotifications().catch(() => null);
      if (!list) return;
      const muted = new Set(getMutedKinds());
      const lastRead = getNotifLastRead();
      sRef.current.update({ notices: list.filter((n) => !muted.has(n.kind)).map((n) => noticeFromNotification(n, lastRead)) });
      const { fresh, since } = freshSince(list, sinceRef.current);
      sinceRef.current = since;
      if (fresh.length === 0) return;
      await deliver(fresh, await readFireContext(), {
        pet: (n) => void petDeliver(n.kind, n.title, bubbleAction(n.title, n.message)),
        desktop: sendDesktopNotification,
        toast: (n) => sRef.current.toast(toastFor(n)),
      });
    })();
    running.current = run;
    try {
      await run;
    } finally {
      running.current = null;
    }
  }, []);

  // Every store load re-read the log; deliver what it brought.
  useEffect(() => {
    void sync();
  }, [s.accounts, sync]);

  useEffect(() => onSyncRequest(() => void sync()), [sync]);

  // Session monitoring: re-ensure the hooks once (a profile created since gets
  // them too — install is idempotent), then poll fast while it stays on.
  useEffect(() => {
    if (getSessionMonitoring()) void installSessionHooks().catch(() => {});
    const id = setInterval(() => {
      if (getSessionMonitoring()) void sync();
    }, SESSION_NOTIFY_POLL_MS);
    return () => clearInterval(id);
  }, [sync]);

  // A clicked desktop notification brings the window up on the notifications sheet.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let gone = false;
    void onNotificationClick(() => {
      void showAppWindow();
      sRef.current.open({ kind: "notifications" });
    }).then((fn) => {
      if (gone) fn();
      else unlisten = fn;
    });
    return () => {
      gone = true;
      unlisten?.();
    };
  }, []);
}
