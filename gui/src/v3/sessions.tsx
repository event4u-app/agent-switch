/**
 * The Sessions zone of the Sessions window (spec §5.2) and the children under
 * a row (§5.2, §9.3; C2): one shared order, one trailing slot by priority, the
 * active row's second line, "Done today", multi-select with the batch bar, and
 * children that unfold under their row with their provenance. Adapted from the
 * reference boards; the data is `sessions --json`.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bot, ChevronDown, ChevronRight, Folder, SquareTerminal } from "lucide-react";
import { cn } from "../lib/utils.js";
import { SessionStateIcon, type StateSource } from "../ui/SessionStateIcon.js";
import type { IdentityColor, SessionState } from "../vm/types.js";
import { AccountMark, BatchBar, CheckMark, Chip, Marker, ago, duration, type BatchActions } from "./kit.js";
import { AppMono } from "./menus.js";
import { useEngaged, useHeldOrder } from "./held-order.js";

export type ChildSource = "hook" | "files" | "lineage" | "host" | "counted" | "unknown";

export interface ChildModel {
  id: string;
  label: string;
  /** subagent, council, arena, court, helper, other, started_by, continued_from, cleared */
  kind: string;
  state: SessionState;
  source: ChildSource;
  /** Who reported `state`, when the child is a session with a runtime. */
  stateSource?: StateSource | null;
  /** Children known only by count. */
  count?: number;
  /** The tool it runs in: from a session child's key, a subagent's parent. */
  tool?: ChildTool;
  /** The account it runs on (a subagent: its parent's). */
  account?: { name: string; color: IdentityColor; nearLimit?: boolean };
  /** A subagent's worktree name, when its hook record has one. */
  worktree?: string | null;
  /** Its own children, from its own row in `sessions --json` (any depth, never inferred). */
  children?: ChildModel[];
  /** A Needs-you item points at it or one of its descendants. */
  needsYou?: boolean;
  /** D3: "no update in 34m". */
  quiet?: string | null;
  /** A running subagent's last tool call without a result: "Bash · npm test". */
  doing?: string;
  /** A subagent's hook times, for how long it ran. */
  startedMs?: number | null;
  endedMs?: number | null;
}

export type ChildTool = "claude" | "codex" | "antigravity";

export interface RowSession {
  key: string;
  title: string;
  state: SessionState;
  /** `color`: the account's identity colour, the tick before its name. */
  account: { name: string; nearLimit: boolean; color?: IdentityColor };
  /** The tool it runs in: a monogram before the title, as on child rows. */
  tool?: ChildTool;
  /** Its last activity, for the row's age. */
  lastActiveMs?: number | null;
  branch: string | null;
  pr: { number: number; ci: string; mergeable: string } | null;
  children: ChildModel[];
  /** A Needs-you item points at this session. */
  needsYou: boolean;
  /** Finished today (the "Done today" row), not in the live list. */
  doneToday?: boolean;
  /** Quiet for over a day: listed folded under "Older than a day", not in the live list. */
  older?: boolean;
  /** Who reported `state` (the dot's tooltip). */
  stateSource?: StateSource | null;
  /** D3: "no update in 34m" — working by the host's word, nothing changed since. */
  quiet?: string | null;
}

/** A subagent's label: its type and, when known, the first line of its Task description. Pure. */
export function subagentLabel(c: { type?: unknown; description?: unknown }): string {
  const type = typeof c.type === "string" && c.type ? c.type : "subagent";
  return typeof c.description === "string" && c.description ? `${type} · ${c.description}` : type;
}

/** `sessions --json` children → the rows under a session. Pure. */
export function childrenFromCli(row: { children?: any[]; childCount?: number; childSource?: string | null }): ChildModel[] {
  const out: ChildModel[] = (row.children ?? []).map((c) =>
    c.kind === "subagent"
      ? { id: c.agentId, label: subagentLabel(c), kind: "subagent", state: c.state === "running" ? "working" : "done", source: c.source === "files" ? "files" : "hook" }
      : { id: c.sessionKey, label: c.label ?? c.kind, kind: c.kind, state: c.state === "running" ? "working" : "done", source: c.source === "host" || c.source === "hook" ? c.source : "lineage" },
  );
  const counted = (row.childCount ?? 0) - out.length;
  if (counted > 0 && row.childSource?.includes("counted")) out.push({ id: "counted", label: "subagents", kind: "subagent", state: "done", source: "counted", count: counted });
  return out;
}

export const childTotal = (s: Pick<RowSession, "children">) => s.children.reduce((n, c) => n + (c.count ?? 1), 0);

/** "1 subagent", "3 helper sessions", "2 related sessions". Pure. */
export function childNoun(s: Pick<RowSession, "children">): string {
  const n = childTotal(s);
  const kinds = new Set(s.children.map((c) => c.kind));
  const noun = kinds.size === 1 && kinds.has("subagent") ? "subagent" : [...kinds].every((k) => ["council", "arena", "court", "helper"].includes(k)) ? "helper session" : "related session";
  return `${n} ${n === 1 ? noun : noun + "s"}`;
}

export type SortBy = "activity" | "name" | "status";
export type GroupBy = "none" | "status" | "project" | "account" | "tool";
export const SORT_LABEL: Record<SortBy, string> = { activity: "Activity", name: "Name", status: "Status" };
export const GROUP_LABEL: Record<GroupBy, string> = { none: "None", status: "Status", project: "Project / folder", account: "Account", tool: "Tool" };

/** The list's default grouping (proposal B): cut by what you have to do. */
export const DEFAULT_GROUP: GroupBy = "status";

/** The status groups, in their fixed order (proposal B). */
export const STATUS_GROUPS = ["Needs you", "Running", "Idle"] as const;
export type StatusGroup = (typeof STATUS_GROUPS)[number];

/** A live row's status group: waiting for you (or its PR is failing), running, or idle. Pure. */
export const statusGroup = (s: RowSession): StatusGroup => (statusRank(s) <= 1 ? "Needs you" : s.state === "working" ? "Running" : "Idle");

/** A group longer than this shows its first rows and "N more" (proposal B). */
export const GROUP_ROWS = 5;

/** The default order of the list, the same in window and tray (spec §5.2). */
export const DEFAULT_SORT: SortBy = "status";

/**
 * The live list in the chosen order. Status (default, spec §5.2) = `liveOrder`,
 * newest first inside each rank; activity = most recent first; name. A session
 * without a known time sorts last. Pure.
 */
export function sortLive(sessions: readonly RowSession[], sort: SortBy, lastActiveMs: (key: string) => number | null): RowSession[] {
  const live = liveOrder(sessions);
  if (sort === "name") return [...live].sort((a, b) => a.title.localeCompare(b.title));
  const t = (x: RowSession) => x.lastActiveMs ?? lastActiveMs(x.key);
  // Unknown times sort last and keep the status order among themselves.
  const recent = (a: RowSession, b: RowSession) => {
    const x = t(a);
    const y = t(b);
    return x === y ? 0 : x == null ? 1 : y == null ? -1 : y - x;
  };
  if (sort === "status") return [...live].sort((a, b) => statusRank(a) - statusRank(b) || recent(a, b));
  return [...live].sort(recent);
}

/** Needs you · CI failing · working · everything else (spec §5.2). Pure. */
const statusRank = (x: RowSession) => (x.needsYou || x.state === "needs-you" ? 0 : x.pr?.ci === "FAILURE" ? 1 : x.state === "working" ? 2 : 3);

/** One order everywhere (window, tray): needs you · CI failing · working · rest; done sessions are not listed. Pure. */
export function liveOrder(sessions: readonly RowSession[]): RowSession[] {
  return sessions.filter((s) => s.state !== "done" && !s.doneToday && !s.older).sort((a, b) => statusRank(a) - statusRank(b));
}

/** The first descendant that needs the user, depth first (D6). Pure. */
export function waitingChild(children: readonly ChildModel[]): ChildModel | null {
  for (const c of children) {
    if (c.state === "needs-you") return c;
    const deeper = waitingChild(c.children ?? []);
    if (deeper) return deeper;
    if (c.needsYou) return c;
  }
  return null;
}

/** Working descendants, any depth; a counted entry counts as its count. Pure. */
export function runningOf(children: readonly ChildModel[]): number {
  return children.reduce((n, c) => n + (c.state === "working" ? (c.count ?? 1) : 0) + runningOf(c.children ?? []), 0);
}

/** What is wrong with the session's PR, in words; CI before a conflict. Pure. */
export function prProblem(s: RowSession): "CI failing" | "merge conflict" | null {
  return s.pr?.ci === "FAILURE" ? "CI failing" : s.pr?.mergeable === "CONFLICTING" ? "merge conflict" : null;
}

/** The title line's tint (owner, 2026-11-24): the row's title line carries the colour, the words go to its tooltip.
 *  Information gets no tint — only what asks you to act is marked. */
const TITLE_TINT: Record<AttentionTone, string | null> = {
  info: null,
  warn: "bg-ac-warn-tint",
  needs: "bg-ac-brand-tint",
  alert: "bg-ac-alert-tint",
};

/** `needs` is the accent set in Settings: waiting on you is the app's call to act, not a warning. */
type AttentionTone = "needs" | "warn" | "alert" | "info";
const RANK: readonly AttentionTone[] = ["alert", "needs", "warn", "info"];
/** The bar takes the most serious tone of what it says: a problem, then needs you, then a warning. Pure. */
export const worst = (asks: readonly { tone: AttentionTone }[]): AttentionTone => RANK.find((t) => asks.some((a) => a.tone === t)) ?? "info";

/** What a row asks of you, for its own line under the title (two-line rows): what to do first. Pure. */
export function attention(s: RowSession): { text: string; tone: AttentionTone }[] {
  const out: { text: string; tone: AttentionTone }[] = [];
  const waiting = s.state !== "needs-you" ? waitingChild(s.children) : null;
  if (s.state === "needs-you" || s.needsYou) out.push({ text: "Needs you", tone: "needs" });
  else if (waiting) out.push({ text: `${waiting.label} needs you`, tone: "needs" });
  const problem = prProblem(s);
  if (problem) out.push({ text: problem === "CI failing" ? `#${s.pr!.number} CI failing` : `#${s.pr!.number} merge conflict`, tone: "alert" });
  if (s.account.nearLimit) out.push({ text: `${s.account.name} near its limit`, tone: "warn" });
  if (s.quiet) out.push({ text: s.quiet, tone: "info" });
  return out;
}

/**
 * The one trailing slot, by priority (spec §5.2). Rank 4 rolls up: a waiting
 * descendant lights the same amber dot, and the tooltip names it (D6). Rank 5
 * counts running descendants at every depth. A PR problem is words, never a
 * second status icon beside the state dot (5.1); on a two-line row it sits on
 * the second line, so `second` leaves it out of the slot. Pure.
 */
export function trailing(s: RowSession, { counts = true, second = false }: { counts?: boolean; second?: boolean } = {}): ReactNode {
  // A two-line row says these on its own attention line; the slot keeps the running count.
  if (second) {
    const running = counts ? runningOf(s.children) : 0;
    return running ? (
      <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-ac-muted" title={`${childNoun(s)} · ${running} running`}>
        <Bot className="size-3.5" />
        {running}
      </span>
    ) : null;
  }
  if (s.account.nearLimit) return <span className="shrink-0 text-[11px] text-ac-warn-text" title={`${s.account.name} is near its limit`}>{s.account.name}</span>;
  const problem = prProblem(s);
  if (problem && !second) return <span className="shrink-0 text-[11px] text-ac-alert-text">{problem}</span>;
  if (s.state !== "needs-you") {
    const waiting = waitingChild(s.children);
    if (s.needsYou || waiting) return <span className="size-1.5 shrink-0 rounded-full bg-ac-warn" aria-label="needs you" title={waiting ? `${waiting.label} needs you` : undefined} />;
  }
  if (s.quiet) return <span className="shrink-0 text-[11px] text-ac-muted">{s.quiet}</span>;
  const running = counts ? runningOf(s.children) : 0;
  if (running)
    return (
      <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-ac-muted" title={`${childNoun(s)} · ${running} running`}>
        <Bot className="size-3.5" />
        {running}
      </span>
    );
  return null;
}

/** The trailing slot speaks about the children — a waiting descendant's dot or the running count — so it unfolds them. Pure. */
export function childrenSlot(s: RowSession, { second = false }: { second?: boolean } = {}): boolean {
  if (second) return runningOf(s.children) > 0;
  if (s.account.nearLimit || (prProblem(s) && !second)) return false;
  if (s.state !== "needs-you" && (s.needsYou || waitingChild(s.children))) return !!waitingChild(s.children);
  if (s.quiet) return false;
  return runningOf(s.children) > 0;
}

const VIA: Record<ChildSource, string> = { hook: "via hook", files: "from Claude Code's files", lineage: "via lineage", host: "via host", counted: "counted", unknown: "relation unknown" };
const TOOL_NAME: Record<ChildTool, string> = { claude: "Claude", codex: "Codex", antigravity: "Antigravity" };
/** The same monograms the Open in menu gives the tools' desktop apps. */
const TOOL_MONO: Record<ChildTool, string> = { claude: "C", codex: "Cx", antigravity: "Ag" };

/** A child that is a session with a key opens like any session; a subagent or a counted entry is not a session. Pure. */
export const childOpens = (c: ChildModel) => c.kind !== "subagent" && c.source !== "counted" && c.id.split("/").length === 3;

/** A subagent its hooks or Claude Code's own files reported opens its own transcript, read-only (7.7); a counted one is known by number only. Pure. */
export const subagentOpens = (c: ChildModel) => c.kind === "subagent" && (c.source === "hook" || c.source === "files");

/** How long a subagent ran, or runs: "4m". Pure. */
export const subagentElapsed = (c: ChildModel, nowMs: number): string | null => (c.startedMs == null ? null : duration((c.endedMs ?? nowMs) - c.startedMs));

/** The row's tooltip: identity and provenance in words (D5). `viewable`: a subagent row here opens its transcript. Pure. */
export function childTitle(c: ChildModel, viewable = false): string {
  const via = VIA[c.source];
  if (viewable && subagentOpens(c)) return [c.label, "subagent", c.doing ?? null, c.worktree ? `worktree ${c.worktree}` : null, via, "opens its transcript, read-only"].filter(Boolean).join(" · ");
  if (!childOpens(c)) return [c.count ? `${c.count} ${c.label}` : c.label, c.kind === "subagent" ? "subagent" : c.kind, c.worktree ? `worktree ${c.worktree}` : null, via, "runs inside its session — nothing to open"].filter(Boolean).join(" · ");
  return [c.label, c.tool ? TOOL_NAME[c.tool] : null, c.account?.name ?? null, via].filter(Boolean).join(" · ");
}

/** A child as a row-shaped value, so it takes the same trailing slot by the same priority. Pure. */
const asRow = (c: ChildModel): RowSession => ({ key: c.id, title: c.label, state: c.state, account: { name: c.account?.name ?? "", nearLimit: !!c.account?.nearLimit }, branch: null, pr: null, children: c.children ?? [], needsYou: !!c.needsYou, quiet: c.quiet ?? null });

/** The cells of a child row (2.2): state dot · tool monogram · account tick · label · inline provenance when it matters · the trailing slot. */
function ChildCells({ c }: { c: ChildModel }) {
  const label = c.count ? `${c.count} ${c.label}` : c.label;
  return (
    <>
      <SessionStateIcon state={c.state} source={c.stateSource} quiet={!!c.quiet} />
      {c.kind === "subagent" || !c.tool ? (
        <span className="inline-flex size-4 shrink-0 items-center justify-center text-ac-muted">
          <Bot className="size-3.5" aria-label="subagent" />
        </span>
      ) : (
        <AppMono m={TOOL_MONO[c.tool]} />
      )}
      {c.account && <AccountMark color={c.account.color} />}
      <span className="min-w-0 flex-1 truncate text-ac-soft">{label}</span>
      {(c.source === "unknown" || c.source === "counted") && (
        <span className={cn("shrink-0 text-[10.5px]", c.source === "unknown" ? "text-ac-warn-text" : "text-ac-muted")}>{c.source === "unknown" ? "relation unknown ⓘ" : "counted"}</span>
      )}
      {trailing(asRow(c), { counts: false })}
    </>
  );
}

/** Enter and Space on a div that acts as a button. */
const pressKeys = (run: () => void) => (e: React.KeyboardEvent) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  e.preventDefault();
  run();
};

/** One child, flat (the Children window, Running on): the same grammar as in the tree; with `onOpen`, it opens what the tree row opens. */
export function ChildLine({ c, onOpen, subagents = true }: { c: ChildModel; onOpen?: (c: ChildModel) => void; subagents?: boolean }) {
  const opens = !!onOpen && (childOpens(c) || (subagents && subagentOpens(c)));
  return (
    <div
      role={opens ? "button" : undefined}
      tabIndex={opens ? 0 : undefined}
      onClick={opens ? () => onOpen!(c) : undefined}
      onKeyDown={opens ? pressKeys(() => onOpen!(c)) : undefined}
      className={cn("flex h-6 min-w-0 items-center gap-2 rounded-md text-[11.5px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ac-brand", opens && "-mx-1.5 px-1.5 hover:bg-ac-raise")}
      title={childTitle(c, !!onOpen && subagents)}
    >
      <ChildCells c={c} />
    </div>
  );
}

/*
 * Tree geometry (3.2). Each row paints only its own slice of the connectors:
 * rails for ancestors that continue below it, a tee (middle child) or an
 * elbow (last child) into its own dot, and a stem down from its dot when it
 * has children. A root row's dot is centred 14 px from the row's left edge
 * (`pl-2.5` + half the 8 px dot); each level steps 16 px, so a line at a
 * level runs through the dot centre of the row above it. Pattern after the
 * reference's lineage guides; written for these rows.
 */
const STEP = 16;
const lineX = (depth: number) => 13 + depth * STEP;
/** From a line to 2 px before the next level's dot. */
const REACH = 11;

function Guides({ depth, rails, last, stem }: { depth: number; rails: readonly boolean[]; last: boolean; stem: boolean }) {
  const x = lineX(depth - 1);
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0">
      {rails.map((on, k) => on && <span key={k} data-guide="rail" className="absolute inset-y-0 w-px bg-ac-line" style={{ left: lineX(k) }} />)}
      {last ? (
        <span data-guide="elbow" className="absolute top-0 h-[13px] rounded-bl-md border-b border-l border-ac-line" style={{ left: x, width: REACH }} />
      ) : (
        <>
          <span data-guide="tee" className="absolute inset-y-0 w-px bg-ac-line" style={{ left: x }} />
          <span className="absolute top-3 h-px bg-ac-line" style={{ left: x + 1, width: REACH - 1 }} />
        </>
      )}
      {stem && <span data-guide="stem" className="absolute bottom-0 top-[18px] w-px bg-ac-line" style={{ left: lineX(depth) }} />}
    </span>
  );
}

/** The child with this id anywhere under these rows, and the root it hangs under. Pure. */
export function findChild(sessions: readonly RowSession[], id: string): { root: RowSession; child: ChildModel } | null {
  const walk = (kids: readonly ChildModel[]): ChildModel | null => {
    for (const c of kids) {
      if (c.id === id) return c;
      const deeper = walk(c.children ?? []);
      if (deeper) return deeper;
    }
    return null;
  };
  for (const root of sessions) {
    const child = walk(root.children);
    if (child) return { root, child };
  }
  return null;
}

/** Live children: working, waiting, pointed at by a Needs-you item, or above one that is. Pure. */
const isLive = (c: ChildModel): boolean => c.state === "working" || c.state === "needs-you" || !!c.needsYou || (c.children ?? []).some(isLive);
const holds = (c: ChildModel, key: string): boolean => c.id === key || (c.children ?? []).some((k) => holds(k, key));

/**
 * Subagents split like the session list (owner, 2026-11-24): "Running" open,
 * "Idle" folded, each header with its count. Running is everything live
 * (working, or a child that needs you); the rest is idle. An empty group has
 * no header. Used by the Children window and the limits popover.
 */
export function ChildGroups({ kids, render }: { kids: readonly ChildModel[]; render: (c: ChildModel) => ReactNode }) {
  const [shut, setShut] = useState<ReadonlySet<string>>(() => new Set(["Idle"]));
  const groups = [
    { id: "Running", rows: kids.filter(isLive) },
    { id: "Idle", rows: kids.filter((c) => !isLive(c)) },
  ].filter((g) => g.rows.length > 0);
  return (
    <>
      {groups.map((g) => {
        const open = !shut.has(g.id);
        return (
          <div key={g.id} data-child-group={g.id}>
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setShut((x) => (x.has(g.id) ? new Set([...x].filter((y) => y !== g.id)) : new Set([...x, g.id])))}
              className="flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-left text-[11.5px] text-ac-muted hover:bg-ac-raise"
            >
              {open ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />}
              <span className="font-medium text-ac-soft">{g.id}</span>
              <span data-group-count="" className="ml-auto inline-flex h-4 min-w-[18px] shrink-0 items-center justify-center rounded-full bg-ac-raise px-1.5 text-[10.5px] tabular-nums leading-none text-ac-soft">{g.rows.length}</span>
            </button>
            {open && g.rows.map((c) => <div key={c.id}>{render(c)}</div>)}
          </div>
        );
      })}
    </>
  );
}

/** The idle fold's state per parent, for the session (D11): survives the row folding and unfolding. */
const IDLE_OPEN = new Set<string>();
function useIdleFold(parent: string): [boolean, () => void] {
  const [open, setOpen] = useState(() => IDLE_OPEN.has(parent));
  return [
    open,
    () => {
      if (open) IDLE_OPEN.delete(parent);
      else IDLE_OPEN.add(parent);
      setOpen(!open);
    },
  ];
}

interface TreeHandlers {
  onSelect: (key: string) => void;
  /** A hook subagent opens its transcript under its parent session (7.7). */
  onSubagent?: (parent: string, agentId: string) => void;
  onPeek?: (key: string | null, y: number) => void;
  /** ⌘J: the child row to focus (3.4). */
  focusKey?: string | null;
}

function ChildRow({ c, parent, depth, rails, last, onSelect, onSubagent, onPeek, focusKey }: { c: ChildModel; parent: string; depth: number; rails: readonly boolean[]; last: boolean } & TreeHandlers) {
  const ref = useRef<HTMLDivElement>(null);
  const viewable = !!onSubagent && subagentOpens(c);
  const opens = childOpens(c) || viewable;
  const open = () => (onPeek?.(null, 0), viewable ? onSubagent!(parent, c.id) : onSelect(c.id));
  useEffect(() => {
    if (focusKey && focusKey === c.id) ref.current?.focus();
  }, [focusKey, c.id]);
  return (
    <div
      ref={ref}
      data-child-row=""
      data-depth={depth}
      role={opens ? "button" : undefined}
      tabIndex={opens ? 0 : -1}
      title={childTitle(c, !!onSubagent)}
      onClick={opens ? open : undefined}
      onKeyDown={opens ? pressKeys(open) : undefined}
      onMouseEnter={
        onPeek &&
        ((e) => {
          const shell = e.currentTarget.closest("[data-v3-shell]");
          onPeek(c.id, Math.round(e.currentTarget.getBoundingClientRect().top - (shell?.getBoundingClientRect().top ?? 0)));
        })
      }
      onMouseLeave={onPeek && (() => onPeek(null, 0))}
      className={cn("relative flex h-6 min-w-0 items-center gap-2 rounded-md pr-2 text-[11.5px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ac-brand", opens && "hover:bg-ac-raise")}
      style={{ paddingLeft: 10 + depth * STEP }}
    >
      <Guides depth={depth} rails={rails} last={last} stem={!!c.children?.length} />
      <ChildCells c={c} />
    </div>
  );
}

/**
 * The children under a row, to any depth (3.1–3.5): live children listed,
 * idle and finished ones behind one "N idle" line that opens in place (D11),
 * folded at first even for one (owner, 2026-11-24).
 */
export function ChildTree({ kids, parent, depth = 1, rails = [], ...h }: { kids: readonly ChildModel[]; parent: string; depth?: number; rails?: readonly boolean[] } & TreeHandlers) {
  const [idleOpen, toggleIdle] = useIdleFold(parent);
  const live = kids.filter(isLive);
  const idle = kids.filter((c) => !isLive(c));
  // Idle children start folded, even a single one; running ones are listed (owner, 2026-11-24).
  const fold = idle.length >= 1;
  const shown = !fold || idleOpen || (!!h.focusKey && idle.some((c) => holds(c, h.focusKey!)));
  const items: (ChildModel | "fold")[] = [...live, ...(fold ? (["fold"] as const) : []), ...(shown ? idle : [])];
  return (
    <>
      {items.map((it, i) => {
        const last = i === items.length - 1;
        if (it === "fold")
          return (
            <div key="fold" data-child-row="" data-depth={depth} className="relative h-6" style={{ paddingLeft: 10 + depth * STEP }}>
              <Guides depth={depth} rails={rails} last={last} stem={false} />
              <button
                type="button"
                aria-expanded={shown}
                aria-label={`${shown ? "Hide" : "Show"} ${idle.length} idle`}
                onClick={toggleIdle}
                className="flex h-6 w-full min-w-0 items-center gap-2 rounded-md pr-2 text-[11.5px] text-ac-muted hover:text-ac-text"
              >
                <span className="-mx-0.5 inline-flex w-3 shrink-0 justify-center">{shown ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}</span>
                {/* Reads like the group headers: name, then its count (owner, 2026-11-24). */}
                <span className="font-medium text-ac-soft">Idle</span>
                {/* Inside the active block (raised) the pill steps a shade deeper, so it stays visible. */}
                <span data-group-count="" className="ml-auto inline-flex h-4 min-w-[18px] shrink-0 items-center justify-center rounded-full bg-ac-line px-1.5 text-[10.5px] tabular-nums leading-none text-ac-soft">{idle.length}</span>
              </button>
            </div>
          );
        return (
          <div key={it.id} className="contents">
            <ChildRow c={it} parent={parent} depth={depth} rails={rails} last={last} {...h} />
            {!!it.children?.length && <ChildTree kids={it.children} parent={it.id} depth={depth + 1} rails={[...rails, !last]} {...h} />}
          </div>
        );
      })}
    </>
  );
}

/**
 * Chromium can drop a truncated span's "…" after the span's row is restyled
 * (hover, focus, a click on the active row; a font weight loading on first
 * use; a width change), and the text then runs past the edge. Measured in
 * v3-render: correct before the click, clipped after it, correct again once
 * the span is laid out anew. Re-laying the span out after such an event
 * makes it decide again.
 */
function useEllipsisRefresh(ref: { current: HTMLElement | null }, remount: unknown) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const refresh = () => {
      if (el.scrollWidth <= el.clientWidth) return;
      el.style.display = "none";
      void el.offsetWidth;
      el.style.display = "";
    };
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(refresh);
    ro?.observe(el);
    const fonts = typeof document === "undefined" ? undefined : document.fonts;
    fonts?.addEventListener?.("loadingdone", refresh);
    let frame = 0;
    const later = () => {
      if (typeof requestAnimationFrame === "undefined") return refresh();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(refresh);
    };
    later();
    // Pointer and focus on the row restyle it, which can drop the "…" again.
    const row = el.closest("[role=button]");
    const events = ["mouseenter", "mouseleave", "focus", "click"] as const;
    for (const e of events) row?.addEventListener(e, later);
    return () => {
      ro?.disconnect();
      fonts?.removeEventListener?.("loadingdone", refresh);
      for (const e of events) row?.removeEventListener(e, later);
      if (frame) cancelAnimationFrame(frame);
    };
    // `remount`: the span is keyed and replaced; observe the new one.
  }, [ref, remount]);
}

export function SessionRow({
  s,
  active,
  comfortable,
  selecting,
  checked,
  open,
  onSelect,
  onToggleChildren,
  onCheck,
  onPeek,
  onSubagent,
  focusKey,
  age,
}: {
  s: RowSession;
  active?: boolean;
  comfortable?: boolean;
  selecting?: boolean;
  checked?: boolean;
  open?: boolean;
  onSelect: (key: string) => void;
  onToggleChildren: (key: string) => void;
  onCheck: (key: string) => void;
  /** Hover: the row's top edge inside the window shell; null when the pointer leaves. */
  onPeek?: (key: string | null, y: number) => void;
  /** ⌘J: a child row to focus (3.4). */
  focusKey?: string | null;
  onSubagent?: (parent: string, agentId: string) => void;
  /** "21m ago": how long since the session last did something. */
  age?: string | null;
}) {
  const second = active || comfortable;
  const kids = !!open && s.children.length > 0;
  // D12 (owner, Q1 2026-11-22): the active open row and its children are one block — one raise fill, one Marker.
  const block = !!active && kids;
  const slot = trailing(s, { second });
  const asks = second ? attention(s) : [];
  const ref = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLSpanElement>(null);
  useEllipsisRefresh(titleRef, active);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [active]);
  return (
    <div ref={ref} className={cn(block && "relative mb-1 rounded-md bg-ac-raise pb-0.5")}>
      {block && <Marker />}
      <div
        role="button"
        tabIndex={0}
        aria-current={active ? "true" : undefined}
        onClick={() => (onPeek?.(null, 0), selecting ? onCheck(s.key) : onSelect(s.key))}
        onMouseEnter={
          onPeek &&
          ((e) => {
            const shell = e.currentTarget.closest("[data-v3-shell]");
            onPeek(s.key, Math.round(e.currentTarget.getBoundingClientRect().top - (shell?.getBoundingClientRect().top ?? 0)));
          })
        }
        onMouseLeave={onPeek && (() => onPeek(null, 0))}
        className={cn("group/row relative rounded-md pl-2.5 pr-2", second ? "py-1.5" : "py-1", block ? null : active ? "bg-ac-raise" : "hover:bg-ac-raise")}
      >
        {active && !block && <Marker />}
        {/* The stem from the dot down to the first child (3.2). */}
        {kids && <span aria-hidden data-guide="stem" className={cn("pointer-events-none absolute bottom-0 w-px bg-ac-line", second ? "top-[22px]" : "top-5")} style={{ left: lineX(0) }} />}
        <div data-attention={asks.length ? "" : undefined} data-tone={asks.length ? worst(asks) : undefined} title={asks.length ? asks.map((x) => x.text).join("\n") : undefined} className={cn("flex h-5 min-w-0 items-center gap-2", asks.length && TITLE_TINT[worst(asks)] && cn("-mx-1.5 rounded px-1.5", TITLE_TINT[worst(asks)]))}>
          {selecting ? (
            <CheckMark role="checkbox" checked={!!checked} size={14} />
          ) : (
            <SessionStateIcon state={s.state} source={s.stateSource} quiet={!!s.quiet} />
          )}
          {/* The tool, as on child rows: Claude and Codex never look alike. */}
          {s.tool && (
            <span title={TOOL_NAME[s.tool]} className="inline-flex">
              <AppMono m={TOOL_MONO[s.tool]} />
            </span>
          )}
          {/* Keyed on the weight: Chromium keeps the ellipsis decision of the old weight
              when only font-weight changes, and the heavier title then runs past the edge. */}
          <span key={active ? "on" : "off"} ref={titleRef} className={cn("min-w-0 flex-1 truncate text-[13px]", active ? "font-medium text-ac-text" : "text-ac-soft")} title={asks.length ? [s.title, ...asks.map((x) => x.text)].join("\n") : s.title}>
            {s.title}
          </span>
          {/* One trailing slot per row (spec §5.2, boards "Work" and "Hover a row"): the children
              unfold from the row's own children count; a chevron shows only while they are open. */}
          {/* Compact: the age takes the free trailing slot. */}
          {!second && !slot && age && <span className="shrink-0 text-[11px] text-ac-muted">{age}</span>}
          {s.children.length > 0 && (open || childrenSlot(s, { second }) || !slot) ? (
            <button
              type="button"
              aria-label={open ? "Hide children" : `Show ${childNoun(s)}`}
              aria-expanded={!!open}
              onClick={(e) => (e.stopPropagation(), onToggleChildren(s.key))}
              // An empty slot shows the chevron on hover only, so a row at rest carries no extra glyph.
              className={cn("inline-flex shrink-0 items-center gap-0.5 rounded text-ac-muted hover:text-ac-text", !open && !slot && "opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100")}
            >
              {open ? <ChevronRight className="size-3 rotate-90" /> : (slot ?? <ChevronRight className="size-3" />)}
            </button>
          ) : (
            slot
          )}
        </div>
        {second && (
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 pl-4 text-[11px] text-ac-muted">
            {s.account.color && <AccountMark color={s.account.color} />}
            <span className="shrink-0">{s.account.name}</span>
            <span>·</span>
            <span className="truncate">{s.branch ?? "no repo"}</span>
            {s.pr && <span className="shrink-0">· #{s.pr.number}</span>}
            {age && <span className="ml-auto shrink-0 pl-1">{age}</span>}
          </div>
        )}
      </div>
      {kids && (
        <div className={cn(!block && "mb-1")}>
          <ChildTree kids={s.children} parent={s.key} onSelect={onSelect} onSubagent={onSubagent} onPeek={onPeek} focusKey={focusKey} />
        </div>
      )}
    </div>
  );
}

export function SessionsZone({
  sessions,
  activeKey,
  comfortable,
  selection,
  openKeys,
  onSelect,
  onToggleChildren,
  onCheck,
  onDoneToday,
  onStart,
  sort = DEFAULT_SORT,
  group = "none",
  lastActiveOf = () => null,
  nowMs,
  onSubagent,
  groupOf,
  worktreeOf,
  onView,
  viewOpen,
  onPeek,
  divider = true,
  loading,
  tray,
  holdOrder,
  focusKey,
  inNeeds,
  batch,
}: {
  /** Sessions a row of the Needs-you zone already shows: under the status grouping they are not listed twice (proposal B). */
  inNeeds?: ReadonlySet<string>;
  /** The tray card's variant (board "tray"): a 24 px head. */
  tray?: boolean;
  sessions: RowSession[];
  activeKey: string | null;
  comfortable?: boolean;
  /** Keys checked in multi-select; null = not selecting. */
  selection: ReadonlySet<string> | null;
  /** Rows whose children are unfolded; helper sessions start folded (C2). */
  openKeys: ReadonlySet<string>;
  onSelect: (key: string) => void;
  onToggleChildren: (key: string) => void;
  onCheck: (key: string) => void;
  /** Opens All sessions; `which` picks its Done today or Older tab. */
  onDoneToday: (which?: "today" | "older") => void;
  /** The empty zone's one action (spec §5.2). */
  onStart?: () => void;
  /** The list's order and grouping (the zone head shows and opens them). */
  sort?: SortBy;
  group?: GroupBy;
  /** Last activity of a row, for the orders and its age (a row's own `lastActiveMs` wins). */
  lastActiveOf?: (key: string) => number | null;
  /** The clock for the rows' age; absent: no age. */
  nowMs?: number;
  /** A hook subagent's row opens its transcript (7.7). */
  onSubagent?: (parent: string, agentId: string) => void;
  /** The group a row belongs to (project, account or tool), or null for "none of them". */
  groupOf?: (key: string) => string | null;
  /** The checkout a row works in, for the worktree sub-header under "Group by project" (D8). */
  worktreeOf?: (key: string) => { id: string; branch: string | null; linked: boolean } | null;
  /** Opens the sort/group menu at the control's top inside the window shell; absent hides the control (tray). */
  onView?: (y: number) => void;
  viewOpen?: boolean;
  onPeek?: (key: string | null, y: number) => void;
  /** The line under the Needs-you zone; absent when that zone is hidden. */
  divider?: boolean;
  /** The first read has not settled: say nothing rather than "No sessions running". */
  loading?: boolean;
  /** Engagement from outside the list (the tray card) that also holds the order (D9). */
  holdOrder?: boolean;
  /** ⌘J: a child row to focus; its root must be in `openKeys` (3.4). */
  focusKey?: string | null;
  batch: BatchActions;
}) {
  const sorted = sortLive(sessions, sort, lastActiveOf);
  // D9: while the pointer or keyboard focus is in the list, rows keep their place; grouping runs on the held order.
  const { engaged, bind: holdBind } = useEngaged();
  const order = useHeldOrder(sorted.map((s) => s.key), engaged || !!holdOrder);
  const byKey = new Map(sorted.map((s) => [s.key, s]));
  const live = order.map((k) => byKey.get(k)!);
  const done = sessions.filter((s) => s.doneToday).length;
  // Status grouping: ended sessions stay one click away in two rows pinned under the list,
  // Done today and Older; each opens the All sessions window (owner, 2026-11-24).
  // The data marks a long-quiet session `older` instead of `doneToday`; midnight still decides the row.
  const ended = sessions.filter((s) => s.doneToday || s.older);
  const midnight = nowMs == null ? null : new Date(nowMs).setHours(0, 0, 0, 0);
  const endedAt = (s: RowSession) => s.lastActiveMs ?? lastActiveOf(s.key);
  const doneRows = [
    { id: "Done today", count: ended.filter((s) => midnight == null || (endedAt(s) ?? midnight) >= midnight).length },
    { id: "Older", count: ended.filter((s) => midnight != null && (endedAt(s) ?? midnight) < midnight).length },
  ].filter((g) => g.count > 0);
  const byStatus = group === "status";
  const grouped = byStatus || (group !== "none" && !!groupOf);
  const groupKey = (s: RowSession) => (byStatus ? statusGroup(s) : (groupOf!(s.key) ?? ""));
  // Status: a session the Needs-you zone already shows is not listed again; the group keeps the rest.
  const listed = byStatus && inNeeds ? live.filter((s) => statusGroup(s) !== "Needs you" || !inNeeds.has(s.key)) : live;
  // Grouped: one header per group — status groups in their fixed order, others in the order the sorted list first meets them; rows keep the sort inside.
  const groups = byStatus ? STATUS_GROUPS.filter((g) => listed.some((s) => statusGroup(s) === g)) : grouped ? [...new Set(listed.map(groupKey))] : [""];
  const rowsOf = (g: string) => (grouped ? listed.filter((s) => groupKey(s) === g) : listed);
  // A long group shows its first rows and "N more"; the active row always shows.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const capped = (g: string, rows: RowSession[]) => (!grouped || expanded.has(g) || rows.length <= GROUP_ROWS + 1 ? rows : rows.filter((s, i) => i < GROUP_ROWS || s.key === activeKey));
  // A project's rows split by worktree only when more than one holds a live session (D8); otherwise one block, no sub-header.
  const worktreesOf = (g: string) => {
    const l = rowsOf(g);
    if (group !== "project" || !worktreeOf) return [{ wt: undefined, rows: l }];
    const by = new Map<string, { wt: NonNullable<ReturnType<typeof worktreeOf>> | null | undefined; rows: RowSession[] }>();
    for (const s of l) {
      const wt = worktreeOf(s.key);
      const id = wt?.id ?? "";
      by.set(id, { wt, rows: [...(by.get(id)?.rows ?? []), s] });
    }
    // undefined = no sub-header; null = rows outside any checkout, when other rows have one.
    return by.size > 1 ? [...by.values()] : [{ wt: undefined, rows: l }];
  };
  const ageOf = (s: RowSession) => {
    const t = s.lastActiveMs ?? lastActiveOf(s.key);
    return t == null || nowMs == null ? null : ago(nowMs - t);
  };
  // Idle starts folded under the status grouping (owner, 2026-11-24) — unless the open session is idle, or
  // nothing else is listed (an all-idle list would read as empty). A click on the header decides from then on.
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
  const [idleChoice, setIdleChoice] = useState<boolean | null>(null);
  const openRow = sessions.find((s) => s.key === activeKey);
  const idleDefault = byStatus && !(openRow && statusGroup(openRow) === "Idle") && listed.some((s) => statusGroup(s) !== "Idle");
  const isFolded = (g: string) => (byStatus && g === "Idle" ? (idleChoice ?? idleDefault) : folded.has(g));
  const fold = (g: string) => {
    if (byStatus && g === "Idle") return setIdleChoice(!isFolded(g));
    setFolded((f) => (f.has(g) ? new Set([...f].filter((x) => x !== g)) : new Set([...f, g])));
  };
  return (
    // A column that fills the window, so Done today and Older sit at its foot, right above the limits.
    <section aria-label="Sessions" className="flex flex-1 flex-col">
      {divider ? <div className="mx-3.5 my-1.5 h-px bg-ac-line" /> : <div className="h-2" />}
      <div className={cn("flex items-center gap-2 px-3.5", tray ? "mt-0.5 h-6" : "sticky top-0 z-[1] h-8 bg-ac-panel")}>
        <span className="text-[11px] font-semibold text-ac-soft">Sessions</span>
        <span className="text-[11px] text-ac-muted">{live.length}</span>
        {onView && (
          <button
            type="button"
            data-popover-trigger
            aria-haspopup="menu"
            aria-expanded={!!viewOpen}
            onClick={(e) => {
              const shell = e.currentTarget.closest("[data-v3-shell]");
              onView(Math.round(e.currentTarget.getBoundingClientRect().top - (shell?.getBoundingClientRect().top ?? 0)));
            }}
            title="Sort and group"
            className={cn("-mr-1.5 ml-auto inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-ac-muted hover:bg-ac-raise hover:text-ac-text", viewOpen && "bg-ac-raise text-ac-text")}
          >
            {/* "Status · Status" says one thing twice: grouped and sorted by status reads "Status". */}
            {grouped && GROUP_LABEL[group] !== SORT_LABEL[sort] && <>{GROUP_LABEL[group].split(" ")[0]} · </>}
            {SORT_LABEL[sort]}
            <ChevronDown className="size-3" />
          </button>
        )}
      </div>
      {selection && <BatchBar compact count={selection.size} actions={batch} className="mx-1.5 mb-1" />}
      <div className="px-1.5" data-session-list {...holdBind}>
        {live.length === 0 && !loading && (
          <p className="px-2 py-1.5 text-[12px] text-ac-muted">
            No sessions running.{" "}
            {onStart && (
              <button type="button" onClick={onStart} className="text-ac-brand-text hover:underline">
                Start one ⌘N
              </button>
            )}
          </p>
        )}
        {groups.map((g) => [
          grouped && (
            <button
              key={`h:${g}`}
              type="button"
              aria-expanded={!isFolded(g)}
              onClick={() => fold(g)}
              title={g ? `${GROUP_LABEL[group]}: ${g}` : undefined}
              className="flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-left text-[11.5px] text-ac-muted hover:bg-ac-raise"
            >
              {isFolded(g) ? <ChevronRight className="size-3 shrink-0" /> : <ChevronDown className="size-3 shrink-0" />}
              {group === "project" ? <Folder className="size-3.5 shrink-0" /> : group === "tool" ? <SquareTerminal className="size-3.5 shrink-0" /> : null}
              <span className="min-w-0 truncate font-medium text-ac-soft">{g || (group === "project" ? "No project" : "Other")}</span>
              <span data-group-count="" className="ml-auto inline-flex h-4 min-w-[18px] shrink-0 items-center justify-center rounded-full bg-ac-raise px-1.5 text-[10.5px] tabular-nums leading-none text-ac-soft">{rowsOf(g).length}</span>
            </button>
          ),
          ...(isFolded(g) ? [] : worktreesOf(g)).flatMap(({ wt, rows: all }, i) => {
          const wtRows = capped(`${g}\0${i}`, all);
          return [
          wt !== undefined ? (
            <h4 key={`w:${g}:${wt?.id ?? i}`} title={wt?.id} className="flex h-6 items-center gap-1.5 pl-[26px] pr-1.5 text-[11px] font-normal text-ac-muted">
              <span className={cn("min-w-0 truncate", wt && "font-ac-mono")}>{wt ? (wt.branch ?? "detached HEAD") : "No repository"}</span>
              {wt?.linked && <Chip>worktree</Chip>}
              <span>{wtRows.length}</span>
            </h4>
          ) : null,
          ...wtRows.map((s) => (
          <SessionRow
            key={s.key}
            s={s}
            active={s.key === activeKey}
            comfortable={comfortable}
            selecting={!!selection}
            checked={selection?.has(s.key)}
            open={openKeys.has(s.key)}
            onSelect={onSelect}
            onToggleChildren={onToggleChildren}
            onCheck={onCheck}
            onPeek={onPeek}
            onSubagent={onSubagent}
            focusKey={focusKey}
            age={ageOf(s)}
          />
          )),
          wtRows.length < all.length ? (
            <button key={`m:${g}:${i}`} type="button" onClick={() => setExpanded((x) => new Set([...x, `${g}\0${i}`]))} className="ml-[26px] flex h-6 items-center text-[11px] text-ac-muted hover:text-ac-text">
              {all.length - wtRows.length} more ›
            </button>
          ) : null,
          ];
          }),
        ])}
        {!byStatus && done > 0 && (
          <div className="mt-0.5 flex h-7 items-center gap-2 px-2.5 text-[11.5px] text-ac-muted">
            <button type="button" onClick={() => onDoneToday("today")} className="inline-flex flex-1 items-center gap-2 text-left hover:text-ac-text">
              <ChevronRight className="size-3" /> Done today {done}
            </button>
          </div>
        )}
      </div>
      {byStatus && doneRows.length > 0 && (
        <div data-done-groups="" className="sticky bottom-0 z-[1] mt-auto border-t border-ac-line bg-ac-panel px-1.5 py-1">
          {/* Each row is one full-width button; Clean up lives in All sessions for now (owner, 2026-11-24). */}
          {doneRows.map((g) => (
            <button key={g.id} type="button" onClick={() => onDoneToday(g.id === "Older" ? "older" : "today")} title={`Open All sessions · ${g.id}`} className="flex h-6 w-full items-center gap-1.5 rounded-md px-1.5 text-left text-[11.5px] text-ac-muted hover:bg-ac-raise hover:text-ac-text">
              <ChevronRight className="size-3 shrink-0" />
              <span className="font-medium text-ac-soft">{g.id}</span>
              <span data-group-count="" className="ml-auto inline-flex h-4 min-w-[18px] shrink-0 items-center justify-center rounded-full bg-ac-raise px-1.5 text-[10.5px] tabular-nums leading-none text-ac-soft">{g.count}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
