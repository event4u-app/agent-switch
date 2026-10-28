import { useEffect, useState } from "react";
import { usageHistory } from "../../ipc.js";
import { AccountDot, identityColor } from "../../ui/AccountDot.js";
import { Button } from "../../ui/Button.js";
import { Card } from "../../ui/Card.js";
import { ago } from "../../ui/format.js";
import { SectionHeader } from "../../ui/Typography.js";
import { topRanked, TOOL_LABEL } from "../../vm/rules.js";
import { useAS } from "../../vm/store.js";
import type { Account } from "../../vm/types.js";
import { dailyPeaks, hasReadout, lastValue, linePath, providerOf } from "./account-logic.js";
import { makeDefault } from "./account-actions.js";

export type HistoryMap = Record<string, (number | null)[]>;

/** Week-window peak per day per account id, read from `usage history` for each
 *  provider that has accounts. Empty until it lands; a failed readout stays
 *  empty (the design's "No history yet" state). */
export function useUsageHistory(accounts: readonly Account[], now: number): HistoryMap {
  const [map, setMap] = useState<HistoryMap>({});
  const providers = Array.from(new Set(accounts.map((a) => providerOf(a.tool)).filter((p) => p != null)));
  const key = providers.join(",");
  useEffect(() => {
    let cancelled = false;
    void Promise.all(providers.map(async (p) => ({ p, rows: await usageHistory(p) }))).then((all) => {
      if (cancelled) return;
      const out: HistoryMap = {};
      for (const { p, rows } of all) for (const r of rows) out[`${p}:${r.profile}`] = dailyPeaks(r.samples, now);
      setMap(out);
    });
    return () => {
      cancelled = true;
    };
    // Read once per provider set; the clock tick must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return map;
}

const W = 640;
const H = 150;

/** Multi-line 30-day chart. Bundle `zP`. */
function HistoryChart({ series }: { series: { id: string; label: string; color: string; values: (number | null)[] }[] }) {
  const y = (v: number) => H - (v / 100) * H;
  return (
    <div className="grid grid-cols-[32px_minmax(0,1fr)] gap-x-2">
      <div className="relative h-[150px] font-ac-mono text-[10px] text-ac-faint">
        {[100, 50, 0].map((v) => (
          <span key={v} className="absolute right-0 -translate-y-1/2" style={{ top: `${100 - v}%` }}>
            {v}%
          </span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-[150px] w-full overflow-visible"
        role="img"
        aria-label="Week window, peak use per day, last 30 days"
      >
        {[0, 50, 100].map((v) => (
          <line key={v} x1="0" x2={W} y1={y(v)} y2={y(v)} stroke="var(--ac-line)" strokeDasharray={v === 100 ? "3 4" : undefined} vectorEffect="non-scaling-stroke" />
        ))}
        {series.map((s) => (
          <path key={s.id} d={linePath(s.values, W, H)} fill="none" stroke={s.color} strokeWidth="1.75" strokeLinejoin="round" vectorEffect="non-scaling-stroke">
            <title>{s.label}</title>
          </path>
        ))}
      </svg>
      <span />
      <div className="mt-1 flex justify-between text-[10px] text-ac-faint">
        <span>30 days ago</span>
        <span>2 weeks ago</span>
        <span>today</span>
      </div>
    </div>
  );
}

/** Area sparkline of the account sheet. Bundle `HP`. */
export function Sparkline({ values, color }: { values: (number | null)[]; color: string }) {
  const line = linePath(values, 400, 56);
  const known = values.map((v, i) => (v == null ? null : i)).filter((i): i is number => i != null);
  const step = 400 / Math.max(1, values.length - 1);
  const area = known.length ? `${line} L${known[known.length - 1] * step},56 L${known[0] * step},56 Z` : "";
  return (
    <svg viewBox="0 0 400 56" className="h-14 w-full" preserveAspectRatio="none" role="img" aria-label="Peak use per day, last 30 days">
      <line x1="0" x2={400} y1={1.12} y2={1.12} stroke="var(--ac-line2)" strokeDasharray="3 4" />
      {area && <path d={area} fill={color} opacity="0.12" />}
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Accounts › Usage history. Bundle `FP`. */
export function UsageHistory({ history }: { history?: HistoryMap }) {
  const s = useAS();
  const loaded = useUsageHistory(s.accounts, s.now);
  const h = history ?? loaded;
  const tools = Array.from(new Set(s.accounts.map((a) => a.tool)));
  const refreshed = Math.max(0, ...s.accounts.map((a) => a.checkedAt ?? 0));
  return (
    <div className="flex flex-col gap-6">
      {tools.map((tool) => {
        const all = s.accounts.filter((a) => a.tool === tool);
        const withData = all.filter((a) => hasReadout(h[a.id]));
        const top = topRanked(s.accounts, tool, s.now)?.account;
        return (
          <section key={tool} className="flex flex-col gap-2">
            <SectionHeader title={TOOL_LABEL[tool]} count={all.length} />
            {top && (
              <Card className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <span className="flex min-w-0 items-center gap-2.5 text-[13px] text-ac-text">
                  <AccountDot color={top.color} size={10} />
                  <span className="min-w-0">
                    Most headroom right now: <b className="font-medium">{top.name}</b>
                  </span>
                </span>
                {top.isDefault ? (
                  <span className="text-xs text-ac-muted">Already used for plain starts</span>
                ) : (
                  <Button size="sm" onClick={() => makeDefault(top, s)}>
                    Use for plain starts
                  </Button>
                )}
              </Card>
            )}
            <Card className="flex flex-col gap-4 p-4">
              {withData.length ? (
                <>
                  <HistoryChart series={withData.map((a) => ({ id: a.id, label: a.name, color: identityColor(a.color), values: h[a.id] }))} />
                  <ul className="flex flex-wrap gap-x-5 gap-y-1.5">
                    {withData.map((a) => (
                      <li key={a.id} className="flex items-center gap-2 text-xs text-ac-soft">
                        <AccountDot color={a.color} size={8} />
                        {a.name}
                        <span className="font-ac-mono text-[11px] text-ac-faint">{lastValue(h[a.id])}%</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-xs text-ac-muted">No history yet — it builds up while Agent Switch reads usage.</p>
              )}
              {withData.length > 0 && all.length > withData.length && (
                <p className="text-[11px] text-ac-faint">
                  No readout for{" "}
                  {all
                    .filter((a) => !hasReadout(h[a.id]))
                    .map((a) => a.name)
                    .join(", ")}{" "}
                  — sign in once to start one.
                </p>
              )}
            </Card>
          </section>
        );
      })}
      <p className="px-1 text-[11px] text-ac-faint">
        Week window, peak use per day · own accounts only · refreshed {refreshed ? ago(refreshed, s.now) : "never"}
      </p>
    </div>
  );
}
