/**
 * Switch requests in the app (road-to-the-agent-config-link): the question
 * agent-config and Agent Switch share when a session nears its limit. The app
 * shows who asked, records the user's answer, and keeps quiet about a request
 * already answered in agent-config.
 */

import type { SwitchRequestRow } from "../ipc.js";
import { t } from "../i18n/index.js";
import type { Account, Attention } from "./types.js";

export type RequestKind = "limit" | "pace";
export const requestKind = (r: SwitchRequestRow): RequestKind => (r.reason.kind === "pace" ? "pace" : "limit");

/** `claude:work` (app) → `claude/work` (CLI). */
export function cliAccount(accountId: string): string {
  return accountId.replace(":", "/");
}

/** `claude:sid` + account `claude:work` → `claude/work/sid`. */
export function cliSession(accountId: string, sessionId: string): string {
  return `${cliAccount(accountId)}/${sessionId.slice(sessionId.indexOf(":") + 1)}`;
}

const live = (r: SwitchRequestRow, now: number) => Date.parse(r.expiresAt) > now;

/** The open request of this kind for this session (or, failing that, for its account). */
export function openRequestFor(
  rows: readonly SwitchRequestRow[],
  accountId: string,
  sessionId: string | null,
  now: number,
  kind: RequestKind = "limit",
): SwitchRequestRow | null {
  const account = cliAccount(accountId);
  const open = rows.filter((r) => r.state === "open" && r.account === account && live(r, now) && requestKind(r) === kind);
  const key = sessionId ? cliSession(accountId, sessionId) : null;
  return open.find((r) => key !== null && r.session === key) ?? open.find((r) => r.session === null) ?? (key === null ? (open[0] ?? null) : null);
}

/** True when this account's limit was already answered outside the app in this
 *  cycle — the app does not ask the same question a second time. */
export function answeredElsewhere(rows: readonly SwitchRequestRow[], accountId: string, now: number): SwitchRequestRow | null {
  const account = cliAccount(accountId);
  return (
    rows.find(
      (r) => r.account === account && requestKind(r) === "limit" && r.state !== "open" && r.state !== "expired" && live(r, now) && !!r.decision && !r.decision.by.startsWith("as-gui"),
    ) ?? null
  );
}

/** `claude/work` → `claude:work`. */
const appAccount = (cli: string): string => cli.replace("/", ":");

function hours(h: number): string {
  return h < 48 ? t("vm.attention.paceHours", { n: String(Math.max(1, Math.round(h))) }) : t("vm.attention.paceDays", { n: String(Math.round(h / 24)) });
}

/** Open pace requests as attention items (road-to-limits-that-last-the-whole-run
 *  3.1). Not urgent: they wait in the list and never open the sheet by themselves. */
export function paceAttention(rows: readonly SwitchRequestRow[], accounts: readonly Account[], now: number): Attention[] {
  const out: Attention[] = [];
  for (const r of rows) {
    if (requestKind(r) !== "pace" || r.state !== "open" || !live(r, now)) continue;
    const a = accounts.find((x) => x.id === appAccount(r.account));
    if (!a || a.disabled) continue;
    const to = r.candidates[0];
    const target = to ? accounts.find((x) => x.id === appAccount(to.target)) : undefined;
    const resetMs = r.reason.resetsAt ? Date.parse(r.reason.resetsAt) - now : NaN;
    out.push({
      id: `pace:${r.id}`,
      kind: "pace",
      title: t("vm.attention.paceTitle", { name: a.name, time: hours(r.reason.etaFull ?? 0) }),
      detail: [
        Number.isFinite(resetMs) && resetMs > 0 ? t("vm.attention.paceResets", { time: hours(resetMs / 3_600_000) }) : null,
        to ? t("vm.attention.paceSpare", { name: target?.name ?? to.target, pct: String(to.spareAtReset ?? 0) }) : null,
      ]
        .filter(Boolean)
        .join(" "),
      accountId: a.id,
      sessionId: r.session ? `${a.tool}:${r.session.split("/")[2]}` : undefined,
      primary: t("vm.attention.decide"),
      at: Date.parse(r.raisedAt) || now,
    });
  }
  return out;
}

export const askedByAgentConfig = (r: SwitchRequestRow | null): boolean => r?.raisedBy === "ac";
