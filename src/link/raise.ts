/**
 * When the service asks: a live session's account is at or over the ask mark
 * in some window. The mark sits below the protection threshold (default 98 %),
 * because a question asked at the limit is asked too late to answer calmly.
 * Raising never moves anything; it opens a request the user answers.
 */

import type { UsageSnapshot } from "../usage.js";
import type { Candidate, RequestStore, SwitchRequest } from "./requests.js";

export const ASK_AT_PCT = 90;

export function askWindow(snapshot: UsageSnapshot, now: number, thresholdPct: number): SwitchRequest["reason"] | null {
  const mark = Math.min(ASK_AT_PCT, thresholdPct);
  const over = snapshot.windows.filter(
    (w) => typeof w.utilization === "number" && w.utilization >= mark && !(w.resetsAt && Date.parse(w.resetsAt) <= now),
  );
  if (!over.length) return null;
  const w = over.reduce((a, b) => ((b.utilization as number) > (a.utilization as number) ? b : a));
  return { window: w.key, fill: w.utilization, resetsAt: w.resetsAt };
}

export interface RaiseForAccount {
  account: string;
  /** Live session ids; [] when nothing runs; null when something runs but its ids are unknown (Codex). */
  sessions: string[] | null;
  snapshot: UsageSnapshot;
  thresholdPct: number;
  now: number;
  candidates: () => Candidate[];
}

/** Open requests for this account's live sessions; returns the newly created ones. */
export function raiseForAccount(store: RequestStore, i: RaiseForAccount): SwitchRequest[] {
  if (i.sessions !== null && i.sessions.length === 0) return [];
  const reason = askWindow(i.snapshot, i.now, i.thresholdPct);
  if (!reason) return [];
  const candidates = i.candidates();
  if (!candidates.length) return [];
  const keys = i.sessions === null ? [null] : i.sessions.map((id) => `${i.account}/${id}`);
  return keys
    .map((session) => store.raise({ account: i.account, session, reason, raisedBy: "as-daemon", candidates }))
    .filter((r) => r.created)
    .map((r) => r.request);
}
