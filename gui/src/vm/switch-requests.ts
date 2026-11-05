/**
 * Switch requests in the app (road-to-the-agent-config-link): the question
 * agent-config and Agent Switch share when a session nears its limit. The app
 * shows who asked, records the user's answer, and keeps quiet about a request
 * already answered in agent-config.
 */

import type { SwitchRequestRow } from "../ipc.js";

/** `claude:work` (app) → `claude/work` (CLI). */
export function cliAccount(accountId: string): string {
  return accountId.replace(":", "/");
}

/** `claude:sid` + account `claude:work` → `claude/work/sid`. */
export function cliSession(accountId: string, sessionId: string): string {
  return `${cliAccount(accountId)}/${sessionId.slice(sessionId.indexOf(":") + 1)}`;
}

const live = (r: SwitchRequestRow, now: number) => Date.parse(r.expiresAt) > now;

/** The open request for this session (or, failing that, for its account). */
export function openRequestFor(rows: readonly SwitchRequestRow[], accountId: string, sessionId: string | null, now: number): SwitchRequestRow | null {
  const account = cliAccount(accountId);
  const open = rows.filter((r) => r.state === "open" && r.account === account && live(r, now));
  const key = sessionId ? cliSession(accountId, sessionId) : null;
  return open.find((r) => key !== null && r.session === key) ?? open.find((r) => r.session === null) ?? (key === null ? (open[0] ?? null) : null);
}

/** True when this account's limit was already answered outside the app in this
 *  cycle — the app does not ask the same question a second time. */
export function answeredElsewhere(rows: readonly SwitchRequestRow[], accountId: string, now: number): SwitchRequestRow | null {
  const account = cliAccount(accountId);
  return rows.find((r) => r.account === account && r.state !== "open" && r.state !== "expired" && live(r, now) && !!r.decision && !r.decision.by.startsWith("as-gui")) ?? null;
}

export const askedByAgentConfig = (r: SwitchRequestRow | null): boolean => r?.raisedBy === "ac";
