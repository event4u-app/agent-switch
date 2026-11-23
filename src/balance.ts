/**
 * Which account a start should use when several could: the one that would
 * lose the most of its rest at its next reset. An account's "need" is the rest
 * of its longest window divided by the hours until that window resets — the
 * pace it would have to be used at to run dry exactly at the reset. Using the
 * highest need first spreads the work so every account is spent by its reset
 * instead of one running out while another resets unused.
 *
 * An account at its limit in any window (at or over its protection threshold)
 * can't take work now and is never picked. Accounts whose needs are level
 * (within {@link LEVEL_TOLERANCE}) are a tie the caller breaks — plain starts
 * prefer the plain-start account, pools a member without a live session.
 */

import type { UsageSnapshot, UsageWindow } from "./usage.js";

const HOUR_MS = 3_600_000;
/** A window resets at the latest one full length from now, so without a reset
 *  time its own length bounds the hours left: the need is never overstated. */
const WINDOW_H: Record<string, number> = { five_hour: 5, seven_day: 7 * 24, monthly: 30 * 24 };
/** A window of unknown length: the longest any provider reports. */
const UNKNOWN_WINDOW_H = 30 * 24;
/** Needs closer than this (relative) count as level. */
export const LEVEL_TOLERANCE = 0.05;

export type Weighed =
  | { usable: true; need: number; rest: number; resetH: number | null; window: string; key: string; peak: number }
  | { usable: false; why: string };

function longest(windows: UsageWindow[]): UsageWindow | null {
  const known = windows.filter((w) => typeof w.utilization === "number");
  if (!known.length) return null;
  const withReset = known.filter((w) => w.resetsAt && !isNaN(Date.parse(w.resetsAt)));
  if (withReset.length) return withReset.reduce((a, b) => (Date.parse(b.resetsAt!) > Date.parse(a.resetsAt!) ? b : a));
  return known.reduce((a, b) => ((b.utilization as number) > (a.utilization as number) ? b : a));
}

export function weigh(snapshot: UsageSnapshot, now: number, thresholdPct: number): Weighed {
  const capped = snapshot.windows.find((w) => typeof w.utilization === "number" && w.utilization >= thresholdPct);
  if (capped) return { usable: false, why: `at ${capped.utilization}% of its ${windowName(capped)} window (limit ${thresholdPct}%)` };
  const w = longest(snapshot.windows);
  if (!w) return { usable: false, why: "usage unknown" };
  const rest = Math.max(0, 100 - (w.utilization as number));
  const resetH = w.resetsAt && !isNaN(Date.parse(w.resetsAt)) ? Math.max(1, (Date.parse(w.resetsAt) - now) / HOUR_MS) : null;
  // The fullest window breaks a level tie: equal room this week, but one is about
  // to hit its 5h limit.
  const peak = Math.max(...snapshot.windows.map((x) => (typeof x.utilization === "number" ? x.utilization : 0)));
  return { usable: true, need: rest / (resetH ?? WINDOW_H[w.key] ?? UNKNOWN_WINDOW_H), rest, resetH, window: windowName(w), key: w.key, peak };
}

const WINDOW_NAME: Record<string, string> = { five_hour: "5h", seven_day: "7d", monthly: "30d" };

/** Named by key: a window read back from the usage history carries its key as label. */
function windowName(w: UsageWindow): string {
  return WINDOW_NAME[w.key] ?? w.label;
}

export function level(a: number, b: number): boolean {
  const hi = Math.max(a, b);
  return hi === 0 || Math.abs(a - b) / hi <= LEVEL_TOLERANCE;
}

export function describe(name: string, w: Extract<Weighed, { usable: true }>): string {
  const reset = w.resetH == null ? "reset time unknown" : w.resetH >= 48 ? `resets in ${Math.round(w.resetH / 24)} d` : `resets in ${Math.round(w.resetH)} h`;
  const of = w.key === "seven_day" ? "the week" : `its ${w.window} window`;
  return `${name}: ${Math.round(w.rest)}% of ${of} left, ${reset} (${w.resetH == null ? "at least " : ""}${w.need.toFixed(1)} %/h to use it up)`;
}

/** Plans whose limits belong to one person. A Team or Enterprise seat, any
 *  other plan and a credential without the field are not balanced. */
export const BALANCED_PLANS: readonly string[] = ["pro", "max"];

/** The `subscriptionType` of a Claude credential, or undefined when it has none. */
export function credentialPlan(cred: string | null): unknown {
  if (!cred) return undefined;
  try {
    return JSON.parse(cred)?.claudeAiOauth?.subscriptionType;
  } catch {
    return undefined;
  }
}

/** Why an account on this plan stays out of balancing, or null when it takes part. */
export function planOutOfBalance(plan: unknown): string | null {
  if (typeof plan === "string" && BALANCED_PLANS.includes(plan)) return null;
  // The value comes from a credential file: only a plain word reaches a reason line.
  const name = typeof plan === "string" && plan ? (/^[a-z0-9_-]{1,24}$/i.test(plan) ? plan : null) : undefined;
  const what = name === undefined ? "no plan in its credential" : name === null ? "an unknown plan" : `${/^[aeiou]/i.test(name) ? "an" : "a"} ${name} plan`;
  return `${what} — only personal Pro and Max accounts are balanced`;
}
