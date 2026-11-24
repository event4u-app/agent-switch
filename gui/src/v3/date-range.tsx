/**
 * A time-range filter for a filter bar (owner, 2026-11-24): a dropdown that looks
 * like the multi-select beside it, opening quick picks (Today, Yesterday, Last 7
 * days) and a from–to pair of date-and-time fields. Either end may stay open.
 */
import { useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
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
  ];
}

/** Whether a time falls in the range (both ends included; an open end lets everything through). Pure. */
export const inRange = (ms: number | null, r: TimeRange): boolean => (r.from == null || (ms != null && ms >= r.from)) && (r.to == null || (ms != null && ms <= r.to));

const fmt = (ms: number) => new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** The trigger's words: a quick pick's name, or "from – to" with an open end said as such. Pure. */
export function rangeLabel(r: TimeRange, nowMs: number): string {
  const hit = presets(nowMs).find((p) => p.range.from === r.from && p.range.to === r.to);
  if (hit) return hit.label;
  if (r.from != null && r.to != null) return `${fmt(r.from)} – ${fmt(r.to)}`;
  return r.from != null ? `Since ${fmt(r.from)}` : `Until ${fmt(r.to!)}`;
}

/** `datetime-local` speaks local wall time without a zone. */
const toField = (ms: number | null) => {
  if (ms == null) return "";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromField = (v: string): number | null => (v ? new Date(v).getTime() : null);

export function DateRange({ label, value, onChange, nowMs, width = 168 }: { label: string; value: TimeRange; onChange: (r: TimeRange) => void; nowMs: number; width?: number }) {
  const [open, setOpen] = useState(false);
  // Fixed to the trigger's place: the layer never shifts over the bar it belongs to.
  const trigger = useRef<HTMLButtonElement>(null);
  const r = open ? trigger.current?.getBoundingClientRect() : undefined;
  const text = rangeLabel(value, nowMs);
  const picks = presets(nowMs);
  const field = "h-8 w-full rounded-md border border-ac-line2 bg-ac-bg px-2 text-xs text-ac-text outline-none focus:border-ac-brand-line [color-scheme:inherit]";
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
        <Anchored onClose={() => setOpen(false)} className="fixed z-50" style={r ? { top: r.bottom + 4, left: Math.max(4, r.right - 264) } : undefined}>
          <div role="dialog" aria-label={`${label} range`} className="w-[264px] rounded-xl border border-ac-line2 bg-ac-panel p-1 shadow-[var(--ac-shadow)]">
            {picks.map((p) => {
              const on = p.range.from === value.from && p.range.to === value.to;
              return (
                <button key={p.id} type="button" onClick={() => (onChange(p.range), setOpen(false))} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-ac-text hover:bg-ac-raise">
                  <span className="flex-1">{p.label}</span>
                  {on && <Check aria-hidden className="size-3.5 text-ac-brand-text" />}
                </button>
              );
            })}
            <div className="mx-1 my-1 h-px bg-ac-line" />
            <div className="space-y-2 px-2 pb-2 pt-1">
              <label className="block">
                <span className="mb-1 block text-[11px] text-ac-muted">From</span>
                <input type="datetime-local" aria-label="From" value={toField(value.from)} max={toField(value.to) || undefined} onChange={(e) => onChange({ ...value, from: fromField(e.target.value) })} className={field} />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] text-ac-muted">To</span>
                <input type="datetime-local" aria-label="To" value={toField(value.to)} min={toField(value.from) || undefined} onChange={(e) => onChange({ ...value, to: fromField(e.target.value) })} className={field} />
              </label>
            </div>
          </div>
        </Anchored>
      )}
    </div>
  );
}
