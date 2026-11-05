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

/** `claude/work/<id>` or `claude/work` → `claude/work`. */
export const accountOfKey = (key: string): string => key.split("/").slice(0, 2).join("/");

/**
 * The requests a set of moves answers (v3 decision sheet): each moved session
 * answers its own open request, else its account's; a request is answered
 * once, by the first session that reaches it. Keys are CLI keys
 * (`claude/work/<id>`), targets account names on the same tool.
 */
export function requestsForMoves(
  rows: readonly SwitchRequestRow[],
  moves: readonly { key: string; target: string }[],
  now: number,
): { id: string; key: string; to: string }[] {
  const open = rows.filter((r) => r.state === "open" && live(r, now));
  const seen = new Set<string>();
  const out: { id: string; key: string; to: string }[] = [];
  for (const { key, target } of moves) {
    const account = accountOfKey(key);
    const r = open.find((x) => x.session === key) ?? open.find((x) => x.session === null && x.account === account);
    if (!r || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({ id: r.id, key, to: `${key.split("/")[0]}/${target}` });
  }
  return out;
}
