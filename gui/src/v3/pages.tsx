/**
 * The centre pages (spec §6.7, §10.1–§10.3): Accounts, All sessions, Library on
 * one `PageBody` — centred, max 960, tables as 10 px cards with muted column
 * heads. Adapted from the reference boards; data and actions come in as props.
 */

import { useMemo, useState, type ReactNode } from "react";
import { Archive, ArchiveRestore, CircleAlert, Clock, Copy, Ellipsis, GitBranch, LogIn, Pin, Play, Plus, RefreshCw, Search, Shield, SquareTerminal, Tag, Vault } from "lucide-react";
import { cn } from "../lib/utils.js";
import { Button, IconButton } from "../ui/Button.js";
import { Segmented } from "../ui/Segmented.js";
import { MultiSelect } from "./multi-select.js";
import { ANY_TIME, DateRange, inRange, type TimeRange } from "./date-range.js";
import { SessionStateIcon } from "../ui/SessionStateIcon.js";
import { Switch } from "../ui/Switch.js";
import { TextInput } from "../ui/TextInput.js";
import type { IdentityColor, SessionState } from "../vm/types.js";
import { Act, AccountMark, BatchBar, CheckBox, Chip, PageHeader, ago, checkedAgo, duration, type BatchActions } from "./kit.js";
import { LimitBar, isStale, tightest, tone, type LimitAccount } from "./limits.js";

export function PageBody({ eyebrow, title, sub, actions, children }: { eyebrow?: string; title?: string; sub?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-h-0 flex-1 relative overflow-y-auto">
      <div className="mx-auto w-full max-w-[960px] px-8 pb-10 pt-6">
        {title && <PageHeader eyebrow={eyebrow} title={title} sub={sub} actions={actions} />}
        {children}
      </div>
    </div>
  );
}

/** A table as a 10 px card with muted column heads (spec §6.7). */
function Table({ cols, heads, children }: { cols: string; heads: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[10px] border border-ac-line bg-ac-panel">
      <div className={cn("grid items-center gap-3 border-b border-ac-line px-3 py-2 text-[11px] font-medium text-ac-muted", cols)}>
        {heads.map((h, i) => (
          <span key={i} className={i === heads.length - 1 && h === "Active" ? "text-right" : undefined}>
            {h}
          </span>
        ))}
      </div>
      {children}
    </div>
  );
}

/** `width` fixes it; without one it takes the room the switches leave, so a filter bar stays one line. */
function Filter({ value, onChange, placeholder, width }: { value: string; onChange: (v: string) => void; placeholder: string; width?: number }) {
  return (
    <div className={cn("relative", width === undefined && "min-w-[120px] flex-1")} style={width === undefined ? undefined : { width }}>
      <Search className="absolute left-2.5 top-2 size-4 text-ac-faint" />
      <TextInput aria-label="Filter" className="w-full pl-8" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

const matches = (q: string, ...fields: (string | null | undefined)[]) => {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = fields.filter(Boolean).join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
};

// ---------- Accounts (spec §10.1) ----------

export interface PageAccount extends LimitAccount {
  email: string | null;
  label: string | null;
  isDefault: boolean;
  running: number;
}

/** The accounts board's columns. Each has the width the board gives it as its
 *  floor: below that the table scrolls sideways instead of drawing one column
 *  over the next (the windows column alone needs its label, bar, number and reset). */
const ACCOUNT_COLS = "grid-cols-[28px_minmax(184px,1.3fr)_88px_minmax(300px,2fr)_64px_120px]";
/** The sum of those floors, the gaps and the row padding. */
const ACCOUNT_TABLE_MIN = "min-w-[896px]";

function AccountRowFull({ a, i, nowMs, on }: { a: PageAccount; i: number; nowMs: number; on: AccountActions }) {
  const stale = isStale(a, nowMs);
  return (
    <div className={`grid ${ACCOUNT_COLS} items-center gap-4 border-b border-ac-line px-4 py-3 last:border-b-0 hover:bg-ac-raise`}>
      <span className={cn("font-ac-mono text-[11px]", a.isDefault ? "text-ac-brand-text" : "text-ac-faint")}>{a.signIn ? "–" : `#${i + 1}`}</span>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <AccountMark color={a.color} />
          <span className="truncate text-[13px] font-medium text-ac-text">{a.name}</span>
          {a.isDefault && <Chip>Default</Chip>}
          {a.next && <Chip>next</Chip>}
          {a.signIn ? (
            <Chip>Sign-in needed</Chip>
          ) : (
            !stale &&
            (tone(tightest(a)?.used ?? null, a.protect) === "warn" || tone(tightest(a)?.used ?? null, a.protect) === "alert") && (
              <Chip kind="status" tone="warn">
                Near limit
              </Chip>
            )
          )}
        </div>
        {(a.email || a.label) && (
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 pl-[11px] text-[11.5px] text-ac-muted">
            {a.email && <span className="truncate">{a.email}</span>}
            {a.email && (
              <button type="button" title="Copy e-mail" aria-label={`Copy ${a.email}`} onClick={() => void navigator.clipboard?.writeText(a.email!)} className="shrink-0 text-ac-faint hover:text-ac-text">
                <Copy className="size-3" />
              </button>
            )}
            {a.label && <span className="shrink-0">{a.email ? `· ${a.label}` : a.label}</span>}
          </div>
        )}
      </div>
      <span className="text-xs text-ac-muted">{a.running ? `${a.running} running` : "idle"}</span>
      <div className="min-w-0 space-y-1">
        {a.windows.length ? (
          a.windows.map((w) => <LimitBar key={w.label} w={w} protect={a.protect} stale={stale} nowMs={nowMs} />)
        ) : (
          <span className="text-xs text-ac-muted">No usage before the first sign-in</span>
        )}
        {a.routines && <div className="text-[11px] text-ac-soft">{`Routines ${a.routines.used}/${a.routines.limit} today`}</div>}
        {a.windows.length > 0 && a.checkedMs != null && <div className={cn("text-[10.5px]", stale ? "text-ac-warn-text" : "text-ac-faint")}>{checkedAgo(nowMs - a.checkedMs)}{stale ? " · stale, refreshing" : ""}</div>}
      </div>
      <span className="inline-flex items-center gap-1 text-xs text-ac-soft" title="Warns at this share">
        <Shield className="size-3.5 text-ac-muted" /> {a.protect}%
      </span>
      <span className="flex items-center justify-end gap-1">
        {a.signIn ? (
          <Act kind="accent" onClick={() => on.signIn(a.key)}>
            <LogIn /> Sign in
          </Act>
        ) : (
          !a.isDefault && (
            <Button size="sm" variant="ghost" onClick={() => on.use(a.key)}>
              Use
            </Button>
          )
        )}
        <IconButton label="Open a terminal on this account" className="size-7" onClick={() => on.terminal(a.key)}>
          <SquareTerminal />
        </IconButton>
        <IconButton label="More" className="size-7" onClick={() => on.more(a.key)}>
          <Ellipsis />
        </IconButton>
      </span>
    </div>
  );
}

export interface AccountActions {
  add: () => void;
  refresh: () => void;
  use: (key: string) => void;
  signIn: (key: string) => void;
  terminal: (key: string) => void;
  more: (key: string) => void;
}

export type AccountsView = "accounts" | "history" | "pools" | "mcp";

/** Usage history and Projects & pools are the 2.11 screens, passed in as views (spec §10.1). */
export function AccountsPage({ accounts, nowMs, nextRefreshMs, view, onView, history, pools, poolCount, mcp, on }: { accounts: PageAccount[]; nowMs: number; nextRefreshMs: number | null; view: AccountsView; onView: (v: AccountsView) => void; history: ReactNode; pools: ReactNode; poolCount: number; mcp?: ReactNode; on: AccountActions }) {
  const groups = (["claude", "codex", "antigravity"] as const).map((t) => [t, accounts.filter((a) => a.tool === t)] as const).filter(([, l]) => l.length);
  return (
    <PageBody
      title="Accounts"
      sub="Each sign-in, where it is used, what is left in every window, and when it warns."
      actions={
        <Act onClick={on.add}>
          <Plus /> Add account
        </Act>
      }
    >
      <div className="mb-4 flex items-center gap-3">
        <Segmented
          size="sm"
          label="View"
          value={view}
          onChange={onView}
          options={[
            { value: "accounts", label: `Accounts ${accounts.length}` },
            { value: "history", label: "Usage history" },
            { value: "pools", label: `Projects & pools ${poolCount}` },
            ...(mcp ? [{ value: "mcp" as const, label: "MCP & plugins" }] : []),
          ]}
        />
        {nextRefreshMs != null && <span className="ml-auto text-xs text-ac-muted">next refresh in {duration(nextRefreshMs)}</span>}
        <Button size="sm" variant="ghost" className={nextRefreshMs == null ? "ml-auto" : undefined} onClick={on.refresh}>
          <RefreshCw /> Refresh
        </Button>
      </div>
      {view === "history" && history}
      {view === "pools" && pools}
      {view === "mcp" && mcp}
      {view === "accounts" &&
        groups.map(([tool, list]) => {
          const name = tool === "claude" ? "Claude" : tool === "codex" ? "Codex" : "Antigravity";
          const def = list.find((a) => a.isDefault) ?? list[0];
          return (
            <section key={tool} className="mb-6">
              <div className="mb-2 flex items-center gap-2">
                <span className="ac-caps">{name}</span>
                <span className="font-ac-mono text-[11px] text-ac-faint">{list.length}</span>
                <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-ac-muted">
                  <SquareTerminal className="size-3.5" /> Plain <span className="font-ac-mono">{tool}</span> starts on
                  <AccountMark color={def.color} /> <span className="text-ac-text">{def.name}</span>
                </span>
              </div>
              <div className="overflow-x-auto overflow-y-hidden rounded-[10px] border border-ac-line bg-ac-panel">
                <div className={ACCOUNT_TABLE_MIN}>
                <div className={`grid ${ACCOUNT_COLS} gap-4 border-b border-ac-line px-4 py-2 text-[11px] font-medium text-ac-muted`}>
                  <span />
                  <span>Account</span>
                  <span>Used in</span>
                  <span>Windows · tick = even pace</span>
                  <span>Protect</span>
                  <span />
                </div>
                {list.map((a, i) => (
                  <AccountRowFull key={a.key} a={a} i={i} nowMs={nowMs} on={on} />
                ))}
                </div>
              </div>
            </section>
          );
        })}
    </PageBody>
  );
}

// ---------- All sessions (spec §10.2) ----------

export interface TableSession {
  key: string;
  title: string;
  state: SessionState;
  live: boolean;
  tool: "claude" | "codex" | "antigravity";
  account: { name: string; color: IdentityColor };
  branch: string | null;
  pr: { number: number; ci: string } | null;
  model: string | null;
  thinking: string | null;
  contextPct: number | null;
  lastActiveMs: number;
  /** The repository (or folder) the session works in, for the Projects grouping: its label, unique per root. */
  project?: string | null;
  /** That repository's full path (the group's identity and tooltip). */
  projectRoot?: string | null;
  /** The checkout the session works in (its toplevel), for the worktree sub-header (D8). */
  worktree?: { id: string; branch: string | null; linked: boolean } | null;
}

/** Sessions grouped by project, the most recently active project first; no project last. Pure. */
export function byProject(rows: readonly TableSession[]): { project: string | null; rows: TableSession[] }[] {
  const m = new Map<string | null, TableSession[]>();
  for (const r of rows) m.set(r.project ?? null, [...(m.get(r.project ?? null) ?? []), r]);
  const last = (l: TableSession[]) => Math.max(...l.map((r) => r.lastActiveMs));
  return [...m].map(([project, l]) => ({ project, rows: l })).sort((a, b) => (a.project === null ? 1 : b.project === null ? -1 : last(b.rows) - last(a.rows)));
}

/** The rows in the sidebar's order (`order`, its keys); the rest (ended sessions) after it, newest first. Pure. */
export function inListOrder(rows: readonly TableSession[], order: readonly string[]): TableSession[] {
  const at = new Map(order.map((k, i) => [k, i]));
  return [...rows].sort((a, b) => {
    const x = at.get(a.key);
    const y = at.get(b.key);
    if (x != null || y != null) return x == null ? 1 : y == null ? -1 : x - y;
    return b.lastActiveMs - a.lastActiveMs;
  });
}

/** The status tabs of All sessions (proposal E), in their order; "live" is every running or idle one, "done" every ended one.
 *  Ended sessions split as in the sidebar (owner, 2026-11-24): Done today since midnight, Older before. */
export type TableStatus = "all" | "needs" | "running" | "idle" | "today" | "older" | "done" | "live";
export type StatusTab = Exclude<TableStatus, "live" | "done">;
const STATUS_TAB: { value: StatusTab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "needs", label: "Needs you" },
  { value: "running", label: "Running" },
  { value: "idle", label: "Idle" },
  { value: "today", label: "Done today" },
  { value: "older", label: "Older" },
];

/** An ended row: Done today (ended since local midnight) or Older. Without a clock, today. Pure. */
export function endedWhen(s: TableSession, nowMs?: number): "today" | "older" {
  if (nowMs == null || s.lastActiveMs == null) return "today";
  return s.lastActiveMs >= new Date(nowMs).setHours(0, 0, 0, 0) ? "today" : "older";
}

/** A row's status: waiting for you (or its CI is failing), running, idle, or done. Pure. */
export function tableStatus(s: TableSession): Exclude<TableStatus, "all" | "live"> {
  if (!s.live) return "done";
  if (s.state === "needs-you" || s.pr?.ci === "FAILURE" || s.pr?.ci === "ERROR") return "needs";
  return s.state === "working" ? "running" : "idle";
}

/** Whether a row belongs under a status tab. Pure. */
export function inStatus(s: TableSession, state: TableStatus, nowMs?: number): boolean {
  if (state === "all") return true;
  if (state === "live") return s.live;
  const st = tableStatus(s);
  if (state === "today" || state === "older") return st === "done" && endedWhen(s, nowMs) === state;
  return st === state;
}

/** `tool`: one tool, "any", or a set of tools (an empty set is every tool). */
export function filterSessions(rows: readonly TableSession[], q: string, state: TableStatus, tool: "any" | TableSession["tool"] | ReadonlySet<TableSession["tool"]>, nowMs?: number): TableSession[] {
  const inState = (s: TableSession) => inStatus(s, state, nowMs);
  const inTool = (s: TableSession) => (typeof tool === "string" ? tool === "any" || s.tool === tool : tool.size === 0 || tool.has(s.tool));
  return rows.filter((s) => inState(s) && inTool(s) && matches(q, s.title, s.account.name, s.branch, s.pr ? `#${s.pr.number}` : null));
}

const TOOL_LABEL: Record<TableSession["tool"], string> = { claude: "Claude", codex: "Codex", antigravity: "Antigravity" };
/** The account as the table says it: the tool only where it is not Claude (proposal E). */
const accountText = (s: TableSession) => (s.tool === "claude" ? s.account.name : `${s.account.name} · ${TOOL_LABEL[s.tool]}`);
const modelText = (s: TableSession) => [s.model, s.thinking].filter(Boolean).join(" · ");
/** One value for every row, or null when they differ (or there are none). Pure. */
function shared<T>(rows: readonly TableSession[], f: (s: TableSession) => T): T | null {
  if (!rows.length) return null;
  const v = f(rows[0]);
  return rows.every((r) => f(r) === v) ? v : null;
}

/**
 * All sessions (spec §10.2, proposal E): search and status tabs with counts —
 * Needs you first — a tool filter only when more than one tool has sessions,
 * branch · PR · CI under the title, and a value every row shares said once
 * above the table instead of in every row. Grouping by project follows the
 * Sessions window's own Group menu.
 */
export function AllSessionsPage({ sessions, order, nowMs, onOpen, batch, group: initialGroup = "none", onGroup, status: initialStatus = "all" }: { /** Each switch between List and Projects, for the window to keep. */ onGroup?: (g: "none" | "project") => void; /** The tab it opens on (Done today or Older from the sidebar). */ status?: StatusTab; sessions: TableSession[]; /** The sidebar's order (its keys); absent keeps the given order. */ order?: readonly string[]; nowMs: number; onOpen: (key: string) => void; batch: (keys: string[]) => BatchActions; /** The Sessions window's grouping: by project, or one list. */ group?: "none" | "project" }) {
  const [q, setQ] = useState("");
  // Status and time as dropdowns (owner, 2026-11-24): several statuses at once; nothing ticked = every status.
  const [state, setState] = useState<ReadonlySet<Exclude<StatusTab, "all">>>(() => new Set(initialStatus === "all" ? [] : [initialStatus]));
  const [range, setRange] = useState<TimeRange>(ANY_TIME);
  // Tools as a multi-select dropdown (owner, 2026-11-24); nothing ticked = every tool.
  const [tool, setTool] = useState<ReadonlySet<TableSession["tool"]>>(() => new Set());
  const [sel, setSel] = useState<Set<string>>(new Set());
  const rows = useMemo(() => {
    const hits = filterSessions(sessions, q, "all", tool, nowMs).filter((s) => (state.size === 0 || [...state].some((st) => inStatus(s, st, nowMs))) && inRange(s.lastActiveMs, range));
    return order ? inListOrder(hits, order) : hits;
  }, [sessions, order, q, state, tool, nowMs, range]);
  // List or Projects stays a switch on the page (owner, 2026-11-24); it starts from the sidebar's grouping.
  const [group, setGroup] = useState<"none" | "project">(initialGroup);
  const sections = useMemo(() => (group === "project" ? byProject(rows) : [{ project: null as string | null, rows }]), [rows, group]);
  const count = (v: StatusTab) => sessions.filter((s) => inStatus(s, v, nowMs)).length;
  // A tab with nothing behind it is hidden, unless it is the one chosen.
  const tabs = STATUS_TAB.filter((t) => t.value !== "all" && (state.has(t.value) || count(t.value) > 0)) as { value: Exclude<StatusTab, "all">; label: string }[];
  const tools = (["claude", "codex", "antigravity"] as const).filter((t) => sessions.some((s) => s.tool === t));
  const oneAccount = shared(rows, accountText);
  const oneModel = shared(rows, modelText);
  const sharedLine = [oneAccount && `on ${oneAccount}`, oneModel && oneModel].filter(Boolean).join(" · ");
  // Static classes (Tailwind sees only whole strings): one per set of columns shown.
  const cols = oneAccount === null ? (oneModel === null ? "grid-cols-[24px_minmax(0,2fr)_minmax(0,0.9fr)_minmax(0,1fr)_56px_76px]" : "grid-cols-[24px_minmax(0,2fr)_minmax(0,0.9fr)_56px_76px]") : oneModel === null ? "grid-cols-[24px_minmax(0,2fr)_minmax(0,1fr)_56px_76px]" : "grid-cols-[24px_minmax(0,2fr)_56px_76px]";
  const heads = ["", "Session", ...(oneAccount === null ? ["Account"] : []), ...(oneModel === null ? ["Model"] : []), "Context", "Active"];
  const toggle = (k: string) => setSel((c) => (c.has(k) ? new Set([...c].filter((x) => x !== k)) : new Set([...c, k])));
  return (
    <PageBody title="All sessions" sub="Scan, filter and act on many sessions at once.">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Filter value={q} onChange={setQ} placeholder="Filter…" />
        <MultiSelect width={176} label="Status" all={`All ${sessions.length}`} picked={state} onChange={setState} options={tabs.map((t) => ({ value: t.value, label: t.label, hint: count(t.value) }))} />
        {tools.length > 1 && <MultiSelect width={150} label="Tool" all="All tools" picked={tool} onChange={setTool} options={tools.map((t) => ({ value: t, label: TOOL_LABEL[t], hint: sessions.filter((s) => s.tool === t).length }))} />}
        <DateRange label="Active" value={range} onChange={setRange} nowMs={nowMs} width={156} />
        <Segmented size="sm" label="Group" value={group} onChange={(g) => (setGroup(g), onGroup?.(g))} options={[{ value: "none", label: "List" }, { value: "project", label: "Projects" }]} />
      </div>
      {sel.size > 0 && <BatchBar count={sel.size} className="mb-2" actions={batch([...sel])} />}
      {rows.length > 1 && sharedLine && <p className="mb-2 text-xs text-ac-muted">Every session here runs {sharedLine}.</p>}
      {sections.map((sec) => (
        <div key={sec.project ?? "-"} className={group === "project" ? "mb-4" : undefined}>
          {group === "project" && (
            <div className="mb-1.5 flex items-center gap-2">
              <span className="ac-caps">{sec.project ?? "No project"}</span>
              <span className="font-ac-mono text-[11px] text-ac-faint">{sec.rows.length}</span>
            </div>
          )}
          <Table cols={cols} heads={heads}>
            {sec.rows.map((s) => (
              <div key={s.key} onClick={() => onOpen(s.key)} className={cn("grid cursor-default items-center gap-3 border-b border-ac-line px-3 py-2 last:border-b-0 hover:bg-ac-raise", cols)}>
                <CheckBox label={`Select ${s.title}`} checked={sel.has(s.key)} onChange={() => toggle(s.key)} />
                <span className="min-w-0">
                  <span className="flex min-w-0 items-center gap-2">
                    <SessionStateIcon state={s.state} />
                    <span className="truncate text-[13px] text-ac-text">{s.title}</span>
                  </span>
                  {/* Branch · PR · CI under the title (proposal E). */}
                  <span className="mt-0.5 flex min-w-0 items-center gap-1.5 pl-4 font-ac-mono text-[11px] text-ac-muted">
                    <GitBranch className="size-3 shrink-0" />
                    <span className="truncate">{s.branch ?? "no repo"}</span>
                    {s.pr && <span className="shrink-0">· #{s.pr.number}</span>}
                    {(s.pr?.ci === "FAILURE" || s.pr?.ci === "ERROR") && <span className="shrink-0 font-sans text-ac-alert-text">CI failing</span>}
                  </span>
                </span>
                {oneAccount === null && (
                  <span className="flex min-w-0 items-center gap-1.5 text-xs text-ac-soft">
                    <AccountMark color={s.account.color} />
                    <span className="truncate">{accountText(s)}</span>
                  </span>
                )}
                {oneModel === null && <span className="truncate text-xs text-ac-soft">{modelText(s)}</span>}
                <span className="font-ac-mono text-[11px] text-ac-muted">{s.contextPct == null ? "" : `${Math.round(s.contextPct)}%`}</span>
                <span className="text-right text-xs text-ac-muted">{lastSeen(s.lastActiveMs, nowMs)}</span>
              </div>
            ))}
          </Table>
        </div>
      ))}
      {!rows.length && <p className="mt-3 text-xs text-ac-muted">No session matches.</p>}
    </PageBody>
  );
}

// ---------- Library (spec §10.3) ----------

/** "Active" and the Library's "Last": the one relative time ("now", "21m ago") within a day, then a short date ("Oct 28"). Pure for a given locale. */
export function lastSeen(ms: number, nowMs: number, locale?: string): string {
  const d = nowMs - ms;
  if (d < 86_400_000) return ago(d);
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(new Date(ms));
}

export interface LibraryRow {
  key: string;
  name: string;
  summary: string | null;
  tags: string[];
  color: IdentityColor;
  project: string | null;
  branch: string | null;
  pr: { number: number; lifecycle: string } | null;
  lastMs: number;
  pinned: boolean;
  archived: boolean;
  vault: { state: "saved"; bytes: number } | { state: "unavailable" } | { state: "none"; cleanupInDays: number | null };
  /** Claude still has the transcript. */
  transcript: boolean;
}

const mb = (b: number) => `${(b / 1_048_576).toFixed(1)} MB`;

function VaultCell({ v }: { v: LibraryRow["vault"] }) {
  if (v.state === "saved")
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-ac-ok-text">
        <Vault className="size-3.5" /> kept · {mb(v.bytes)}
      </span>
    );
  if (v.state === "unavailable")
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-ac-alert-text" title="Pinned before the vault existed; Claude has deleted the transcript">
        <CircleAlert className="size-3.5" /> transcript gone
      </span>
    );
  if (v.cleanupInDays == null) return <span className="text-xs text-ac-muted">not kept</span>;
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-xs", v.cleanupInDays <= 7 ? "text-ac-warn-text" : "text-ac-muted")}>
      <Clock className="size-3.5" /> Claude deletes it in {v.cleanupInDays} d
    </span>
  );
}

/** The unkept entry Claude deletes soonest, within a week; drives the deadline banner. Pure. */
export function nextDeadline(rows: readonly LibraryRow[]): LibraryRow | null {
  const soon = rows.filter((r) => !r.archived && r.vault.state === "none" && r.vault.cleanupInDays != null && r.vault.cleanupInDays <= 7);
  return soon.sort((a, b) => (a.vault as { cleanupInDays: number }).cleanupInDays - (b.vault as { cleanupInDays: number }).cleanupInDays)[0] ?? null;
}

export function LibraryPage({ rows, vaultBytes, autoKeep, nowMs, on }: { rows: LibraryRow[]; vaultBytes: number; autoKeep: boolean; nowMs: number; on: { autoKeep: (v: boolean) => void; pin: (key: string, pinned: boolean) => void; resume: (key: string) => void; archive: (key: string, archived: boolean) => void } }) {
  const [q, setQ] = useState("");
  const [show, setShow] = useState<"all" | "pinned" | "archived">("all");
  // "All" is everything, archived rows included with their chip (G1, as on the boards).
  const visible = rows.filter((r) => (show === "all" ? true : show === "pinned" ? r.pinned : r.archived) && matches(q, r.name, r.summary, r.project, r.branch, r.pr ? `#${r.pr.number}` : null, ...r.tags));
  const deadline = nextDeadline(rows);
  const cols = "grid-cols-[24px_minmax(0,1.7fr)_minmax(0,1fr)_64px_150px_132px]";
  return (
    <PageBody
      title="Library"
      sub="Pinned sessions are kept in the vault, so Claude's own cleanup can't take them."
      actions={
        <span className="inline-flex items-center gap-2 text-xs text-ac-soft" title="Pins automatically before Claude's cleanup">
          Auto-keep sessions with an open PR <Switch checked={autoKeep} onChange={on.autoKeep} label="Auto-keep" />
        </span>
      }
    >
      <div className="mb-3 flex items-center gap-2">
        <Filter value={q} onChange={setQ} placeholder="Name, summary, folder, branch, PR…" width={340} />
        <Segmented size="sm" label="Show" value={show} onChange={setShow} options={[{ value: "all", label: "All" }, { value: "pinned", label: `Pinned ${rows.filter((r) => r.pinned).length}` }, { value: "archived", label: `Archived ${rows.filter((r) => r.archived).length}` }]} />
        <span className="ml-auto whitespace-nowrap text-xs text-ac-muted">vault {mb(vaultBytes)}</span>
      </div>
      {deadline && (
        <div role="alert" className="mb-3 flex items-center gap-3 rounded-[10px] border border-ac-warn bg-ac-warn-tint px-3 py-2">
          <Clock className="size-4 shrink-0 text-ac-warn-text" />
          <span className="min-w-0 flex-1 text-xs text-ac-warn-text">
            “{deadline.name}” will be deleted by Claude in {(deadline.vault as { cleanupInDays: number }).cleanupInDays} days.
          </span>
          <Act kind="accent" onClick={() => on.pin(deadline.key, true)}>
            <Pin /> Keep it
          </Act>
        </div>
      )}
      <Table cols={cols} heads={["", "Session", "Where", "Last", "Kept?", ""]}>
        {visible.map((e) => (
          <div key={e.key} className={cn("grid items-center gap-3 border-b border-ac-line px-3 py-2.5 last:border-b-0 hover:bg-ac-raise", cols)}>
            <button type="button" aria-label={e.pinned ? "Unpin" : "Pin to keep"} aria-pressed={e.pinned} onClick={() => on.pin(e.key, !e.pinned)} className={cn("inline-flex", e.pinned ? "text-ac-brand-text" : "text-ac-faint")}>
              <Pin className="size-3.5" fill={e.pinned ? "currentColor" : "none"} />
            </button>
            <span className="min-w-0">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-[13px] font-medium text-ac-text">{e.name}</span>
                {e.archived && <Chip>archived</Chip>}
                {e.tags.map((t) => (
                  <Chip key={t} kind="tag" icon={<Tag className="size-2.5" />}>
                    {t}
                  </Chip>
                ))}
              </span>
              {e.summary && (
                <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-ac-muted">
                  <AccountMark color={e.color} className="h-2.5" />
                  <span className="truncate">{e.summary}</span>
                </span>
              )}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-xs text-ac-soft">{e.project ?? ""}</span>
              {e.branch && (
                <span className="mt-0.5 flex min-w-0 items-center gap-1.5 font-ac-mono text-[11px] text-ac-muted">
                  <GitBranch className="size-3 shrink-0" />
                  <span className="truncate">{e.branch}</span>
                  {e.pr && (
                    <span className="shrink-0">
                      #{e.pr.number} {e.pr.lifecycle.toLowerCase()}
                    </span>
                  )}
                </span>
              )}
            </span>
            <span className="text-xs text-ac-muted" title={new Date(e.lastMs).toLocaleString()}>
              {lastSeen(e.lastMs, nowMs)}
            </span>
            <VaultCell v={e.vault} />
            <span className="flex items-center justify-end gap-1">
              {e.transcript || e.vault.state === "saved" ? (
                <Button size="sm" onClick={() => on.resume(e.key)}>
                  <Play /> Resume…
                </Button>
              ) : (
                <span className="text-[11px] text-ac-faint">can't resume</span>
              )}
              <IconButton label={e.archived ? "Restore" : "Archive"} className="size-7" onClick={() => on.archive(e.key, !e.archived)}>
                {e.archived ? <ArchiveRestore /> : <Archive />}
              </IconButton>
            </span>
          </div>
        ))}
        {!visible.length && (
          <p role="status" className="px-3 py-6 text-center text-xs text-ac-muted">
            {q.trim() ? `No entry matches “${q.trim()}”.` : rows.length ? "Nothing in this view." : "Pin a session to keep it in the vault. Merged sessions move here on their own after 24 h."}
          </p>
        )}
      </Table>
    </PageBody>
  );
}
