/**
 * The v3 window frame (spec §4): title bar, the left and right stripes, and the
 * layout that holds the Sessions window, the workbench and one right tool
 * window. Adapted from the reference boards; data and actions come in as props.
 *
 * Tone order from outside in: rail (title bar, stripes), panel (tool windows),
 * bg (workbench). Dividers are full-height 1 px lines.
 */

import { useCallback, useState, type ReactNode } from "react";
import { Archive, Bell, CalendarCheck, FileDiff, History, Inbox, Layers, Library, ListTree, Network, PanelLeft, Plus, Search, Settings, Swords, TriangleAlert, Users, Gavel, Wrench } from "lucide-react";
import type { RunKind } from "./runs.js";
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
  notifications = 0,
  historyOpen,
  onHistory,
  onSearch,
  onStart,
  onSettings,
  onInbox,
  onRestart,
  onSettingsMenu,
}: {
  health: "ready" | "down";
  /** Shown only while the Sessions window is hidden (focus mode); null otherwise. */
  inbox: InboxPill | null;
  inboxOpen?: boolean;
  /** What waits for you, on the bell before Settings (owner, 2026-11-24, as in v2); 0 = no badge. */
  notifications?: number;
  historyOpen?: boolean;
  /** The History sheet (as v2); absent: no button. */
  onHistory?: () => void;
  onSearch: () => void;
  onStart: () => void;
  /** `newTab`: ⌘/Ctrl-click asks for a tab of its own; else Settings opens in the main tab (owner, 2026-11-26). */
  onSettings: (newTab?: boolean) => void;
  onInbox: () => void;
  onRestart: () => void;
  /** Right click on Settings: Open, Open in new tab. */
  onSettingsMenu?: (at: { x: number; y: number }) => void;
}) {
  return (
    <header data-tauri-drag-region className="relative flex h-11 shrink-0 items-center gap-2 border-b border-ac-line bg-ac-rail pl-[84px] pr-3">
      <AppLogo className="pointer-events-none size-6" />
      <span className="pointer-events-none mr-2 text-[13px] font-semibold text-ac-text">Agent Switch</span>
      <div data-tauri-drag-region className="flex flex-1 justify-center self-stretch items-center">
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
      {/* History, then the bell, then Settings — the order v2 has them in. */}
      {onHistory && (
        <IconButton label="History" data-popover-trigger="" aria-pressed={!!historyOpen} active={!!historyOpen} onClick={onHistory}>
          <History />
        </IconButton>
      )}
      {/* The bell, as in v2: always there, opens Needs you and what finished today. */}
      <IconButton label="Notifications" data-popover-trigger="" aria-pressed={!!inboxOpen} active={!!inboxOpen} badge={notifications ? (notifications > 9 ? "9+" : notifications) : undefined} onClick={onInbox}>
        <Bell />
      </IconButton>
      <IconButton
        label="Settings  ⌘,"
        onClick={(e) => onSettings(e.metaKey || e.ctrlKey)}
        onAuxClick={(e) => e.button === 1 && (e.preventDefault(), onSettings(true))}
        onContextMenu={onSettingsMenu && ((e) => (e.preventDefault(), onSettingsMenu({ x: e.clientX, y: e.clientY })))}
      >
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
  /** Accent count in the top-right corner: how many of these run now (0: none shown). */
  badge?: number;
  /** Sits in the group pinned to the stripe's bottom. */
  bottom?: boolean;
  /** A short rule above it: a new group starts. */
  gap?: boolean;
}

export function Stripe({
  side,
  items,
  active,
  why,
  onSelect,
  onMenu,
}: {
  side: "left" | "right";
  items: StripeItem[];
  active?: string | readonly string[] | null;
  /** Why no button can act here (a page tab has no session); absent: they can. */
  why?: string | null;
  /** `newTab`: ⌘/Ctrl-click or a middle click asks for a tab of its own (owner, 2026-11-26). */
  onSelect: (id: string, newTab?: boolean) => void;
  /** Right click on a page button: its menu (Open, Open in new tab), at the pointer. */
  onMenu?: (id: string, at: { x: number; y: number }) => void;
}) {
  const button = (it: StripeItem) => [it.gap ? <span key={`gap:${it.id}`} aria-hidden data-stripe-gap="" className="my-1 h-px w-6 bg-ac-line" /> : null, one(it)];
  const one = (it: StripeItem) => {
    const on = !why && (Array.isArray(active) ? active.includes(it.id) : it.id === active);
    const label = it.badge ? `${it.label.trim()} · ${it.badge} running` : it.label;
    return (
      <button
        key={it.id}
        type="button"
        title={why ? `${it.label.trim()} · ${why}` : label}
        aria-label={label}
        aria-pressed={on}
        aria-disabled={why ? true : undefined}
        onClick={why ? undefined : (e) => onSelect(it.id, e.metaKey || e.ctrlKey)}
        onAuxClick={why || !onMenu || it.id === "sessions" ? undefined : (e) => e.button === 1 && (e.preventDefault(), onSelect(it.id, true))}
        onContextMenu={why || !onMenu || it.id === "sessions" ? undefined : (e) => (e.preventDefault(), onMenu(it.id, { x: e.clientX, y: e.clientY }))}
        className={cn("relative inline-flex size-9 items-center justify-center rounded-md [&_svg]:size-[18px]", on ? "bg-ac-raise text-ac-text" : why ? "cursor-not-allowed text-ac-muted opacity-50" : "text-ac-muted hover:bg-ac-raise hover:text-ac-text")}
      >
        {on && <Marker />}
        {it.icon}
        {it.dot && <span aria-hidden className="absolute right-1 top-1 size-2 rounded-full bg-ac-warn" />}
        {!!it.badge && (
          <span aria-hidden data-stripe-badge="" className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-ac-brand px-1 text-center text-[10px] font-semibold leading-4 tabular-nums text-ac-on-color">
            {it.badge > 9 ? "9+" : it.badge}
          </span>
        )}
      </button>
    );
  };
  return (
    <nav
      aria-label={side === "left" ? "Tool windows" : "Session panels"}
      className={cn("flex w-11 shrink-0 flex-col items-center gap-1 bg-ac-rail py-2", side === "left" ? "border-r border-ac-line" : "border-l border-ac-line")}
    >
      {items.filter((it) => !it.bottom).map(button)}
      {items.some((it) => it.bottom) && <div className="mt-auto flex flex-col items-center gap-1">{items.filter((it) => it.bottom).map(button)}</div>}
    </nav>
  );
}

/** Left stripe: Sessions is the tool window; the rest open as page tabs. */
export function leftItems(needsYouHidden: boolean, running: Record<RunKind, number> = { arena: 0, council: 0, panel: 0 }): StripeItem[] {
  return [
    { id: "sessions", label: "Sessions  ⌘B", icon: <ListTree />, dot: needsYouHidden },
    { id: "library", label: "Library", icon: <Library /> },
    { id: "accounts", label: "Accounts", icon: <Layers /> },
    { id: "tools", label: "Tools", icon: <Wrench /> },
    // Ended sessions, one click from anywhere (owner, 2026-11-25): All sessions on that tab; no count.
    { id: "done-today", label: "Done today", icon: <CalendarCheck />, gap: true },
    { id: "older", label: "Older", icon: <Archive /> },
    // Bottom (owner, 2026-11-25): what runs across sessions, each with its running count — Councils, Arenas, Panels.
    { id: "councils", label: "Councils", icon: <Users />, badge: running.council, bottom: true },
    { id: "arenas", label: "Arenas", icon: <Swords />, badge: running.arena, bottom: true },
    { id: "panels", label: "Panels", icon: <Gavel />, badge: running.panel, bottom: true },
  ];
}

export function rightItems(blocker: boolean): StripeItem[] {
  return [
    { id: "summary", label: "Summary  ⌘I", icon: <PanelLeft className="rotate-180" />, dot: blocker },
    { id: "changes", label: "Changes", icon: <FileDiff /> },
    { id: "children", label: "Children", icon: <Network /> },
  ];
}

export type RightWindow = "summary" | "changes" | "children";
export type PageId = "library" | "accounts" | "tools" | "settings" | "arenas" | "councils" | "panels";

/**
 * Which tool windows are open. The Sessions window shows by default; clicking
 * its button while shown hides it (focus mode). Only one right window at a
 * time, closed by default; clicking the open one closes it. Page buttons open
 * page tabs (the caller's `onPage`). Nothing opens on its own.
 */
export function useFrame(onPage: (p: PageId, newTab?: boolean) => void) {
  const [sessionsShown, setSessionsShown] = useState(true);
  const [right, setRight] = useState<RightWindow | null>(null);
  const selectLeft = useCallback(
    (id: string, newTab?: boolean) => {
      if (id === "sessions") setSessionsShown((v) => !v);
      else onPage(id as PageId, newTab);
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
  rightWhy,
  sessionsWindow,
  centre,
  rightWindow,
  overlay,
  actions,
  historyOpen,
  running,
  activePage,
  onPageMenu,
}: {
  frame: ReturnType<typeof useFrame>;
  health: "ready" | "down";
  inbox: InboxPill;
  inboxOpen?: boolean;
  /** Something waits for the user: the Sessions button dots while the window is hidden. */
  needsYou: boolean;
  /** The active session has a blocker: the Summary button dots while Summary is closed. */
  blocker: boolean;
  /** Why the session panels cannot open (a page tab is active); absent: they can. */
  rightWhy?: string | null;
  sessionsWindow: ReactNode;
  centre: ReactNode;
  rightWindow: ReactNode;
  overlay?: ReactNode;
  actions: { onSearch: () => void; onStart: () => void; onSettings: (newTab?: boolean) => void; onInbox: () => void; onRestart: () => void; onHistory?: () => void };
  historyOpen?: boolean;
  /** Arenas, councils, panels running now: the bottom stripe badges. */
  running?: Record<RunKind, number>;
  /** The page tab in front, so its stripe button reads as pressed. */
  activePage?: string | null;
  /** Right click on a left-stripe page button (or on Settings): Open, Open in new tab. */
  onPageMenu?: (id: string, at: { x: number; y: number }) => void;
}) {
  return (
    <div data-v3-shell className="relative flex h-full min-h-0 flex-col bg-ac-bg">
      <TitleBar health={health} inbox={frame.sessionsShown ? null : inbox} inboxOpen={inboxOpen} notifications={inbox.count} historyOpen={historyOpen} onSettingsMenu={onPageMenu && ((at) => onPageMenu("settings", at))} {...actions} />
      <div className="flex min-h-0 flex-1">
        <Stripe side="left" items={leftItems(!frame.sessionsShown && needsYou, running)} active={[...(frame.sessionsShown ? ["sessions"] : []), ...(activePage && ["arenas", "councils", "panels"].includes(activePage) ? [activePage] : [])]} onSelect={frame.selectLeft} onMenu={onPageMenu} />
        {frame.sessionsShown && sessionsWindow}
        {centre}
        {frame.right && !rightWhy && rightWindow}
        <Stripe side="right" items={rightItems(blocker && frame.right !== "summary")} active={frame.right} why={rightWhy} onSelect={frame.selectRight} />
      </div>
      {overlay}
    </div>
  );
}
