/** The 2.11 view model plus the v3 feeds → `V3Data`. Pure: every input is an
 *  argument, so the whole window can be driven from fixtures. Where two
 *  sources disagree about a session, the CLI's `sessions --json` row wins over
 *  the engine's lists (it is the one that read the transcript last). */

import type { SessionRow } from "../../transforms.js";
import { accountId, activityFromEntries } from "../../vm/build.js";
import { sessionFromRow } from "../../vm/build.js";
import type { Account, IdentityColor, SessionState, ViewModel } from "../../vm/types.js";
import type { NewSessionFacts, NewSessionPlan, SheetSession } from "../dialogs.js";
import { paceFor, type LimitAccount, type LimitWindow } from "../limits.js";
import type { DoneItem, PaletteEntry } from "../overlays.js";
import type { LibraryRow, PageAccount, TableSession } from "../pages.js";
import type { ChangedFile, SummaryFacts } from "../panels.js";
import { childNoun, subagentLabel, type ChildModel, type ChildSource, type ChildTool, type RowSession } from "../sessions.js";
import type { OpenTarget } from "../settings.js";
import type { Appearance } from "../themes/resolve.js";
import { SESSION_MENU, type SessionMenuItem, type V3Data } from "../window.js";
import type { BarSession, ModelChoices } from "../workbench.js";
import { modelLabel } from "../model-label.js";
import { shortAge } from "../../ui/format.js";
import { choiceFlags, type StartChoice } from "../../ipc.js";
import type { RememberedStart } from "../../settings-store.js";
import { answeredElsewhere, cliAccount, requestKind } from "../../vm/switch-requests.js";
import { parsePr, type HistoryRow, type PrFacts } from "./feeds.js";
import type { V3Feeds } from "./useFeeds.js";

export interface AdapterEnv {
  now: number;
  appearance: Appearance;
  prefersDark: boolean;
  focusTerminal: boolean;
  /** When the engine was first seen down in this run; null while it answers. */
  engineDownSince: number | null;
  plan: NewSessionPlan;
  terminalApp: string;
  /** How long a session stays quiet before it moves to Done today (a setting; default 15 minutes). */
  doneAfterMs?: number;
  /** Changed files per session key, as last read (`changes <s> --json`). */
  changes: ReadonlyMap<string, ChangedFile[]>;
  /** Changed files past the list's cap, per session key (`more` of the same read). */
  changesMore?: ReadonlyMap<string, number>;
  /** Ask for a session's changed files; the caller dedupes and reads. */
  wantChanges: (key: string) => void;
  /** Sessions this window shows in the chat view (their bridges run here). */
  chats?: ReadonlySet<string>;
  /** The view picked for a session in the user's own terminal (read-only; chat by default). */
  ownViews?: ReadonlyMap<string, "terminal" | "chat">;
  /** Chats with no session row yet (a new chat before the poll sees it): drawn from these. */
  chatRows?: readonly SessionRow[];
  /** Where a session in the user's own terminal runs, as last read (`focus <s> --where --json`). */
  terminals?: ReadonlyMap<string, SessionTerminal>;
  /** Ask for a session's terminal; the caller dedupes and reads. */
  wantTerminal?: (key: string) => void;
  /** Where a plain start in the plan's folder would go and why (`dir --json`); null until read.
   *  `for` names the tool and folder it was read for: a route read for another one is ignored. */
  route?: { profile: string | null; why: string[]; blocked?: string; ask?: string[]; for?: { tool: string; folder: string } } | null;
  /** The New-session plan as the dialog has it now; the facts follow it. Absent: `plan`. */
  draft?: NewSessionPlan | null;
  /** The user's home folder, for a typed `~/…` folder; null until read. */
  home?: string | null;
}

export const THINKING_LEVELS: NewSessionFacts["thinkingLevels"] = {
  claude: ["low", "medium", "high", "xhigh", "max"],
  codex: ["minimal", "low", "medium", "high"],
  antigravity: [],
};

const WEEK_MS = 7 * 86_400_000;

/** The palette command that starts a new session straight in the chat view. */
export const NEW_CHAT = "chat:new";

export const sessionKey = (r: Pick<SessionRow, "provider" | "profile" | "sessionId">) => `${r.provider}/${r.profile}/${r.sessionId}`;

/** Local midnight before `now`. */
/** Claude's model aliases for the next turn (`--model`), with the boards' hints (spec §7.6). */
export const CLAUDE_MODELS: ModelChoices["models"] = [
  { id: "opus", label: "Opus", hint: "deepest · uses the most limit" },
  { id: "sonnet", label: "Sonnet", hint: "balanced" },
  { id: "haiku", label: "Haiku", hint: "fast · light on limits" },
];

/** The desktop apps Open in may offer, one per tool. */
const AGENT_APPS = ["claude-desktop", "codex-desktop"];

export function startOfDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Resolved queue items since local midnight, newest first. Pure. */
export function doneToday(history: readonly HistoryRow[], now: number): DoneItem[] {
  const from = startOfDay(now);
  return history
    .filter((h) => {
      const t = Date.parse(h.doneAt);
      return Number.isFinite(t) && t >= from && t <= now;
    })
    .sort((a, b) => b.doneAt.localeCompare(a.doneAt))
    .map(({ id, who, what, doneAt }) => ({ id, who, what, doneAt }));
}

/** The window label the limits strip uses for a usage window key. */
export function windowLabel(key: string, label: string): string {
  if (key === "five_hour") return "5h";
  if (key === "seven_day") return "week";
  if (key === "monthly") return "30d";
  if (key.startsWith("weekly_")) return `week · ${label}`;
  return label;
}

function limitAccount(a: Account, now: number): LimitAccount | null {
  if (a.tool !== "claude" && a.tool !== "codex") return null;
  const windows: LimitWindow[] = a.windows.map((w) => {
    const label = windowLabel(w.key, w.label);
    const resetsAtMs = w.resetsAt ? Date.parse(w.resetsAt) : null;
    return { label, used: w.utilization, resetsAtMs: Number.isFinite(resetsAtMs) ? resetsAtMs : null, pace: paceFor(label, Number.isFinite(resetsAtMs) ? resetsAtMs : null, now) };
  });
  return {
    key: a.id,
    tool: a.tool,
    name: a.name,
    color: a.color,
    protect: a.threshold,
    next: a.isDefault,
    signIn: a.state === "signed-out" || a.state === "wrong-account",
    checkedMs: a.checkedAt,
    windows,
    routines: a.routines ?? null,
    identity: a.identity,
    plan: a.plan,
  };
}

const fiveH = (a: Account | undefined) => a?.windows.find((w) => w.key === "five_hour")?.utilization ?? null;
const nearLimit = (a: Account | undefined) => !!a && (a.state === "near-limit" || a.state === "limited");

const RUNTIME_SOURCES = new Set(["hook", "host", "program", "transcript"]);

/**
 * A child's state (D4). A child that is a session reads its own runtime — the
 * same function as a root — and a listed child session without one is not live.
 * A subagent keeps running / done. Pure.
 */
function childState(o: Record<string, unknown>, rowOf?: (key: string) => SessionRow | undefined, now?: number): Pick<ChildModel, "state" | "stateSource" | "quiet"> {
  const rt = o.runtime as { state?: unknown; source?: unknown; observedAt?: unknown; unconfirmed?: unknown } | undefined;
  if (rt && (rt.state === "working" || rt.state === "idle" || rt.state === "needs-you")) {
    const quiet = rt.unconfirmed === true && typeof rt.observedAt === "number" && now != null ? `no update in ${shortAge(rt.observedAt, now)}` : null;
    return { state: rt.state, stateSource: RUNTIME_SOURCES.has(rt.source as string) ? (rt.source as ChildModel["stateSource"]) : null, ...(quiet ? { quiet } : {}) };
  }
  const own = typeof o.sessionKey === "string" ? rowOf?.(o.sessionKey) : undefined;
  if (own && !own.live) return { state: "done" };
  return { state: o.state === "running" ? "working" : "done" };
}

const CHILD_SOURCES = new Set<ChildSource>(["hook", "files", "lineage", "host", "counted", "unknown"]);
const toolOf = (provider: string | undefined): ChildTool => (provider === "codex" ? "codex" : provider === "antigravity" ? "antigravity" : "claude");

/** What a child tree needs beyond the rows: account colours, the Needs-you subjects, the clock. */
export interface ChildContext {
  accountOf?: (provider: string, profile: string) => { color: IdentityColor; nearLimit: boolean } | undefined;
  needing?: ReadonlySet<string>;
  now?: number;
}

/**
 * `sessions --json` children → the tree's child rows, to any depth: a child
 * session's own children come from its own row (`rowOf`), never inferred. An
 * edge back to a session already above is dropped, so a cycle in the input
 * ends instead of looping (3.1). Pure.
 */
export function childrenOf(r: SessionRow, rowOf?: (key: string) => SessionRow | undefined, ctx: ChildContext = {}, above: ReadonlySet<string> = new Set([sessionKey(r)])): ChildModel[] {
  const out: ChildModel[] = [];
  const parentAccount = { name: r.profile, color: ctx.accountOf?.(r.provider, r.profile)?.color ?? ("blue" as IdentityColor), nearLimit: ctx.accountOf?.(r.provider, r.profile)?.nearLimit ?? false };
  const worktree = worktreeOf(r);
  for (const c of r.children ?? []) {
    const o = c as Record<string, unknown>;
    const kind = typeof o.kind === "string" ? o.kind : "other";
    const sessionKeyOf = typeof o.sessionKey === "string" ? o.sessionKey : null;
    if (sessionKeyOf && above.has(sessionKeyOf)) continue;
    const id = typeof o.agentId === "string" ? o.agentId : (sessionKeyOf ?? `${kind}-${out.length}`);
    const label = typeof o.label === "string" ? o.label : typeof o.agentId === "string" ? subagentLabel(o) : typeof o.type === "string" ? o.type : kind;
    const source = CHILD_SOURCES.has(o.source as ChildSource) ? (o.source as ChildSource) : "unknown";
    const identity: Partial<ChildModel> = {};
    let children: ChildModel[] = [];
    if (sessionKeyOf) {
      // A child session's key names its tool and account: `provider/account/id`.
      const [provider, profile] = sessionKeyOf.split("/");
      const a = provider && profile ? ctx.accountOf?.(provider, profile) : undefined;
      identity.tool = toolOf(provider);
      if (profile) identity.account = { name: profile, color: a?.color ?? "blue", nearLimit: a?.nearLimit ?? false };
      const own = rowOf?.(sessionKeyOf);
      if (own) children = childrenOf(own, rowOf, ctx, new Set([...above, sessionKeyOf]));
    } else {
      identity.tool = toolOf(r.provider);
      identity.account = parentAccount;
      if (typeof o.agentId === "string") {
        identity.worktree = worktree(o.agentId);
        // 7.7: what it runs now and its hook times, for its read-only view.
        if (typeof o.doing === "string" && o.state === "running") identity.doing = o.doing;
        const ms = (v: unknown) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null);
        if (ms(o.startedAt) != null) identity.startedMs = ms(o.startedAt);
        if (ms(o.endedAt) != null) identity.endedMs = ms(o.endedAt);
      }
    }
    const needsYou = !!ctx.needing?.has(id) || children.some((k) => k.needsYou);
    out.push({ id, label, kind, ...childState(o, rowOf, ctx.now), source, ...identity, ...(children.length ? { children } : {}), ...(needsYou ? { needsYou } : {}) });
  }
  const counted = (r.childCount ?? 0) - (r.children ?? []).length;
  if (counted > 0) out.push({ id: `${sessionKey(r)}#counted`, label: "subagents", kind: "subagent", state: "done", source: "counted", count: counted, tool: toolOf(r.provider), account: parentAccount });
  return out;
}

/** Summary's "Children" fact: the Children window's noun and count, or "none". Pure. */
const childSummary = (children: ChildModel[]) => (children.length ? childNoun({ children }) : "none");

/** A subagent's worktree name, from the session's record of its children: by its agent id, and by the Task call that started it, which a running Task row already knows. Pure. */
export function worktreeOf(r: SessionRow | undefined): (agentId: string) => string | null {
  const byAgent = new Map<string, string>();
  for (const c of r?.children ?? []) {
    const o = c as Record<string, unknown>;
    const cwd = typeof o.cwd === "string" ? o.cwd : "";
    const m = /[\\/]worktrees[\\/]([^\\/]+)[\\/]?$/.exec(cwd);
    if (!m) continue;
    if (typeof o.agentId === "string") byAgent.set(o.agentId, m[1]);
    if (typeof o.toolUseId === "string") byAgent.set(o.toolUseId, m[1]);
  }
  return (agentId) => byAgent.get(agentId) ?? null;
}

/** Menu entries that do something for this session. Detach has no meaning
 *  outside the attached terminal view, which closing its tab already does;
 *  End and Compact reach only sessions Agent Switch hosts; Take over only a
 *  session in the user's own terminal, and only with tmux (`host adopt`). Pure. */
export function menuFor(row: SessionRow | undefined, hosted: boolean, hosting: "persistent" | "ephemeral"): SessionMenuItem[] {
  return SESSION_MENU.filter((item) => {
    if (item === "Detach") return false;
    if (item === "End…" || item === "Compact") return hosted;
    if (item === "Take over here…") return canTakeOver(row, hosted, hosting);
    if (item === "Hand off…" || item === "Move to another account…") return !!row && row.provider !== "antigravity";
    return true;
  });
}

/** A Claude or Codex session in the user's own terminal can be taken over into a
 *  hosted window — where tmux hosts sessions; without it `host adopt` refuses. Pure. */
export function canTakeOver(row: SessionRow | undefined, hosted: boolean, hosting: "persistent" | "ephemeral"): boolean {
  return hosting === "persistent" && !!row && !hosted && row.surface !== "desktop-app" && (row.provider === "claude" || row.provider === "codex");
}

/** What `focus <s> --where --json` says about a session in the user's own terminal. */
export interface SessionTerminal {
  running: boolean | null;
  terminal: string | null;
  focusable: boolean;
  why?: string;
}

/** Where a session not hosted here runs, named only as far as it is known, and
 *  whether "Focus terminal" reaches it. Codex names no program per session, so
 *  it is never asked about. Asks for a Claude session's terminal once. */
function externalWhere(r: SessionRow, key: string, here: boolean, env: AdapterEnv): { where: string; focusable: boolean } {
  if (r.surface === "desktop-app") return { where: "Claude Desktop", focusable: false };
  if (here) return { where: "Agent Switch", focusable: false };
  if (r.provider !== "claude") return { where: "your terminal", focusable: false };
  const t = env.terminals?.get(key);
  if (!t) env.wantTerminal?.(key);
  return { where: t?.terminal ?? "your terminal", focusable: !!t?.focusable };
}

const prsOf = (r: SessionRow): PrFacts[] => (r.prs ?? []).map(parsePr).filter((p): p is PrFacts => p !== null);
/** True when the session has an open PR: Create PR is then not offered. */
export const hasOpenPr = (r: SessionRow): boolean => prsOf(r).some((p) => p.lifecycle === "OPEN");

export interface NextStep {
  text: string;
  action: string;
  does: "open-checks" | "open-pr" | "create-pr" | "focus";
  /** What the agent is asked to do about it: sent where the app can type, copied elsewhere. */
  prompt?: string;
}

/** A PR page as GitHub names it; anything else is left out of a prompt. Pure. */
const prPage = (url: string | null | undefined): string | null => (url && /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+$/.test(url) ? url : null);

/** The request a failing PR's agent is sent: fixed text and the PR's checks page,
 *  nothing else. Check names are text anyone who can push a workflow controls, so
 *  they never reach the agent; it reads them on that page. Same as `needs fix`. Pure. */
export function ciPrompt(pr: Pick<PrFacts, "number" | "url">): string {
  const page = prPage(pr.url);
  return `CI is failing on PR #${pr.number}${page ? ` (${page}/checks)` : ""}. Find the cause and fix it.`;
}

/** The request a PR with a merge conflict sends its agent. Pure. */
export function conflictPrompt(pr: Pick<PrFacts, "number" | "url">): string {
  const page = prPage(pr.url);
  return `PR #${pr.number} has a merge conflict with its base branch${page ? ` (${page})` : ""}. Bring the branch up to date with its base and resolve the conflict.`;
}

/** Why a hosted Codex session's model and thinking stay as they started: `host respawn` restarts Claude only. */
export const NO_TERMINAL_WHY = "This session started in the chat view; it has no terminal here";
export const CODEX_RESPAWN_WHY ="Codex keeps the model and thinking it started with; start a new session to change them";

/**
 * Whether "Focus terminal" can bring this session's terminal to the front: only a
 * Claude session in the user's own terminal (`focus` finds it by its process), not
 * one the app hosts or runs as a chat, and only while the Open in › Focus terminal
 * switch is on. Pure.
 */
export const canFocus = (r: { provider: string }, hereOrHosted: boolean, focusTerminal: boolean): boolean => focusTerminal && r.provider === "claude" && !hereOrHosted;

/** The label of a step the agent can be asked to do: sent, or copied for the user to paste. Pure. */
export const promptAction = (canType: boolean) => (canType ? "Send to agent" : "Copy prompt");

/** The folder's git state as the New-session dialog labels it ("main · clean",
 *  "feat/x · 3 changed"), from the newest session the CLI read there with its git
 *  facts (`sessions --json`). Null for a folder no session ran in, or outside git:
 *  nothing is shown rather than a guess. Pure. */
export function folderGitState(folder: string, rows: readonly SessionRow[]): string | null {
  const here = rows.filter((r) => r.git && (r.cwd === folder || r.git.cwd === folder || r.git.toplevel === folder)).sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.git;
  if (!here) return null;
  const changed = here.changed > 0 ? `${here.changed} changed` : here.dirty ? "changed" : "clean";
  return `${here.branch ?? "detached"} · ${changed}`;
}

/** The session a CI item is about: the one it names, or — from an older CLI that
 *  named the item by a session key — that key. Never another session found on the
 *  same PR: a fix sent there would go to work the user did not pick. Pure. */
export function ciSession(n: { subject: string; session?: string }, byKey: ReadonlyMap<string, SessionRow>): SessionRow | undefined {
  return byKey.get(n.session ?? n.subject);
}

/** The one next step for a session, by its PR and git state (spec §6.4). Pure. */
export function nextStep(r: SessionRow, needsYou: boolean): NextStep | null {
  const pr = prsOf(r)[0];
  if (needsYou) return { text: "Waits for you in its terminal", action: "Focus terminal", does: "focus" };
  if (pr && pr.lifecycle === "OPEN") {
    if (pr.ci === "FAILURE") return { text: `CI failing: ${pr.failingChecks.join(", ") || "checks"}`, action: "Open checks", does: "open-checks", prompt: ciPrompt(pr) };
    if (pr.mergeable === "CONFLICTING")
      return { text: `PR #${pr.number} has a merge conflict`, action: "Open PR", does: "open-pr", prompt: conflictPrompt(pr) };
    if (pr.review === "CHANGES_REQUESTED") {
      const page = prPage(pr.url);
      return { text: `Changes requested on PR #${pr.number}`, action: "Open PR", does: "open-pr", prompt: `Changes were requested on PR #${pr.number}${page ? ` (${page})` : ""}. Please read the review comments and address them.` };
    }
    return null;
  }
  const g = r.git;
  if (!pr && g && g.branch && g.upstream !== null && (g.ahead ?? 0) > 0 && r.git?.remote?.includes("github.com")) {
    return { text: `${g.ahead} commit${g.ahead === 1 ? "" : "s"} on ${g.branch} without a PR`, action: "Create PR", does: "create-pr" };
  }
  return null;
}

function keptText(r: SessionRow): string {
  const k = r.kept as { state?: string; bytes?: number; daysLeft?: number } | undefined;
  if (k?.state === "kept") return "Kept in the vault";
  if (k?.state === "at-risk") return `Claude removes it in ${k.daysLeft} days`;
  if (k?.state === "lost") return "Transcript gone";
  return "Not in the library";
}

function vaultOf(e: { kept: { state: string; bytes?: number; daysLeft?: number } }): LibraryRow["vault"] {
  if (e.kept.state === "kept") return { state: "saved", bytes: e.kept.bytes ?? 0 };
  if (e.kept.state === "at-risk") return { state: "none", cleanupInDays: e.kept.daysLeft ?? null };
  return { state: "unavailable" };
}

const basename = (p: string | null) => (p ? p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p : null);

/**
 * One label per project root: the folder name, or as many trailing path parts
 * as it takes to tell roots apart (`work/api`, `personal/api`). Pure.
 */
export function projectLabels(roots: readonly string[]): Map<string, string> {
  const parts = new Map([...new Set(roots)].map((r) => [r, r.split("/").filter(Boolean)]));
  const tail = (p: string[], n: number) => p.slice(-n).join("/");
  const out = new Map<string, string>();
  for (const [root, p] of parts) {
    let n = 1;
    while (n < p.length && [...parts].some(([o, q]) => o !== root && tail(q, n) === tail(p, n))) n++;
    out.set(root, tail(p, n) || root);
  }
  return out;
}

/** The whole window's data. */
/** Quiet this long and a session moves to Done today, unless the setting says otherwise. */
export const DEFAULT_DONE_AFTER_MS = 15 * 60_000;
/** Quiet longer than this and a session moves to the folded "Older than a day" group. */
const OLDER_MS = 24 * 3600_000;

export function toV3Data(vmIn: ViewModel, feeds: V3Feeds, env: AdapterEnv): V3Data {
  const now = env.now;
  // One row per account, whatever the reads returned (a reload racing a poll can repeat one).
  const vm: ViewModel = { ...vmIn, accounts: [...new Map(vmIn.accounts.map((a) => [a.id, a])).values()] };
  // A Codex rollout the engine matched to a live hosted window takes that window's key, so
  // the window's actions (end, compact, its terminal) reach it and it is listed once.
  const liveHost = new Map((feeds.host?.hosted ?? []).filter((h) => h.alive && h.sessionId).map((h) => [h.key, h]));
  const read = [...(vm.sessionRows ?? []), ...feeds.codexRows].map((r) => {
    const h = r.hostKey ? liveHost.get(r.hostKey) : undefined;
    return h && h.sessionId !== r.sessionId ? { ...r, sessionId: h.sessionId } : r;
  });
  const seen = new Set(read.map(sessionKey));
  // A hosted session started a moment ago has no transcript yet: it still gets a row.
  const hostedOnly: SessionRow[] = (feeds.host?.hosted ?? [])
    .filter((h) => h.alive && !seen.has(h.key) && h.provider && h.account && h.sessionId)
    .map((h) => ({ provider: h.provider as SessionRow["provider"], profile: h.account, sessionId: h.sessionId, projectDir: "", cwd: h.cwd || null, mtimeMs: Date.parse(h.startedAt) || now, live: true, summary: null }));
  const chatOnly = (env.chatRows ?? []).filter((r) => !seen.has(sessionKey(r)) && !hostedOnly.some((h) => sessionKey(h) === sessionKey(r)));
  const rows = [...read, ...hostedOnly, ...chatOnly];
  const byKey = new Map(rows.map((r) => [sessionKey(r), r]));
  const accounts = new Map(vm.accounts.map((a) => [a.id, a]));
  const accountOf = (r: SessionRow) => accounts.get(accountId(r.provider, r.profile));
  const colorOf = (r: SessionRow): IdentityColor => accountOf(r)?.color ?? "blue";
  const hosted = new Map((feeds.host?.hosted ?? []).filter((h) => h.alive).map((h) => [h.key, h]));
  /** The app types into a session it hosts or whose chat runs in this window. */
  const canType = (key: string) => hosted.has(key) || !!env.chats?.has(key);
  const focusOk = (r: SessionRow, key: string) => canFocus(r, canType(key), env.focusTerminal);
  // A verb says what it does here. CI: the fix is sent where the app can type into the
  // session the item names; elsewhere the checks (or, for a conflict, the PR) open.
  // "Focus terminal" only where focusing works; elsewhere the click opens the session.
  const needs = (feeds.needs?.items ?? []).map((n) => {
    if (n.kind === "ci") {
      const r = ciSession(n, byKey);
      return { ...n, verb: r && canType(sessionKey(r)) ? "Fix" : n.ci?.state === "conflict" ? "Open PR" : "Open checks" };
    }
    if (n.verb === "Focus terminal") {
      const r = byKey.get(n.subject);
      return r && focusOk(r, n.subject) ? n : { ...n, verb: "Open session" };
    }
    return n;
  });
  const needing = new Set(needs.map((n) => n.subject));
  const today = startOfDay(now);
  const stateOf = (r: SessionRow) => sessionFromRow(r, now).state;
  const titleOf = (r: SessionRow) => r.library?.name || r.summary || basename(r.cwd) || r.sessionId.slice(0, 8);

  const childCtx: ChildContext = { accountOf: (provider, profile) => { const a = accounts.get(accountId(provider, profile)); return a ? { color: a.color, nearLimit: nearLimit(a) } : undefined; }, needing, now };
  const roots = rows.filter((r) => !r.parent && (r.live || r.mtimeMs >= today));
  // Active, quiet past the done-after time (Done today), or quiet for over a day (Older).
  // Something that needs the user or is working never leaves the active list.
  const doneAfter = env.doneAfterMs ?? DEFAULT_DONE_AFTER_MS;
  const whenOf = (r: SessionRow, state: string, needsYou: boolean): "active" | "done" | "older" => {
    const quietFor = state === "needs-you" || state === "working" || needsYou ? 0 : now - r.mtimeMs;
    if (quietFor > OLDER_MS) return "older";
    return !(r.live || r.recentlyActive) || quietFor >= doneAfter ? "done" : "active";
  };
  const sessions: RowSession[] = roots.map((r) => {
    const key = sessionKey(r);
    const pr = prsOf(r)[0];
    const view = sessionFromRow(r, now);
    const children = childrenOf(r, (k) => byKey.get(k), childCtx);
    const needsYou = needing.has(key) || children.some((c) => c.needsYou);
    const when = whenOf(r, view.state, needsYou);
    return {
      key,
      title: titleOf(r),
      state: view.state,
      stateSource: view.stateSource ?? null,
      quiet: view.quietSince != null ? `no update in ${shortAge(view.quietSince, now)}` : null,
      account: { name: r.profile, nearLimit: nearLimit(accountOf(r)), color: colorOf(r) },
      tool: toolOf(r.provider),
      lastActiveMs: r.mtimeMs,
      branch: r.git?.branch ?? null,
      pr: pr ? { number: pr.number, ci: pr.ci, mergeable: pr.mergeable } : null,
      children,
      // D6: a Needs-you item on this session or any descendant.
      needsYou,
      ...(when === "older" ? { older: true } : when === "done" ? { doneToday: true } : {}),
    };
  });

  const limits = vm.accounts.filter((a) => !a.disabled).map((a) => limitAccount(a, now)).filter((a): a is LimitAccount => a !== null);
  const pageAccounts: PageAccount[] = vm.accounts.flatMap((a): PageAccount[] => {
    const l = limitAccount(a, now);
    return l ? [{ ...l, email: a.identity, label: a.label, isDefault: a.isDefault, running: a.liveSessions }] : [];
  });

  // A project is the repository (its main checkout, from git's common dir, so every worktree joins it), else the folder (D7).
  // Keyed on the full path; labelled by its folder name, with as much of the parent path as tells two apart.
  const rootOf = (r: SessionRow): string | null => r.git?.repoRoot ?? r.git?.toplevel ?? r.cwd ?? null;
  const labels = projectLabels(rows.map(rootOf).filter((d): d is string => !!d));
  const projectOf = (r: SessionRow): string | null => {
    const dir = rootOf(r);
    return dir ? (labels.get(dir) ?? null) : null;
  };
  const table: TableSession[] = rows.map((r) => {
    const pr = prsOf(r)[0];
    return {
      key: sessionKey(r),
      title: titleOf(r),
      state: stateOf(r),
      live: r.live,
      tool: r.provider === "codex" ? "codex" : r.provider === "antigravity" ? "antigravity" : "claude",
      account: { name: r.profile, color: colorOf(r) },
      branch: r.git?.branch ?? null,
      pr: pr ? { number: pr.number, ci: pr.ci } : null,
      model: modelLabel(r.context?.model),
      thinking: (r.context as { effort?: string | null } | null | undefined)?.effort ?? null,
      contextPct: r.context?.pct ?? null,
      lastActiveMs: r.mtimeMs,
      project: projectOf(r),
      projectRoot: rootOf(r),
      worktree: r.git ? { id: r.git.toplevel, branch: r.git.branch, linked: r.git.worktree } : null,
    };
  });

  const library: LibraryRow[] = (feeds.library?.entries ?? []).map((e) => {
    const [provider, profile] = e.key.split("/");
    return {
      key: e.key,
      name: e.name ?? e.summary ?? e.key.split("/").pop()!.slice(0, 8),
      summary: e.summary,
      tags: e.tags,
      color: accounts.get(accountId(provider ?? "claude", profile ?? ""))?.color ?? "blue",
      project: basename(e.cwd),
      branch: e.branch,
      pr: e.pr,
      lastMs: e.lastMs,
      pinned: e.pinned,
      archived: e.archived,
      vault: vaultOf(e),
      transcript: e.canResume,
    };
  });

  const palette: PaletteEntry[] = [
    ...rows.map((r) => ({
      id: sessionKey(r),
      group: "sessions" as const,
      title: titleOf(r),
      meta: [r.profile, r.git?.branch].filter(Boolean).join(" · "),
      state: stateOf(r),
      ...(now - r.mtimeMs > WEEK_MS ? { old: true } : {}),
    })),
    ...rows.flatMap((r) => {
      const pr = prsOf(r)[0];
      return pr ? [{ id: `pr:${sessionKey(r)}`, group: "branches" as const, title: `#${pr.number} ${r.git?.branch ?? ""}`.trim(), meta: r.profile }] : [];
    }),
  ];

  palette.push({ id: NEW_CHAT, group: "commands", title: "New session in chat view", meta: "Claude, in this window" });

  const targets: OpenTarget[] = (feeds.openTargets?.targets ?? []).map((t) => ({ target: t.target, label: t.label, kind: t.kind, installed: t.installed, app: t.app, launcher: t.launcher }));

  // The dialog's facts follow the plan as it is now: its tool, folder and chosen account.
  const live = env.draft ?? env.plan;
  // The account the CLI's routing picks for this folder; the tool's default account until that is read.
  const route = env.route && (!env.route.for || (env.route.for.tool === live.tool && env.route.for.folder === live.folder)) ? env.route : null;
  const routedName = route?.profile && route.profile.startsWith(`${live.tool}/`) ? route.profile.slice(live.tool.length + 1) : null;
  const routed = routedName ? vm.accounts.find((a) => a.tool === live.tool && a.name === routedName) : undefined;
  const chosen = live.account ? vm.accounts.find((a) => a.tool === live.tool && a.name === live.account) : undefined;
  const shown = chosen ?? routed ?? vm.accounts.find((a) => a.tool === live.tool && a.isDefault) ?? vm.accounts.find((a) => a.tool === live.tool);
  const planLimits = shown ? limitAccount(shown, now) : null;
  const ask = askCandidates(route, vm.accounts, live.tool);
  const accountsOf = (tool: string) => vm.accounts.filter((a) => a.tool === tool && !a.disabled).map((a) => ({ name: a.name, color: a.color }));
  const facts: NewSessionFacts = {
    gitState: folderGitState(live.folder, rows),
    terminalApp: startTerminalName(feeds.openTargets, env.terminalApp),
    hosting: feeds.host?.mode ?? "ephemeral",
    thinkingLevels: THINKING_LEVELS,
    models: { claude: CLAUDE_MODELS.map((m) => ({ id: m.id, label: m.label })), codex: [], antigravity: [] },
    folders: recentFolders(rows),
    home: env.home ?? null,
    accounts: { claude: accountsOf("claude"), codex: accountsOf("codex"), antigravity: accountsOf("antigravity") },
    account: {
      name: shown?.name ?? "—",
      color: shown?.color ?? "blue",
      ...(chosen ? { chosen: true as const } : {}),
      reason: chosen ? "chosen here" : route?.blocked ? route.blocked : routed ? (route?.why[0] ?? "the folder's rule") : shown?.isDefault ? "the account for plain starts" : "the only account of this tool",
      limits: planLimits ?? { key: "none", tool: live.tool === "codex" ? "codex" : "claude", name: "—", color: "blue", protect: 98, next: false, signIn: false, checkedMs: null, windows: [] },
      // Reasons belong to the routed account; shown beside another one they would mislead.
      why: routed && !chosen ? (route?.why ?? []) : [],
      paceText: null,
    },
    ...(ask ? { ask } : {}),
    // What the start passes: the account chosen here, else none — the CLI routes, as the box shows.
    command: startCommand(live, live.account ?? (ask ? "ask" : null)),
    nowMs: now,
  };

  const health: V3Data["health"] =
    feeds.engine && !feeds.engine.running ? { state: "down", sinceMs: env.engineDownSince ?? now, hostedRunning: feeds.engine.hostedRunning, ...(feeds.engine.elsewhere ? { elsewhere: true as const } : {}) } : { state: "ready" };

  return {
    nowMs: now,
    health,
    needs,
    away: feeds.needs?.away ?? null,
    history: doneToday(feeds.needs?.history ?? [], now),
    activity: activityFromEntries(feeds.activity ?? []),
    sessions,
    limits,
    accounts: pageAccounts,
    table,
    library,
    vaultBytes: feeds.library?.vaultBytes ?? 0,
    autoKeep: feeds.library?.autoKeep ?? true,
    tools: vm.tools,
    palette,
    appearance: env.appearance,
    prefersDark: env.prefersDark,
    openIn: {
      targets,
      defaultTarget: feeds.openTargets?.default ?? null,
      lastUsed: feeds.openTargets?.lastUsed ?? null,
      perRepo: feeds.openTargets?.perRepo ?? {},
      terminal: feeds.openTargets?.terminal ?? null,
      terminals: feeds.openTargets?.terminals ?? [],
      focusTerminal: env.focusTerminal,
      terminalSync: feeds.terminalSync?.enabled ?? null,
      // Only the desktop apps of a tool, and only where they are installed (spec §7.7).
      agentApps: vm.surfaces.filter((x) => x.kind === "desktop" && x.detected && AGENT_APPS.includes(x.id)).map((x) => ({ id: x.id, label: x.name, tool: x.tool })),
    },
    agents: { rows: feeds.agents?.agents ?? [], suggestions: feeds.agents?.suggestions ?? [] },
    remote: { remoteControl: feeds.remote?.remoteControlAccounts ?? [], ssh: feeds.remote?.ssh ?? false },
    newSession: { initial: env.plan, facts },
    link: linkFor(vm, now),
    decision: (subject) => decisionFor(subject, vm, rows, now),
    chatHere: (key) => !!env.chats?.has(key),
    bar: (key): BarSession | null => {
      const r = byKey.get(key);
      if (!r) return null;
      const a = accountOf(r);
      return {
        key,
        hosted: hosted.has(key) || !!env.chats?.has(key),
        // Only a tmux window can be joined from the user's terminal; a chat has none.
        attachable: hosted.has(key),
        // Started in the chat: there is no program in a terminal to switch to.
        ...(env.chats?.has(key) && !hosted.has(key) ? { terminalWhy: NO_TERMINAL_WHY } : {}),
        ...externalWhere(r, key, hosted.has(key) || !!env.chats?.has(key), env),
        ...(r.provider === "codex" && hosted.has(key) && !env.chats?.has(key) ? { respawnWhy: CODEX_RESPAWN_WHY } : {}),
        // v3.1: chat and terminal share one conversation for Claude and Codex.
        chatAvailable: r.provider === "claude" || r.provider === "codex",
        view: env.chats?.has(key) ? "chat" : hosted.has(key) ? "terminal" : (env.ownViews?.get(key) ?? "chat"),
        account: { name: r.profile, color: colorOf(r), fiveH: fiveH(a), protect: a?.threshold ?? 98 },
        model: modelLabel(r.context?.model),
        modelId: r.context?.model ?? null,
        thinking: (r.context as { effort?: string | null } | null | undefined)?.effort ?? null,
        contextPct: r.context?.pct ?? null,
        tool: r.provider,
        contextTokens: r.context?.contextTokens ?? null,
        cache: r.cache ?? null,
      };
    },
    models: (key): ModelChoices | null => {
      const r = byKey.get(key);
      if (!r || (r.provider !== "claude" && r.provider !== "codex")) return null;
      const id = (r.context?.model ?? "").toLowerCase();
      const effort = (r.context as { effort?: string | null } | null | undefined)?.effort ?? null;
      // Codex keeps the model its config names; only its reasoning level changes here.
      const models = r.provider === "claude" ? CLAUDE_MODELS : [];
      return {
        models,
        current: models.find((m) => id.includes(m.id))?.id ?? null,
        thinking: THINKING_LEVELS[r.provider],
        currentThinking: effort,
        thinkingWhy: env.chats?.has(key) ? "Set when the chat starts; switch to the terminal view to change it." : undefined,
      };
    },
    summary: (key): SummaryFacts | null => {
      const r = byKey.get(key);
      if (!r) return null;
      const pr = prsOf(r)[0];
      const a = accountOf(r);
      const n = nextStep(r, needing.has(key) && focusOk(r, key));
      // The Changes list is the authority: once read, the count is its length, so Summary and
      // Changes agree. Before the first read the hooks' count stands in.
      if (r.git) env.wantChanges(key);
      const files = env.changes.get(key);
      return {
        next: n && { text: n.text, action: n.prompt ? promptAction(canType(key)) : n.action },
        pr: pr ? { number: pr.number, url: pr.url, ci: pr.ci, lifecycle: pr.lifecycle, mergeable: pr.mergeable, review: pr.review, failingChecks: pr.failingChecks } : null,
        git: r.git ? { branch: r.git.branch, worktree: r.git.worktree, changed: files ? files.length + (env.changesMore?.get(key) ?? 0) : r.git.changed, ahead: r.git.ahead, behind: r.git.behind } : null,
        limit: nearLimit(a) ? `${a!.name} is at ${fiveH(a) ?? "?"}% of its 5-hour window` : null,
        more: {
          id: r.sessionId,
          host: hosted.has(key) ? "Hosted by Agent Switch" : r.surface === "desktop-app" ? "Claude Desktop" : "Your terminal",
          library: keptText(r),
          // The Children window's count and words, so the two never disagree.
          children: childSummary(sessions.find((x) => x.key === key)?.children ?? childrenOf(r, (k) => byKey.get(k), childCtx)),
        },
      };
    },
    changes: (key) => {
      env.wantChanges(key);
      return env.changes.get(key) ?? [];
    },
    changesMore: (key) => env.changesMore?.get(key) ?? 0,
    next: (key) => {
      const r = byKey.get(key);
      const n = r ? nextStep(r, needing.has(key) && focusOk(r, key)) : null;
      return n && { text: n.text, action: n.prompt ? promptAction(canType(key)) : n.action };
    },
    menu: (key) => menuFor(byKey.get(key), hosted.has(key), feeds.host?.mode ?? "ephemeral"),
    // v3.1: "Commit…" opens the Review page, where staged changes are committed.
    commitAvailable: true,
  };
}

type Route = AdapterEnv["route"];

/** Strategy ask: the accounts of `tool` a person picks from, in the CLI's order;
 *  undefined when there is no choice to make. The CLI's own pick is the fallback
 *  for scripts, never for a person. Pure. */
export function askCandidates(route: Route, accounts: readonly Account[], tool: string): { name: string; color: IdentityColor }[] | undefined {
  const found = (route?.ask ?? []).flatMap((name) => accounts.filter((a) => a.tool === tool && a.name === name)).map((a) => ({ name: a.name, color: a.color }));
  return found.length > 1 ? found : undefined;
}

/** Which Claude account a new chat starts on: the routed one, else the default;
 *  under strategy ask, the candidates to ask about instead. Pure. */
export function chatStart(route: Route, accounts: readonly Account[]): { profile: string } | { ask: { name: string; color: IdentityColor }[] } | null {
  // A route read for another tool (the New-session dialog's last pick) says nothing about Claude.
  const own = route?.profile?.startsWith("claude/") ? route : null;
  const ask = askCandidates(own, accounts, "claude");
  if (ask) return { ask };
  const profile = own?.profile ? own.profile.slice("claude/".length) : accounts.find((a) => a.tool === "claude" && a.isDefault)?.name;
  return profile ? { profile } : null;
}

/** What the New-session dialog opens with: the project's last start, or — on
 *  the first start there — your terminal (spec Principle 5). Pure. */
export function initialPlan(folder: string, last: RememberedStart | null, hosting: "persistent" | "ephemeral" = "persistent"): NewSessionPlan {
  const base = { folder, gitState: null, worktree: false };
  if (!last) return { ...base, tool: "claude", model: "opus", thinking: "high", where: "terminal" };
  // `host start` refuses without tmux, so a remembered hosted start opens in the user's terminal there.
  return { ...base, ...last, ...(last.where === "hosted" && hosting !== "persistent" ? { where: "terminal" as const } : {}), remembered: true };
}

/** The model, thinking and worktree a plan starts with — only what its tool takes. Pure. */
export function startChoice(p: NewSessionPlan): StartChoice {
  return {
    ...(p.model && p.tool !== "antigravity" ? { model: p.model } : {}),
    ...(THINKING_LEVELS[p.tool].includes(p.thinking) ? { effort: p.thinking } : {}),
    ...(p.worktree ? { worktree: true } : {}),
  };
}

/** The exact command the New-session dialog previews — the one its start runs.
 *  `account`: the one named on it; null lets the CLI route; "ask" marks one still to be chosen. Pure. */
export function startCommand(p: NewSessionPlan, account: string | null | "ask"): string {
  const q = (s: string) => (/^[\w./:@-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`);
  const choice = choiceFlags(startChoice(p)).map(q);
  const who = account === "ask" ? ["<account>"] : account ? [q(account)] : [];
  if (p.where === "hosted") return ["agent-switch", "host", "start", ...who, "--provider", p.tool, "--cwd", q(p.folder), ...choice].join(" ");
  return ["agent-switch", "run", ...who, "--provider", p.tool, "--cwd", q(p.folder), ...choice, "--new-window"].join(" ");
}

/** The terminal `run --new-window` opens: the one set in Settings (the CLI's
 *  pick), Terminal for Warp, which cannot be asked to run a command; `fallback`
 *  until Settings is read. Pure. */
export function startTerminalName(o: V3Feeds["openTargets"], fallback: string): string {
  const id = o?.terminal;
  if (!id) return fallback;
  if (id === "warp") return "Terminal";
  return o.terminals.find((t) => t.id === id)?.name ?? fallback;
}

/** The folders sessions ran in, newest first. Pure. */
function recentFolders(rows: readonly SessionRow[], limit = 8): string[] {
  const out: string[] = [];
  for (const r of [...rows].sort((a, b) => b.mtimeMs - a.mtimeMs)) {
    if (r.cwd && !out.includes(r.cwd)) out.push(r.cwd);
    if (out.length >= limit) break;
  }
  return out;
}

/** Where a start in `folder` is remembered: the main repository it belongs to —
 *  also from a worktree or a subfolder — as the sessions' git facts know it; the
 *  folder itself when none does. Pure. */
export function startKey(folder: string, rows: readonly SessionRow[]): string {
  const inside = (dir: string) => folder === dir || folder.startsWith(dir.endsWith("/") ? dir : `${dir}/`);
  for (const r of rows) {
    const g = r.git;
    if (g && inside(g.toplevel)) return g.repoRoot ?? g.toplevel;
  }
  return folder;
}

/** The switch requests the window acts on. Pure. */
export function linkFor(vm: ViewModel, now: number): NonNullable<V3Data["link"]> {
  const rows = vm.switchRequests ?? [];
  const asked = rows.filter((r) => r.state === "open" && r.raisedBy === "ac" && Date.parse(r.expiresAt) > now).map((r) => ({ id: r.id, account: r.account }));
  const accounts = [...new Set(rows.map((r) => r.account))];
  const answered = accounts.filter((a) => answeredElsewhere(rows, a.replace("/", ":"), now) !== null);
  return { asked, answered };
}

/** The limit decision sheet for an account subject (`claude/work` or `claude:work`). */
export function decisionFor(subject: string, vm: ViewModel, rows: readonly SessionRow[], now: number) {
  // An account (`claude/work`, `claude:work`) or one session (`claude/work/<id>`): then only that session moves.
  const parts = subject.split("/");
  const only = parts.length === 3 ? subject : null;
  const id = subject.includes(":") ? subject : `${parts[0]}:${parts[1]}`;
  const a = vm.accounts.find((x) => x.id === id);
  if (!a) return null;
  const w = a.windows.find((x) => x.key === "five_hour") ?? a.windows[0];
  if (!w) return null;
  const others = vm.accounts
    .filter((x) => x.tool === a.tool && x.id !== a.id && !x.disabled && x.state !== "signed-out")
    .sort((x, y) => roomOf(y) - roomOf(x) || x.liveSessions - y.liveSessions);
  const resetsAt = w.resetsAt ? Date.parse(w.resetsAt) : NaN;
  const mins = Number.isFinite(resetsAt) ? Math.max(0, Math.round((resetsAt - now) / 60_000)) : null;
  const moving = rows
    .filter((r) => (only ? sessionKey(r) === only : r.live && accountId(r.provider, r.profile) === a.id))
    .map((r) => ({ r, state: sessionFromRow(r, now).state }));
  const assigned = spreadSessions(
    moving.map(({ r, state }) => ({ key: sessionKey(r), demand: sessionDemand(r, state) })),
    others,
  );
  const titleOf = (r: SessionRow) => r.library?.name || r.summary || r.sessionId.slice(0, 8);
  const sessions: SheetSession[] = moving.map(({ r, state }) => ({ key: sessionKey(r), title: titleOf(r), model: modelLabel(r.context?.model), target: assigned.get(sessionKey(r)) ?? "", state }));
  // A Desktop session runs on Desktop's own login: a rebind of the profile does not move it.
  const alsoOn = rows.filter((r) => r.live && r.surface !== "desktop-app" && accountId(r.provider, r.profile) === a.id).map((r) => ({ key: sessionKey(r), title: titleOf(r) }));
  // The heaviest session's account: the one the sheet names when it names one.
  const heaviest = [...moving].sort((x, y) => sessionDemand(y.r, y.state) - sessionDemand(x.r, x.state))[0];
  const suggestion = (heaviest && assigned.get(sessionKey(heaviest.r))) ?? others[0]?.name ?? "";
  const spread = new Set(sessions.map((s) => s.target)).size > 1;
  return {
    account: a.name,
    tool: a.tool,
    // The sheet also opens from Move at any level; only a near or limited account is "near limit".
    nearLimit: nearLimit(a),
    // The accounts a session can move to, most room first; the picker offers these only.
    targets: others.map((x) => ({ name: x.name, color: x.color, busy: x.liveSessions > 0 })),
    pctUsed: w.utilization ?? 0,
    window: windowLabel(w.key, w.label),
    resetsIn: mins === null ? "unknown" : mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`,
    sessions,
    alsoOn,
    suggestion,
    suggestionWhy: suggestion ? (spread ? "spread by expected use — the busiest session gets the most room" : "most room left") : undefined,
    askedByAgentConfig: (vm.switchRequests ?? []).some((r) => r.state === "open" && r.raisedBy === "ac" && r.account === cliAccount(a.id) && Date.parse(r.expiresAt) > now),
    ...paceWording(vm, a, now),
  };
}

const hoursText = (h: number) => (h < 48 ? `${Math.max(1, Math.round(h))} h` : `${Math.round(h / 24)} days`);

/** An open pace request words the sheet (road-to-limits-that-last-the-whole-run
 *  4.2) — unless the account is at its limit, where the limit wording is the true one. */
function paceWording(vm: ViewModel, a: Account, now: number): { pace?: { title: string; sub: string } } {
  if (a.state === "near-limit" || a.state === "limited") return {};
  const r = (vm.switchRequests ?? []).find((x) => requestKind(x) === "pace" && x.state === "open" && x.account === cliAccount(a.id) && Date.parse(x.expiresAt) > now);
  if (!r) return {};
  const to = r.candidates[0];
  const resetMs = r.reason.resetsAt ? Date.parse(r.reason.resetsAt) - now : NaN;
  const reset = Number.isFinite(resetMs) && resetMs > 0 ? `Its limit resets only in ${hoursText(resetMs / 3_600_000)}. ` : "";
  const spare = to ? `${to.target.split("/")[1] ?? to.target} would let ${to.spareAtReset ?? 0}% expire unused at its reset. ` : "";
  return { pace: { title: `${a.name} runs out in about ${hoursText(r.reason.etaFull ?? 0)}`, sub: `${reset}${spare}Moving spreads your limits; nothing changes until you choose.` } };
}

/** Percent left on an account: its fullest 5h or week window decides. Pure. */
function roomOf(a: Account): number {
  const used = a.windows.filter((w) => w.key === "five_hour" || w.key === "seven_day").map((w) => w.utilization ?? 0);
  return 100 - Math.max(0, ...used);
}

/** What a session is likely to spend next, relative to the others. Pure.
 *  A guess from what is known now — nothing knows the work still ahead: a turn
 *  in progress spends now, a bigger model and a fuller context cost more per
 *  turn, and helper sessions spend alongside it. */
export function sessionDemand(r: SessionRow, state: SessionState): number {
  const activity = state === "working" ? 3 : state === "needs-you" || state === "waiting" || state === "pause-requested" ? 1.5 : 1;
  const m = (r.context?.model ?? "").toLowerCase();
  const model = m.includes("opus") || m.includes("fable") ? 2 : m.includes("haiku") ? 0.5 : 1;
  const ctx = 1 + Math.min(100, Math.max(0, r.context?.pct ?? 0)) / 100;
  return activity * model * ctx + 0.5 * (r.childCount ?? 0);
}

/** Percent points one unit of demand is assumed to take from an account, and
 *  one session already running there. Both are rough weights, not measurements:
 *  they only make the next pick see that an account has taken on work. */
const POINTS_PER_DEMAND = 10;
const POINTS_PER_RUNNING = 10;

/** Each session to an account: the heaviest first, each to the account with the
 *  most room left after what it already carries. Pure. */
export function spreadSessions(sessions: { key: string; demand: number }[], accounts: Account[]): Map<string, string> {
  const left = new Map(accounts.map((a) => [a.name, roomOf(a) - POINTS_PER_RUNNING * a.liveSessions]));
  const out = new Map<string, string>();
  for (const s of [...sessions].sort((x, y) => y.demand - x.demand)) {
    let best: string | null = null;
    for (const a of accounts) if (best === null || left.get(a.name)! > left.get(best)!) best = a.name;
    if (best === null) break;
    out.set(s.key, best);
    left.set(best, left.get(best)! - POINTS_PER_DEMAND * s.demand);
  }
  return out;
}
