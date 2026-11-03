/** The 2.11 view model plus the v3 feeds → `V3Data`. Pure: every input is an
 *  argument, so the whole window can be driven from fixtures. Where two
 *  sources disagree about a session, the CLI's `sessions --json` row wins over
 *  the engine's lists (it is the one that read the transcript last). */

import type { SessionRow } from "../../transforms.js";
import { accountId } from "../../vm/build.js";
import { sessionFromRow } from "../../vm/build.js";
import type { Account, IdentityColor, SessionState, ViewModel } from "../../vm/types.js";
import type { NewSessionFacts, NewSessionPlan, SheetSession } from "../dialogs.js";
import { paceFor, type LimitAccount, type LimitWindow } from "../limits.js";
import type { DoneItem, PaletteEntry } from "../overlays.js";
import type { LibraryRow, PageAccount, TableSession } from "../pages.js";
import type { ChangedFile, SummaryFacts } from "../panels.js";
import type { ChildModel, ChildSource, RowSession } from "../sessions.js";
import type { OpenTarget } from "../settings.js";
import type { Appearance } from "../themes/resolve.js";
import { SESSION_MENU, type SessionMenuItem, type V3Data } from "../window.js";
import type { BarSession } from "../workbench.js";
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
  /** Changed files per session key, as last read (`changes <s> --json`). */
  changes: ReadonlyMap<string, ChangedFile[]>;
  /** Ask for a session's changed files; the caller dedupes and reads. */
  wantChanges: (key: string) => void;
  /** Sessions this window shows in the chat view (their bridges run here). */
  chats?: ReadonlySet<string>;
  /** Chats with no session row yet (a new chat before the poll sees it): drawn from these. */
  chatRows?: readonly SessionRow[];
  /** Where a plain start in the plan's folder would go and why (`dir --json`); null until read. */
  route?: { profile: string | null; why: string[]; blocked?: string } | null;
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
  };
}

const fiveH = (a: Account | undefined) => a?.windows.find((w) => w.key === "five_hour")?.utilization ?? null;
const nearLimit = (a: Account | undefined) => !!a && (a.state === "near-limit" || a.state === "limited");

function childState(s: unknown): SessionState {
  return s === "running" ? "working" : "done";
}

const CHILD_SOURCES = new Set<ChildSource>(["hook", "lineage", "host", "counted", "unknown"]);

/** `sessions --json` children → the tree's child rows. Pure. */
export function childrenOf(r: SessionRow): ChildModel[] {
  const out: ChildModel[] = [];
  for (const c of r.children ?? []) {
    const o = c as Record<string, unknown>;
    const kind = typeof o.kind === "string" ? o.kind : "other";
    const id = typeof o.agentId === "string" ? o.agentId : typeof o.sessionKey === "string" ? o.sessionKey : `${kind}-${out.length}`;
    const label = typeof o.label === "string" ? o.label : typeof o.type === "string" ? o.type : kind;
    const source = CHILD_SOURCES.has(o.source as ChildSource) ? (o.source as ChildSource) : "unknown";
    out.push({ id, label, kind, state: childState(o.state), source });
  }
  const counted = (r.childCount ?? 0) - out.length;
  if (counted > 0) out.push({ id: `${sessionKey(r)}#counted`, label: "subagents", kind: "subagent", state: "done", source: "counted", count: counted });
  return out;
}

/** A subagent's worktree name, from the session's hook record of its children. Pure. */
export function worktreeOf(r: SessionRow | undefined): (agentId: string) => string | null {
  const byAgent = new Map<string, string>();
  for (const c of r?.children ?? []) {
    const o = c as Record<string, unknown>;
    const cwd = typeof o.cwd === "string" ? o.cwd : "";
    const m = /[\\/]worktrees[\\/]([^\\/]+)[\\/]?$/.exec(cwd);
    if (typeof o.agentId === "string" && m) byAgent.set(o.agentId, m[1]);
  }
  return (agentId) => byAgent.get(agentId) ?? null;
}

/** Menu entries that do something for this session. Detach has no meaning
 *  outside the attached terminal view, which closing its tab already does;
 *  End and Compact reach only sessions Agent Switch hosts. Pure. */
export function menuFor(row: SessionRow | undefined, hosted: boolean): SessionMenuItem[] {
  return SESSION_MENU.filter((item) => {
    if (item === "Detach") return false;
    if (item === "End…" || item === "Compact") return hosted;
    if (item === "Take over here…" || item === "Hand off…" || item === "Move to another account…") return !!row && row.provider !== "antigravity";
    return true;
  });
}

const prsOf = (r: SessionRow): PrFacts[] => (r.prs ?? []).map(parsePr).filter((p): p is PrFacts => p !== null);

export interface NextStep {
  text: string;
  action: string;
  does: "open-checks" | "open-pr" | "create-pr" | "focus";
}

/** The one next step for a session, by its PR and git state (spec §6.4). Pure. */
export function nextStep(r: SessionRow, needsYou: boolean): NextStep | null {
  const pr = prsOf(r)[0];
  if (needsYou) return { text: "Waits for you in its terminal", action: "Focus terminal", does: "focus" };
  if (pr && pr.lifecycle === "OPEN") {
    if (pr.ci === "FAILURE") return { text: `CI failing: ${pr.failingChecks.join(", ") || "checks"}`, action: "Open checks", does: "open-checks" };
    if (pr.mergeable === "CONFLICTING") return { text: `PR #${pr.number} has a merge conflict`, action: "Open PR", does: "open-pr" };
    if (pr.review === "CHANGES_REQUESTED") return { text: `Changes requested on PR #${pr.number}`, action: "Open PR", does: "open-pr" };
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

/** The whole window's data. */
export function toV3Data(vmIn: ViewModel, feeds: V3Feeds, env: AdapterEnv): V3Data {
  const now = env.now;
  // One row per account, whatever the reads returned (a reload racing a poll can repeat one).
  const vm: ViewModel = { ...vmIn, accounts: [...new Map(vmIn.accounts.map((a) => [a.id, a])).values()] };
  const read = [...(vm.sessionRows ?? []), ...feeds.codexRows];
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
  const needs = feeds.needs?.items ?? [];
  const needing = new Set(needs.map((n) => n.subject));
  const hosted = new Map((feeds.host?.hosted ?? []).filter((h) => h.alive).map((h) => [h.key, h]));
  const today = startOfDay(now);
  const stateOf = (r: SessionRow) => sessionFromRow(r, now).state;
  const titleOf = (r: SessionRow) => r.library?.name || r.summary || basename(r.cwd) || r.sessionId.slice(0, 8);

  const roots = rows.filter((r) => !r.parent && (r.live || r.mtimeMs >= today));
  const sessions: RowSession[] = roots.map((r) => {
    const key = sessionKey(r);
    const pr = prsOf(r)[0];
    return {
      key,
      title: titleOf(r),
      state: stateOf(r),
      account: { name: r.profile, nearLimit: nearLimit(accountOf(r)) },
      branch: r.git?.branch ?? null,
      pr: pr ? { number: pr.number, ci: pr.ci, mergeable: pr.mergeable } : null,
      children: childrenOf(r),
      needsYou: needing.has(key),
      ...(r.live ? {} : { doneToday: true }),
    };
  });

  const limits = vm.accounts.filter((a) => !a.disabled).map((a) => limitAccount(a, now)).filter((a): a is LimitAccount => a !== null);
  const pageAccounts: PageAccount[] = vm.accounts.flatMap((a): PageAccount[] => {
    const l = limitAccount(a, now);
    return l ? [{ ...l, email: a.identity, label: a.label, isDefault: a.isDefault, running: a.liveSessions }] : [];
  });

  // A project is the repository (its main checkout, so worktrees join it), else the folder.
  const projectOf = (r: SessionRow): string | null => {
    const dir = r.git?.toplevel ?? r.cwd ?? null;
    if (!dir) return null;
    const wt = /^(.*?)(?:-wt\/[^/]+|\/\.worktrees?\/[^/]+)$/.exec(dir);
    return (wt ? wt[1] : dir).split("/").filter(Boolean).pop() ?? null;
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
      model: r.context?.model ?? null,
      thinking: (r.context as { effort?: string | null } | null | undefined)?.effort ?? null,
      contextPct: r.context?.pct ?? null,
      lastActiveMs: r.mtimeMs,
      project: projectOf(r),
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

  const targets: OpenTarget[] = (feeds.openTargets?.targets ?? []).map((t) => ({ target: t.target, label: t.label, kind: t.kind, installed: t.installed }));

  // The account the CLI's routing picks for this folder; the default account until that is read.
  const routedName = env.route?.profile ? env.route.profile.slice(env.route.profile.indexOf("/") + 1) : null;
  const routed = routedName ? vm.accounts.find((a) => a.tool === env.plan.tool && a.name === routedName) : undefined;
  const defaultClaude = routed ?? vm.accounts.find((a) => a.tool === env.plan.tool && a.isDefault) ?? vm.accounts.find((a) => a.tool === env.plan.tool);
  const planLimits = defaultClaude ? limitAccount(defaultClaude, now) : null;
  const facts: NewSessionFacts = {
    terminalApp: env.terminalApp,
    hosting: feeds.host?.mode ?? "ephemeral",
    thinkingLevels: THINKING_LEVELS,
    account: {
      name: defaultClaude?.name ?? "—",
      color: defaultClaude?.color ?? "blue",
      reason: env.route?.blocked ? env.route.blocked : routed ? (env.route?.why[0] ?? "the folder's rule") : defaultClaude?.isDefault ? "the account for plain starts" : "the only account of this tool",
      limits: planLimits ?? { key: "none", tool: "claude", name: "—", color: "blue", protect: 98, next: false, signIn: false, checkedMs: null, windows: [] },
      // Reasons belong to the routed account; shown beside another one they would mislead.
      why: routed ? (env.route?.why ?? []) : [],
      paceText: null,
    },
    command: startCommand(env.plan, defaultClaude?.name ?? null),
    nowMs: now,
  };

  const health: V3Data["health"] =
    feeds.engine && !feeds.engine.running ? { state: "down", sinceMs: env.engineDownSince ?? now, hostedRunning: feeds.engine.hostedRunning } : { state: "ready" };

  return {
    nowMs: now,
    health,
    needs,
    away: feeds.needs?.away ?? null,
    history: doneToday(feeds.needs?.history ?? [], now),
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
    openIn: { targets, defaultTarget: feeds.openTargets?.default ?? null, perRepo: feeds.openTargets?.perRepo ?? {}, focusTerminal: env.focusTerminal },
    agents: { rows: feeds.agents?.agents ?? [], suggestions: feeds.agents?.suggestions ?? [] },
    newSession: { initial: env.plan, facts },
    decision: (subject) => decisionFor(subject, vm, rows, now),
    bar: (key): BarSession | null => {
      const r = byKey.get(key);
      if (!r) return null;
      const a = accountOf(r);
      return {
        key,
        hosted: hosted.has(key) || !!env.chats?.has(key),
        // v3.1: chat and terminal share one conversation for Claude and Codex.
        chatAvailable: r.provider === "claude" || r.provider === "codex",
        view: env.chats?.has(key) ? "chat" : "terminal",
        account: { name: r.profile, color: colorOf(r), fiveH: fiveH(a), protect: a?.threshold ?? 98 },
        model: r.context?.model ?? null,
        thinking: (r.context as { effort?: string | null } | null | undefined)?.effort ?? null,
        contextPct: r.context?.pct ?? null,
      };
    },
    summary: (key): SummaryFacts | null => {
      const r = byKey.get(key);
      if (!r) return null;
      const pr = prsOf(r)[0];
      const a = accountOf(r);
      const n = nextStep(r, needing.has(key));
      return {
        next: n && { text: n.text, action: n.action },
        pr: pr ? { number: pr.number, url: pr.url, ci: pr.ci, lifecycle: pr.lifecycle, mergeable: pr.mergeable, review: pr.review, failingChecks: pr.failingChecks } : null,
        git: r.git ? { branch: r.git.branch, worktree: r.git.worktree, changed: r.git.changed, ahead: r.git.ahead, behind: r.git.behind } : null,
        limit: nearLimit(a) ? `${a!.name} is at ${fiveH(a) ?? "?"}% of its 5-hour window` : null,
        more: {
          id: r.sessionId,
          host: hosted.has(key) ? "Hosted by Agent Switch" : r.surface === "desktop-app" ? "Claude Desktop" : "Your terminal",
          library: keptText(r),
          children: `${r.childCount ?? 0} child session${r.childCount === 1 ? "" : "s"}`,
        },
      };
    },
    changes: (key) => {
      env.wantChanges(key);
      return env.changes.get(key) ?? [];
    },
    next: (key) => {
      const r = byKey.get(key);
      const n = r ? nextStep(r, needing.has(key)) : null;
      return n && { text: n.text, action: n.action };
    },
    menu: (key) => menuFor(byKey.get(key), hosted.has(key)),
    // v3.1: "Commit…" opens the Review page, where staged changes are committed.
    commitAvailable: true,
  };
}

/** The exact command the New-session dialog previews. Pure. */
export function startCommand(p: NewSessionPlan, account: string | null): string {
  const q = (s: string) => (/^[\w./:@-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`);
  if (p.where === "hosted") return ["agent-switch", "host", "start", ...(account ? [q(account)] : []), "--provider", p.tool, "--cwd", q(p.folder)].join(" ");
  return ["agent-switch", "run", ...(account ? [q(account)] : []), ...(p.tool !== "claude" ? ["--provider", p.tool] : []), "--cwd", q(p.folder)].join(" ");
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
  const others = vm.accounts.filter((x) => x.tool === a.tool && x.id !== a.id && !x.disabled && x.state !== "signed-out");
  const best = others.sort((x, y) => (fiveH(x) ?? 0) - (fiveH(y) ?? 0))[0];
  const resetsAt = w.resetsAt ? Date.parse(w.resetsAt) : NaN;
  const mins = Number.isFinite(resetsAt) ? Math.max(0, Math.round((resetsAt - now) / 60_000)) : null;
  const sessions: SheetSession[] = rows
    .filter((r) => (only ? sessionKey(r) === only : r.live && accountId(r.provider, r.profile) === a.id))
    .map((r) => ({ key: sessionKey(r), title: r.library?.name || r.summary || r.sessionId.slice(0, 8), model: r.context?.model ?? null, target: best?.name ?? "" }));
  return {
    account: a.name,
    pctUsed: w.utilization ?? 0,
    window: windowLabel(w.key, w.label),
    resetsIn: mins === null ? "unknown" : mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`,
    sessions,
    suggestion: best?.name ?? "",
  };
}
