/**
 * A time-range filter for a filter bar (owner, 2026-11-24): a dropdown that looks
 * like the multi-select beside it. It opens quick picks on the left and a month
 * calendar on the right — click a first day, then a last one; the days between
 * fill in the accent — with a start and an end time under it. Either end may stay
 * open. No browser date field: its look differs per platform and cannot be styled.
 */
import { useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../lib/utils.js";
import { Anchored } from "./menus.js";

export interface TimeRange {
  from: number | null;
  to: number | null;
}
export const ANY_TIME: TimeRange = { from: null, to: null };

const DAY = 86_400_000;
const midnight = (ms: number) => new Date(ms).setHours(0, 0, 0, 0);

/** The quick picks, as ranges ending now or at a midnight. Pure. */
export function presets(nowMs: number): { id: string; label: string; range: TimeRange }[] {
  const today = midnight(nowMs);
  return [
    { id: "any", label: "Any time", range: ANY_TIME },
    { id: "today", label: "Today", range: { from: today, to: null } },
    { id: "yesterday", label: "Yesterday", range: { from: midnight(today - DAY / 2), to: today - 1 } },
    { id: "7d", label: "Last 7 days", range: { from: midnight(today - 6 * DAY), to: null } },
    { id: "30d", label: "Last 30 days", range: { from: midnight(today - 29 * DAY), to: null } },
  ];
}

/** Whether a time falls in the range (both ends included; an open end lets everything through). Pure. */
export const inRange = (ms: number | null, r: TimeRange): boolean => (r.from == null || (ms != null && ms >= r.from)) && (r.to == null || (ms != null && ms <= r.to));

const fmt = (ms: number) => new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** The trigger's words: a quick pick's name, or "from – to" with an open end said as such. Pure. */
export function rangeLabel(r: TimeRange, nowMs: number): string {
  const hit = presets(nowMs).find((p) => p.range.from === r.from && p.range.to === r.to);
  if (hit) return hit.label;
  if (r.from != null && r.to != null) {
    // Whole days (00:00 to 23:59) say only their dates, so the trigger stays short.
    const whole = r.from === midnight(r.from) && r.to === new Date(midnight(r.to)).setHours(23, 59, 59, 999);
    if (whole) {
      const day = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
      return midnight(r.from) === midnight(r.to) ? day(r.from) : `${day(r.from)} – ${day(r.to)}`;
    }
    return `${fmt(r.from)} – ${fmt(r.to)}`;
  }
  return r.from != null ? `Since ${fmt(r.from)}` : `Until ${fmt(r.to!)}`;
}

/** The 6×7 days of the month that holds `month` (any time in it), weeks from Monday. Pure. */
export function monthGrid(month: number): number[] {
  const first = new Date(month);
  first.setDate(1);
  first.setHours(0, 0, 0, 0);
  const lead = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) => new Date(first.getFullYear(), first.getMonth(), 1 - lead + i).getTime());
}

/** A day picked in the calendar: the first click starts a range, the second ends it (either order). Pure. */
export function pickDay(r: TimeRange, day: number): TimeRange {
  const start = midnight(day);
  const end = new Date(start).setHours(23, 59, 59, 999);
  if (r.from == null || r.to != null) return { from: start, to: null };
  return start >= midnight(r.from) ? { from: r.from, to: end } : { from: start, to: new Date(midnight(r.from)).setHours(23, 59, 59, 999) };
}

/** "HH:MM" of a time, and a time with its clock set from "HH:MM" (null when it does not parse). Pure. */
const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5);
export function withClock(ms: number, text: string): number | null {
  const m = /^(\d{1,2}):?(\d{2})$/.exec(text.trim());
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return new Date(ms).setHours(+m[1], +m[2], 0, 0);
}


export function DateRange({ label, value, onChange, nowMs, width = 168 }: { label: string; value: TimeRange; onChange: (r: TimeRange) => void; nowMs: number; width?: number }) {
  const [open, setOpen] = useState(false);
  // Fixed to the trigger's place: the layer never shifts over the bar it belongs to.
  const trigger = useRef<HTMLButtonElement>(null);
  const r = open ? trigger.current?.getBoundingClientRect() : undefined;
  const text = rangeLabel(value, nowMs);
  const picks = presets(nowMs);
  return (
    <div className="relative shrink-0">
      <button
        ref={trigger}
        type="button"
        data-popover-trigger=""
        aria-expanded={open}
        aria-label={`${label}: ${text}`}
        title={`${label}: ${text}`}
        onClick={() => setOpen((o) => !o)}
        style={{ width }}
        className={cn(
          "group inline-flex h-8 items-center gap-1.5 rounded-md border border-ac-line2 bg-ac-bg px-2.5 text-left text-xs text-ac-text outline-none hover:border-ac-faint focus-visible:border-ac-brand-line",
          open && "border-ac-brand-line",
        )}
      >
        <span className="shrink-0 text-ac-muted">{label}</span>
        <span className="min-w-0 flex-1 truncate">{text}</span>
        <ChevronDown aria-hidden className={cn("size-3.5 shrink-0 text-ac-muted transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <Anchored onClose={() => setOpen(false)} className="fixed z-50" style={r ? { top: r.bottom + 4, left: Math.max(4, r.right - 468) } : undefined}>
          <RangePanel label={label} value={value} nowMs={nowMs} picks={picks} onChange={onChange} onDone={() => setOpen(false)} />
        </Anchored>
      )}
    </div>
  );
}

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function TimeField({ label, ms, onChange }: { label: string; ms: number | null; onChange: (ms: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (ms == null ? "" : hhmm(ms));
  const commit = () => {
    if (ms != null && text != null) {
      const next = withClock(ms, text);
      if (next != null) onChange(next);
    }
    setText(null);
  };
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-[11px] text-ac-muted">{label}</span>
      <span className={cn("flex h-8 items-center gap-2 rounded-md border border-ac-line2 bg-ac-bg px-2.5 text-xs", ms == null ? "text-ac-faint" : "text-ac-text")}>
        <span className="min-w-0 flex-1 truncate">{ms == null ? "open" : new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
        <input
          aria-label={`${label} time`}
          disabled={ms == null}
          value={shown}
          placeholder="--:--"
          inputMode="numeric"
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && (e.currentTarget.blur(), e.preventDefault())}
          className="w-[44px] shrink-0 rounded bg-transparent text-right font-ac-mono text-xs tabular-nums text-ac-text outline-none placeholder:text-ac-faint focus:bg-ac-raise disabled:opacity-0"
        />
      </span>
    </label>
  );
}

function RangePanel({ label, value, nowMs, picks, onChange, onDone }: { label: string; value: TimeRange; nowMs: number; picks: ReturnType<typeof presets>; onChange: (r: TimeRange) => void; onDone: () => void }) {
  const [month, setMonth] = useState(() => value.from ?? nowMs);
  const today = midnight(nowMs);
  const days = monthGrid(month);
  const shownMonth = new Date(month).getMonth();
  const step = (n: number) => setMonth((m) => new Date(new Date(m).getFullYear(), new Date(m).getMonth() + n, 1).getTime());
  const from = value.from == null ? null : midnight(value.from);
  const to = value.to == null ? null : midnight(value.to);
  return (
    <div role="dialog" aria-label={`${label} range`} className="flex w-[468px] rounded-xl border border-ac-line2 bg-ac-panel shadow-[var(--ac-shadow)]">
      <div className="w-[132px] shrink-0 border-r border-ac-line p-1">
        {picks.map((p) => {
          const on = p.range.from === value.from && p.range.to === value.to;
          return (
            <button key={p.id} type="button" onClick={() => (onChange(p.range), onDone())} className={cn("flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-ac-raise", on ? "font-medium text-ac-text" : "text-ac-soft")}>
              <span className="flex-1">{p.label}</span>
              {on && <Check aria-hidden className="size-3.5 text-ac-brand-text" />}
            </button>
          );
        })}
      </div>
      <div className="min-w-0 flex-1 p-3">
        <div className="mb-2 flex h-7 items-center">
          <button type="button" aria-label="Previous month" onClick={() => step(-1)} className="inline-flex size-7 items-center justify-center rounded-md text-ac-muted hover:bg-ac-raise hover:text-ac-text">
            <ChevronLeft className="size-4" />
          </button>
          <span className="flex-1 text-center text-[12.5px] font-medium text-ac-text">{new Date(month).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</span>
          <button type="button" aria-label="Next month" onClick={() => step(1)} className="inline-flex size-7 items-center justify-center rounded-md text-ac-muted hover:bg-ac-raise hover:text-ac-text">
            <ChevronRight className="size-4" />
          </button>
        </div>
        <div role="grid" aria-label="Days" className="grid grid-cols-7 gap-y-0.5 text-center">
          {/* Whole-width cells: the days between the two picked ones read as one band. */}
          {WEEKDAYS.map((w) => (
            <span key={w} className="pb-1 text-[10.5px] font-medium text-ac-faint">
              {w}
            </span>
          ))}
          {days.map((d) => {
            const inMonth = new Date(d).getMonth() === shownMonth;
            const future = d > today;
            const edge = d === from || d === to;
            const between = from != null && to != null && d > from && d < to;
            return (
              <button
                key={d}
                type="button"
                role="gridcell"
                aria-selected={edge || between || undefined}
                aria-label={new Date(d).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
                disabled={future}
                onClick={() => onChange(pickDay(value, d))}
                className={cn(
                  "relative inline-flex h-8 w-full items-center justify-center rounded-md text-xs tabular-nums",
                  edge ? "bg-ac-brand font-semibold text-ac-on-color" : between ? "rounded-none bg-ac-brand-tint text-ac-brand-text" : inMonth ? "text-ac-text hover:bg-ac-raise" : "text-ac-faint hover:bg-ac-raise",
                  future && "pointer-events-none opacity-35",
                  d === today && !edge && "shadow-[inset_0_0_0_1px_var(--ac-line2)]",
                )}
              >
                {new Date(d).getDate()}
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex gap-2">
          <TimeField label="From" ms={value.from} onChange={(ms) => onChange({ ...value, from: ms })} />
          <TimeField label="To" ms={value.to} onChange={(ms) => onChange({ ...value, to: ms })} />
        </div>
      </div>
    </div>
  );
}
