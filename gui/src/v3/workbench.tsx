/**
 * The workbench (spec §6): tab strip, session bar, blocker strip, the hosted
 * terminal, the view of a session in the user's own terminal, and the system
 * banner. Adapted from the reference boards; data and actions come in as props.
 */

import type { ReactNode } from "react";
import { Brain, ChevronDown, CircleX, Ellipsis, Lock, MessageSquareText, SquareTerminal, TriangleAlert, X } from "lucide-react";
import { cn } from "../lib/utils.js";
import { IconButton } from "../ui/Button.js";
import { SessionStateIcon } from "../ui/SessionStateIcon.js";
import type { IdentityColor, SessionState } from "../vm/types.js";
import { Act, AccountMark } from "./kit.js";
import { tone } from "./limits.js";
import { XtermBox } from "../redesign/screens/terminal-sheet.js";
import type { TermBackend } from "../terminal.js";

// ---------- tab strip ----------

/** Tab: rounded top corners; the active one is framed with a 2 px accent top edge and joins the content below (spec §3.2). */
const TAB = "relative -mb-px flex h-[33px] items-center gap-2 rounded-t-md border-x border-t-2 px-3 text-xs";
const TAB_ON = "border-ac-line border-t-ac-brand bg-ac-bg text-ac-text";

export type TabItem = { kind: "page"; id: string; label: string; icon: ReactNode } | { kind: "session"; id: string; title: string; state: SessionState };

export function TabStrip({ tabs, activeId, onSelect, onClose }: { tabs: TabItem[]; activeId: string; onSelect: (id: string) => void; onClose: (id: string) => void }) {
  // Page tabs come first (spec §6.1).
  const ordered = [...tabs.filter((t) => t.kind === "page"), ...tabs.filter((t) => t.kind === "session")];
  let n = 0;
  return (
    <div role="tablist" className="flex h-9 shrink-0 items-end gap-px border-b border-ac-line bg-ac-rail px-1">
      {ordered.map((t) => {
        const on = t.id === activeId;
        const idx = t.kind === "session" ? ++n : 0;
        return (
          <div
            key={t.id}
            role="tab"
            aria-selected={on}
            onClick={() => onSelect(t.id)}
            title={t.kind === "session" ? `${t.title}${idx <= 9 ? ` · ⌘${idx}` : ""}` : t.label}
            className={cn(TAB, t.kind === "session" ? "group min-w-[140px] max-w-[220px] shrink" : "shrink-0", on ? TAB_ON : "border-transparent text-ac-muted hover:bg-ac-raise hover:text-ac-text")}
          >
            {t.kind === "session" ? <SessionStateIcon state={t.state} /> : t.icon}
            <span className="truncate">{t.kind === "session" ? t.title : t.label}</span>
            {t.kind === "session" ? (
              idx <= 9 && <span className="ml-auto shrink-0 font-ac-mono text-[10px] text-ac-muted">⌘{idx}</span>
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
  model: string | null;
  thinking: string | null;
  contextPct: number | null;
}

/** Session-bar chip: opens a popover; a locked chip keeps its shape and says why. */
function BarChip({ children, title, locked, onClick }: { children: ReactNode; title: string; locked?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      title={title}
      aria-disabled={locked || undefined}
      onClick={locked ? undefined : onClick}
      className={cn("inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 text-xs text-ac-soft", locked ? "cursor-not-allowed opacity-60" : "hover:bg-ac-raise hover:text-ac-text")}
    >
      {children}
      {locked ? <Lock className="size-3 text-ac-muted" /> : <ChevronDown className="size-3 text-ac-muted" />}
    </button>
  );
}

export function SessionBar({ s, openIn, on }: { s: BarSession; openIn: ReactNode; on: { view: (v: "terminal" | "chat") => void; account: () => void; model: () => void; thinking: () => void; menu: () => void } }) {
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
          <span className={cn("font-ac-mono text-[10.5px]", t === "ok" || t === "none" ? "text-ac-muted" : t === "warn" ? "text-ac-warn-text" : "text-ac-alert-text")}>{s.account.fiveH == null ? "—" : `${s.account.fiveH}%`}</span>
        </span>
      </BarChip>
      <BarChip title={s.hosted ? "Model for the next turn" : "Locked: change it in your terminal (/model)"} locked={!s.hosted} onClick={on.model}>
        {s.model ?? "model"}
      </BarChip>
      <BarChip title={s.hosted ? "Thinking for the next turn" : "Locked: change it in your terminal"} locked={!s.hosted} onClick={on.thinking}>
        <Brain className="size-3.5 text-ac-muted" /> {s.thinking ?? "—"}
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

// ---------- a session in the user's own terminal ----------

/**
 * Spec §6.5 with D-mirror (owner, 2026-11-02): Agent Switch cannot read a
 * terminal it does not host, so instead of a mirror the body shows the
 * session's facts and its last transcript line; a full read-only view comes
 * with the v3.1 timeline reader.
 */
export function ExternalBody({ where, facts, lastLine, onFocus, onTakeOver, timeline }: { where: string; facts: ReactNode; lastLine: string | null; onFocus: () => void; onTakeOver: () => void; timeline?: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-ac-line bg-ac-panel px-4 py-2">
        <SquareTerminal className="size-4 shrink-0 text-ac-muted" />
        <span className="min-w-0 flex-1 text-xs text-ac-soft">
          Runs in <span className="text-ac-text">{where}</span> · read-only here
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

export const TERMINAL_LOOK = { fontSize: 12.5, lineHeight: 1.5 } as const;

/**
 * The hosted session's real PTY: `agent-switch host attach <key>` in xterm (the
 * pty only runs agent-switch). Closing it ends this view only — tmux keeps the
 * session (spec §6.4: never re-rendered or summarised).
 */
export function HostedTerminal({ sessionKey, vars, followTheme, backend, onExit }: { sessionKey: string; vars: Record<string, string>; followTheme: boolean; backend: TermBackend; onExit: (code: number | null) => void }) {
  return <XtermBox key={sessionKey} args={["host", "attach", sessionKey]} backend={backend} onExit={onExit} look={{ theme: xtermTheme(vars, followTheme), ...TERMINAL_LOOK }} />;
}
