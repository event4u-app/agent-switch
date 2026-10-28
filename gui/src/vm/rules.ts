/**
 * Decision rules of the redesign, ported from the bundle (tone `e0` L17, stale
 * `zd` L53, ranking `Bt` L516, "Next in" `Xi` L533, tool status `ko` L399).
 * Pure — every screen and the tray read the same answers from here.
 */

import type { Account, MeterTone, Pool, SessionState, Tool, ToolEntry, UsageWindow } from "./types.js";

/** Below the threshold by less than this many points → warn. */
export const WARN_BAND = 10;
/** Usage older than this is stale: greyed, ranked below fresh readouts. */
export const STALE_MS = 10 * 60_000;

export const SESSION_STATE_LABEL: Record<SessionState, string> = {
  working: "Working",
  waiting: "Waiting for you",
  "needs-you": "Needs a decision",
  "pause-requested": "Pause requested",
  parked: "Paused at limit",
  "auth-paused": "Paused · sign-in needed",
  idle: "Idle",
  done: "Done",
};

export const TOOL_LABEL: Record<Tool, string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
  antigravity: "Antigravity",
};

/** alert at/over the threshold, warn within WARN_BAND below it, else ok;
 *  unknown usage is neutral — never "free". */
export function toneFor(utilization: number | null | undefined, threshold: number): MeterTone {
  if (utilization == null) return "neutral";
  if (utilization >= threshold) return "alert";
  if (utilization >= threshold - WARN_BAND) return "warn";
  return "ok";
}

/** Never checked counts as stale. */
export function isStale(checkedAt: number | null | undefined, now: number): boolean {
  return checkedAt == null || now - checkedAt > STALE_MS;
}

export function maxUtilization(windows: readonly UsageWindow[]): number | null {
  const known = windows.map((w) => w.utilization).filter((u): u is number => typeof u === "number");
  return known.length ? Math.max(...known) : null;
}

/** The window that binds first (highest known utilization); null when none is known. */
export function bindingWindow(windows: readonly UsageWindow[]): UsageWindow | null {
  let worst: UsageWindow | null = null;
  for (const w of windows) {
    if (w.utilization != null && (!worst || w.utilization > (worst.utilization ?? -1))) worst = w;
  }
  return worst;
}

/** Percent left in the binding window; null when usage is unknown. */
export function headroom(account: Pick<Account, "windows">): number | null {
  const max = maxUtilization(account.windows);
  return max == null ? null : Math.max(0, 100 - max);
}

const STATE_ORDER: Record<Account["state"], number> = {
  ready: 0,
  "near-limit": 1,
  checking: 2,
  limited: 3,
  "wrong-account": 4,
  "signed-out": 5,
};

export interface RankedAccount {
  account: Account;
  headroom: number | null;
  /** 1-based rank among accounts that can take work; null otherwise. */
  rank: number | null;
  reason: string;
}

/** One tool's accounts ordered state → fresh → headroom. Only ready and
 *  near-limit accounts get a rank. `now` omitted → freshness is not judged. */
export function rankAccounts(accounts: readonly Account[], tool: Tool, now?: number): RankedAccount[] {
  const fresh = (a: Account) => (now == null ? true : !isStale(a.checkedAt, now));
  const sorted = accounts
    .filter((a) => a.tool === tool)
    .sort((a, b) => {
      const byState = STATE_ORDER[a.state] - STATE_ORDER[b.state];
      if (byState !== 0) return byState;
      const byFresh = Number(fresh(b)) - Number(fresh(a));
      if (byFresh !== 0) return byFresh;
      return (headroom(b) ?? -1) - (headroom(a) ?? -1);
    });
  let next = 0;
  return sorted.map((account) => {
    const left = headroom(account);
    const rank = account.state === "ready" || account.state === "near-limit" ? ++next : null;
    const reason =
      account.state === "signed-out"
        ? "Sign-in needed"
        : account.state === "wrong-account"
          ? "Signed in with the wrong account"
          : account.state === "checking"
            ? "Checking sign-in"
            : account.state === "limited"
              ? "Paused at its limit"
              : left == null
                ? "Usage unknown — not counted as free"
                : fresh(account)
                  ? `${left}% left in its binding window`
                  : `${left}% left · usage is stale`;
    return { account, headroom: left, rank, reason };
  });
}

export function topRanked(accounts: readonly Account[], tool: Tool, now?: number): RankedAccount | null {
  return rankAccounts(accounts, tool, now).find((r) => r.rank === 1) ?? null;
}

/** accountId → pool label for each pool's rank-1 account ("Next in <pool>"). */
export function nextInPools(accounts: readonly Account[], tool: Tool, pools: readonly Pool[], now?: number): Map<string, string> {
  const out = new Map<string, string>();
  for (const pool of pools) {
    const top = topRanked(
      accounts.filter((a) => pool.accountIds.includes(a.id)),
      tool,
      now,
    );
    if (top) out.set(top.account.id, pool.label);
  }
  return out;
}

export type ToolStatus = "update" | "ok" | "attention" | "missing" | "unknown";

export function toolStatus(t: Pick<ToolEntry, "present" | "healthy" | "version" | "latest">): ToolStatus {
  if (!t.present) return "missing";
  if (!t.healthy) return "attention";
  if (t.latest == null) return "unknown";
  return t.version !== t.latest ? "update" : "ok";
}

export function updateCount(tools: readonly ToolEntry[]): number {
  return tools.filter((t) => toolStatus(t) === "update").length;
}
