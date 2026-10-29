/**
 * Pure decision logic of the Accounts lane — Accounts list, Usage history,
 * Projects & pools, Account sheet, Add account, Sign in again (bundle `UP`/`WP`
 * L672, `FP` L657, `VP` L694, `GP` L717, `KP` L757, `DP` L642). No React, no I/O.
 */

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
  if (/\s/.test(name)) return "No spaces — use - or _ instead.";
  if (n.startsWith("-")) return "A name can't start with “-”.";
  if (!ACCOUNT_NAME_RE.test(n)) return "Only letters, digits, - and _.";
  return null;
}

/** The hint under a name field when nothing is wrong. */
export const NAME_HINT = "Letters, digits, - and _.";

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

/** "CLI · Desktop" from an account's surfaces (bundle `Bd`). */
export function usedIn(account: Pick<Account, "surfaces">): string {
  const kinds = account.surfaces.map((u) => (/Desktop/.test(u) ? "Desktop" : /VS Code|IDE/.test(u) ? "IDE" : "CLI"));
  return kinds.length ? Array.from(new Set(kinds)).join(" · ") : "—";
}

/** Tooltip of the Protect column. The backend only warns at the threshold, so
 *  the copy says "warns" where the design says "pauses". */
export function protectTitle(p: Protection | null): string {
  if (!p) return "Session protection not read";
  return p.enabled ? `Session protection on: warns at ${p.thresholdPct} % of the binding window` : "Session protection off";
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

/** Add-account step 3 lead text per provider (bundle `I0`). */
export const SIGN_IN_TEXT: Record<Tool, string> = {
  claude: "Opens the Claude sign-in in your browser",
  codex: "Opens the ChatGPT sign-in in your browser — or shows a device code",
  gemini: "Opens the Google sign-in in your browser",
  antigravity: "Antigravity stays monitor-only on this OS until sign-in isolation is proven",
};

/** Why a provider can't be added from here; null = it can. */
export function addBlocked(tool: Tool): string | null {
  if (tool === "antigravity") return `${SIGN_IN_TEXT.antigravity}.`;
  if (tool === "gemini") return "Gemini has no backend yet — accounts can't be added for it.";
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
