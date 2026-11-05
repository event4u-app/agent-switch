/**
 * Account limits (spec §5.3, §7.5): the Limits strip at the bottom of the
 * Sessions window and the popover a row opens. One bar per account for its
 * tightest window; numbers only when not OK; stale data greyed with its age;
 * full-size bars carry a pace tick, said in words underneath. Adapted from the
 * reference boards; nothing here ever switches an account.
 */

import type { ReactNode } from "react";
import { cn } from "../lib/utils.js";
import type { IdentityColor } from "../vm/types.js";
import { AppWindow, Copy } from "lucide-react";
import { AccountMark, Chip, checkedAgo, duration, pct } from "./kit.js";

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

/** One window, full size: label · bar with pace tick · used · reset. */
export function LimitBar({ w, protect, stale, nowMs }: { w: LimitWindow; protect: number; stale?: boolean; nowMs: number }) {
  const t = stale ? "none" : tone(w.used, protect);
  return (
    <div className="grid grid-cols-[76px_1fr_36px_64px] items-center gap-2">
      <span className="truncate text-[11px] text-ac-muted">{w.label.replace("week · ", "week ")}</span>
      <span className="relative block h-1.5 rounded-full bg-ac-raise">
        <span className={cn("absolute inset-y-0 left-0 rounded-full", FILL[t], stale && "opacity-50")} style={{ width: `${w.used ?? 0}%` }} />
        {w.pace != null && <span data-testid="pace-tick" className="absolute -top-1 h-3.5 w-0.5 -translate-x-1/2 rounded-full bg-ac-text" style={{ left: `${w.pace}%` }} />}
      </span>
      <span className={cn("text-right font-ac-mono text-[11px]", TEXT[t])}>{pct(w.used)}</span>
      <span className="truncate text-right font-ac-mono text-[11px] text-ac-muted">{w.resetsAtMs ? `↻ ${duration(w.resetsAtMs - nowMs)}` : ""}</span>
    </div>
  );
}

/** One row of the Limits strip: name · numbers when not OK · a 64×4 bar (no pace tick on small bars). */
export function LimitRow({ a, nowMs, open, onOpen, onSignIn }: { a: LimitAccount; nowMs: number; open?: boolean; onOpen: (key: string) => void; onSignIn: (key: string) => void }) {
  const top = tightest(a);
  const stale = isStale(a, nowMs);
  const t = stale ? "none" : tone(top?.used ?? null, a.protect);
  const tip = a.windows.map((w) => `${w.label} ${pct(w.used)}${w.resetsAtMs ? ` · resets in ${duration(w.resetsAtMs - nowMs)}` : ""}`).join("\n");
  return (
    <div role="button" tabIndex={0} data-popover-trigger="" onClick={() => onOpen(a.key)} title={tip} className={cn("flex h-6 items-center gap-2 rounded-md px-2", open ? "bg-ac-raise" : "hover:bg-ac-raise")}>
      <span className="min-w-0 flex-1 truncate text-xs text-ac-soft">
        {a.name}
        {a.tool === "codex" && <span className="text-ac-muted"> · Codex</span>}
        {a.next && (
          <span className="ml-1 text-ac-muted" title="Next for new sessions">
            →
          </span>
        )}
        {stale && <span className="text-[11px] text-ac-muted"> · {duration(nowMs - a.checkedMs!)} old</span>}
      </span>
      {a.signIn ? (
        <button type="button" onClick={(e) => (e.stopPropagation(), onSignIn(a.key))} className="shrink-0 text-[11px] text-ac-muted hover:text-ac-text">
          sign in ›
        </button>
      ) : !a.windows.length ? (
        // Not read yet: never an empty track, which reads as 0 % used.
        <span className="shrink-0 text-[11px] text-ac-muted">no data yet</span>
      ) : (
        <>
          {(t === "warn" || t === "alert") && top && (
            <span className={cn("shrink-0 font-ac-mono text-[10.5px]", TEXT[t])}>
              {pct(top.used)}
              {top.resetsAtMs ? ` · ${duration(top.resetsAtMs - nowMs)}` : ""}
            </span>
          )}
          <span className="relative block h-1 w-16 shrink-0 rounded-full bg-ac-raise">
            <span className={cn("absolute inset-y-0 left-0 rounded-full", FILL[t], stale && "opacity-50")} style={{ width: `${top?.used ?? 0}%` }} />
          </span>
        </>
      )}
    </div>
  );
}

/** Claude first, then Codex (spec §5.3). */
export function LimitsStrip({ accounts, nowMs, openKey, onOpen, onSignIn }: { accounts: LimitAccount[]; nowMs: number; openKey: string | null; onOpen: (key: string) => void; onSignIn: (key: string) => void }) {
  const ordered = [...accounts.filter((a) => a.tool === "claude"), ...accounts.filter((a) => a.tool === "codex")];
  return (
    <section aria-label="Limits" className="relative shrink-0 border-t border-ac-line px-1.5 pb-1.5 pt-1">
      <div className="flex h-7 items-center px-2 text-[11px] font-semibold text-ac-soft">Limits</div>
      {ordered.map((a) => (
        <LimitRow key={a.key} a={a} nowMs={nowMs} open={a.key === openKey} onOpen={onOpen} onSignIn={onSignIn} />
      ))}
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
export function LimitsPopover({ a, nowMs, onMove, onAccounts, running }: { a: LimitAccount; nowMs: number; onMove: () => void; onAccounts: () => void; /** What runs on this account ("Running on …"). */ running?: ReactNode }) {
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
        <button type="button" onClick={onMove} className="h-7 rounded-md border border-ac-line2 px-2.5 text-xs text-ac-soft hover:text-ac-text">
          Move its session…
        </button>
        <button type="button" onClick={onAccounts} className="h-7 rounded-md px-2.5 text-xs text-ac-muted hover:text-ac-text">
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
 * Tray account (proposal, like the v2 tray): name, next / near-limit word, how
 * old the reading is and the app button on the first line; identity and plan
 * on the second; then every window full size — bar with pace tick, used, reset.
 */
export function TrayAccount({ a, nowMs, onOpen, onSignIn, app }: { a: LimitAccount; nowMs: number; onOpen: (key: string) => void; onSignIn: (key: string) => void; app?: { name: string; onOpen: () => void } }) {
  const stale = isStale(a, nowMs);
  const t = stale ? "none" : tone(tightest(a)?.used ?? null, a.protect);
  const id = [a.identity, a.plan].filter(Boolean).join(" · ");
  return (
    <div className="rounded-md px-2 py-1.5 hover:bg-ac-raise">
      <div className="flex h-6 items-center gap-2">
        <button type="button" data-popover-trigger="" onClick={() => onOpen(a.key)} title="Every window, pace and actions" className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <AccountMark color={a.color} />
          <span className="truncate text-[12.5px] font-medium text-ac-text">{a.name}</span>
          {a.next && <span className="shrink-0 text-[10.5px] text-ac-info-text">→ next</span>}
          {(t === "warn" || t === "alert") && (
            <Chip kind="status" tone={t}>
              Near limit
            </Chip>
          )}
        </button>
        {a.checkedMs !== null && (
          <span className={cn("shrink-0 font-ac-mono text-[10.5px]", stale ? "text-ac-warn-text" : "text-ac-muted")} title={stale ? "Usage data is old — refreshing" : undefined}>
            {stale ? `${duration(nowMs - a.checkedMs)} old` : checkedAgo(nowMs - a.checkedMs).replace("checked ", "")}
          </span>
        )}
        {app && (
          <button type="button" onClick={app.onOpen} aria-label={`Open ${app.name} as ${a.name}`} title={`Open ${app.name} as ${a.name}`} className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-ac-muted hover:bg-ac-line hover:text-ac-text">
            <AppWindow className="size-3.5" />
          </button>
        )}
      </div>
      {id && (
        <div className="flex h-5 min-w-0 items-center gap-1 pl-[18px] text-[11px] text-ac-muted">
          <span className="truncate" title={id}>
            {id}
          </span>
          {a.identity && (
            <button type="button" onClick={() => void navigator.clipboard?.writeText(a.identity!)} aria-label="Copy email" title="Copy email" className="inline-flex size-5 shrink-0 items-center justify-center rounded text-ac-faint hover:text-ac-text">
              <Copy className="size-3" />
            </button>
          )}
        </div>
      )}
      {a.signIn ? (
        <div className="mt-0.5 flex h-6 items-center gap-2 pl-[18px] text-[11px] text-ac-muted">
          Sign-in needed
          <button type="button" onClick={() => onSignIn(a.key)} className="-mr-1.5 ml-auto h-5 rounded px-1.5 text-[11px] font-medium text-ac-brand-text hover:bg-ac-brand-tint">
            Sign in
          </button>
        </div>
      ) : a.windows.length ? (
        <div className="mt-1 space-y-1 pl-[18px]">
          {a.windows.map((w) => (
            <LimitBar key={w.label} w={w} protect={a.protect} stale={stale} nowMs={nowMs} />
          ))}
        </div>
      ) : (
        <div className="mt-0.5 pl-[18px] text-[11px] text-ac-muted">No usage read yet</div>
      )}
    </div>
  );
}
