import { cn } from "../lib/utils.js";
import { isStale, toneFor } from "../vm/rules.js";
import type { MeterTone, UsageWindow } from "../vm/types.js";
import { countdown, shortAge } from "./format.js";

const BAR: Record<MeterTone, string> = {
  ok: "bg-ac-ok",
  warn: "bg-ac-warn",
  alert: "bg-ac-alert",
  neutral: "bg-ac-line2",
};
const FIGURE: Record<MeterTone, string> = {
  ok: "text-ac-soft",
  warn: "text-ac-warn-text",
  alert: "text-ac-alert-text",
  neutral: "text-ac-faint",
};

/** "checked 4m ago" — but "checked just now" for a fresh readout. */
const checkedLine = (age: string, prefix = "checked ") => (age === "now" ? `${prefix}just now` : `${prefix}${age} ago`);

/** Label · meter with a threshold tick · mono % · reset countdown. Bundle `s0`. */
export function UsageWindowRow({
  window: w,
  threshold,
  now,
  compact,
}: {
  window: UsageWindow;
  threshold: number;
  now: number;
  compact?: boolean;
}) {
  const tone = toneFor(w.utilization, threshold);
  const resets = countdown(w.resetsAt, now);
  return (
    <div
      className={cn(
        "grid items-center gap-x-2.5",
        compact ? "grid-cols-[34px_minmax(48px,1fr)_34px]" : "grid-cols-[40px_minmax(64px,1fr)_38px_64px]",
      )}
    >
      <span className="text-[11px] text-ac-muted">{w.label}</span>
      <span
        className="relative h-1.5 overflow-hidden rounded-full bg-ac-line"
        role="meter"
        aria-label={`${w.label} window used`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={w.utilization ?? undefined}
      >
        <span className="absolute inset-y-0 w-px bg-ac-faint opacity-70" style={{ left: `${threshold}%` }} aria-hidden />
        <span
          className={cn("absolute inset-y-0 left-0 rounded-full", BAR[tone])}
          style={{ width: `${Math.min(100, w.utilization ?? 0)}%` }}
        />
      </span>
      <span className={cn("text-right font-ac-mono text-[11px] tabular-nums", FIGURE[tone])}>
        {w.utilization == null ? "—" : `${w.utilization}%`}
      </span>
      {!compact && (
        <span className="whitespace-nowrap text-right text-[11px] tabular-nums text-ac-faint">
          {resets ? `↻ ${resets}` : ""}
        </span>
      )}
    </div>
  );
}

/** Every usage window of an account under each other (5 h, week, a model
 *  window …) in one aligned grid, then the data age once. Same unknown / stale
 *  rules as {@link CapacityMeter}. */
export function UsageWindowStack({
  windows,
  threshold,
  checkedAt,
  now,
}: {
  windows: readonly UsageWindow[];
  threshold: number;
  checkedAt: number | null;
  now: number;
}) {
  const known = windows.filter((w) => w.utilization != null);
  if (known.length === 0) return <CapacityMeter window={null} threshold={threshold} checkedAt={checkedAt} now={now} />;
  const stale = isStale(checkedAt, now);
  const age = shortAge(checkedAt, now);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="grid grid-cols-[auto_minmax(48px,1fr)_34px_auto] items-center gap-x-2 gap-y-1">
        {known.map((w) => {
          const tone = stale ? "neutral" : toneFor(w.utilization, threshold);
          const resets = countdown(w.resetsAt, now);
          return (
            <div key={w.key} className="contents">
              <span className="whitespace-nowrap text-[11px] text-ac-muted">{w.label}</span>
              <span
                className="relative h-1.5 overflow-hidden rounded-full bg-ac-line"
                role="meter"
                aria-label={`${w.label} window used`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={w.utilization ?? undefined}
              >
                <span className="absolute inset-y-0 w-px bg-ac-faint opacity-70" style={{ left: `${threshold}%` }} aria-hidden />
                <span
                  className={cn("absolute inset-y-0 left-0 rounded-full", BAR[tone], stale && "opacity-60")}
                  style={{ width: `${Math.min(100, w.utilization ?? 0)}%` }}
                />
              </span>
              <span className={cn("text-right font-ac-mono text-[11px] tabular-nums", FIGURE[tone])}>{w.utilization}%</span>
              <span className="whitespace-nowrap text-right text-[11px] tabular-nums text-ac-faint">{resets ? `↻ ${resets}` : ""}</span>
            </div>
          );
        })}
      </div>
      <span className="truncate text-[11px] text-ac-faint" title={checkedLine(age)}>
        {stale ? <span className="text-ac-warn-text">{age} old</span> : checkedLine(age)}
      </span>
    </div>
  );
}

/** Binding-window meter with reset + data age. Older than 10 min → neutral bar
 *  and "<age> old" in warn; no readout → dashed "usage unknown". Bundle `J3`. */
export function CapacityMeter({
  window: w,
  threshold,
  checkedAt,
  now,
  compact,
}: {
  window: UsageWindow | null;
  threshold: number;
  checkedAt: number | null;
  now: number;
  compact?: boolean;
}) {
  const stale = isStale(checkedAt, now);
  if (!w || w.utilization == null) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-ac-faint">
        <span className="h-1.5 flex-1 rounded-full border border-dashed border-ac-line2" aria-hidden />
        <span>usage unknown</span>
      </div>
    );
  }
  const tone = stale ? "neutral" : toneFor(w.utilization, threshold);
  const resets = countdown(w.resetsAt, now);
  const age = shortAge(checkedAt, now);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="grid grid-cols-[minmax(56px,1fr)_38px] items-center gap-2.5">
        <span
          className="relative h-1.5 overflow-hidden rounded-full bg-ac-line"
          role="meter"
          aria-label={`${w.label} window used`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={w.utilization}
        >
          <span className="absolute inset-y-0 w-px bg-ac-faint opacity-70" style={{ left: `${threshold}%` }} aria-hidden />
          <span
            className={cn("absolute inset-y-0 left-0 rounded-full", BAR[tone], stale && "opacity-60")}
            style={{ width: `${Math.min(100, w.utilization)}%` }}
          />
        </span>
        <span className={cn("text-right font-ac-mono text-[11px] tabular-nums", FIGURE[tone])}>{w.utilization}%</span>
      </div>
      <span className="truncate text-[11px] text-ac-faint" title={`${w.label} window · ${checkedLine(age)}`}>
        {compact ? "" : `${w.label} · `}
        {resets ? `↻ ${resets} · ` : ""}
        {stale ? <span className="text-ac-warn-text">{age} old</span> : checkedLine(age, compact ? "" : "checked ")}
      </span>
    </div>
  );
}
