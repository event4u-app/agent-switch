/**
 * Account limits (spec §5.3, §7.5): the Limits strip at the bottom of the
 * Sessions window and the popover a row opens. One bar per account for its
 * tightest window; numbers only when not OK; stale data greyed with its age;
 * full-size bars carry a pace tick, said in words underneath. Adapted from the
 * reference boards; nothing here ever switches an account.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Segmented } from "../ui/Segmented.js";
import { cn } from "../lib/utils.js";
import type { IdentityColor } from "../vm/types.js";
import { AppWindow, Copy } from "lucide-react";
import { AccountMark, Chip, Marker, checkedAgo, duration, pct } from "./kit.js";

export interface LimitWindow {
  /** "5h", "week", "week · Opus" */
  label: string;
  used: number | null;
  resetsAtMs: number | null;
  /** Share an even use would have reached by now, or null when the window's length is unknown. */
  pace: number | null;
}

export interface LimitAccount {
  key: string;
  tool: "claude" | "codex";
  name: string;
  color: IdentityColor;
  /** Warn threshold of the account (its protect value). */
  protect: number;
  /** Next account for new sessions. */
  next: boolean;
  signIn: boolean;
  /** Last reading; null = never read. */
  checkedMs: number | null;
  windows: LimitWindow[];
  /** Claude Code routines today; null/absent = not reported, so no row is drawn. */
  routines?: { used: number; limit: number } | null;
  /** Signed-in identity (email) and plan, as the CLI reports them; null = not read. */
  identity?: string | null;
  plan?: string | null;
}

/** Data older than this is drawn greyed with its age (spec §13.9). */
export const STALE_MS = 10 * 60_000;
const WINDOW_LENGTH_MS: Record<string, number> = { "5h": 5 * 3_600_000, week: 7 * 86_400_000 };

/** How much of a window even use would have spent by now. Pure. */
export function paceFor(label: string, resetsAtMs: number | null, nowMs: number): number | null {
  const len = WINDOW_LENGTH_MS[label.split(" ")[0]];
  if (!len || resetsAtMs === null) return null;
  const left = Math.min(len, Math.max(0, resetsAtMs - nowMs));
  return Math.round(((len - left) / len) * 100);
}

export function tone(used: number | null, protect: number): "ok" | "warn" | "alert" | "none" {
  if (used == null) return "none";
  if (used >= protect) return "alert";
  if (used >= protect - 15) return "warn";
  return "ok";
}

const FILL = { ok: "bg-ac-ok", warn: "bg-ac-warn", alert: "bg-ac-alert", none: "bg-ac-faint" } as const;
const TEXT = { ok: "text-ac-soft", warn: "text-ac-warn-text", alert: "text-ac-alert-text", none: "text-ac-muted" } as const;

export const isStale = (a: LimitAccount, nowMs: number) => a.checkedMs !== null && nowMs - a.checkedMs > STALE_MS;

/** The window nearest to running out. Pure. */
export function tightest(a: LimitAccount): LimitWindow | undefined {
  return [...a.windows].sort((x, y) => (y.used ?? -1) - (x.used ?? -1))[0];
}

/** The same three cells on every limit row (proposal D): bar · used · reset. `tick`: the pace tick (full-size rows only). */
function LimitCells({ w, protect, stale, nowMs, tick = true, bar = "h-1.5" }: { w: LimitWindow; protect: number; stale?: boolean; nowMs: number; tick?: boolean; bar?: string }) {
  const t = stale ? "none" : tone(w.used, protect);
  return (
    <>
      <span className={cn("relative block rounded-full bg-ac-raise", bar)}>
        <span className={cn("absolute inset-y-0 left-0 rounded-full", FILL[t], stale && "opacity-50")} style={{ width: `${w.used ?? 0}%` }} />
        {tick && w.pace != null && <span data-testid="pace-tick" className="absolute -top-1 h-3.5 w-0.5 -translate-x-1/2 rounded-full bg-ac-text" style={{ left: `${w.pace}%` }} />}
      </span>
      <span className={cn("text-right font-ac-mono text-[11px]", TEXT[t], stale && "italic")}>{pct(w.used)}</span>
      <span className={cn("truncate text-right font-ac-mono text-[11px] text-ac-muted", stale && "italic")}>{w.resetsAtMs ? `↻ ${duration(w.resetsAtMs - nowMs)}` : ""}</span>
    </>
  );
}

/** One window, full size: label · bar with pace tick · used · reset. */
export function LimitBar({ w, protect, stale, nowMs }: { w: LimitWindow; protect: number; stale?: boolean; nowMs: number }) {
  return (
    <div className="grid grid-cols-[76px_1fr_36px_64px] items-center gap-2">
      <span className="truncate text-[11px] text-ac-muted">{w.label.replace("week · ", "week ")}</span>
      <LimitCells w={w} protect={protect} stale={stale} nowMs={nowMs} />
    </div>
  );
}

/** The window a one-line row shows: a window near its limit, else the current (5h) one. Pure. */
export function rowWindow(a: LimitAccount): LimitWindow | undefined {
  const top = tightest(a);
  const t = tone(top?.used ?? null, a.protect);
  return t === "warn" || t === "alert" ? top : currentWindow(a);
}

/** The strip's columns (proposal D): account + tool · bar · used · reset, the same on every row. */
const ROW_GRID = "grid grid-cols-[minmax(0,1fr)_44px_34px_58px] items-center gap-2";

/** One row of the Limits strip (proposal D): account and tool · bar · used · reset, always. Near limit is colour and the number;
 *  an old reading is italic with its age on hover; a missing sign-in fills the row. */
export function LimitRow({ a, nowMs, open, current, toolShown, onOpen, onSignIn }: { a: LimitAccount; nowMs: number; open?: boolean; /** The tool switch above already names the tool: the row leaves it out. */ toolShown?: boolean; /** The account the open session runs on (owner, 2026-11-24): marked like the active session row. */ current?: boolean; onOpen: (key: string) => void; onSignIn: (key: string) => void }) {
  const w = rowWindow(a);
  const stale = isStale(a, nowMs);
  const age = stale ? `${duration(nowMs - a.checkedMs!)} old` : null;
  const tip = [age && `Read ${age} — refreshing`, ...a.windows.map((x) => `${x.label} ${pct(x.used)}${x.resetsAtMs ? ` · resets in ${duration(x.resetsAtMs - nowMs)}` : ""}`)].filter(Boolean).join("\n");
  return (
    <div
      role="button"
      tabIndex={0}
      data-popover-trigger=""
      onClick={() => onOpen(a.key)}
      // A div, not a button (it holds the sign-in button): Enter and Space open it as a button would.
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault();
        onOpen(a.key);
      }}
      title={[current && "The open session runs on this account", tip].filter(Boolean).join("\n") || undefined}
      aria-current={current || undefined}
      data-current={current ? "" : undefined}
      className={cn(ROW_GRID, "relative h-6 rounded-md px-2", open || current ? "bg-ac-raise" : "hover:bg-ac-raise")}
    >
      {current && <Marker />}
      <span className={cn("flex min-w-0 items-center gap-1.5 text-xs", current ? "text-ac-text" : "text-ac-soft", stale && "italic")}>
        <AccountMark color={a.color} />
        <span className={cn("shrink-0", current && "font-semibold")}>{a.name}</span>
        <span className="min-w-0 truncate text-[11px] text-ac-muted">
          {!toolShown && (a.tool === "codex" ? "Codex" : "Claude")}
          {w && w.label !== "5h" && `${toolShown ? "" : " · "}${w.label.replace("week · ", "week ")}`}
        </span>
        {a.next && (
          <span className="shrink-0 text-ac-muted" title="Next for new sessions">
            →
          </span>
        )}
      </span>
      {a.signIn ? (
        <button type="button" onClick={(e) => (e.stopPropagation(), onSignIn(a.key))} className="col-span-3 justify-self-end text-[11px] font-medium text-ac-brand-text hover:underline">
          Sign in ›
        </button>
      ) : !w ? (
        // Not read yet: never an empty track, which reads as 0 % used.
        <span className="col-span-3 justify-self-end text-[11px] text-ac-muted">no data yet</span>
      ) : (
        // On a raised row (open, or the current account) the track steps up a shade so it stays visible.
        <LimitCells w={w} protect={a.protect} stale={stale} nowMs={nowMs} tick={false} bar={open || current ? "h-1 bg-ac-line2" : "h-1"} />
      )}
    </div>
  );
}

/** Rows the strip's box holds; its height stays the same on every tab, more rows scroll inside it (owner, 2026-11-24). */
export const STRIP_ROWS = 4;

/**
 * Claude first, then Codex (spec §5.3). With accounts on more than one tool, a
 * tool switch sits under the head — the tray's segmented control (owner,
 * 2026-11-24): the open session's tool first, Claude otherwise — and the rows
 * sit in a dark box like the tray's, always STRIP_ROWS high, scrolling past that.
 */
export function LimitsStrip({ accounts, nowMs, openKey, currentKey, onOpen, onSignIn }: { accounts: LimitAccount[]; nowMs: number; openKey: string | null; /** The open session's account; absent: none marked. */ currentKey?: string | null; onOpen: (key: string) => void; onSignIn: (key: string) => void }) {
  const tools = (["claude", "codex"] as const).filter((t) => accounts.some((a) => a.tool === t));
  const currentTool = accounts.find((a) => a.key === currentKey)?.tool;
  const [picked, setPicked] = useState<"claude" | "codex" | null>(null);
  const tab = picked && tools.includes(picked) ? picked : currentTool && tools.includes(currentTool) ? currentTool : (tools[0] ?? "claude");
  const shown = tools.length > 1 ? accounts.filter((a) => a.tool === tab) : [...accounts.filter((a) => a.tool === "claude"), ...accounts.filter((a) => a.tool === "codex")];
  // Picking another session follows its account (owner, 2026-11-25): the switch goes back to that
  // session's tool, and the box scrolls just far enough to show its row.
  useEffect(() => setPicked(null), [currentKey]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    const row = el?.querySelector<HTMLElement>("[data-current]");
    if (!el || !row) return;
    const top = row.offsetTop - el.offsetTop - el.clientTop;
    const pad = 4;
    const to = top < el.scrollTop + pad ? top - pad : top + row.offsetHeight > el.scrollTop + el.clientHeight - pad ? top + row.offsetHeight - el.clientHeight + pad : null;
    if (to != null) el.scrollTo?.({ top: Math.max(0, to), behavior: "smooth" });
  }, [currentKey, tab]);
  return (
    <section aria-label="Limits" className="relative shrink-0 border-t border-ac-line px-1.5 pb-1.5 pt-1.5">
      {tools.length > 1 && (
        <div className="px-1">
          <Segmented
            label="Tool"
            size="sm"
            fill
            value={tab}
            onChange={setPicked}
            options={tools.map((t) => ({
              value: t,
              label: (
                <>
                  {t === "claude" ? "Claude" : "Codex"}
                  <span className="ml-1.5 font-ac-mono text-[10.5px] font-normal text-ac-muted">{accounts.filter((a) => a.tool === t).length}</span>
                </>
              ),
            }))}
          />
        </div>
      )}
      {/* The head sits under the switch (owner, 2026-11-24), right above the rows it names. */}
      <div className={cn(ROW_GRID, "h-7 px-2 text-[11px]")}>
        <span className="font-semibold text-ac-soft">
          Limits <span className="font-normal text-ac-muted">· 5h</span>
        </span>
        <span className="col-span-3 justify-self-end text-ac-muted">resets</span>
      </div>
      <div ref={box} data-limit-rows="" role="region" aria-label={tools.length > 1 ? `${tab === "claude" ? "Claude" : "Codex"} limits` : undefined} className="mx-1 h-[106px] overflow-y-auto rounded-md border border-ac-line bg-ac-bg p-1">
        {shown.map((a) => (
          <LimitRow key={a.key} a={a} nowMs={nowMs} open={a.key === openKey} current={a.key === currentKey} toolShown={tools.length > 1} onOpen={onOpen} onSignIn={onSignIn} />
        ))}
      </div>
    </section>
  );
}

/** The windows at least 10 points ahead of an even pace. Pure. */
export function aheadOfPace(a: LimitAccount): LimitWindow[] {
  return a.windows.filter((w) => w.used != null && w.pace != null && w.used - w.pace >= 10);
}

export function PaceLine({ a }: { a: LimitAccount }) {
  const ahead = aheadOfPace(a);
  return (
    <p className="mt-2 text-[11px] leading-relaxed text-ac-muted">
      {ahead.length ? (
        ahead.map((w) => (
          <span key={w.label} className="block">
            <span className="text-ac-warn-text">{w.label} runs ahead</span> · {w.used}% used, {w.pace}% expected by now
          </span>
        ))
      ) : (
        <span className="block">Every window is on pace</span>
      )}
      <span className="block">
        Tick = even pace · amber from {a.protect - 15}%, red from {a.protect}%
      </span>
    </p>
  );
}

/** From a Limits-strip row: every window, pace in words, actions. Never switches on its own. */
export function LimitsPopover({ a, nowMs, moveWhy, onMove, onAccounts, running }: { a: LimitAccount; nowMs: number; /** Why its sessions cannot move now; absent: they can. */ moveWhy?: string | null; onMove: () => void; onAccounts: () => void; /** What runs on this account ("Running on …"). */ running?: ReactNode }) {
  const near = tone(tightest(a)?.used ?? null, a.protect);
  return (
    <div role="dialog" aria-label={`${a.name} limits`} className="w-[320px] rounded-xl border border-ac-line2 bg-ac-panel p-3" style={{ boxShadow: "var(--ac-shadow)" }}>
      <div className="mb-2 flex items-center gap-2">
        <AccountMark color={a.color} />
        <span className="text-[13px] font-medium text-ac-text">
          {a.tool === "claude" ? "Claude" : "Codex"} · {a.name}
        </span>
        {(near === "warn" || near === "alert") && (
          <Chip kind="status" tone="warn">
            Near limit
          </Chip>
        )}
        <span className="ml-auto text-[11px] text-ac-muted">{a.checkedMs === null ? "" : nowMs - a.checkedMs < 60_000 ? "checked just now" : `checked ${duration(nowMs - a.checkedMs)} ago`}</span>
      </div>
      <div className="space-y-1.5">
        {a.windows.map((w) => (
          <LimitBar key={w.label} w={w} protect={a.protect} stale={isStale(a, nowMs)} nowMs={nowMs} />
        ))}
      </div>
      <PaceLine a={a} />
      {running}
      <div className="mt-2.5 flex gap-1.5">
        <button type="button" onClick={moveWhy ? undefined : onMove} aria-disabled={moveWhy ? true : undefined} title={moveWhy ?? undefined} aria-description={moveWhy ?? undefined} className={cn("h-7 rounded-md border border-ac-line2 px-2.5 text-xs", moveWhy ? "cursor-default text-ac-faint" : "text-ac-soft hover:text-ac-text")}>
          Move its session…
        </button>
        <button type="button" onClick={onAccounts} className="h-7 rounded-md px-2.5 text-xs font-medium text-ac-brand-text hover:underline">
          Open Accounts
        </button>
      </div>
    </div>
  );
}

/** "Room left" in the decision sheet: every account of the tool with all its windows (spec §8.2). */
export function RoomLeft({ accounts, nowMs }: { accounts: LimitAccount[]; nowMs: number }) {
  if (!accounts.length) return null;
  return (
    <div className="rounded-[10px] border border-ac-line bg-ac-bg">
      {accounts.map((a) => (
        <div key={a.key} className="rounded-md px-2 py-1.5 hover:bg-ac-raise">
          <div className="flex min-w-0 items-center gap-2">
            <AccountMark color={a.color} />
            <span className="truncate text-xs font-medium text-ac-text">{a.name}</span>
            {a.next && <span className="shrink-0 text-[10.5px] text-ac-info-text">→ next</span>}
            {!isStale(a, nowMs) && (tone(tightest(a)?.used ?? null, a.protect) === "warn" || tone(tightest(a)?.used ?? null, a.protect) === "alert") && (
              <Chip kind="status" tone="warn">
                Near limit
              </Chip>
            )}
            <span className="ml-auto shrink-0 font-ac-mono text-[10.5px] text-ac-muted">{a.checkedMs === null ? "" : nowMs - a.checkedMs < 60_000 ? "just now" : `${duration(nowMs - a.checkedMs)} ago`}</span>
          </div>
          {a.windows.length ? (
            <div className="mt-1.5 space-y-1 pl-4">
              {a.windows.map((w) => (
                <LimitBar key={w.label} w={w} protect={a.protect} stale={isStale(a, nowMs)} nowMs={nowMs} />
              ))}
            </div>
          ) : (
            <div className="mt-1 pl-4 text-[11px] text-ac-muted">{a.signIn ? "No usage before the first sign-in" : "no data yet"}</div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Tray account (like the v2 tray), two lines: name with the email shortened
 * after it, next / near-limit word, how old the reading is and the app button;
 * then the current (5h) window — bar with pace tick, used, reset. The other windows are in its tooltip and in the popover.
 */
/** The window the tray shows: the 5h one, else the first the CLI reports. Pure. */
export const currentWindow = (a: LimitAccount): LimitWindow | undefined => a.windows.find((w) => w.label === "5h") ?? a.windows[0];

export function TrayAccount({ a, nowMs, onOpen, onSignIn, app }: { a: LimitAccount; nowMs: number; onOpen: (key: string) => void; onSignIn: (key: string) => void; app?: { name: string; onOpen: () => void } }) {
  const stale = isStale(a, nowMs);
  const t = stale ? "none" : tone(tightest(a)?.used ?? null, a.protect);
  const id = [a.identity, a.plan].filter(Boolean).join(" · ");
  const now = currentWindow(a);
  return (
    <div className="group rounded-md px-2 py-1 hover:bg-ac-raise">
      <div className="flex h-6 min-w-0 items-center gap-2">
        <button type="button" data-popover-trigger="" onClick={() => onOpen(a.key)} title="Every window, pace and actions" className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <AccountMark color={a.color} />
          <span className="shrink-0 text-[12.5px] font-medium text-ac-text">{a.name}</span>
          {/* The email shortened right after the name, like v2; email and plan in full on hover. */}
          {a.identity && (
            <span className="min-w-0 truncate text-[11px] text-ac-muted" title={id}>
              {a.identity}
            </span>
          )}
        </button>
        {a.identity && (
          <button type="button" onClick={() => void navigator.clipboard?.writeText(a.identity!)} aria-label="Copy email" title="Copy email" className="-ml-1 inline-flex size-5 shrink-0 items-center justify-center rounded text-ac-faint opacity-0 hover:text-ac-text focus-visible:opacity-100 group-hover:opacity-100">
            <Copy className="size-3" />
          </button>
        )}
        {a.next && <span className="shrink-0 text-[10.5px] text-ac-info-text">→ next</span>}
        {(t === "warn" || t === "alert") && (
          <Chip kind="status" tone={t}>
            Near limit
          </Chip>
        )}
        {a.checkedMs !== null && (
          <span className={cn("shrink-0 font-ac-mono text-[10.5px]", stale ? "text-ac-warn-text" : "text-ac-muted")} title={stale ? "Usage data is old — refreshing" : undefined}>
            {stale ? `${duration(nowMs - a.checkedMs)} old` : checkedAgo(nowMs - a.checkedMs).replace("checked ", "")}
          </span>
        )}
        {app && (
          <button type="button" onClick={app.onOpen} aria-label={`Open ${app.name} as ${a.name}`} title={`Open ${app.name} as ${a.name}`} className="-mr-1 inline-flex size-6 shrink-0 items-center justify-center rounded-md text-ac-muted hover:bg-ac-line hover:text-ac-text">
            <AppWindow className="size-3.5" />
          </button>
        )}
      </div>
      {a.signIn ? (
        <div className="flex h-5 items-center gap-2 pl-[18px] text-[11px] text-ac-muted">
          Sign-in needed
          <button type="button" onClick={() => onSignIn(a.key)} className="-mr-1.5 ml-auto h-5 rounded px-1.5 text-[11px] font-medium text-ac-brand-text hover:bg-ac-brand-tint">
            Sign in
          </button>
        </div>
      ) : now ? (
        // Only the current (5h) window; the others are in the tooltip and the popover.
        <div className="flex h-5 items-center pl-[18px]" title={a.windows.map((w) => `${w.label} ${pct(w.used)}${w.resetsAtMs ? ` · resets in ${duration(w.resetsAtMs - nowMs)}` : ""}`).join("\n")}>
          <div className="min-w-0 flex-1">
            <LimitBar w={now} protect={a.protect} stale={stale} nowMs={nowMs} />
          </div>
        </div>
      ) : (
        <div className="flex h-5 items-center pl-[18px] text-[11px] text-ac-muted">No usage read yet</div>
      )}
    </div>
  );
}
