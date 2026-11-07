/**
 * The plain sentence another tool shows a person for a switch request — the
 * chat path renders it as is (road-to-limits-that-last-the-whole-run 2.1), so
 * agent-config does not have to rebuild the reasoning from raw fields.
 */

import { requestKind, type RequestKind, type SwitchRequest } from "./requests.js";

const HOUR_MS = 3_600_000;
const WINDOW: Record<string, string> = { five_hour: "5-hour", seven_day: "weekly", monthly: "monthly" };

function windowName(key: string): string {
  return WINDOW[key] ?? key.replace(/_/g, " ");
}

export function hoursText(h: number): string {
  if (h < 1) return "under an hour";
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} d`;
}

export function requestSummary(r: SwitchRequest, now: number): string {
  const win = windowName(r.reason.window);
  const resetMs = r.reason.resetsAt ? Date.parse(r.reason.resetsAt) - now : NaN;
  const resetIn = Number.isFinite(resetMs) && resetMs > 0 ? hoursText(resetMs / HOUR_MS) : null;
  const to = r.candidates[0];
  if (requestKind(r) === "pace") {
    const eta = typeof r.reason.etaFull === "number" ? `in about ${hoursText(r.reason.etaFull)}` : "early";
    const head = `${r.account} runs out ${eta}${resetIn ? `, but its ${win} limit resets only in ${resetIn}` : ""}.`;
    if (!to) return head;
    const spare = typeof to.spareAtReset === "number" ? ` would let ${to.spareAtReset}% expire unused at its reset` : " has room to spare";
    return `${head} ${to.target}${spare} — moving this session there spreads the limits over the whole run.`;
  }
  const head = `${r.account} is ${r.reason.fill === null ? "near" : `at ${r.reason.fill}% of`} its ${win} limit${resetIn ? `, which resets in ${resetIn}` : ""}.`;
  if (!to) return head;
  return `${head} ${to.target} has room${to.fill === null ? "" : ` (${to.fill}% used)`}.`;
}

export type RequestView = SwitchRequest & { kind: RequestKind; summary: string };

/** A request as the link hands it out: the stored fields plus `kind` and `summary`. */
export function requestView(r: SwitchRequest, now: number): RequestView {
  return { ...r, kind: requestKind(r), summary: requestSummary(r, now) };
}

/** Requests that concern a session: its own, and account-level ones on its account. */
export function forSession(session: string): (r: SwitchRequest) => boolean {
  const account = session.split("/").slice(0, 2).join("/");
  return (r) => r.session === session || (r.session === null && r.account === account);
}
