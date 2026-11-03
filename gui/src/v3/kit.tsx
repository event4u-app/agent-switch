/**
 * v3 kit — the few primitives every board shares, so one element looks the
 * same everywhere (UX review round 2):
 *  - Chip: three kinds only (status = tinted, meta = outlined, tag = plain).
 *  - AccountMark: identity as a coloured tick, never a dot (dots = state).
 *  - Act: action buttons with an accent budget — filled only for the one
 *    primary of a surface; everything else outline/ghost.
 *  - PageHeader, BatchBar, Later, Disclosure.
 */
import type { ReactNode } from "react";
import { Archive, ChevronDown, ChevronRight, Clock, FolderMinus, Pin, X } from "lucide-react";
import { cn } from "../lib/utils.js";
import { identityColor } from "../ui/AccountDot.js";
import { Button, IconButton } from "../ui/Button.js";
import type { IdentityColor } from "../vm/types.js";

type Tone = "ok" | "warn" | "alert" | "info";
const STATUS: Record<Tone, string> = {
  ok: "bg-ac-ok-tint text-ac-ok-text",
  warn: "bg-ac-warn-tint text-ac-warn-text",
  alert: "bg-ac-alert-tint text-ac-alert-text",
  info: "bg-ac-info-tint text-ac-info-text",
};

export function Chip({ kind = "meta", tone = "warn", icon, children, title }: { kind?: "status" | "meta" | "tag"; tone?: Tone; icon?: ReactNode; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded px-1.5 text-[11px] font-medium leading-none [&_svg]:size-3",
        kind === "status" && STATUS[tone],
        kind === "meta" && "border border-ac-line2 text-ac-soft",
        kind === "tag" && "bg-ac-raise text-ac-soft",
      )}
    >
      {icon}
      {children}
    </span>
  );
}

/** Corner rule (one scale, everywhere):
 *  0      — window regions that tile edge to edge (title bar, panels, tab strip, terminal)
 *  4px    — small marks: chips, kbd, checkboxes, monograms  (`rounded`)
 *  6px    — everything you click: buttons, rows, tabs, inputs, menu items  (`rounded-md`)
 *  10px   — containers inside a page: cards, boxes, bars  (`rounded-[10px]`)
 *  12px   — floating layers: menus, popovers, dialogs  (`rounded-xl`)
 *  pill   — only dots and meters
 *  State language: hover / keyboard cursor = raise fill only; chosen option in a list = check;
 *  where you are (tab, row, rail button, nav item) = the Marker.
 *  Selection is always the same Marker: a rounded frame whose leading edge is the accent — left on items, top on tabs, never an inset shadow. */
export function Marker({ side = "left", tone = "brand" }: { side?: "left"; tone?: "brand" | "warn" }) {
  const lead = tone === "warn" ? "border-l-ac-warn" : "border-l-ac-brand";
  void side;
  // Same frame as the active tab, turned 90°: a 1px line around the rounded item,
  // with a 2px accent leading edge that follows the corners.
  return <span aria-hidden className={cn("pointer-events-none absolute inset-0 rounded-md border border-l-2 border-ac-line", lead)} />;
}

/** Account identity: a 3×12 tick in the account colour (never a dot). */
export function AccountMark({ color, className }: { color: IdentityColor; className?: string }) {
  return <span aria-hidden className={cn("inline-block h-3 w-[3px] shrink-0 rounded-full", className)} style={{ background: identityColor(color) }} />;
}

/** Action button. `primary` = the one filled button of a surface; `accent` = outline in accent text. */
export function Act({
  kind = "secondary",
  children,
  className,
  title,
  kbd,
  onClick,
  disabled,
}: {
  kind?: "primary" | "accent" | "secondary" | "ghost" | "danger";
  children: ReactNode;
  className?: string;
  title?: string;
  kbd?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  if (kind === "accent")
    return (
      <button
        type="button"
        title={title}
        onClick={onClick}
        disabled={disabled}
        className={cn(
          "inline-flex h-7 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-ac-brand-line px-2.5 text-xs font-medium text-ac-brand-text hover:bg-ac-brand-tint [&_svg]:size-3.5",
          className,
        )}
      >
        {children}
        {kbd && <span className="font-ac-mono text-[10px] opacity-70">{kbd}</span>}
      </button>
    );
  return (
    <Button size="sm" variant={kind} className={cn("[&_svg]:size-3.5", className)} title={title} onClick={onClick} disabled={disabled}>
      {children}
      {kbd && <span className="font-ac-mono text-[10px] opacity-70">{kbd}</span>}
    </Button>
  );
}

/** One page header for every page (Accounts, Library, Sessions, Review, Settings, Tools). */
export function PageHeader({ eyebrow, title, sub, actions }: { eyebrow?: string; title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs text-ac-muted">{eyebrow}</div>}
        <h1 className="text-[20px] font-semibold leading-7 tracking-tight text-ac-text">{title}</h1>
        {sub && <p className="mt-1 text-[13px] text-ac-muted">{sub}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** The same batch bar in the Sessions window and the sessions table. */
export interface BatchActions {
  onClear: () => void;
  onPin: () => void;
  onArchive: () => void;
  onClean: () => void;
  onEnd: () => void;
}

export function BatchBar({ count, compact, className, actions }: { count: number; compact?: boolean; className?: string; actions: BatchActions }) {
  return (
    <div className={cn("flex items-center gap-1.5 rounded-[10px] border border-ac-line2 bg-ac-raise px-2 py-1.5", className)}>
      <IconButton label="Clear selection  Esc" className="size-6" onClick={actions.onClear}>
        <X />
      </IconButton>
      <span className="mr-auto whitespace-nowrap text-xs text-ac-text">{count} selected</span>
      {compact ? (
        <>
          <IconButton label="Pin" className="size-7" onClick={actions.onPin}>
            <Pin />
          </IconButton>
          <IconButton label="Archive" className="size-7" onClick={actions.onArchive}>
            <Archive />
          </IconButton>
          <IconButton label="Clean worktrees (merged only; dirty ones are skipped)" className="size-7" onClick={actions.onClean}>
            <FolderMinus />
          </IconButton>
        </>
      ) : (
        <>
          <Act onClick={actions.onPin}>
            <Pin /> Pin
          </Act>
          <Act onClick={actions.onArchive}>
            <Archive /> Archive
          </Act>
          <Act title="Removes worktrees whose PR merged; dirty ones are skipped" onClick={actions.onClean}>
            <FolderMinus /> Clean worktrees
          </Act>
        </>
      )}
      <Act kind="danger" onClick={actions.onEnd}>
        End…
      </Act>
    </div>
  );
}

export function Later({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" title="Later (L) — snooze until it changes" onClick={onClick} className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-ac-muted hover:bg-ac-raise hover:text-ac-text">
      <Clock className="size-3.5" />
    </button>
  );
}

export function Disclosure({ open, label, children, onToggle }: { open?: boolean; label: ReactNode; children?: ReactNode; onToggle: () => void }) {
  return (
    <div>
      <button type="button" aria-expanded={!!open} onClick={onToggle} className="inline-flex items-center gap-1 text-xs text-ac-muted hover:text-ac-text">
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        {label}
      </button>
      {open && <div className="mt-1.5">{children}</div>}
    </div>
  );
}

/** Small caps section label — the only label style inside tool windows and sheets. */
export function Label({ children, aside, className }: { children: ReactNode; aside?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-1.5 flex h-5 items-center gap-2", className)}>
      <span className="ac-caps">{children}</span>
      {aside && <span className="ml-auto text-[11px] text-ac-muted">{aside}</span>}
    </div>
  );
}

/** Percent/time formatting: "94%", "5h", "1h 18m" — one format everywhere (spec §3.6). */
export const pct = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n)}%`);

/** "45s", "5m", "5h", "1h 18m", "2d 5h": the two largest units, the second only when it is not zero. */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return h ? `${d}d ${h}h` : `${d}d`;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  if (m) return `${m}m`;
  return `${s}s`;
}

/** "↻ 1h 18m" until a window resets. */
export const resetIn = (ms: number) => `↻ ${duration(ms)}`;

/** "14m old" for stale data; "checked 1m ago" for a fresh reading. */
export const age = (ms: number) => `${duration(ms)} old`;
export const checkedAgo = (ms: number) => (ms < 60_000 ? "checked just now" : `checked ${duration(ms)} ago`);
