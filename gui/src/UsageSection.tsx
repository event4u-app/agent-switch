import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { usageHistory, type UsageHistoryProfile, type UsageHistorySample } from "./ipc.js";
import { utilColor } from "./UsageBars.js";
import {
  formatReset,
  hasUsageReadout,
  relativeAge,
  type ProfileRow,
  type ProviderId,
  type UsageSnapshot,
  type UsageWindow,
} from "./transforms.js";
import type { UsageEntry } from "./usage-cache.js";

/**
 * Usage section: the cross-account comparison the per-card bars can never
 * answer. One headroom sentence with a one-click switch, one aligned row per
 * account (session + week windows, resets countdown), per-model windows as an
 * expandable sub-row, and a 30-day week-window history chart fed by the
 * daemon's hourly samples. Data reuse: the table + summary read the SAME
 * per-profile snapshots App already fetches/caches for the profile cards —
 * only the history series has its own (cached-in-App) fetch.
 */

const PROVIDER_LABEL: Record<ProviderId, string> = { claude: "Claude", codex: "Codex", antigravity: "Antigravity" };

/** History cache, owned by App (like ToolingCache) so it survives section switches. */
export type UsageHistoryCache = Partial<Record<ProviderId, UsageHistoryProfile[]>>;

const HISTORY_DAYS = 30;
const HISTORY_MS = HISTORY_DAYS * 24 * 60 * 60 * 1000;
/** Chart coordinate space (the SVG scales to its container). */
export const CHART_W = 600;
export const CHART_H = 120;

/** Per-profile polyline colours (cycled) — state colours stay reserved for the
 *  bars; the first two series reuse the app accents for recognisability. */
const SERIES_COLORS = ["hsl(var(--success))", "hsl(var(--primary))", "hsl(var(--muted-foreground))", "#d9a343", "hsl(var(--destructive))"];

export function isWeekKey(key: string): boolean {
  return key.startsWith("seven_day") || key.startsWith("weekly");
}

function isSessionKey(key: string): boolean {
  return key.startsWith("five_hour");
}

/** The overall session (5h) window of a snapshot, if present. */
export function sessionWindow(snap: UsageSnapshot | null): UsageWindow | null {
  return snap?.windows.find((w) => isSessionKey(w.key)) ?? null;
}

/** The overall week window of a snapshot, if present (first week-shaped key —
 *  per-model week windows come after the overall one in the CLI payload). */
export function weekWindow(snap: UsageSnapshot | null): UsageWindow | null {
  return snap?.windows.find((w) => isWeekKey(w.key)) ?? null;
}

/** Windows beyond the two primary ones (per-model entries etc.) — rendered as
 *  an expandable sub-row per account, never in the main comparison row. */
export function extraWindows(snap: UsageSnapshot | null): UsageWindow[] {
  if (!snap) return [];
  const session = sessionWindow(snap);
  const week = weekWindow(snap);
  return snap.windows.filter((w) => w !== session && w !== week);
}

export interface HeadroomPick {
  name: string;
  weekUtil: number | null;
  sessionUtil: number | null;
}

/** The account with the most week-window headroom (lowest week utilization;
 *  ties → first, stable). Falls back to the session window when no account has
 *  week data. Null when nothing has any known utilization. Pure. */
export function pickHeadroom(entries: { name: string; snap: UsageSnapshot | null }[]): HeadroomPick | null {
  let bestWeek: HeadroomPick | null = null;
  let bestSession: HeadroomPick | null = null;
  for (const e of entries) {
    const w = weekWindow(e.snap)?.utilization ?? null;
    const s = sessionWindow(e.snap)?.utilization ?? null;
    if (typeof w === "number" && (bestWeek === null || w < bestWeek.weekUtil!)) {
      bestWeek = { name: e.name, weekUtil: w, sessionUtil: s };
    }
    if (typeof s === "number" && (bestSession === null || s < bestSession.sessionUtil!)) {
      bestSession = { name: e.name, weekUtil: w, sessionUtil: s };
    }
  }
  return bestWeek ?? bestSession;
}

/** Soonest upcoming reset across a snapshot's windows — the row's countdown. */
export function nearestReset(snap: UsageSnapshot | null, now: number): string {
  if (!snap) return "";
  let best: string | null = null;
  let bestT = Infinity;
  for (const w of snap.windows) {
    if (!w.resetsAt) continue;
    const t = Date.parse(w.resetsAt);
    if (!Number.isFinite(t) || t <= now) continue;
    if (t < bestT) {
      bestT = t;
      best = w.resetsAt;
    }
  }
  return best ? formatReset(best, now) : "";
}

/** A profile's week-window utilization series from its history samples,
 *  bounded to the last 30 days, time-sorted. Pure. */
export function weekSeries(samples: UsageHistorySample[], now: number): { t: number; util: number }[] {
  const t0 = now - HISTORY_MS;
  return samples
    .map((s) => ({ t: Date.parse(s.at), util: s.windows.find((w) => isWeekKey(w.key))?.utilization ?? null }))
    .filter((p): p is { t: number; util: number } => Number.isFinite(p.t) && p.t >= t0 && p.t <= now && typeof p.util === "number")
    .sort((a, b) => a.t - b.t);
}

/** SVG polyline points for a week-utilization series in CHART_W×CHART_H space. Pure. */
export function polylinePoints(points: { t: number; util: number }[], now: number): string {
  const t0 = now - HISTORY_MS;
  return points
    .map((p) => `${(((p.t - t0) / HISTORY_MS) * CHART_W).toFixed(1)},${(CHART_H - (Math.min(100, Math.max(0, p.util)) / 100) * CHART_H).toFixed(1)}`)
    .join(" ");
}

/** One aligned bar + % readout cell. `pct >= 90` appends the near-limit text
 *  (already red via utilColor — the same thresholds the daemon uses). */
function WindowCell({ w }: { w: UsageWindow | null }) {
  const known = typeof w?.utilization === "number";
  const pct = Math.min(100, w?.utilization ?? 0);
  return (
    <div className="min-w-0">
      <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
        {known && <div className="h-full rounded-full" style={{ width: `${pct}%`, background: utilColor(pct) }} />}
      </div>
      <div
        className={cn("mt-1 truncate text-[11px] tabular-nums", !known && "text-muted-foreground")}
        style={known ? { color: utilColor(pct) } : undefined}
      >
        {known ? `${pct}%${pct >= 90 ? " — near the limit" : ""}` : "N.A."}
      </div>
    </div>
  );
}

const ROW_GRID = "grid grid-cols-[minmax(0,1.1fr)_1fr_1fr_4.5rem] items-center gap-x-4";

export function UsageSection({
  rows,
  usage,
  nowTick,
  history,
  onHistory,
  onSwitch,
}: {
  rows: ProfileRow[];
  usage: Record<string, UsageEntry>;
  nowTick: number;
  history: UsageHistoryCache;
  onHistory: (provider: ProviderId, data: UsageHistoryProfile[]) => void;
  onSwitch: (provider: ProviderId, name: string) => void;
}) {
  // Providers with a usage readout that actually have profiles. Claude-anchored;
  // codex appears alongside once codex profiles exist (it has a readout too).
  const providers = (["claude", "codex"] as ProviderId[]).filter(
    (p) => hasUsageReadout(p) && rows.some((r) => r.provider === p),
  );
  const [provider, setProvider] = useState<ProviderId>("claude");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // If the anchored provider has no profiles (e.g. codex-only setup), jump to
  // the first one that does.
  useEffect(() => {
    if (providers.length > 0 && !providers.includes(provider)) setProvider(providers[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  // History is fetched once per provider on section open and cached by App
  // (like the tooling sweep) so section switches never re-fetch.
  const hist = history[provider];
  useEffect(() => {
    if (hist) return;
    let cancelled = false;
    void usageHistory(provider).then((d) => {
      if (!cancelled) onHistory(provider, d);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, hist === undefined]);

  const profs = rows.filter((r) => r.provider === provider);
  const entries = profs.map((r) => ({ row: r, snap: usage[`${provider}/${r.name}`]?.snap ?? null }));
  const pick = pickHeadroom(entries.map((e) => ({ name: e.row.name, snap: e.snap })));
  const activeName = profs.find((r) => r.active)?.name ?? null;

  // Footer freshness: the newest capturedAt among the shown snapshots.
  let newestCaptured = -Infinity;
  for (const e of entries) {
    if (!e.snap) continue;
    const t = Date.parse(e.snap.capturedAt);
    if (Number.isFinite(t) && t > newestCaptured) newestCaptured = t;
  }
  const refreshedAgo = Number.isFinite(newestCaptured) ? relativeAge(newestCaptured, nowTick) : null;

  const series = (hist ?? [])
    .map((h, i) => ({ profile: h.profile, color: SERIES_COLORS[i % SERIES_COLORS.length], points: weekSeries(h.samples, nowTick) }))
    .filter((s) => s.points.length > 0);

  function headroomSentence(p: HeadroomPick): string {
    const parts: string[] = [];
    if (typeof p.weekUtil === "number") parts.push(`${Math.round(100 - p.weekUtil)}% of the week window free`);
    if (typeof p.sessionUtil === "number") parts.push(`${Math.round(p.sessionUtil)}% of the session window used`);
    return parts.join(" · ");
  }

  function toggleExpanded(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="space-y-2.5">
      <div>
        <div className="text-sm font-semibold tracking-tight">Usage</div>
        <p className="text-xs text-muted-foreground">
          Which account has room — session and week windows compared across your own profiles.
        </p>
      </div>

      {providers.length > 1 && (
        <div
          role="tablist"
          className="grid gap-1 rounded-lg bg-muted p-1"
          style={{ gridTemplateColumns: `repeat(${providers.length}, minmax(0, 1fr))` }}
        >
          {providers.map((pid) => (
            <button
              key={pid}
              role="tab"
              aria-selected={provider === pid}
              onClick={() => setProvider(pid)}
              className={cn(
                "rounded-md px-2 py-1 text-xs font-medium transition-colors",
                provider === pid ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {PROVIDER_LABEL[pid]}
            </button>
          ))}
        </div>
      )}

      {/* Headroom summary — the page answers one question first. Same data the
          profile cards show; same pick shape the auto-switch daemon uses. */}
      <div className="rounded-[10px] border border-border bg-card px-4 py-3">
        <div className="text-[10px] font-semibold uppercase tracking-[.09em] text-muted-foreground">
          Most headroom right now
        </div>
        {pick ? (
          <div className="mt-1 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="text-sm font-semibold">{pick.name}</span>{" "}
              <span className="text-xs text-muted-foreground">{headroomSentence(pick)}</span>
            </div>
            {activeName === pick.name ? (
              <span className="shrink-0 text-[11px] font-medium text-[hsl(var(--success))]">active</span>
            ) : (
              <Button size="sm" className="shrink-0" onClick={() => onSwitch(provider, pick.name)}>
                Switch to it
              </Button>
            )}
          </div>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">No usage data yet — it appears after the first refresh.</p>
        )}
      </div>

      {/* Comparison table — one row per account, aligned columns. */}
      <div className="rounded-[10px] border border-border bg-card px-4 py-3">
        <div className={cn(ROW_GRID, "border-b border-border pb-1.5 text-[10px] font-semibold uppercase tracking-[.09em] text-muted-foreground")}>
          <span>By account</span>
          <span>Session (5h)</span>
          <span>Week</span>
          <span>Resets</span>
        </div>
        {entries.length === 0 && (
          <p className="py-3 text-xs text-muted-foreground">No {PROVIDER_LABEL[provider]} profiles yet.</p>
        )}
        {entries.map((e) => {
          const key = `${provider}/${e.row.name}`;
          const extras = extraWindows(e.snap);
          const isOpen = expanded.has(key);
          return (
            <div key={key} className="border-b border-border py-2.5 last:border-0 last:pb-0.5">
              <div className={ROW_GRID}>
                <div className="flex min-w-0 items-center gap-1.5">
                  {extras.length > 0 && (
                    <button
                      aria-label={`${isOpen ? "Hide" : "Show"} per-model usage for ${e.row.name}`}
                      aria-expanded={isOpen}
                      onClick={() => toggleExpanded(key)}
                      className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {isOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                    </button>
                  )}
                  <div className="min-w-0">
                    <span className={cn("block truncate text-[13px] font-semibold", !e.snap && "text-muted-foreground")}>
                      {e.row.name}
                    </span>
                    {e.row.label && (
                      <Badge variant="secondary" className="mt-0.5">
                        {e.row.label}
                      </Badge>
                    )}
                  </div>
                </div>
                {e.snap ? (
                  <>
                    <WindowCell w={sessionWindow(e.snap)} />
                    <WindowCell w={weekWindow(e.snap)} />
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {nearestReset(e.snap, nowTick) || "—"}
                    </span>
                  </>
                ) : (
                  <span className="col-span-3 text-[11px] text-muted-foreground">
                    No readout — sign in once to enable
                  </span>
                )}
              </div>
              {isOpen && extras.length > 0 && (
                <div className="mt-1.5 space-y-1.5 pl-5">
                  {extras.map((w) => (
                    <div key={w.key} className="grid grid-cols-[minmax(0,1.02fr)_2fr_4.5rem] items-center gap-x-4">
                      <span className="truncate text-[11px] text-muted-foreground" title={w.label}>
                        {w.label}
                      </span>
                      <WindowCell w={w} />
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        {formatReset(w.resetsAt, nowTick) || "—"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Week-window history — the daemon's hourly samples over the last 30 days. */}
      <div className="rounded-[10px] border border-border bg-card px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[10px] font-semibold uppercase tracking-[.09em] text-muted-foreground">
            Week window · last {HISTORY_DAYS} days
          </div>
          {series.length > 0 && (
            <div data-testid="history-legend" className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              {series.map((s) => (
                <span key={s.profile} className="flex items-center gap-1">
                  <span aria-hidden className="size-2 rounded-full" style={{ background: s.color }} />
                  {s.profile}
                </span>
              ))}
            </div>
          )}
        </div>
        {hist === undefined ? (
          <p className="mt-2 text-xs text-muted-foreground">Loading history…</p>
        ) : series.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            History appears after the background service has been running for a while.
          </p>
        ) : (
          <>
            <svg
              viewBox={`0 0 ${CHART_W} ${CHART_H}`}
              preserveAspectRatio="none"
              className="mt-2 h-32 w-full"
              role="img"
              aria-label={`Week-window utilization per account over the last ${HISTORY_DAYS} days`}
            >
              {series.map((s) => (
                <polyline
                  key={s.profile}
                  points={polylinePoints(s.points, nowTick)}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ))}
            </svg>
            <div className="mt-1 flex items-center justify-between border-t border-border pt-1 text-[10px] text-muted-foreground">
              <span>{HISTORY_DAYS} days ago</span>
              <span>today</span>
            </div>
          </>
        )}
      </div>

      {/* The scope disclaimer is permanent — AS reads its own accounts' quota
          endpoints and nothing else. */}
      <div className="flex items-center justify-between px-0.5 text-[11px] text-muted-foreground">
        <span>{refreshedAgo ? `Refreshed ${refreshedAgo} ago · own profiles only` : "Own profiles only"}</span>
        <span>
          {PROVIDER_LABEL[provider]} · {profs.length} {profs.length === 1 ? "profile" : "profiles"}
        </span>
      </div>
    </div>
  );
}
