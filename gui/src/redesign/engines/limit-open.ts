/**
 * Limit auto-open: when an account with a
 * running session reaches its limit (its protection threshold), the near-limit
 * sheet opens by itself and the window comes forward — once per account and
 * reset cycle. The move still waits for the user's choice (owner request
 * 2026-11-04; off with Settings › Protection › Ask me when a session reaches its limit).
 */

import { useEffect } from "react";
import * as ipc from "../../ipc.js";
import { getLimitAutoOpen } from "../../settings-store.js";
import { useAS } from "../../vm/store.js";
import type { Account, Attention } from "../../vm/types.js";
import { answeredElsewhere, cliAccount } from "../../vm/switch-requests.js";

/** What a remembered limit is keyed by: the item and the reset cycle it is in. */
export interface LimitMark {
  id: string;
  version: string;
}

const KEY = "agent-switch-limit-auto-opened";
const KEEP = 50;
const keyOf = (n: LimitMark) => `${n.id}@${n.version}`;

function wasOpened(opened: ReadonlySet<string>, n: LimitMark): boolean {
  return opened.has(keyOf(n));
}

/** Remembered per viewer; a store that fails only means the sheet may open once more. */
export function openedLimits(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function markLimitOpened(n: LimitMark): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...openedLimits(), keyOf(n)].slice(-KEEP)));
  } catch {
    /* a lost mark only reopens the sheet once more */
  }
}

/** The binding window: the one used most. */
function tightest(a: Account) {
  return [...a.windows].filter((w) => typeof w.utilization === "number").sort((x, y) => (y.utilization as number) - (x.utilization as number))[0] ?? null;
}

/** The near-limit item to open now, with the mark to remember it by: a session
 *  is running there (deriveAttention only raises it then), the account is at
 *  its protection threshold, and this reset cycle was not opened yet. */
export interface LinkContext {
  /** True when agent-config already answered this account's limit this cycle. */
  answered?: (accountId: string) => boolean;
  /** The id of an open request agent-config raised for this account, if any. */
  requested?: (accountId: string) => string | null;
}

export function nearLimitToOpen(
  attention: readonly Attention[],
  accounts: readonly Account[],
  opened: ReadonlySet<string>,
  link: LinkContext = {},
): { item: Attention; mark: LimitMark } | null {
  for (const item of attention) {
    if (item.kind !== "near-limit" || !item.accountId) continue;
    if (link.answered?.(item.accountId)) continue;
    const a = accounts.find((x) => x.id === item.accountId);
    const w = a ? tightest(a) : null;
    if (!a || !w) continue;
    // agent-config asked in the session: ask here too, before the limit, once per request.
    const asked = link.requested?.(item.accountId) ?? null;
    if (asked) {
      const mark = { id: item.id, version: `request:${asked}` };
      if (!wasOpened(opened, mark)) return { item, mark };
    }
    if (a.state !== "limited" && (w.utilization as number) < a.threshold) continue;
    const mark = { id: item.id, version: `${w.key}:${w.resetsAt ?? ""}` };
    if (!wasOpened(opened, mark)) return { item, mark };
  }
  return null;
}

export function useLimitAutoOpen(): void {
  const s = useAS();
  useEffect(() => {
    if (s.overlay.kind !== "none" || !getLimitAutoOpen()) return;
    const hit = nearLimitToOpen(s.attention, s.accounts, openedLimits(), {
      answered: (id) => answeredElsewhere(s.switchRequests, id, s.now) !== null,
      requested: (id) =>
        s.switchRequests.find((r) => r.state === "open" && r.raisedBy === "ac" && r.account === cliAccount(id) && Date.parse(r.expiresAt) > s.now)?.id ?? null,
    });
    if (!hit) return;
    markLimitOpened(hit.mark);
    s.open({ kind: "limit", attentionId: hit.item.id });
    void ipc.showWindow().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.attention, s.accounts, s.overlay.kind, s.switchRequests]);
}
