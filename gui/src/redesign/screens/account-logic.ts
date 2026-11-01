/**
 * Pure decision logic of the Accounts lane — Accounts list, Usage history,
 * Projects & pools, Account sheet, Add account, Sign in again (bundle `UP`/`WP`
 * L672, `FP` L657, `VP` L694, `GP` L717, `KP` L757, `DP` L642). No React, no I/O.
 */

import { t, type TKey } from "../../i18n/index.js";
import type { UsageHistorySample } from "../../ipc.js";
import { loginArgs, reloginArgs } from "../../ipc.js";
import type { ProviderId } from "../../transforms.js";
import type { Account, Protection, Tool } from "../../vm/types.js";

/** The CLI's rule for a profile name (`assertProfileName`: letters in either
 *  case, digits, - and _), minus a leading `-`, which argv would read as a
 *  flag. The design's lowercase-only rule is not used: it refused names the
 *  CLI accepts and existing profiles already have. */
export const ACCOUNT_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/;

/** Why a typed name can't be used, in words; null when it can. */
export function nameProblem(name: string): string | null {
  const n = name.trim();
  if (!n) return null;
  if (/\s/.test(name)) return t("accounts.name.noSpaces");
  if (n.startsWith("-")) return t("accounts.name.leadingDash");
  if (!ACCOUNT_NAME_RE.test(n)) return t("accounts.name.onlyAllowed");
  return null;
}

/** The hint under a name field when nothing is wrong. */
export function nameHint(): string {
  return t("accounts.name.hint");
}

const TAG_KEY: Record<string, TKey> = {
  Work: "accounts.tag.work",
  Personal: "accounts.tag.personal",
  Other: "accounts.tag.other",
};

/** A profile tag in the live language; the stored value stays English. */
export function tagLabel(label: string): string {
  const key = TAG_KEY[label];
  return key ? t(key) : label;
}

/** Names that existed before the design rule (dots, capitals) stay savable
 *  unchanged; a NEW name must follow the design rule. */
export function canSaveName(next: string, original: string): boolean {
  const n = next.trim();
  return n === original || ACCOUNT_NAME_RE.test(n);
}

/** Every tool the Accounts screen lists, in the design's order (`A0`). */
export const ACCOUNT_TOOLS: Tool[] = ["claude", "codex", "gemini", "antigravity"];

/** Tools with an `agent-switch` backend (ProviderId). */
export function providerOf(tool: Tool): ProviderId | null {
  return tool === "gemini" ? null : tool;
}

/** "CLI · Desktop" from an account's surfaces (bundle `Bd`); null when none is
 *  known, so the cell shows only running/idle instead of a placeholder. */
export function usedIn(account: Pick<Account, "surfaces">): string | null {
  const kinds = account.surfaces.map((u) => (/Desktop/.test(u) ? "Desktop" : /VS Code|IDE/.test(u) ? "IDE" : "CLI"));
  return kinds.length ? Array.from(new Set(kinds)).join(" · ") : null;
}

/** Tooltip of the Protect column. The backend only warns at the threshold, so
 *  the copy says "warns" where the design says "pauses". */
export function protectTitle(p: Protection | null): string {
  if (!p) return t("accounts.protection.notRead");
  return p.enabled ? t("accounts.protection.onTitle", { pct: p.thresholdPct }) : t("accounts.protection.offTitle");
}

// ------------------------------------------------------------ usage history

const DAY_MS = 86_400_000;
export const HISTORY_DAYS = 30;

function isWeekKey(key: string): boolean {
  return key.startsWith("seven_day") || key.startsWith("weekly");
}

/** Week-window peak use per day for the last `days` days, oldest first; a day
 *  without a readout is null (a gap in the line, never 0). */
export function dailyPeaks(samples: readonly UsageHistorySample[], now: number, days = HISTORY_DAYS): (number | null)[] {
  const out: (number | null)[] = Array.from({ length: days }, () => null);
  const startOfToday = Math.floor(now / DAY_MS) * DAY_MS;
  for (const s of samples) {
    const t = Date.parse(s.at);
    if (!Number.isFinite(t) || t > now) continue;
    const u = s.windows.find((w) => isWeekKey(w.key))?.utilization;
    if (typeof u !== "number") continue;
    const idx = days - 1 - Math.floor((startOfToday - Math.floor(t / DAY_MS) * DAY_MS) / DAY_MS);
    if (idx < 0 || idx >= days) continue;
    const v = Math.max(0, Math.min(100, Math.round(u)));
    out[idx] = Math.max(out[idx] ?? 0, v);
  }
  return out;
}

export function hasReadout(values: readonly (number | null)[] | undefined): boolean {
  return !!values && values.some((v) => v != null);
}

export function lastValue(values: readonly (number | null)[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] != null) return values[i];
  return null;
}

/** SVG path over `values` in a w×h box (0 % at the bottom); a null breaks the
 *  line and the next known value starts a new segment. */
export function linePath(values: readonly (number | null)[], w: number, h: number): string {
  const n = Math.max(values.length, 2);
  const x = (i: number) => (i / (n - 1)) * w;
  const y = (v: number) => h - (v / 100) * h;
  const parts: string[] = [];
  let pen = false;
  values.forEach((v, i) => {
    if (v == null) {
      pen = false;
      return;
    }
    parts.push(`${pen ? "L" : "M"}${x(i)},${y(v)}`);
    pen = true;
  });
  return parts.join(" ");
}

// ------------------------------------------------------------- sign-in flows

const SIGN_IN_TEXT_KEY: Record<Tool, TKey> = {
  claude: "accounts.signInLead.claude",
  codex: "accounts.signInLead.codex",
  gemini: "accounts.signInLead.gemini",
  antigravity: "accounts.signInLead.antigravity",
};

/** Add-account step 3 lead text per provider (bundle `I0`). */
export function signInText(tool: Tool): string {
  return t(SIGN_IN_TEXT_KEY[tool]);
}

/** Why a provider can't be added from here; null = it can. */
export function addBlocked(tool: Tool): string | null {
  if (tool === "antigravity") return t("accounts.add.blockedAntigravity");
  if (tool === "gemini") return t("accounts.add.blockedGemini");
  return null;
}

/** `add` creates a profile and signs it in; a profile that exists signs in again
 *  with `login`, which exits non-zero unless the stored login is back. */
export function signInArgs(provider: ProviderId, name: string, exists: boolean, browser?: string): string[] {
  return exists ? reloginArgs(provider, name, browser) : loginArgs(provider, name, browser);
}

export type SignInOutcome = "verified" | "mismatch" | "unfinished";

/** After the sign-in ran: unfinished when no identity can be read; mismatch only
 *  when the account had an identity before and the new one differs. */
export function signInOutcome(before: string | null, after: string | null): SignInOutcome {
  if (!after) return "unfinished";
  if (before && before.toLowerCase() !== after.toLowerCase()) return "mismatch";
  return "verified";
}
