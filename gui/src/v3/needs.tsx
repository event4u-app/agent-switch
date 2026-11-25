/**
 * The Needs-you zone (spec §5.1) and its rows, on `agent-switch needs --json`.
 * One queue, most urgent first; the top item is open, ⌘J moves a focus through
 * it; at most three rows, then "N more ›"; one row for a long absence; hidden
 * when nothing waits. Adapted from the reference boards' NeedRow.
 */

import type { ReactNode } from "react";
import { CircleX, Download, Gauge, Hand, LogIn, MessageCircleQuestion, TriangleAlert } from "lucide-react";
import { cn } from "../lib/utils.js";
import { Act, Marker } from "./kit.js";

/** One item as `needs --json` gives it (src/attention.ts). */
export interface NeedItem {
  id: string;
  kind: "approval" | "question" | "limit" | "ci" | "signin" | "pace" | "update";
  subject: string;
  who: string;
  what: string;
  detail?: string;
  verb: string;
  since: string;
  version: string;
  /** The session an item about a PR acts on (a fix goes there). */
  session?: string;
  /** A CI item's own kind: failing checks by name, or a merge conflict. */
  ci?: { state: "failing" | "conflict"; checks: string[] };
}

export interface AwayDigest {
  finishedTurns: number;
  stoppedOnError: number;
  resolved: number;
  mergedPrs: number;
  ciBreaks: number;
}

const ICON: Record<NeedItem["kind"], ReactNode> = {
  approval: <Hand />,
  question: <MessageCircleQuestion />,
  limit: <TriangleAlert />,
  ci: <CircleX />,
  signin: <LogIn />,
  pace: <Gauge />,
  update: <Download />,
};

/** The keys a focused item answers to (spec §5.1). `always` false: the
 *  approval can only be answered from outside its chat, where "always" is never
 *  offered. Pure. */
export function keysFor(n: NeedItem, always = true): string | null {
  if (n.verb === "Focus terminal") return "↵ focus terminal · L later";
  if (n.verb === "Open session") return "↵ open session · L later";
  if (n.kind === "approval") return [n.verb === "Allow" ? "↵ once" : `↵ ${n.verb.toLowerCase()} · Y once`, always ? "⇧↵ always" : null, "⌫ deny", "L later"].filter(Boolean).join(" · ");
  if (n.kind === "question") return "↵ reply · Y yes · L later";
  return "↵ " + n.verb.toLowerCase() + " · L later";
}

/** An approval or question that is answered where its session runs, never from here. Pure. */
export const answeredThere = (n: NeedItem) => n.verb === "Focus terminal" || n.verb === "Open session";

const warn = (n: NeedItem) => n.kind === "approval" || n.kind === "question" || n.kind === "limit" || n.kind === "ci";

export function NeedRow({ n, top, focused, always = true, onVerb }: { n: NeedItem; top?: boolean; focused?: boolean; always?: boolean; onVerb: (n: NeedItem) => void }) {
  const open = top || focused;
  return (
    // A focused item holds DOM focus (tabIndex -1), so its keys never reach a focused terminal.
    <div data-need={n.id} tabIndex={focused ? -1 : undefined} className={cn("relative rounded-md px-2 outline-none", open ? "py-1.5" : "py-1", focused ? "bg-ac-raise" : "hover:bg-ac-raise")} title={open ? undefined : n.detail}>
      {focused && <Marker tone="warn" />}
      <div className="flex h-6 items-center gap-2">
        <span className={cn("shrink-0 [&_svg]:size-3.5", warn(n) ? "text-ac-warn-text" : "text-ac-muted")}>{ICON[n.kind]}</span>
        <span className="min-w-0 flex-1 truncate text-[12.5px]">
          <span className="text-ac-text">{n.who}</span> <span className="text-ac-muted">{n.what}</span>
        </span>
        {/* One frame, the row's own height (owner, 2026-11-25): no focus ring around the outlined button, which
            read as a double frame and, at 28 px in a 24 px line, sat too high. The focused row says itself
            (marker, fill, key hints); its button takes the accent tint. */}
        <Act kind={open ? "accent" : "ghost"} className={cn("h-6", focused && "bg-ac-brand-tint")} onClick={() => onVerb(n)}>
          {n.verb}
        </Act>
      </div>
      {open && n.detail && <div className="truncate pl-[22px] font-ac-mono text-[11px] text-ac-muted">{n.detail}</div>}
      {focused && <div className="mt-0.5 pl-[22px] text-[10.5px] text-ac-muted">{keysFor(n, always)}</div>}
    </div>
  );
}

export const MAX_ROWS = 3;

export function NeedsZone({
  items,
  away,
  focusedId,
  onVerb,
  onMore,
  onAway,
  tray,
  always,
  full,
}: {
  /** The window's "For you" tab (owner, 2026-11-25): every item, no head (the tab names it), no "N more". */
  full?: boolean;
  /** Whether an approval can be answered "always" here (its chat runs in this window); all when absent. */
  always?: (n: NeedItem) => boolean;
  /** The tray card's variant (board "tray"): a 24 px head without the ⌘J hint. */
  tray?: boolean;
  items: NeedItem[];
  away: AwayDigest | null;
  focusedId?: string | null;
  onVerb: (n: NeedItem) => void;
  onMore: () => void;
  onAway: () => void;
}) {
  if (items.length === 0 && !away) return full ? <p className="px-3.5 py-2 text-[12px] text-ac-muted">Nothing needs you right now.</p> : null;
  // A focused item further down the queue is shown in place of the last row, so ⌘J is always visible.
  const shown = full ? items : shownNeeds(items, focusedId);
  const updates = away ? away.finishedTurns + away.stoppedOnError + away.resolved + away.mergedPrs + away.ciBreaks : 0;
  return (
    <section aria-label="Needs you" className={tray ? "pt-1" : full ? "pt-1" : undefined}>
      {!full && <div className={cn("flex items-center gap-2 bg-ac-panel px-3.5", tray ? "h-6" : "sticky top-0 z-[1] h-8")}>
        <span className="text-[11px] font-semibold text-ac-soft">Needs you</span>
        <span className="text-[11px] text-ac-muted">{items.length}</span>
        {!tray && <span className="ml-auto font-ac-mono text-[10.5px] text-ac-muted">⌘J</span>}
      </div>}
      <div className={full ? "px-2.5" : "px-1.5"}>
        {away && updates > 0 && (
          <button type="button" onClick={onAway} className="flex h-6 w-full items-center rounded-md px-2 text-left text-[12px] text-ac-soft hover:bg-ac-raise">
            While you were away · {updates} updates ›
          </button>
        )}
        {shown.map((n, i) => (
          <NeedRow key={n.id} n={n} top={i === 0 && !focusedId} focused={n.id === focusedId} always={always?.(n) ?? true} onVerb={onVerb} />
        ))}
        {!full && items.length > MAX_ROWS && (
          <button type="button" onClick={onMore} className="h-6 px-2 text-[11px] text-ac-muted hover:text-ac-text">
            {items.length - MAX_ROWS} more ›
          </button>
        )}
      </div>
    </section>
  );
}

/** The rows the zone shows: the first `MAX_ROWS`, a focused item further down in place of the last. Pure. */
export function shownNeeds(items: readonly NeedItem[], focusedId?: string | null): NeedItem[] {
  const shown = items.slice(0, MAX_ROWS);
  const focused = focusedId ? items.find((i) => i.id === focusedId) : undefined;
  if (focused && !shown.includes(focused)) shown[shown.length - 1] = focused;
  return shown;
}

/** The session an item is about: a PR item names it; an approval, question or CI item's subject is its key. Pure. */
export const needSession = (n: NeedItem): string | null => n.session ?? (n.kind === "approval" || n.kind === "question" || n.kind === "ci" ? n.subject : null);

/** ⌘J: the next item after the focused one, wrapping; the first when none is focused. Pure. */
export function nextFocus(items: readonly NeedItem[], current: string | null | undefined): string | null {
  if (!items.length) return null;
  const i = items.findIndex((n) => n.id === current);
  return items[(i + 1) % items.length].id;
}
