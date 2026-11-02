/**
 * The Needs-you zone (spec §5.1) and its rows, on `agent-switch needs --json`.
 * One queue, most urgent first; the top item is open, ⌘J moves a focus through
 * it; at most three rows, then "N more ›"; one row for a long absence; hidden
 * when nothing waits. Adapted from the reference boards' NeedRow.
 */

import type { ReactNode } from "react";
import { CircleX, Download, Hand, LogIn, MessageCircleQuestion, TriangleAlert } from "lucide-react";
import { cn } from "../lib/utils.js";
import { Act, Marker } from "./kit.js";

/** One item as `needs --json` gives it (src/attention.ts). */
export interface NeedItem {
  id: string;
  kind: "approval" | "question" | "limit" | "ci" | "signin" | "update";
  subject: string;
  who: string;
  what: string;
  detail?: string;
  verb: string;
  since: string;
  version: string;
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
  update: <Download />,
};

/** The keys a focused item answers to (spec §5.1). Pure. */
export function keysFor(n: NeedItem): string | null {
  if (n.verb === "Focus terminal") return "↵ focus terminal · L later";
  if (n.kind === "approval") return "↵ once · ⇧↵ always · ⌫ deny · L later";
  if (n.kind === "question") return "↵ reply · Y yes · L later";
  return "↵ " + n.verb.toLowerCase() + " · L later";
}

const warn = (n: NeedItem) => n.kind === "approval" || n.kind === "question" || n.kind === "limit" || n.kind === "ci";

export function NeedRow({ n, top, focused, onVerb }: { n: NeedItem; top?: boolean; focused?: boolean; onVerb: (n: NeedItem) => void }) {
  const open = top || focused;
  return (
    <div className={cn("relative rounded-md px-2", open ? "py-1.5" : "py-1", focused ? "bg-ac-raise" : "hover:bg-ac-raise")} title={open ? undefined : n.detail}>
      {focused && <Marker tone="warn" />}
      <div className="flex h-6 items-center gap-2">
        <span className={cn("shrink-0 [&_svg]:size-3.5", warn(n) ? "text-ac-warn-text" : "text-ac-muted")}>{ICON[n.kind]}</span>
        <span className="min-w-0 flex-1 truncate text-[12.5px]">
          <span className="text-ac-text">{n.who}</span> <span className="text-ac-muted">{n.what}</span>
        </span>
        <span className={cn("rounded-md", focused && "ring-2 ring-ac-brand ring-offset-2 ring-offset-[var(--ac-raise)]")}>
          <Act kind={open ? "accent" : "ghost"} onClick={() => onVerb(n)}>
            {n.verb}
          </Act>
        </span>
      </div>
      {open && n.detail && <div className="truncate pl-[22px] font-ac-mono text-[11px] text-ac-muted">{n.detail}</div>}
      {focused && <div className="mt-0.5 pl-[22px] text-[10.5px] text-ac-muted">{keysFor(n)}</div>}
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
}: {
  items: NeedItem[];
  away: AwayDigest | null;
  focusedId?: string | null;
  onVerb: (n: NeedItem) => void;
  onMore: () => void;
  onAway: () => void;
}) {
  if (items.length === 0 && !away) return null;
  const shown = items.slice(0, MAX_ROWS);
  // A focused item further down the queue is shown in place of the last row, so ⌘J is always visible.
  const focused = focusedId ? items.find((i) => i.id === focusedId) : undefined;
  if (focused && !shown.includes(focused)) shown[shown.length - 1] = focused;
  const updates = away ? away.finishedTurns + away.stoppedOnError + away.resolved + away.mergedPrs + away.ciBreaks : 0;
  return (
    <section aria-label="Needs you">
      <div className="sticky top-0 flex h-8 items-center gap-2 bg-ac-panel px-3">
        <span className="text-[11px] font-semibold text-ac-soft">Needs you</span>
        <span className="text-[11px] text-ac-muted">{items.length}</span>
        <span className="ml-auto font-ac-mono text-[10.5px] text-ac-muted">⌘J</span>
      </div>
      <div className="px-1.5 pb-1">
        {away && updates > 0 && (
          <button type="button" onClick={onAway} className="flex h-6 w-full items-center rounded-md px-2 text-left text-[12px] text-ac-soft hover:bg-ac-raise">
            While you were away · {updates} updates ›
          </button>
        )}
        {shown.map((n, i) => (
          <NeedRow key={n.id} n={n} top={i === 0 && !focusedId} focused={n.id === focusedId} onVerb={onVerb} />
        ))}
        {items.length > MAX_ROWS && (
          <button type="button" onClick={onMore} className="px-2 text-[11px] text-ac-muted hover:text-ac-text">
            {items.length - MAX_ROWS} more ›
          </button>
        )}
      </div>
    </section>
  );
}

/** ⌘J: the next item after the focused one, wrapping; the first when none is focused. Pure. */
export function nextFocus(items: readonly NeedItem[], current: string | null | undefined): string | null {
  if (!items.length) return null;
  const i = items.findIndex((n) => n.id === current);
  return items[(i + 1) % items.length].id;
}
