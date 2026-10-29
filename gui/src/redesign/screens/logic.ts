/**
 * Pure decision logic of the Overview / Sessions / Session sheet / Start /
 * Near-limit screens (bundle `N0`/`IP` L589, `Zi` L587, `C0` L547, `gR` L925,
 * `vR` L947). No React, no I/O — every screen reads its answers from here.
 */

import type { DirResolution } from "../../ipc.js";
import { expandHome } from "../../lib/paths.js";
import { shortPath } from "../../ui/format.js";
import { accountIdFromMember, BIN_NAME } from "../../vm/build.js";
import { rankAccounts, TOOL_LABEL, type RankedAccount } from "../../vm/rules.js";
import type { Account, Attention, Binding, Launcher, Pool, Session, SessionState, Tool, ViewModel } from "../../vm/types.js";

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

/** How specifically a folder binding covers `cwd`: the matched prefix length,
 *  or null. Bindings are the CLI's absolute mapping paths (a subfolder is
 *  covered too); a `~`/glob value from older data still matches. */
function folderSpecificity(value: string, cwd: string, home: string | null): number | null {
  const norm = (p: string) => expandHome(p, home).replace(/(.)\/+$/, "$1");
  const c = norm(cwd);
  const v = norm(value);
  if (v.includes("*")) {
    const short = shortPath(c);
    const hit = [c, short].some((x) => glob(v, x) || glob(v, `${x}/x`) || glob(value, x) || glob(value, `${x}/x`));
    return hit ? v.indexOf("*") : null;
  }
  return c === v || c.startsWith(`${v}/`) ? v.length : null;
}

/** Which account a plain start in `cwd` gets: the most specific enabled folder
 *  binding (longest prefix), else a repo/org binding, else the tool's default
 *  account. Design `C0`. This is the OFFLINE fallback — the dialog asks the CLI
 *  (`dir --json`, `resolutionFromCli`) whenever it can. Repo/org bindings need
 *  a repo lookup (`repoOf`); without one they never match. */
export function resolveStart(
  cwd: string,
  tool: Tool,
  rules: readonly Binding[],
  accounts: readonly Account[],
  pools: readonly Pool[],
  opts: { repoOf?: (cwd: string) => { repo: string; org: string } | null; home?: string | null } = {},
): Resolution {
  const home = opts.home ?? null;
  const repo = opts.repoOf?.(cwd) ?? null;
  const usable = rules.filter((r) => r.enabled && (r.tool === "any" || r.tool === tool));
  let rule: Binding | null = null;
  let best = -1;
  for (const r of usable) {
    if (r.match.kind !== "folder") continue;
    const score = folderSpecificity(r.match.value, cwd, home);
    if (score != null && score > best) {
      best = score;
      rule = r;
    }
  }
  rule ??=
    usable.find((r) => {
      if (r.match.kind === "repo") return repo != null && glob(r.match.value, repo.repo);
      if (r.match.kind === "org") return repo != null && glob(r.match.value, repo.org);
      return false;
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

/** Automatic, as the CLI resolves it (`dir --json`): its profile and its
 *  reasons. No profile (the default config dir) → the tool's default account,
 *  which is what `run` would load there. */
export function resolutionFromCli(res: DirResolution, tool: Tool, accounts: readonly Account[]): Resolution {
  if (res.blocked) return { account: null, rule: null, why: res.why.length ? res.why : [`Refused: ${res.blocked}`] };
  if (res.profile) {
    const id = accountIdFromMember(res.profile) ?? `${tool}:${res.profile}`;
    const account = accounts.find((a) => a.id === id) ?? null;
    return { account, rule: null, why: res.why.length ? res.why : [`agent-switch picks ${res.profile}`] };
  }
  const def = accounts.find((a) => a.tool === tool && a.isDefault) ?? null;
  return { account: def, rule: null, why: res.why.length ? res.why : [`No rule matches — default ${tool} account ${def?.name ?? "none"}`] };
}

/** Why a tool cannot be picked in the start dialog; null when it can. */
export function toolUnavailableReason(tool: Tool, accounts: readonly Account[], platform: ViewModel["platform"]): string | null {
  if (tool === "antigravity" && platform !== "mac") return "Antigravity profiles need macOS for now";
  return toolCanTakeWork(accounts, tool) ? null : `No ${TOOL_LABEL[tool]} account can take work`;
}

/** A reason line split so an `agent-switch …` command renders unbroken. */
export function reasonParts(line: string): { text: string; code: boolean }[] {
  const m = line.match(/agent-switch(?: [\w-]+)+(?=$|[),.;]|\s)/);
  if (!m || m.index === undefined) return [{ text: line, code: false }];
  const parts = [
    { text: line.slice(0, m.index), code: false },
    { text: m[0], code: true },
    { text: line.slice(m.index + m[0].length), code: false },
  ];
  return parts.filter((p) => p.text !== "");
}

/** Start is possible only for a known account that can take work. */
export function canStartOn(a: Account | null | undefined): boolean {
  return !!a && !a.disabled && a.state !== "signed-out" && a.state !== "limited" && a.state !== "wrong-account";
}

/** The design's tool row; a tool is selectable when any of its accounts ranks. */
export const START_TOOLS: Tool[] = ["claude", "codex", "antigravity"];

export function toolCanTakeWork(accounts: readonly Account[], tool: Tool): boolean {
  return rankAccounts(accounts, tool).some((r) => r.rank != null);
}

/** The desktop app to open for a tool, if one is registered and installed. */
export function appFor(vm: Pick<ViewModel, "surfaces">, tool: Tool): string | null {
  return vm.surfaces.find((s) => s.tool === tool && s.kind === "desktop" && s.detected)?.id ?? null;
}

export function hasLauncher(launchers: readonly Launcher[], appId: string, accountId: string): boolean {
  return launchers.some((l) => l.appId === appId && l.accountId === accountId && l.exists);
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

export interface PlainStart {
  command: string;
  /** The account a plain start uses; null = the tool's own login. */
  account: Account | null;
  /** Enabled folder rules for this tool, which pick their own account. */
  rules: number;
  /** The whole answer as one sentence (tooltip / accessible name). */
  text: string;
  /** Why agent-switch picked it, short (from `dir --plain`); null = not asked. */
  reason: string | null;
  /** agent-switch's full reasoning, one line each. */
  why: string[];
  /** Set when that account can't take work right now. */
  warn: string | null;
}

/** What a plain `claude` / `codex` / `agy` does where no folder rule applies:
 *  the account set for plain starts, or the tool's own login. Folder rules
 *  (and the pools they name) decide for their folders, so they're only counted. */
export function plainStart(accounts: readonly Account[], tool: Tool, rules: readonly Binding[]): PlainStart {
  const command = tool === "gemini" ? "gemini" : BIN_NAME[tool];
  const def = accounts.find((a) => a.tool === tool && a.isDefault && !a.disabled) ?? null;
  const ruleCount = rules.filter((r) => r.enabled && (r.tool === tool || r.tool === "any")).length;
  const rulesNote = ruleCount ? ` ${ruleCount} folder rule${ruleCount > 1 ? "s" : ""} pick their own.` : "";
  const base = `A plain \`${command}\` outside a folder rule starts on`;
  if (!def) {
    return {
      command,
      account: null,
      rules: ruleCount,
      text: `${base} your original ${TOOL_LABEL[tool]} login — no account is set for plain starts.${rulesNote}`,
      warn: null,
      reason: null,
      why: [],
    };
  }
  const warn =
    def.state === "signed-out"
      ? `${def.name} is signed out — sign in again or pick another account for plain starts.`
      : def.state === "wrong-account"
        ? `${def.name} is signed in to a different account than expected.`
        : def.state === "limited"
          ? `${def.name} is at its limit — pick another account for plain starts.`
          : null;
  return { command, account: def, rules: ruleCount, text: `${base} ${def.name}.${rulesNote}`, warn, reason: null, why: [] };
}

/** The same answer from agent-switch itself (`dir --plain`), which balances a
 *  plain start across the accounts; the local guess is only the fallback. */
export function plainStartFromCli(accounts: readonly Account[], tool: Tool, rules: readonly Binding[], r: DirResolution): PlainStart {
  const id = r.profile ? accountIdFromMember(r.profile) : null;
  const local = plainStart(
    accounts.map((a) => ({ ...a, isDefault: a.tool === tool ? a.id === id : a.isDefault })),
    tool,
    rules,
  );
  const picked = r.why.find((w) => w.startsWith("Picked "));
  const reason = picked
    ? picked.replace(/^Picked [^:]+: /, "").replace(/ \(.*$/, "")
    : r.why.some((w) => w.includes("are level"))
      ? "level with the others — the starred account"
      : r.why.some((w) => w.startsWith("No account has fresh usage"))
        ? "no fresh usage to weigh — the starred account"
        : null;
  return { ...local, reason, why: r.why };
}
