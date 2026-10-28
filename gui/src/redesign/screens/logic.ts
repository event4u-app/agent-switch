/**
 * Pure decision logic of the Overview / Sessions / Session sheet / Start /
 * Near-limit screens (bundle `N0`/`IP` L589, `Zi` L587, `C0` L547, `gR` L925,
 * `vR` L947). No React, no I/O — every screen reads its answers from here.
 */

import { shortPath } from "../../ui/format.js";
import { rankAccounts, TOOL_LABEL, type RankedAccount } from "../../vm/rules.js";
import type { Account, Attention, Binding, Pool, Session, SessionState, Tool, ViewModel } from "../../vm/types.js";

// ---------------------------------------------------------------- sessions

export type SessionFilter = "open" | "needs-you" | "paused" | "done" | "all" | "trash";

export const SESSION_FILTERS: Record<SessionFilter, (s: Session) => boolean> = {
  open: (s) => !s.trashed && s.state !== "done",
  "needs-you": (s) => !s.trashed && (s.state === "needs-you" || s.state === "waiting"),
  paused: (s) => !s.trashed && (s.state === "parked" || s.state === "pause-requested" || s.state === "auth-paused"),
  done: (s) => !s.trashed && s.state === "done",
  all: (s) => !s.trashed,
  trash: (s) => !!s.trashed,
};

/** Design `Vd`: states that count as active for sorting. */
const ACTIVE: ReadonlySet<SessionState> = new Set(["working", "needs-you", "waiting", "pause-requested"]);

/** A session whose process is still there. Our `idle` means "live but quiet"
 *  (build.ts), so unlike the design's `Vd` it counts as running: the CLI refuses
 *  to trash it and `/compact` can reach it. */
export function isRunning(s: Session): boolean {
  return s.state !== "done" && s.state !== "parked" && s.state !== "auth-paused";
}

/** Active first, then most recently active. Design `IP`. */
export function compareSessions(a: Session, b: Session): number {
  const x = ACTIVE.has(a.state) ? 0 : 1;
  const y = ACTIVE.has(b.state) ? 0 : 1;
  return x - y || b.lastActiveAt - a.lastActiveAt;
}

export function countSessions(sessions: readonly Session[], filter: SessionFilter): number {
  return sessions.filter(SESSION_FILTERS[filter]).length;
}

export function filterSessions(
  sessions: readonly Session[],
  filter: SessionFilter,
  tool: "all" | Tool,
  accountId: "all" | string,
): Session[] {
  return sessions
    .filter((s) => SESSION_FILTERS[filter](s) && (accountId === "all" || s.accountId === accountId) && (tool === "all" || s.tool === tool))
    .sort(compareSessions);
}

/** `claude:abc…` → `abc…` (the CLI's session id). */
export function sessionHandle(s: Pick<Session, "id">): string {
  return s.id.slice(s.id.indexOf(":") + 1);
}

/** Recent folders for the Start dialog: the cwd of every known session, most
 *  recently active first, deduplicated. */
export function recentFolders(sessions: readonly Session[], limit = 8): string[] {
  const out: string[] = [];
  for (const s of [...sessions].sort((a, b) => b.lastActiveAt - a.lastActiveAt)) {
    if (s.cwd && !out.includes(s.cwd)) out.push(s.cwd);
    if (out.length >= limit) break;
  }
  return out;
}

// ------------------------------------------------------------- live switch

export interface Availability {
  ok: boolean;
  reason: string;
}

/** Design `Zi`. `surface` null = not reported: the CLI `rebind` re-points the
 *  profile's credential store, which a terminal session picks up — only a
 *  surface known to be the app/IDE is ruled out. */
export function liveSwitch(s: Session, platform: ViewModel["platform"]): Availability {
  if (s.tool !== "claude") return { ok: false, reason: "Live switching is only available for Claude today." };
  if (s.surface != null && s.surface !== "terminal")
    return { ok: false, reason: "Only sessions in a terminal can switch live; the app and IDE keep their sign-in." };
  if (platform !== "mac") return { ok: false, reason: "Live switching works on macOS only today." };
  if (s.state === "done") return { ok: false, reason: "The session has ended." };
  return { ok: true, reason: "Adopts the new sign-in with its next message — no restart. If that fails, it stays on its account." };
}

// ------------------------------------------------------------ resolution

export const AUTO = "__auto";

function glob(pattern: string, value: string): boolean {
  return new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`).test(value);
}

export interface Resolution {
  account: Account | null;
  rule: Binding | null;
  why: string[];
}

/** Which account a plain start in `cwd` gets: first matching enabled binding,
 *  else the tool's default account. Design `C0`; repo/org bindings need a repo
 *  lookup (`repoOf`) — without one they never match. */
export function resolveStart(
  cwd: string,
  tool: Tool,
  rules: readonly Binding[],
  accounts: readonly Account[],
  pools: readonly Pool[],
  repoOf: (cwd: string) => { repo: string; org: string } | null = () => null,
): Resolution {
  const short = shortPath(cwd);
  const repo = repoOf(cwd);
  const rule =
    rules.find((r) => {
      if (!r.enabled || (r.tool !== "any" && r.tool !== tool)) return false;
      if (r.match.kind === "folder") return glob(r.match.value, short) || glob(r.match.value, `${short}/x`);
      if (r.match.kind === "repo") return repo != null && glob(r.match.value, repo.repo);
      return repo != null && glob(r.match.value, repo.org);
    }) ?? null;
  if (rule && rule.target.kind === "account") {
    const id = rule.target.accountId;
    const account = accounts.find((a) => a.id === id) ?? null;
    return { account, rule, why: [`Rule: ${rule.match.kind} ${rule.match.value} → ${account?.name ?? "?"}`] };
  }
  if (rule && rule.target.kind === "pool") {
    const pool = rule.target.pool;
    const members = pools.find((p) => p.id === pool)?.accountIds ?? [];
    const top = rankAccounts(accounts.filter((a) => members.includes(a.id)), tool).find((r) => r.rank === 1) ?? null;
    return {
      account: top?.account ?? null,
      rule,
      why: [
        `Rule: ${rule.match.kind} ${rule.match.value} → pool ${pool}`,
        top ? `Pool ${pool}: ${top.account.name} has the most left (${top.reason})` : `Pool ${pool}: no ${tool} account can take work`,
      ],
    };
  }
  const def = accounts.find((a) => a.tool === tool && a.isDefault) ?? null;
  return {
    account: def,
    rule: null,
    why: [def ? `No rule matches — default ${tool} account ${def.name}` : `No rule matches and no default ${tool} account`],
  };
}

/** Start is possible only for a known account that can take work. */
export function canStartOn(a: Account | null | undefined): boolean {
  return !!a && a.state !== "signed-out" && a.state !== "limited" && a.state !== "wrong-account";
}

/** The design's tool row; a tool is selectable when any of its accounts ranks. */
export const START_TOOLS: Tool[] = ["claude", "codex", "gemini"];

export function toolCanTakeWork(accounts: readonly Account[], tool: Tool): boolean {
  return rankAccounts(accounts, tool).some((r) => r.rank != null);
}

/** The desktop app to open for a tool, if one is registered and installed. */
export function appFor(vm: Pick<ViewModel, "surfaces">, tool: Tool): string | null {
  return vm.surfaces.find((s) => s.tool === tool && s.kind === "desktop" && s.detected)?.id ?? null;
}

export function appUnavailableReason(vm: Pick<ViewModel, "surfaces">, tool: Tool): string | null {
  if (tool === "gemini") return "Gemini has no desktop app";
  return appFor(vm, tool) ? null : `No ${TOOL_LABEL[tool]} app found on this computer`;
}

// ------------------------------------------------------------- near limit

export type LimitChoice = "pause" | "switch" | "continue-elsewhere" | "keep";

export interface LimitOption {
  id: LimitChoice;
  title: string;
  detail: string;
  disabled: boolean;
  isDefault?: boolean;
}

export const PAUSE_UNAVAILABLE = "Pausing needs the protection engine — Agent Switch warns at the threshold today.";
export const KEEP_UNAVAILABLE = "There is no session protection to turn off — Agent Switch only warns today.";

/** The session a near-limit item is about: the item's own, else the account's
 *  most recently active running session. */
export function limitSession(item: Attention, sessions: readonly Session[]): Session | null {
  if (item.sessionId) return sessions.find((s) => s.id === item.sessionId) ?? null;
  return (
    sessions
      .filter((s) => s.accountId === item.accountId && !s.trashed && isRunning(s))
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0] ?? null
  );
}

/** Other accounts of the same tool that can take work, best first. */
export function limitTargets(account: Account, accounts: readonly Account[], now: number): RankedAccount[] {
  return rankAccounts(accounts, account.tool, now).filter((r) => r.account.id !== account.id && r.rank != null);
}

/** Design `vR` options, gated by what the backend can do today. */
export function limitOptions(
  account: Account,
  session: Session | null,
  targets: readonly RankedAccount[],
  platform: ViewModel["platform"],
): LimitOption[] {
  const noSession = `Not available here: no running session on ${account.name}.`;
  const noTarget = `Not available here: no other ${TOOL_LABEL[account.tool]} account can take work.`;
  const live = session ? liveSwitch(session, platform) : null;
  return [
    {
      id: "pause",
      title: `Pause at ${account.threshold} %, continue after the reset`,
      detail: `Not available here: ${PAUSE_UNAVAILABLE}`,
      disabled: true,
      isDefault: true,
    },
    {
      id: "switch",
      title: "Switch this session to another account",
      detail: !session
        ? noSession
        : !live?.ok
          ? `Not available here: ${live?.reason}`
          : !targets.length
            ? noTarget
            : "Live: the session keeps running and adopts the other sign-in with its next message. Only when you choose it — never on its own.",
      disabled: !session || !live?.ok || !targets.length,
    },
    {
      id: "continue-elsewhere",
      title: "Continue on another account",
      detail: !session
        ? noSession
        : !targets.length
          ? noTarget
          : "Starts a new session there with a brief of this one. This session keeps running — it is not moved. Lossy: the transcript stays here.",
      disabled: !session || !targets.length,
    },
    {
      id: "keep",
      title: `Keep going on ${account.name}`,
      detail: `Not available here: ${KEEP_UNAVAILABLE}`,
      disabled: true,
    },
  ];
}

// ---------------------------------------------------------------- overview

export function overviewSub(vm: Pick<ViewModel, "accounts" | "sessions" | "attention">): string {
  const ready = vm.accounts.filter((a) => a.state === "ready" || a.state === "near-limit").length;
  const working = vm.sessions.filter((s) => s.state === "working").length;
  const n = vm.attention.length;
  return [`${ready} of ${vm.accounts.length} accounts ready`, `${working} session${working === 1 ? "" : "s"} working`, n ? `${n} need${n === 1 ? "s" : ""} you` : "nothing needs you"].join(
    " · ",
  );
}

/** Tools in first-seen account order (the "What's left" groups). */
export function accountTools(accounts: readonly Account[]): Tool[] {
  return Array.from(new Set(accounts.map((a) => a.tool)));
}
