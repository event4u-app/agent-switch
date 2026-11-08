/**
 * When the service asks: a live session's account is at or over the ask mark
 * in some window. The mark sits below the protection threshold (default 98 %),
 * because a question asked at the limit is asked too late to answer calmly.
 * Raising never moves anything; it opens a request the user answers.
 */

import type { HistorySample } from "../history.js";
import type { UsageSnapshot } from "../usage.js";
import { paceReason, spareCandidates } from "./pace.js";
import { requestKind, type Candidate, type RequestStore, type SwitchRequest } from "./requests.js";

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

export interface RaisePaceForAccount extends RaiseForAccount {
  history: HistorySample[];
  /** Whether an account has live work of its own; busy accounts are never offered. */
  busy: (id: string) => boolean;
  /** An account's projected fill at its reset; null when unknown. */
  projected: (id: string) => number | null;
}

/**
 * Ask early when the pace is off: this account runs out well before its reset
 * while another lets room expire. At most one open pace request per account; a
 * declined or snoozed one stays closed for its window until that window resets
 * (the id carries window, reset and kind).
 */
export function raisePaceForAccount(store: RequestStore, i: RaisePaceForAccount): SwitchRequest[] {
  if (i.sessions !== null && i.sessions.length === 0) return [];
  if (store.list().some((r) => r.account === i.account && r.state === "open" && requestKind(r) === "pace")) return [];
  const reason = paceReason({ snapshot: i.snapshot, history: i.history, thresholdPct: i.thresholdPct, now: i.now });
  if (!reason) return [];
  const candidates = spareCandidates(i.account, i.candidates(), i.busy, i.projected);
  if (!candidates.length) return [];
  const keys = i.sessions === null ? [null] : i.sessions.map((id) => `${i.account}/${id}`);
  return keys
    .map((session) => store.raise({ account: i.account, session, reason, raisedBy: "as-daemon", candidates }))
    .filter((r) => r.created)
    .map((r) => r.request);
}

export interface RaiseAsks extends RaisePaceForAccount {
  /** `pace.suggest`: off leaves only the limit ask. */
  paceOn: boolean;
}

/** One poll's asks for a live account: the limit ask first; the pace ask only
 *  when the limit has nothing to say and the setting is on. */
export function raiseAsks(store: RequestStore, i: RaiseAsks): SwitchRequest[] {
  const limit = raiseForAccount(store, i);
  if (limit.length || !i.paceOn || askWindow(i.snapshot, i.now, i.thresholdPct)) return limit;
  return raisePaceForAccount(store, i);
}
