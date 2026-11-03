/**
 * The centre pages (spec §6.7, §10.1–§10.3): Accounts, All sessions, Library on
 * one `PageBody` — centred, max 960, tables as 10 px cards with muted column
 * heads. Adapted from the reference boards; data and actions come in as props.
 */

import { useMemo, useState, type ReactNode } from "react";
import { Archive, ArchiveRestore, CircleAlert, Clock, Ellipsis, GitBranch, LogIn, Pin, Play, Plus, RefreshCw, Search, Shield, SquareTerminal, Tag, Vault } from "lucide-react";
import { cn } from "../lib/utils.js";
import { Button, IconButton } from "../ui/Button.js";
import { Segmented } from "../ui/Segmented.js";
import { SessionStateIcon } from "../ui/SessionStateIcon.js";
import { Switch } from "../ui/Switch.js";
import { TextInput } from "../ui/TextInput.js";
import type { IdentityColor, SessionState } from "../vm/types.js";
import { Act, AccountMark, BatchBar, Chip, PageHeader, checkedAgo, duration, type BatchActions } from "./kit.js";
import { LimitBar, isStale, type LimitAccount } from "./limits.js";

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

function Filter({ value, onChange, placeholder, width }: { value: string; onChange: (v: string) => void; placeholder: string; width: number }) {
  return (
    <div className="relative" style={{ width }}>
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

function AccountRowFull({ a, i, nowMs, on }: { a: PageAccount; i: number; nowMs: number; on: AccountActions }) {
  const stale = isStale(a, nowMs);
  return (
    <div className="grid grid-cols-[28px_minmax(0,1.3fr)_88px_minmax(0,2fr)_64px_120px] items-center gap-4 border-b border-ac-line px-4 py-3 last:border-b-0 hover:bg-ac-raise">
      <span className={cn("font-ac-mono text-[11px]", a.isDefault ? "text-ac-brand-text" : "text-ac-faint")}>{a.signIn ? "–" : `#${i + 1}`}</span>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <AccountMark color={a.color} />
          <span className="truncate text-[13px] font-medium text-ac-text">{a.name}</span>
          {a.isDefault && <Chip>Default</Chip>}
          {a.next && <Chip>next</Chip>}
        </div>
        {(a.email || a.label) && <div className="mt-0.5 truncate pl-[11px] text-[11.5px] text-ac-muted">{[a.email, a.label].filter(Boolean).join(" · ")}</div>}
      </div>
      <span className="text-xs text-ac-muted">{a.running ? `${a.running} running` : "idle"}</span>
      <div className="min-w-0 space-y-1">
        {a.windows.length ? (
          a.windows.map((w) => <LimitBar key={w.label} w={w} protect={a.protect} stale={stale} nowMs={nowMs} />)
        ) : (
          <span className="text-xs text-ac-muted">No usage before the first sign-in</span>
        )}
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
              <div className="overflow-hidden rounded-[10px] border border-ac-line bg-ac-panel">
                <div className="grid grid-cols-[28px_minmax(0,1.3fr)_88px_minmax(0,2fr)_64px_120px] gap-4 border-b border-ac-line px-4 py-2 text-[11px] font-medium text-ac-muted">
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
  /** The repository (or folder) the session works in, for the Projects grouping. */
  project?: string | null;
}

/** Sessions grouped by project, the most recently active project first; no project last. Pure. */
export function byProject(rows: readonly TableSession[]): { project: string | null; rows: TableSession[] }[] {
  const m = new Map<string | null, TableSession[]>();
  for (const r of rows) m.set(r.project ?? null, [...(m.get(r.project ?? null) ?? []), r]);
  const last = (l: TableSession[]) => Math.max(...l.map((r) => r.lastActiveMs));
  return [...m].map(([project, l]) => ({ project, rows: l })).sort((a, b) => (a.project === null ? 1 : b.project === null ? -1 : last(b.rows) - last(a.rows)));
}

export function filterSessions(rows: readonly TableSession[], q: string, state: "all" | "live" | "done", tool: "any" | TableSession["tool"]): TableSession[] {
  return rows.filter((s) => (state === "all" || (state === "live") === s.live) && (tool === "any" || s.tool === tool) && matches(q, s.title, s.account.name, s.branch, s.pr ? `#${s.pr.number}` : null));
}

export function AllSessionsPage({ sessions, nowMs, onOpen, batch }: { sessions: TableSession[]; nowMs: number; onOpen: (key: string) => void; batch: (keys: string[]) => BatchActions }) {
  const [q, setQ] = useState("");
  const [state, setState] = useState<"all" | "live" | "done">("all");
  const [tool, setTool] = useState<"any" | TableSession["tool"]>("any");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [group, setGroup] = useState<"none" | "project">("none");
  const rows = useMemo(() => filterSessions(sessions, q, state, tool), [sessions, q, state, tool]);
  const sections = useMemo(() => (group === "project" ? byProject(rows) : [{ project: null as string | null, rows }]), [rows, group]);
  const live = sessions.filter((s) => s.live).length;
  const cols = "grid-cols-[24px_minmax(0,1.6fr)_120px_minmax(0,1.2fr)_120px_70px_80px]";
  const toggle = (k: string) => setSel((c) => (c.has(k) ? new Set([...c].filter((x) => x !== k)) : new Set([...c, k])));
  return (
    <PageBody title="All sessions" sub="Scan, filter and act on many sessions at once.">
      <div className="mb-3 flex items-center gap-2">
        <Filter value={q} onChange={setQ} placeholder="Filter…" width={300} />
        <Segmented size="sm" label="State" value={state} onChange={setState} options={[{ value: "all", label: `All ${sessions.length}` }, { value: "live", label: `Live ${live}` }, { value: "done", label: `Done ${sessions.length - live}` }]} />
        <Segmented size="sm" label="Tool" value={tool} onChange={setTool} options={[{ value: "any", label: "Any tool" }, { value: "claude", label: "Claude" }, { value: "codex", label: "Codex" }, { value: "antigravity", label: "Antigravity" }]} />
        <Segmented size="sm" label="Group" value={group} onChange={setGroup} options={[{ value: "none", label: "List" }, { value: "project", label: "Projects" }]} />
      </div>
      {sel.size > 0 && <BatchBar count={sel.size} className="mb-2" actions={batch([...sel])} />}
      {sections.map((sec) => (
        <div key={sec.project ?? "-"} className={group === "project" ? "mb-4" : undefined}>
          {group === "project" && (
            <div className="mb-1.5 flex items-center gap-2">
              <span className="ac-caps">{sec.project ?? "No project"}</span>
              <span className="font-ac-mono text-[11px] text-ac-faint">{sec.rows.length}</span>
            </div>
          )}
          <Table cols={cols} heads={["", "Session", "Account", "Branch · PR", "Model", "Context", "Active"]}>
            {sec.rows.map((s) => (
              <div key={s.key} onClick={() => onOpen(s.key)} className={cn("grid cursor-default items-center gap-3 border-b border-ac-line px-3 py-2 last:border-b-0 hover:bg-ac-raise", cols)}>
                <input type="checkbox" aria-label={`Select ${s.title}`} checked={sel.has(s.key)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(s.key)} />
                <span className="flex min-w-0 items-center gap-2">
                  <SessionStateIcon state={s.state} />
                  <span className="truncate text-[13px] text-ac-text">{s.title}</span>
                </span>
                <span className="flex min-w-0 items-center gap-1.5 text-xs text-ac-soft">
                  <AccountMark color={s.account.color} />
                  <span className="truncate">{s.account.name}</span>
                </span>
                <span className="flex min-w-0 items-center gap-1.5 font-ac-mono text-[11px] text-ac-muted">
                  <GitBranch className="size-3 shrink-0" />
                  <span className="truncate">{s.branch ?? "no repo"}</span>
                  {s.pr && <span className={cn("shrink-0", s.pr.ci === "FAILURE" && "text-ac-alert-text")}>#{s.pr.number}</span>}
                </span>
                <span className="truncate text-xs text-ac-soft">{[s.model, s.thinking].filter(Boolean).join(" · ")}</span>
                <span className="font-ac-mono text-[11px] text-ac-muted">{s.contextPct == null ? "" : `${Math.round(s.contextPct)}%`}</span>
                <span className="text-right text-xs text-ac-muted">{duration(nowMs - s.lastActiveMs)}</span>
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

/** Library "Last": "now", "3 h", then a short date ("Oct 28"). Pure for a given locale. */
export function lastSeen(ms: number, nowMs: number, locale?: string): string {
  const d = nowMs - ms;
  if (d < 60_000) return "now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} min`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} h`;
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
  const visible = rows.filter((r) => (show === "all" ? !r.archived : show === "pinned" ? r.pinned && !r.archived : r.archived) && matches(q, r.name, r.summary, r.project, r.branch, r.pr ? `#${r.pr.number}` : null, ...r.tags));
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
        <Segmented size="sm" label="Show" value={show} onChange={setShow} options={[{ value: "all", label: "All" }, { value: "pinned", label: `Pinned ${rows.filter((r) => r.pinned && !r.archived).length}` }, { value: "archived", label: `Archived ${rows.filter((r) => r.archived).length}` }]} />
        <span className="ml-auto text-xs text-ac-muted">vault {mb(vaultBytes)}</span>
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
      </Table>
      {!visible.length && <p className="mt-3 text-xs text-ac-muted">Nothing here yet.</p>}
    </PageBody>
  );
}
