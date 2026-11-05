/**
 * The workbench (spec §6): tab strip, session bar, blocker strip, the hosted
 * terminal, the view of a session in the user's own terminal, and the system
 * banner. Adapted from the reference boards; data and actions come in as props.
 */

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Brain, Check, ChevronDown, CircleX, Ellipsis, Lightbulb, Lock, MessageSquareText, Pin, SquareTerminal, TriangleAlert, X } from "lucide-react";
import { cn } from "../lib/utils.js";
import { IconButton } from "../ui/Button.js";
import { SessionStateIcon } from "../ui/SessionStateIcon.js";
import type { IdentityColor, SessionState } from "../vm/types.js";
import { Act, AccountMark } from "./kit.js";
import { Segmented } from "../ui/Segmented.js";
import { tone } from "./limits.js";
import { XtermBox } from "../redesign/screens/terminal-sheet.js";
import type { TermBackend } from "../terminal.js";
import type { SessionCache } from "../transforms.js";
import { sessionHints, type Hint } from "./hints.js";

// ---------- tab strip ----------

/** Tab: rounded top corners; the active one is framed with a 2 px accent top edge and joins the content below (spec §3.2). */
export const TAB = "relative -mb-px flex h-[33px] items-center gap-2 rounded-t-md border-x border-t-2 px-3 text-xs";
export const TAB_ON = "border-ac-line border-t-ac-brand bg-ac-bg text-ac-text";

export type TabItem = { kind: "page"; id: string; label: string; icon: ReactNode } | { kind: "session"; id: string; title: string; state: SessionState };

/** Pointer travel before a press on a tab becomes a drag. */
const DRAG_PX = 4;

export function TabStrip({
  tabs,
  activeId,
  onSelect,
  onClose,
  pinned,
  onMenu,
  onMove,
}: {
  tabs: TabItem[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  /** Pinned tabs: first, tinted, marked with a pin, no close button (owner request 2026-11-05). */
  pinned?: ReadonlySet<string>;
  /** Right click: the tab's menu at the pointer (window coordinates). */
  onMenu?: (id: string, at: { x: number; y: number }) => void;
  /** A tab dragged onto another one. */
  onMove?: (id: string, target: string, side: "before" | "after") => void;
}) {
  const isPin = (id: string) => !!pinned?.has(id);
  // Pinned first, then pages (spec §6.1), then sessions; the given order inside each.
  const rank = (t: TabItem) => (isPin(t.id) ? 0 : t.kind === "page" ? 1 : 2);
  const ordered = [...tabs].sort((a, b) => rank(a) - rank(b));
  const [drag, setDrag] = useState<{ id: string; x0: number; moving: boolean; over: { id: string; side: "before" | "after" } | null } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const moved = useRef(false);
  const dragging = !!drag;
  useEffect(() => {
    if (!dragging) return;
    const up = () => {
      const d = dragRef.current;
      if (d?.moving && d.over && d.over.id !== d.id) onMove?.(d.id, d.over.id, d.over.side);
      moved.current = !!d?.moving;
      setDrag(null);
    };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => (window.removeEventListener("pointerup", up), window.removeEventListener("pointercancel", up));
    // Bound for the length of one drag; onMove is read when it ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);
  let n = 0;
  return (
    <div role="tablist" className={cn("flex h-9 shrink-0 items-end gap-px border-b border-ac-line bg-ac-rail px-1", drag?.moving && "cursor-grabbing select-none")}>
      {ordered.map((t) => {
        const on = t.id === activeId;
        const pin = isPin(t.id);
        const idx = t.kind === "session" ? ++n : 0;
        const name = t.kind === "session" ? t.title : t.label;
        const dropAt = drag?.moving && drag.over?.id === t.id && drag.id !== t.id ? drag.over.side : null;
        return (
          <div
            key={t.id}
            role="tab"
            aria-selected={on}
            data-tab-id={t.id}
            data-pinned={pin || undefined}
            onClick={() => {
              // The click that ends a drag does not also select.
              if (moved.current) return void (moved.current = false);
              onSelect(t.id);
            }}
            onAuxClick={(e) => {
              // Middle click closes, like a browser — never a pinned tab.
              if (e.button === 1 && !pin) (e.preventDefault(), onClose(t.id));
            }}
            onContextMenu={(e) => {
              if (!onMenu) return;
              e.preventDefault();
              onMenu(t.id, { x: e.clientX, y: e.clientY });
            }}
            onPointerDown={(e) => {
              if (e.button !== 0 || !onMove || (e.target as HTMLElement).closest("button")) return;
              moved.current = false;
              setDrag({ id: t.id, x0: e.clientX, moving: false, over: null });
            }}
            onPointerMove={(e) => {
              const d = dragRef.current;
              if (!d) return;
              const moving = d.moving || Math.abs(e.clientX - d.x0) >= DRAG_PX;
              const r = e.currentTarget.getBoundingClientRect();
              const side = e.clientX < r.left + r.width / 2 ? "before" : "after";
              if (moving !== d.moving || d.over?.id !== t.id || d.over.side !== side) setDrag({ ...d, moving, over: { id: t.id, side } });
            }}
            title={`${name}${t.kind === "session" && idx <= 9 ? ` · ⌘${idx}` : ""}${pin ? " · pinned" : ""}`}
            className={cn(
              TAB,
              t.kind === "session" ? "group min-w-[140px] max-w-[220px] shrink" : "shrink-0",
              on ? TAB_ON : pin ? "border-transparent bg-ac-brand-tint text-ac-soft hover:text-ac-text" : "border-transparent text-ac-muted hover:bg-ac-raise hover:text-ac-text",
              on && pin && "bg-ac-brand-tint",
              drag?.moving && drag.id === t.id && "opacity-50",
            )}
          >
            {/* Where the dragged tab lands. */}
            {dropAt && <span aria-hidden data-drop={dropAt} className={cn("pointer-events-none absolute inset-y-1 w-0.5 rounded-full bg-ac-brand", dropAt === "before" ? "-left-px" : "-right-px")} />}
            {t.kind === "session" ? <SessionStateIcon state={t.state} /> : t.icon}
            <span className="truncate">{name}</span>
            {pin ? (
              // Pinned: no close button; it closes from its menu only.
              <span className="ml-auto inline-flex shrink-0 items-center gap-1">
                {t.kind === "session" && idx <= 9 && <span className="font-ac-mono text-[10px] text-ac-muted">⌘{idx}</span>}
                <Pin aria-label="Pinned" className="size-3 text-ac-brand-text" />
              </span>
            ) : t.kind === "session" ? (
              // The shortcut sits in the slot; hover or focus swaps it for the close button (spec §6.1: closing keeps the session).
              <span className="relative ml-auto inline-flex h-4 min-w-4 shrink-0 items-center justify-end">
                {idx <= 9 && <span className="font-ac-mono text-[10px] text-ac-muted group-hover:invisible group-focus-within:invisible">⌘{idx}</span>}
                <button type="button" aria-label={`Close ${t.title}`} onClick={(e) => (e.stopPropagation(), onClose(t.id))} className="absolute inset-y-0 right-0 inline-flex items-center rounded opacity-0 hover:bg-ac-raise focus-visible:opacity-100 group-hover:opacity-100">
                  <X className="size-3 text-ac-muted hover:text-ac-text" />
                </button>
              </span>
            ) : (
              <button type="button" aria-label={`Close ${t.label}`} onClick={(e) => (e.stopPropagation(), onClose(t.id))}>
                <X className="size-3 text-ac-muted" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------- session bar ----------

export interface BarSession {
  key: string;
  hosted: boolean;
  /** Chat exists from v3.1 on; until then the switch shows it, disabled. */
  chatAvailable: boolean;
  view: "terminal" | "chat";
  account: { name: string; color: IdentityColor; fiveH: number | null; protect: number };
  /** The model's display name ("Opus 4.7"); `modelId` is the raw id for the tooltip. */
  model: string | null;
  modelId?: string | null;
  thinking: string | null;
  contextPct: number | null;
  /** For the usage hints (road-to-a-chat-that-reads-well Phase 6). */
  tool?: string;
  contextTokens?: number | null;
  cache?: SessionCache | null;
}

/** Session-bar chip: opens a popover; a locked chip keeps its shape and says why. */
function BarChip({ children, title, locked, open, onClick }: { children: ReactNode; title: string; locked?: boolean; open?: boolean; onClick: (e: MouseEvent<HTMLButtonElement>) => void }) {
  return (
    <button
      type="button"
      title={title}
      aria-disabled={locked || undefined}
      aria-expanded={locked ? undefined : !!open}
      data-popover-trigger=""
      onClick={locked ? undefined : onClick}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 text-xs",
        open ? "bg-ac-raise text-ac-text shadow-[inset_0_0_0_1px_var(--ac-line2)]" : "text-ac-soft",
        locked ? "cursor-not-allowed opacity-60" : !open && "hover:bg-ac-raise hover:text-ac-text",
      )}
    >
      {children}
      {locked ? <Lock className="size-3 text-ac-muted" /> : <ChevronDown className="size-3 text-ac-muted" />}
    </button>
  );
}

/** A chip's left edge inside the window shell, where its popover anchors. */
const shellX = (e: MouseEvent<HTMLElement>): number => {
  const shell = e.currentTarget.closest("[data-v3-shell]");
  return Math.round(e.currentTarget.getBoundingClientRect().left - (shell?.getBoundingClientRect().left ?? 0));
};

export function SessionBar({ s, openIn, chipOpen, on }: { s: BarSession; openIn: ReactNode; chipOpen?: "model" | "thinking" | null; on: { view: (v: "terminal" | "chat") => void; account: () => void; model: (x: number) => void; thinking: (x: number) => void; menu: () => void } }) {
  const t = tone(s.account.fiveH, s.account.protect);
  const chatOff = !s.hosted || !s.chatAvailable;
  const chatWhy = !s.hosted ? "Chat needs a session hosted in Agent Switch" : "This tool keeps the view it started in";
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 overflow-hidden border-b border-ac-line bg-ac-panel px-2">
      <div role="radiogroup" aria-label="View" className="mr-1 inline-flex h-7 shrink-0 items-center rounded-md border border-ac-line bg-ac-bg p-0.5">
        {(
          [
            ["terminal", "Terminal", <SquareTerminal key="t" className="size-3.5" />],
            ["chat", "Chat", <MessageSquareText key="c" className="size-3.5" />],
          ] as const
        ).map(([id, label, icon]) => {
          const off = id === "chat" && chatOff;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={s.view === id}
              aria-disabled={off || undefined}
              title={off ? chatWhy : `${label} · switches between turns`}
              onClick={off ? undefined : () => on.view(id)}
              className={cn("inline-flex h-full items-center gap-1.5 rounded-md px-2 text-xs", s.view === id ? "bg-ac-raise font-medium text-ac-text" : "text-ac-muted", off && "opacity-60")}
            >
              {icon}
              {label}
            </button>
          );
        })}
      </div>
      <span className="mx-1 h-4 w-px shrink-0 bg-ac-line" />
      <BarChip title={`${s.account.name} — moving opens the decision sheet, it never switches by itself`} onClick={on.account}>
        <AccountMark color={s.account.color} />
        {s.account.name}
        <span className="ml-1 inline-flex items-center gap-1">
          <span className="relative h-1.5 w-8 rounded-full bg-ac-raise">
            <span className={cn("absolute inset-y-0 left-0 rounded-full", t === "alert" ? "bg-ac-alert" : t === "warn" ? "bg-ac-warn" : "bg-ac-ok")} style={{ width: `${s.account.fiveH ?? 0}%` }} />
          </span>
          {s.account.fiveH != null && <span className={cn("font-ac-mono text-[10.5px]", t === "ok" || t === "none" ? "text-ac-muted" : t === "warn" ? "text-ac-warn-text" : "text-ac-alert-text")}>{s.account.fiveH}%</span>}
        </span>
      </BarChip>
      <BarChip title={s.hosted ? "Model for the next turn" : "Locked: change it in your terminal (/model)"} locked={!s.hosted} open={chipOpen === "model"} onClick={(e) => on.model(shellX(e))}>
        {/* Unknown: the field's name, muted — never a dash (gap §5b). */}
        {s.model ? <span title={s.modelId ?? undefined}>{s.model}</span> : <span className="text-ac-muted">Model</span>}
      </BarChip>
      <BarChip title={s.hosted ? "Thinking for the next turn" : "Locked: change it in your terminal"} locked={!s.hosted} open={chipOpen === "thinking"} onClick={(e) => on.thinking(shellX(e))}>
        <Brain className="size-3.5 text-ac-muted" /> {s.thinking ? s.thinking[0].toUpperCase() + s.thinking.slice(1) : <span className="text-ac-muted">Thinking</span>}
      </BarChip>
      {s.contextPct != null && (
        <span className="ml-1 shrink-0 whitespace-nowrap font-ac-mono text-[11px] text-ac-muted" title="Context used">
          ctx {Math.round(s.contextPct)}%
        </span>
      )}
      <span className="flex-1" />
      {openIn}
      <IconButton label="Session actions: rename, pin, move, detach, end" className="size-7" onClick={on.menu}>
        <Ellipsis />
      </IconButton>
    </div>
  );
}

// ---------- model popover ----------

export interface ModelChoices {
  models: { id: string; label: string; hint: string }[];
  /** The model the session runs, as an id from `models`, when it is one of them. */
  current: string | null;
  thinking: string[];
  currentThinking: string | null;
  /** The thinking level cannot change here (a chat sets it when it starts). */
  thinkingWhy?: string;
}

/** Under the model chip (spec §7.6): the models with only the chosen one checked, thinking as a segmented control. */
export function ModelPopover({ c, onModel, onThinking }: { c: ModelChoices; onModel: (id: string) => void; onThinking: (level: string) => void }) {
  return (
    <div role="dialog" aria-label="Model and thinking" className="w-[320px] rounded-xl border border-ac-line2 bg-ac-panel p-3" style={{ boxShadow: "var(--ac-shadow)" }}>
      <div className="ac-caps mb-2">Model · next turn</div>
      {c.models.map((m) => (
        <button key={m.id} type="button" role="menuitemradio" aria-checked={m.id === c.current} onClick={() => onModel(m.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-ac-raise">
          <span className="inline-flex size-4 items-center justify-center">{m.id === c.current && <Check className="size-3.5 text-ac-brand-text" />}</span>
          <span className="text-[13px] text-ac-text">{m.label}</span>
          <span className="ml-auto text-[11px] text-ac-muted">{m.hint}</span>
        </button>
      ))}
      {c.thinking.length > 0 && (
        <>
          <div className="ac-caps mb-2 mt-3">Thinking</div>
          {c.thinkingWhy ? (
            <p className="text-[11px] leading-snug text-ac-muted">{c.thinkingWhy}</p>
          ) : (
            <Segmented size="sm" fill label="Thinking" value={c.currentThinking ?? ""} onChange={onThinking} options={c.thinking.map((t) => ({ value: t, label: t[0].toUpperCase() + t.slice(1) }))} />
          )}
        </>
      )}
      <p className="mt-2.5 text-[11px] leading-snug text-ac-muted">Applies from the next turn. The levels come from the tool itself — Codex shows its reasoning levels here.</p>
    </div>
  );
}

// ---------- blocker strip ----------

/** Only while Summary is closed; with Summary open the same next step shows there, never twice (spec §6.3). */
export function BlockerStrip({ text, action, summaryOpen, onAction, onDismiss }: { text: string; action: string; summaryOpen: boolean; onAction: () => void; onDismiss: () => void }) {
  if (summaryOpen) return null;
  return (
    <div role="alert" className="flex shrink-0 items-center gap-3 border-b border-ac-line bg-ac-panel px-4 py-2">
      <CircleX className="size-4 shrink-0 text-ac-alert" />
      <span className="min-w-0 flex-1 text-xs leading-snug text-ac-soft">{text}</span>
      <Act kind="accent" onClick={onAction}>
        {action}
      </Act>
      <IconButton label="Dismiss" className="size-6" onClick={onDismiss}>
        <X />
      </IconButton>
    </div>
  );
}

/**
 * The most pressing usage hint for the session (Phase 6): clear or compact a
 * full context, reply while the cache is warm, move before the limit. One at a
 * time, re-read every few seconds (the cache hint counts down); a dismissed hint
 * stays away until its situation changes.
 */
export function HintStrip({ s, dismissed, onDismiss, onAction }: { s: BarSession; dismissed: ReadonlySet<string>; onDismiss: (stateKey: string) => void; onAction: (h: Hint) => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);
  const hints = sessionHints({ tool: s.tool ?? "", contextPct: s.contextPct, contextTokens: s.contextTokens ?? null, cache: s.cache ?? null, account: { name: s.account.name, fiveH: s.account.fiveH, protect: s.account.protect }, nowMs: now }).filter((h) => !dismissed.has(`${s.key}|${h.stateKey}`));
  const h = hints[0];
  if (!h) return null;
  return (
    <div role="status" data-hint={h.id} className={cn("flex shrink-0 items-center gap-3 border-b border-ac-line px-4 py-1.5", h.tone === "warn" ? "bg-ac-warn-tint" : "bg-ac-panel")}>
      <Lightbulb className={cn("size-4 shrink-0", h.tone === "warn" ? "text-ac-warn-text" : "text-ac-info-text")} />
      <span className="min-w-0 flex-1 text-xs leading-snug text-ac-soft">{h.text}</span>
      {hints.length > 1 && <span className="shrink-0 text-[11px] text-ac-faint">+{hints.length - 1}</span>}
      {h.action && (
        <Act kind="accent" onClick={() => onAction(h)}>
          {h.action.label}
        </Act>
      )}
      <IconButton label="Dismiss hint" className="size-6" onClick={() => onDismiss(`${s.key}|${h.stateKey}`)}>
        <X />
      </IconButton>
    </div>
  );
}

// ---------- a session in the user's own terminal ----------

/**
 * Spec §6.5 with D-mirror (owner, 2026-11-02): Agent Switch cannot read a
 * terminal it does not host, so instead of a mirror the body shows the
 * session's facts and its last transcript line; a full read-only view comes
 * with the v3.1 timeline reader.
 */
export function ExternalBody({ where, facts, lastLine, onFocus, onTakeOver, timeline, readOnlyTitle }: { where: string; facts: ReactNode; lastLine: string | null; onFocus: () => void; onTakeOver: () => void; timeline?: ReactNode; readOnlyTitle?: string | null }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-ac-line bg-ac-panel px-4 py-2">
        <SquareTerminal className="size-4 shrink-0 text-ac-muted" />
        <span className="min-w-0 flex-1 text-xs text-ac-soft">
          Runs in <span className="text-ac-text">{where}</span> · <span title={readOnlyTitle ?? undefined}>read-only here</span>
        </span>
        <Act kind="accent" kbd="⌘↵" onClick={onFocus}>
          Focus terminal
        </Act>
        <Act onClick={onTakeOver} title="Moves the session into a host owned by Agent Switch — explained before it acts">
          Take over here…
        </Act>
      </div>
      {/* v3.1: the read-only timeline replaces the facts once it can be read (D-mirror). */}
      {timeline ?? (
        <div className="min-h-0 flex-1 space-y-3 relative overflow-y-auto px-5 py-4 text-[12.5px] text-ac-soft">
          {facts}
          {lastLine && (
            <div className="rounded-[10px] border border-ac-line px-3 py-2 font-ac-mono text-[12px]" style={{ background: "var(--as-term-bg)", color: "var(--as-term-fg)" }}>
              {lastLine}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- system banner ----------

export function SystemBanner({ children, action }: { children: ReactNode; action: ReactNode }) {
  return (
    <div role="alert" className="flex shrink-0 items-center gap-3 border-b border-ac-alert bg-ac-alert-tint px-4 py-2 text-xs text-ac-alert-text">
      <TriangleAlert className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  );
}

/** "The engine stopped 2 min ago. Hosted sessions keep running in tmux; Agent Switch reconnects when it is back." Pure. */
export function engineDownText(sinceMs: number, nowMs: number, hostedRunning: number): string {
  const mins = Math.max(1, Math.round((nowMs - sinceMs) / 60_000));
  const hosted = hostedRunning ? ` ${hostedRunning === 1 ? "The hosted session keeps" : "Hosted sessions keep"} running in tmux;` : "";
  return `The engine stopped ${mins} min ago.${hosted} Agent Switch reconnects when it is back.`;
}

// ---------- terminal look ----------

/** The resolved theme's terminal tokens as an xterm theme (spec §2, §6.4). Pure. */
export function xtermTheme(vars: Record<string, string>, followTheme: boolean): Record<string, string> {
  const names = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white", "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite"];
  const base = { background: vars["--as-term-bg"], foreground: vars["--as-term-fg"] };
  // Off: the agent's own ANSI colours on the theme's background.
  if (!followTheme) return base;
  return { ...base, ...Object.fromEntries(names.map((n, i) => [n, vars[`--as-ansi-${i}`]]).filter(([, v]) => v)) };
}

/** The boards' terminal type: IBM Plex Mono 12.5 px on a 1.5 CSS line (spec §6.4). */
export const TERMINAL_LOOK = { fontSize: 12.5, lineHeight: 1.5, fontFamily: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace' } as const;

/**
 * The hosted session's real PTY: `agent-switch host attach <key>` in xterm (the
 * pty only runs agent-switch). Closing it ends this view only — tmux keeps the
 * session (spec §6.4: never re-rendered or summarised).
 */
export function HostedTerminal({ sessionKey, vars, followTheme, backend, onExit }: { sessionKey: string; vars: Record<string, string>; followTheme: boolean; backend: TermBackend; onExit: (code: number | null) => void }) {
  return <XtermBox key={sessionKey} args={["host", "attach", sessionKey]} backend={backend} onExit={onExit} look={{ theme: xtermTheme(vars, followTheme), ...TERMINAL_LOOK }} />;
}
