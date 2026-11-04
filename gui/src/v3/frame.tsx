/**
 * The v3 window frame (spec §4): title bar, the left and right stripes, and the
 * layout that holds the Sessions window, the workbench and one right tool
 * window. Adapted from the reference boards; data and actions come in as props.
 *
 * Tone order from outside in: rail (title bar, stripes), panel (tool windows),
 * bg (workbench). Dividers are full-height 1 px lines.
 */

import { useCallback, useState, type ReactNode } from "react";
import { FileDiff, GitBranch, Inbox, Layers, Library, ListTree, PanelLeft, Plus, Search, Settings, TriangleAlert, Wrench } from "lucide-react";
import { cn } from "../lib/utils.js";
import { AppLogo } from "../ui/AppLogo.js";
import { Button, IconButton } from "../ui/Button.js";
import { Kbd } from "../ui/Typography.js";
import { Marker } from "./kit.js";

export interface InboxPill {
  count: number;
  /** Any CI failing among the items: the pill turns alert. */
  ciFailing: boolean;
}

export function TitleBar({
  health,
  inbox,
  inboxOpen,
  onSearch,
  onStart,
  onSettings,
  onInbox,
  onRestart,
}: {
  health: "ready" | "down";
  /** Shown only while the Sessions window is hidden (focus mode); null otherwise. */
  inbox: InboxPill | null;
  inboxOpen?: boolean;
  onSearch: () => void;
  onStart: () => void;
  onSettings: () => void;
  onInbox: () => void;
  onRestart: () => void;
}) {
  return (
    <header className="relative flex h-11 shrink-0 items-center gap-2 border-b border-ac-line bg-ac-rail pl-[84px] pr-3">
      <AppLogo className="size-6" />
      <span className="mr-2 text-[13px] font-semibold text-ac-text">Agent Switch</span>
      <div className="flex flex-1 justify-center">
        <button type="button" onClick={onSearch} className="inline-flex h-7 w-[420px] items-center gap-2 rounded-md border border-ac-line2 bg-ac-bg px-2.5 text-xs text-ac-muted">
          <Search className="size-3.5" />
          <span className="flex-1 truncate text-left">Go to session, account, branch, PR, or run a command…</span>
          <Kbd>⌘K</Kbd>
        </button>
      </div>
      {health === "down" && (
        <button type="button" onClick={onRestart} className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md bg-ac-alert-tint px-2 text-xs font-medium text-ac-alert-text">
          <TriangleAlert className="size-3.5" /> Engine stopped
        </button>
      )}
      {inbox && (
        <button
          type="button"
          title="Needs you · ⌘J jumps to the next one"
          data-popover-trigger=""
          aria-pressed={!!inboxOpen}
          onClick={onInbox}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 text-xs font-medium",
            inboxOpen ? "border-ac-warn bg-ac-warn-tint text-ac-warn-text" : inbox.ciFailing ? "border-transparent bg-ac-alert-tint text-ac-alert-text" : "border-transparent bg-ac-warn-tint text-ac-warn-text",
          )}
        >
          <Inbox className="size-3.5" /> {inbox.count}
        </button>
      )}
      <Button variant="primary" size="sm" title="New session  ⌘N" onClick={onStart}>
        <Plus /> Start session
      </Button>
      <IconButton label="Settings  ⌘," onClick={onSettings}>
        <Settings />
      </IconButton>
    </header>
  );
}

export interface StripeItem {
  id: string;
  label: string;
  icon: ReactNode;
  /** Amber corner dot: something in there needs you while it is hidden. */
  dot?: boolean;
}

export function Stripe({ side, items, active, onSelect }: { side: "left" | "right"; items: StripeItem[]; active?: string | null; onSelect: (id: string) => void }) {
  return (
    <nav
      aria-label={side === "left" ? "Tool windows" : "Session panels"}
      className={cn("flex w-11 shrink-0 flex-col items-center gap-1 bg-ac-rail py-2", side === "left" ? "border-r border-ac-line" : "border-l border-ac-line")}
    >
      {items.map((it) => {
        const on = it.id === active;
        return (
          <button
            key={it.id}
            type="button"
            title={it.label}
            aria-label={it.label}
            aria-pressed={on}
            onClick={() => onSelect(it.id)}
            className={cn("relative inline-flex size-9 items-center justify-center rounded-md [&_svg]:size-[18px]", on ? "bg-ac-raise text-ac-text" : "text-ac-muted hover:bg-ac-raise hover:text-ac-text")}
          >
            {on && <Marker />}
            {it.icon}
            {it.dot && <span aria-hidden className="absolute right-1 top-1 size-2 rounded-full bg-ac-warn" />}
          </button>
        );
      })}
    </nav>
  );
}

/** Left stripe: Sessions is the tool window; the rest open as page tabs. */
export function leftItems(needsYouHidden: boolean): StripeItem[] {
  return [
    { id: "sessions", label: "Sessions  ⌘B", icon: <ListTree />, dot: needsYouHidden },
    { id: "library", label: "Library", icon: <Library /> },
    { id: "accounts", label: "Accounts", icon: <Layers /> },
    { id: "tools", label: "Tools", icon: <Wrench /> },
  ];
}

export function rightItems(blocker: boolean): StripeItem[] {
  return [
    { id: "summary", label: "Summary  ⌘I", icon: <PanelLeft className="rotate-180" />, dot: blocker },
    { id: "changes", label: "Changes", icon: <FileDiff /> },
    { id: "children", label: "Children", icon: <GitBranch /> },
  ];
}

export type RightWindow = "summary" | "changes" | "children";
export type PageId = "library" | "accounts" | "tools" | "settings";

/**
 * Which tool windows are open. The Sessions window shows by default; clicking
 * its button while shown hides it (focus mode). Only one right window at a
 * time, closed by default; clicking the open one closes it. Page buttons open
 * page tabs (the caller's `onPage`). Nothing opens on its own.
 */
export function useFrame(onPage: (p: PageId) => void) {
  const [sessionsShown, setSessionsShown] = useState(true);
  const [right, setRight] = useState<RightWindow | null>(null);
  const selectLeft = useCallback(
    (id: string) => {
      if (id === "sessions") setSessionsShown((v) => !v);
      else onPage(id as PageId);
    },
    [onPage],
  );
  const selectRight = useCallback((id: string) => setRight((cur) => (cur === id ? null : (id as RightWindow))), []);
  return { sessionsShown, right, selectLeft, selectRight, setSessionsShown, setRight };
}

export function Shell({
  frame,
  health,
  inbox,
  inboxOpen,
  needsYou,
  blocker,
  sessionsWindow,
  centre,
  rightWindow,
  overlay,
  actions,
}: {
  frame: ReturnType<typeof useFrame>;
  health: "ready" | "down";
  inbox: InboxPill;
  inboxOpen?: boolean;
  /** Something waits for the user: the Sessions button dots while the window is hidden. */
  needsYou: boolean;
  /** The active session has a blocker: the Summary button dots while Summary is closed. */
  blocker: boolean;
  sessionsWindow: ReactNode;
  centre: ReactNode;
  rightWindow: ReactNode;
  overlay?: ReactNode;
  actions: { onSearch: () => void; onStart: () => void; onSettings: () => void; onInbox: () => void; onRestart: () => void };
}) {
  return (
    <div data-v3-shell className="relative flex h-full min-h-0 flex-col bg-ac-bg">
      <TitleBar health={health} inbox={frame.sessionsShown ? null : inbox} inboxOpen={inboxOpen} {...actions} />
      <div className="flex min-h-0 flex-1">
        <Stripe side="left" items={leftItems(!frame.sessionsShown && needsYou)} active={frame.sessionsShown ? "sessions" : null} onSelect={frame.selectLeft} />
        {frame.sessionsShown && sessionsWindow}
        {centre}
        {frame.right && rightWindow}
        <Stripe side="right" items={rightItems(blocker && frame.right !== "summary")} active={frame.right} onSelect={frame.selectRight} />
      </div>
      {overlay}
    </div>
  );
}
