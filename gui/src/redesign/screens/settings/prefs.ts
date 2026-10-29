/**
 * Settings logic shared by the subpages: GUI-local preferences (settings-store /
 * localStorage) behind a tiny hook, the backend seams the store's `act` does not
 * carry yet, and the pure helpers the tests pin down.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import type { AutoSwitchMap } from "../../../ipc.js";
import { hasUsageReadout, PROFILE_LABELS, type AutoSwitchTag, type ProviderId } from "../../../transforms.js";
import { createFoundationActions, type FoundationActions } from "../../../vm/actions-foundations.js";
import type { Account, Pool, ViewModel } from "../../../vm/types.js";
import { useAS } from "../../../vm/store.js";

/** A persisted GUI preference as React state: reads once, writes through. */
export function usePref<T>(get: () => T, set: (v: T) => void): [T, (v: T) => void] {
  const [v, setV] = useState<T>(get);
  const write = useCallback(
    (next: T) => {
      setV(next);
      set(next);
    },
    [set],
  );
  return [v, write];
}

export function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Run a backend call; a failure becomes an alert toast, never an unhandled rejection. */
export function useRun() {
  const s = useAS();
  const { toast } = s;
  return useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await fn();
      } catch (e) {
        toast({ text: describeError(e), tone: "alert" });
        return undefined;
      }
    },
    [toast],
  );
}

/** Protection and guard writes: the store's `act` when it carries them, else
 *  built here over the same store reload (a provider without foundations). */
export function useFoundation(): FoundationActions {
  const s = useAS();
  const { reload } = s;
  const vmRef = useRef<ViewModel>(s);
  vmRef.current = s;
  const { act } = s;
  // Prefer the store's own seam once foundations are merged into `act`.
  return useMemo(() => {
    const own = createFoundationActions(() => vmRef.current, reload);
    return { ...own, setProtection: act.setProtection ?? own.setProtection, setGuard: act.setGuard ?? own.setGuard };
  }, [act, reload]);
}

/** "Notify near limit" (autoswitch) applies to providers with a usage readout. */
export const NEAR_LIMIT_PROVIDERS: ProviderId[] = (["claude", "codex", "antigravity"] as ProviderId[]).filter(hasUsageReadout);

/** Same choices as the classic window's near-limit threshold select. */
export const NOTIFY_THRESHOLD_CHOICES = [95, 90, 85, 80, 75, 70, 65, 60, 55, 50, 45, 40, 35, 30] as const;

/** Per-account protection threshold choices (design: 95 / 98 recommended / 99),
 *  plus the account's current value when it is something else. */
export function protectionThresholds(current: number | null): number[] {
  const base = [95, 98, 99];
  return current != null && !base.includes(current) ? [...base, current].sort((a, b) => a - b) : base;
}

/** Tags an autoswitch suggestion may be scoped to for one provider: "all" plus
 *  the labels its accounts actually carry. Needs 2+ accounts and 1+ tag. */
export function scopeTags(accounts: readonly Account[], tool: ProviderId): AutoSwitchTag[] | null {
  const own = accounts.filter((a) => a.tool === tool);
  const present = PROFILE_LABELS.filter((l) => own.some((a) => a.label === l));
  if (own.length < 2 || present.length === 0) return null;
  return ["all", ...present];
}

/** Turning the master off switches every provider's autoswitch off (classic semantics). */
export function providersToDisable(auto: AutoSwitchMap | null): ProviderId[] {
  if (!auto) return [];
  return (Object.keys(auto) as ProviderId[]).filter((p) => auto[p]?.enabled);
}

/** Tags with 2+ accounts and no pool of that name yet (Distribution › Suggested). */
export function suggestedPoolTags(accounts: readonly Account[], pools: readonly Pool[]): string[] {
  return PROFILE_LABELS.filter(
    (tag) =>
      accounts.filter((a) => a.label === tag).length >= 2 && !pools.some((p) => p.label.toLowerCase() === tag.toLowerCase()),
  );
}

/** Uninstall is armed only by typing the word. */
export function uninstallArmed(text: string): boolean {
  return text.trim().toLowerCase() === "uninstall";
}
