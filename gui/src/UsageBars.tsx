import { cn } from "@/lib/utils";
import { formatReset, type UsageSnapshot } from "./transforms.js";

/** Utilization → bar colour: green (headroom) · amber (≥70%) · red (≥90%). */
export function utilColor(pct: number): string {
  if (pct >= 90) return "hsl(var(--destructive))";
  if (pct >= 70) return "#d9a343";
  return "hsl(var(--success))";
}

const HATCH = "repeating-linear-gradient(45deg, hsl(var(--muted-foreground) / 0.5) 0 3px, transparent 3px 6px)";

// Fallback windows when we have NO snapshot at all — still show grey hatched
// "N.A." bars (rather than nothing) so a provider with a usage readout always
// has a stable bar area.
const PLACEHOLDER_WINDOWS: UsageSnapshot["windows"] = [
  { key: "five_hour", label: "5h", utilization: null, resetsAt: null },
  { key: "seven_day", label: "7d", utilization: null, resetsAt: null },
];

/**
 * Usage bars for one profile. Three states per window:
 *   - fresh value  → solid coloured fill + coloured % + reset countdown.
 *   - stale value (from cache) → coloured fill with a HATCH overlay (colour kept,
 *     but visibly striped = not current) + coloured (dimmed) % + cached reset.
 *   - no value     → grey HATCHED track + "N.A.".
 * With no snapshot at all, PLACEHOLDER_WINDOWS render as hatched N.A.
 */
export function UsageBars({ usage, stale }: { usage: UsageSnapshot | null; stale: boolean }) {
  const windows = usage && usage.windows.length > 0 ? usage.windows : PLACEHOLDER_WINDOWS;
  return (
    <div className="mt-1.5 space-y-1 pl-4">
      {windows.map((w) => {
        const known = typeof w.utilization === "number";
        const pct = Math.min(100, w.utilization ?? 0);
        // Cached data still carries a valid reset time — show it even when stale
        // (formatReset already returns "" once the window has rolled over).
        const reset = known ? formatReset(w.resetsAt) : "";
        return (
          <div key={w.key} className="flex items-center gap-2 text-[11px]">
            <span className="w-12 shrink-0 truncate text-muted-foreground" title={w.label}>{w.label}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
              {!known ? (
                <div className="h-full w-full rounded-full opacity-70" style={{ backgroundImage: HATCH }} />
              ) : (
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: utilColor(pct) }}>
                  {stale && <div className="h-full w-full" style={{ backgroundImage: HATCH }} />}
                </div>
              )}
            </div>
            <span
              className={cn("w-10 shrink-0 text-right tabular-nums", !known && "text-muted-foreground", stale && "opacity-60")}
              style={known ? { color: utilColor(pct) } : undefined}
            >
              {known ? `${pct}%` : "N.A."}
            </span>
            <span className={cn("w-16 shrink-0 text-muted-foreground", stale && "opacity-70")}>{reset}</span>
          </div>
        );
      })}
      {typeof usage?.resetCredits === "number" && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="w-12 shrink-0">resets</span>
          <span className="tabular-nums">{usage.resetCredits} available</span>
        </div>
      )}
    </div>
  );
}
