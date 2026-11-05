/**
 * The link's operations, shared by the CLI (`limits`, `switch …`) and the MCP
 * server so both front doors behave identically. Nothing here moves a session:
 * requests are raised and decided; the service executes approved ones.
 */

import { liveSessionPids } from "../api.js";
import { cachedUsage } from "../commands/shared.js";
import { FRESH_USAGE_MS } from "../dir-resolve.js";
import { codexProfilesWithSession } from "../login-keepalive.js";
import { configDir, isDisabled, listAllProfiles, profileExists } from "../profiles.js";
import { readProtection } from "../protection.js";
import { PROVIDER_IDS, type ProviderId } from "../providers.js";
import { candidatesFor } from "./candidates.js";
import { buildLimits, type LimitsReport } from "./limits.js";
import type { Decision, MoveHow, Raiser, RequestStore, SwitchRequest } from "./requests.js";

export function readLimits(provider?: ProviderId, now: number = Date.now()): LimitsReport {
  const accounts = listAllProfiles()
    .filter((p) => !provider || p.provider === provider)
    .map((p) => ({ provider: p.provider, name: p.name, disabled: isDisabled(p.provider, p.name) }));
  return buildLimits({
    now,
    accounts,
    usage: (p, n) => cachedUsage(p, n),
    threshold: (p, n) => readProtection(p, n).thresholdPct,
    freshMs: FRESH_USAGE_MS,
  });
}

export function accountBusy(id: string): boolean {
  const [p, n] = id.split("/");
  if (p === "claude") return liveSessionPids(configDir("claude", n)).length > 0;
  if (p === "codex") return codexProfilesWithSession([n]).has(n);
  return false;
}

function parseAccount(id: string): { provider: ProviderId; name: string } {
  const [p, n, ...rest] = id.split("/");
  if (!n || rest.length || !(PROVIDER_IDS as readonly string[]).includes(p)) throw new Error(`not an account: "${id}" (expected provider/name)`);
  if (!profileExists(p as ProviderId, n)) throw new Error(`no such account: ${id}`);
  return { provider: p as ProviderId, name: n };
}

export interface RequestArgs {
  /** `provider/name`, or derived from `session`. */
  account?: string;
  /** `provider/account/sessionId`. */
  session?: string | null;
  raisedBy: Raiser;
}

/**
 * Raise (or return) the request for an account. Asked for explicitly, so it
 * does not wait for the ask mark: the reason is the account's fullest window.
 */
export function requestSwitch(store: RequestStore, a: RequestArgs, now: number = Date.now()): { request: SwitchRequest; created: boolean } {
  const session = a.session ?? null;
  if (session !== null && session.split("/").length !== 3) throw new Error(`not a session key: "${session}" (expected provider/account/sessionId)`);
  const accountId = a.account ?? (session ? session.split("/").slice(0, 2).join("/") : undefined);
  if (!accountId) throw new Error("name the account (provider/name) or the session (provider/account/sessionId)");
  if (session && !session.startsWith(`${accountId}/`)) throw new Error(`session ${session} does not belong to ${accountId}`);
  const acct = parseAccount(accountId);
  const report = readLimits(undefined, now);
  const own = report.accounts.find((x) => x.id === accountId);
  const fullest = (own?.windows ?? []).filter((w) => w.fill !== null).sort((x, y) => (y.fill as number) - (x.fill as number))[0];
  const reason = fullest ? { window: fullest.key, fill: fullest.fill, resetsAt: fullest.resetsAt } : { window: "unknown", fill: null, resetsAt: null };
  const candidates = candidatesFor(`${acct.provider}/${acct.name}`, report, accountBusy);
  if (!candidates.length) throw new Error(`no account can take work from ${accountId} now — every other account is full, stale or disabled`);
  return store.raise({ account: accountId, session, reason, raisedBy: a.raisedBy, candidates });
}

export interface DecideArgs {
  id: string;
  decision: "approve" | "decline" | "snooze";
  /** approve: the candidate to move to; default the first. */
  target?: string;
  /** approve: how; default the candidate's first offered move. */
  how?: MoveHow;
  by: string;
}

export function decideSwitch(store: RequestStore, a: DecideArgs): { request: SwitchRequest; applied: boolean } {
  let d: Decision;
  if (a.decision === "approve") {
    const r = store.get(a.id);
    if (!r) throw new Error(`no switch request ${a.id}`);
    const c = a.target ? r.candidates.find((x) => x.target === a.target) : r.candidates[0];
    if (!c) throw new Error(`${a.target} is not a candidate for request ${a.id} (candidates: ${r.candidates.map((x) => x.target).join(", ")})`);
    d = { kind: "approve", target: c.target, how: a.how ?? c.how[0], by: a.by };
  } else {
    d = { kind: a.decision, by: a.by };
  }
  return store.decide(a.id, d);
}

/** What a person reads about a request, one line. */
export function describeRequest(r: SwitchRequest): string {
  const where = r.session ?? r.account;
  const reason = r.reason.fill === null ? "" : ` at ${r.reason.fill}% of ${r.reason.window}`;
  const decided = r.decision
    ? r.decision.kind === "approve"
      ? ` → ${r.decision.target} (${r.decision.how}, by ${r.decision.by})`
      : ` — ${r.decision.kind}d by ${r.decision.by}`
    : "";
  const outcome = r.outcome ? ` — ${r.outcome.detail}${r.outcome.resume ? `; continue with: ${r.outcome.resume}` : ""}` : "";
  return `${r.id}  ${r.state.padEnd(9)} ${where}${reason}${decided}${outcome}`;
}
