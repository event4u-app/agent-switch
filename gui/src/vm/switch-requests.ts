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

/**
 * Requests answered in the app and then carried out by the background service,
 * finished at or after `since`. A move the app made itself is recorded in one write, so its outcome carries the decision's
 * own timestamp; one answered in agent-config is agent-config's to report.
 */
export function serviceOutcomes(rows: readonly SwitchRequestRow[], since: number): SwitchRequestRow[] {
  return rows.filter(
    (r) =>
      (r.state === "done" || r.state === "failed") &&
      !!r.decision?.by.startsWith("as-gui") &&
      !!r.outcome &&
      r.outcome.at !== r.decision.at &&
      Date.parse(r.outcome.at) >= since,
  );
}

/** The service's `outcome.resume` (`agent-switch …`, POSIX single-quoted) as the
 *  args the app's terminal runs; null for anything else. */
export function resumeArgs(cmd: string): string[] | null {
  const out: string[] = [];
  let cur = "";
  let has = false;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (c === "'") {
      const end = cmd.indexOf("'", i + 1);
      if (end < 0) return null;
      cur += cmd.slice(i + 1, end);
      has = true;
      i = end;
    } else if (c === "\\" && i + 1 < cmd.length) {
      cur += cmd[++i];
      has = true;
    } else if (c === " ") {
      if (has) out.push(cur);
      cur = "";
      has = false;
    } else {
      cur += c;
      has = true;
    }
  }
  if (has) out.push(cur);
  if (out[0] !== "agent-switch" || out.length < 2) return null;
  return out.slice(1);
}
