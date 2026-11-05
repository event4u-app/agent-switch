/**
 * The Sessions zone of the Sessions window (spec §5.2) and the children under
 * a row (§5.2, §9.3; C2): one shared order, one trailing slot by priority, the
 * active row's second line, "Done today", multi-select with the batch bar, and
 * children that unfold under their row with their provenance. Adapted from the
 * reference boards; the data is `sessions --json`.
 */

import { useEffect, useRef, type ReactNode } from "react";
import { Bot, ChevronRight, CircleX, TriangleAlert } from "lucide-react";
import { cn } from "../lib/utils.js";
import { SessionStateIcon } from "../ui/SessionStateIcon.js";
import type { SessionState } from "../vm/types.js";
import { BatchBar, Marker, type BatchActions } from "./kit.js";

export type ChildSource = "hook" | "lineage" | "host" | "counted" | "unknown";

export interface ChildModel {
  id: string;
  label: string;
  /** subagent, council, arena, court, helper, other, started_by, continued_from, cleared */
  kind: string;
  state: SessionState;
  source: ChildSource;
  /** Children known only by count. */
  count?: number;
}

export interface RowSession {
  key: string;
  title: string;
  state: SessionState;
  account: { name: string; nearLimit: boolean };
  branch: string | null;
  pr: { number: number; ci: string; mergeable: string } | null;
  children: ChildModel[];
  /** A Needs-you item points at this session. */
  needsYou: boolean;
  /** Finished today (the "Done today" row), not in the live list. */
  doneToday?: boolean;
}

/** `sessions --json` children → the rows under a session. Pure. */
export function childrenFromCli(row: { children?: any[]; childCount?: number; childSource?: string | null }): ChildModel[] {
  const out: ChildModel[] = (row.children ?? []).map((c) =>
    c.kind === "subagent"
      ? { id: c.agentId, label: c.type ?? "subagent", kind: "subagent", state: c.state === "running" ? "working" : "done", source: "hook" }
      : { id: c.sessionKey, label: c.label ?? c.kind, kind: c.kind, state: c.state === "running" ? "working" : "done", source: c.source === "host" || c.source === "hook" ? c.source : "lineage" },
  );
  const counted = (row.childCount ?? 0) - out.length;
  if (counted > 0 && row.childSource?.includes("counted")) out.push({ id: "counted", label: "subagents", kind: "subagent", state: "done", source: "counted", count: counted });
  return out;
}

export const childTotal = (s: RowSession) => s.children.reduce((n, c) => n + (c.count ?? 1), 0);

/** "1 subagent", "3 helper sessions", "2 related sessions". Pure. */
export function childNoun(s: RowSession): string {
  const n = childTotal(s);
  const kinds = new Set(s.children.map((c) => c.kind));
  const noun = kinds.size === 1 && kinds.has("subagent") ? "subagent" : [...kinds].every((k) => ["council", "arena", "court", "helper"].includes(k)) ? "helper session" : "related session";
  return `${n} ${n === 1 ? noun : noun + "s"}`;
}

/** One order everywhere (window, tray): needs you · CI failing · working · rest; done sessions are not listed. Pure. */
export function liveOrder(sessions: readonly RowSession[]): RowSession[] {
  const rank = (x: RowSession) => (x.needsYou || x.state === "needs-you" ? 0 : x.pr?.ci === "FAILURE" ? 1 : x.state === "working" ? 2 : 3);
  return sessions.filter((s) => s.state !== "done").sort((a, b) => rank(a) - rank(b));
}

/** The one trailing slot, by priority (spec §5.2). */
export function trailing(s: RowSession): ReactNode {
  if (s.account.nearLimit) return <span className="shrink-0 text-[11px] text-ac-warn-text" title={`${s.account.name} is near its limit`}>{s.account.name}</span>;
  if (s.pr?.ci === "FAILURE") return <CircleX className="size-3.5 shrink-0 text-ac-alert" aria-label="CI failing" />;
  if (s.pr?.mergeable === "CONFLICTING") return <TriangleAlert className="size-3.5 shrink-0 text-ac-alert" aria-label="merge conflict" />;
  if (s.needsYou && s.state !== "needs-you") return <span className="size-1.5 shrink-0 rounded-full bg-ac-warn" aria-label="needs you" />;
  const running = s.children.filter((c) => c.state === "working").reduce((n, c) => n + (c.count ?? 1), 0);
  if (running)
    return (
      <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-ac-muted" title={`${childNoun(s)} · ${running} running`}>
        <Bot className="size-3.5" />
        {running}
      </span>
    );
  return null;
}

/** The trailing slot is the running-children count (nothing of higher priority took it). Pure. */
export function childrenSlot(s: RowSession): boolean {
  if (s.account.nearLimit || s.pr?.ci === "FAILURE" || s.pr?.mergeable === "CONFLICTING" || (s.needsYou && s.state !== "needs-you")) return false;
  return s.children.some((c) => c.state === "working");
}

const VIA: Record<ChildSource, string> = { hook: "via hook", lineage: "via lineage", host: "via host", counted: "counted", unknown: "relation unknown" };

/** Provenance inline only when it matters (unknown, counted); otherwise in the tooltip. */
export function ChildLine({ c }: { c: ChildModel }) {
  const label = c.count ? `${c.count} ${c.label}` : c.label;
  return (
    <div className="flex h-6 min-w-0 items-center gap-2 text-[11.5px]" title={VIA[c.source]}>
      <SessionStateIcon state={c.state} />
      <span className="min-w-0 flex-1 truncate text-ac-soft">{label}</span>
      {(c.source === "unknown" || c.source === "counted") && (
        <span className={cn("shrink-0 text-[10.5px]", c.source === "unknown" ? "text-ac-warn-text" : "text-ac-muted")}>{c.source === "unknown" ? "relation unknown ⓘ" : "counted"}</span>
      )}
    </div>
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
}) {
  const second = active || comfortable;
  const slot = trailing(s);
  const ref = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLSpanElement>(null);
  useEllipsisRefresh(titleRef, active);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [active]);
  return (
    <div ref={ref}>
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
        className={cn("group/row relative rounded-md pl-2.5 pr-2", second ? "py-1.5" : "py-1", active ? "bg-ac-raise" : "hover:bg-ac-raise")}
      >
        {active && <Marker />}
        <div className="flex h-5 min-w-0 items-center gap-2">
          {selecting ? (
            <span role="checkbox" aria-checked={!!checked} className={cn("inline-flex size-3.5 shrink-0 rounded border", checked ? "border-ac-brand bg-ac-brand" : "border-ac-line2")} />
          ) : (
            <SessionStateIcon state={s.state} />
          )}
          {/* Keyed on the weight: Chromium keeps the ellipsis decision of the old weight
              when only font-weight changes, and the heavier title then runs past the edge. */}
          <span key={active ? "on" : "off"} ref={titleRef} className={cn("min-w-0 flex-1 truncate text-[13px]", active ? "font-medium text-ac-text" : "text-ac-soft")} title={s.title}>
            {s.title}
          </span>
          {/* One trailing slot per row (spec §5.2, boards "Work" and "Hover a row"): the children
              unfold from the row's own children count; a chevron shows only while they are open. */}
          {s.children.length > 0 && (open || childrenSlot(s) || !slot) ? (
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
            <span className="shrink-0">{s.account.name}</span>
            <span>·</span>
            <span className="truncate">{s.branch ?? "no repo"}</span>
            {s.pr && <span className="shrink-0">· #{s.pr.number}</span>}
          </div>
        )}
      </div>
      {open && (
        <div className="mb-1 ml-[18px] border-l border-ac-line pl-2">
          {s.children.map((c) => (
            <ChildLine key={c.id} c={c} />
          ))}
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
  onCleanUp,
  onDoneToday,
  onStart,
  projectOf,
  onPeek,
  divider = true,
  loading,
  tray,
  batch,
}: {
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
  onCleanUp: () => void;
  onDoneToday: () => void;
  /** The empty zone's one action (spec §5.2). */
  onStart?: () => void;
  /** Group by project: the project of a row, or null for rows outside a repo. */
  projectOf?: (key: string) => string | null;
  onPeek?: (key: string | null, y: number) => void;
  /** The line under the Needs-you zone; absent when that zone is hidden. */
  divider?: boolean;
  /** The first read has not settled: say nothing rather than "No sessions running". */
  loading?: boolean;
  batch: BatchActions;
}) {
  const live = liveOrder(sessions);
  const done = sessions.filter((s) => s.doneToday).length;
  // Grouped: one header per project, in the order the live list first meets it.
  const groups = projectOf ? [...new Set(live.map((s) => projectOf(s.key) ?? ""))] : [""];
  const rowsOf = (g: string) => (projectOf ? live.filter((s) => (projectOf(s.key) ?? "") === g) : live);
  return (
    <section aria-label="Sessions">
      {divider ? <div className="mx-3.5 my-1.5 h-px bg-ac-line" /> : <div className="h-2" />}
      <div className={cn("flex items-center gap-2 px-3.5", tray ? "mt-0.5 h-6" : "sticky top-0 z-[1] h-8 bg-ac-panel")}>
        <span className="text-[11px] font-semibold text-ac-soft">Sessions</span>
        <span className="text-[11px] text-ac-muted">{live.length}</span>
      </div>
      {selection && <BatchBar compact count={selection.size} actions={batch} className="mx-1.5 mb-1" />}
      <div className="px-1.5">
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
          projectOf && (
            <div key={`h:${g}`} className="truncate px-2 pb-0.5 pt-1.5 text-[10.5px] font-medium text-ac-muted" title={g || undefined}>
              {g ? g.split("/").pop() : "No project"}
            </div>
          ),
          ...rowsOf(g).map((s) => (
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
          />
          )),
        ])}
        {done > 0 && (
          <div className="mt-0.5 flex h-7 items-center gap-2 px-2.5 text-[11.5px] text-ac-muted">
            <button type="button" onClick={onDoneToday} className="inline-flex items-center gap-2 hover:text-ac-text">
              <ChevronRight className="size-3" /> Done today {done}
            </button>
            <button type="button" onClick={onCleanUp} title="Removes worktrees whose PR merged; dirty ones are skipped" className="ml-auto hover:text-ac-text">
              Clean up
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
