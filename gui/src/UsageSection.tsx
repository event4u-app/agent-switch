import { useEffect, useState } from "react";
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
 * answer. One headroom sentence with a one-click switch, one tile per account
 * (headline stat, every window as an always-visible bar, a per-profile week
 * sparkline), and a 30-day week-window history chart fed by the daemon's
 * hourly samples. Data reuse: the tiles + summary read the SAME per-profile
 * snapshots App already fetches/caches for the profile cards — only the
 * history series has its own (cached-in-App) fetch.
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

/** Windows beyond the two primary ones (per-model entries etc.) — rendered on
 *  the tile right after session + week, always visible. */
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

/** The window closest to its limit (highest known utilization; ties → first) —
 *  the tile's one glanceable headline. Null when nothing has a readout. Pure. */
export function biggestConstraint(snap: UsageSnapshot | null): UsageWindow | null {
  if (!snap) return null;
  let best: UsageWindow | null = null;
  for (const w of snap.windows) {
    if (typeof w.utilization !== "number") continue;
    if (!best || w.utilization > best.utilization!) best = w;
  }
  return best;
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

/** One compact labeled bar on a tile: label · thin bar · % · reset countdown.
 *  `pct >= 90` is already red via utilColor — same thresholds as the daemon. */
function TileWindowRow({ w, now }: { w: UsageWindow; now: number }) {
  const known = typeof w.utilization === "number";
  const pct = Math.min(100, w.utilization ?? 0);
  const reset = known ? formatReset(w.resetsAt, now) : "";
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-14 shrink-0 truncate text-muted-foreground" title={w.label}>
        {w.label}
      </span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
        {known && <div className="h-full rounded-full" style={{ width: `${pct}%`, background: utilColor(pct) }} />}
      </div>
      <span
        className={cn("w-9 shrink-0 text-right tabular-nums", !known && "text-muted-foreground")}
        style={known ? { color: utilColor(pct) } : undefined}
      >
        {known ? `${pct}%` : "N.A."}
      </span>
      <span className="w-14 shrink-0 text-right tabular-nums text-muted-foreground">{reset || "—"}</span>
    </div>
  );
}

/** One account tile: header (name + label + active), headline stat, every
 *  window as an always-visible bar, and a 30-day week sparkline. Informational
 *  only — the headroom card above keeps the single switch action, so tiles
 *  deliberately do NOT mirror the Profiles rows. */
function ProfileTile({
  row,
  snap,
  samples,
  now,
}: {
  row: ProfileRow;
  snap: UsageSnapshot | null;
  samples: UsageHistorySample[];
  now: number;
}) {
  const header = (
    <div className="flex min-w-0 items-center gap-2">
      <span className={cn("truncate text-[13px] font-semibold", !snap && "text-muted-foreground")}>{row.name}</span>
      {row.label && (
        <Badge variant="secondary" className="shrink-0">
          {row.label}
        </Badge>
      )}
      {row.active && (
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-[hsl(var(--success))]">
          <span aria-hidden className="size-1.5 rounded-full bg-[hsl(var(--success))]" />
          Active
        </span>
      )}
    </div>
  );

  if (!snap) {
    return (
      <div className="rounded-[10px] border border-border bg-card px-4 py-3">
        {header}
        <p className="mt-1.5 text-[11px] text-muted-foreground">No readout — sign in once to enable</p>
      </div>
    );
  }

  const ordered = [sessionWindow(snap), weekWindow(snap), ...extraWindows(snap)].filter((w): w is UsageWindow => w !== null);
  const big = biggestConstraint(snap);
  const bigPct = big ? Math.min(100, big.utilization!) : null;
  const week = weekWindow(snap);
  const weekPct = typeof week?.utilization === "number" ? Math.min(100, week.utilization) : null;
  const points = weekSeries(samples, now);

  function windowNoun(w: UsageWindow): string {
    if (w === sessionWindow(snap)) return "session";
    if (w === weekWindow(snap)) return "week";
    return w.label;
  }

  return (
    <div className="flex flex-col rounded-[10px] border border-border bg-card px-4 py-3">
      {header}
      {big ? (
        <div className="mt-1 text-xs font-medium tabular-nums" style={{ color: utilColor(bigPct!) }}>
          {bigPct! >= 90 ? `${bigPct}% — near the limit` : `${bigPct}% of ${windowNoun(big)} used`}
        </div>
      ) : (
        <div className="mt-1 text-xs text-muted-foreground">No utilization data yet</div>
      )}
      <div className="mt-2 space-y-1.5">
        {ordered.map((w) => (
          <TileWindowRow key={w.key} w={w} now={now} />
        ))}
      </div>
      {/* Week sparkline — the profile's own 30-day trend, from the same history
          fetch the comparison chart uses. Never a fake flat line: no samples →
          a caption instead. */}
      <div className="mt-auto pt-2">
        {points.length > 0 ? (
          <svg
            data-testid={`sparkline-${row.name}`}
            viewBox={`0 0 ${CHART_W} ${CHART_H}`}
            preserveAspectRatio="none"
            className="h-7 w-full"
            role="img"
            aria-label={`${row.name} week-window utilization over the last ${HISTORY_DAYS} days`}
          >
            <polyline
              points={polylinePoints(points, now)}
              fill="none"
              stroke={weekPct !== null ? utilColor(weekPct) : "hsl(var(--muted-foreground))"}
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
        ) : (
          <p className="text-[10px] text-muted-foreground">No history yet</p>
        )}
      </div>
    </div>
  );
}

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
  // Tile order: active profile first, then input order (stable sort).
  const tiles = [...entries].sort((a, b) => Number(b.row.active) - Number(a.row.active));
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

      {/* Account tiles — one per profile, everything visible at once: headline
          stat, all windows (incl. per-model) as bars, and a week sparkline. */}
      <div>
        <div className="px-0.5 text-[10px] font-semibold uppercase tracking-[.09em] text-muted-foreground">
          By account
        </div>
        {tiles.length === 0 ? (
          <p className="mt-1.5 text-xs text-muted-foreground">No {PROVIDER_LABEL[provider]} profiles yet.</p>
        ) : (
          <div data-testid="usage-tiles" className="mt-1.5 grid gap-2.5 min-[900px]:grid-cols-2">
            {tiles.map((e) => (
              <ProfileTile
                key={`${provider}/${e.row.name}`}
                row={e.row}
                snap={e.snap}
                samples={(hist ?? []).find((h) => h.profile === e.row.name)?.samples ?? []}
                now={nowTick}
              />
            ))}
          </div>
        )}
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
