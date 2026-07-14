/**
 * Pure view-model transforms over the CLI's `--json` contract. No Tauri / React
 * imports so they are unit-testable in isolation. The GUI NEVER re-implements
 * profile logic — it only reshapes what `agent-switch <cmd> --json` returns.
 *
 * Anti-rotation: `nearestLimit` is the max utilization of ONE profile's own
 * windows (its own headroom, as the vendor shows it) — never a comparison
 * across accounts.
 */

export type ProviderId = "claude" | "codex" | "gemini";

export const PROFILE_LABELS = ["Work", "Personal", "Other"] as const;
export type ProfileLabel = (typeof PROFILE_LABELS)[number];

/** Which surfaces of a provider are enabled (mirrors the CLI `providers` map). */
export interface ProviderSurfaces {
  cli: boolean;
  ui: boolean;
}
export type ProviderSurface = keyof ProviderSurfaces;
export type ProvidersConfig = Record<ProviderId, ProviderSurfaces>;

export interface ProfileRow {
  provider: ProviderId;
  name: string;
  identity: string | null;
  label: ProfileLabel | null;
  active: boolean;
  liveSessions: number;
}

export interface UsageWindow {
  key: string;
  label: string;
  utilization: number | null;
  resetsAt: string | null;
}

export interface UsageSnapshot {
  windows: UsageWindow[];
  routines: { used: number; limit: number } | null;
  capturedAt: string;
}

export interface StatusJson {
  provider: ProviderId;
  name: string;
  identity: string | null;
  usage: UsageSnapshot | null;
}

/** Whether a provider exposes a usage readout (Claude only). Auto-switch UI is
 *  shown ONLY for these — there is nothing to trigger on otherwise. Mirrors the
 *  CLI's `Provider.hasUsageReadout`. */
export function hasUsageReadout(provider: ProviderId): boolean {
  return provider === "claude";
}

/** Group the flat profile list by provider, preserving order. */
export function groupByProvider(rows: ProfileRow[]): Record<ProviderId, ProfileRow[]> {
  const out: Record<ProviderId, ProfileRow[]> = { claude: [], codex: [], gemini: [] };
  for (const r of rows) out[r.provider].push(r);
  return out;
}

/** The active profile row, if any. */
export function activeRow(rows: ProfileRow[]): ProfileRow | null {
  return rows.find((r) => r.active) ?? null;
}

/** Highest own-window utilization (0-100) for a single profile, or null when no
 *  usage is known. This is the profile's OWN nearest-limit headroom — not a
 *  cross-account ranking. */
export function nearestLimit(usage: UsageSnapshot | null): number | null {
  if (!usage) return null;
  const vals = usage.windows.map((w) => w.utilization).filter((u): u is number => typeof u === "number");
  return vals.length ? Math.max(...vals) : null;
}

/** Tray tooltip: active profile + its nearest own limit. */
export function trayTooltip(active: ProfileRow | null, usage: UsageSnapshot | null): string {
  if (!active) return "agent-switch — no active profile";
  const limit = nearestLimit(usage);
  const head = limit === null ? "" : ` · ${limit}% used`;
  return `agent-switch — ${active.provider}/${active.name}${head}`;
}

/** Relative "resets in" hint from an ISO timestamp, e.g. "2h 47m" or "5d 3h".
 *  Empty when unknown/past. Pure so it is unit-testable (pass `now`). */
export function formatReset(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (isNaN(t)) return "";
  let s = Math.floor((t - now) / 1000);
  if (s <= 0) return "";
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** A tiny sparkline string from a utilization series (GUI + statusline). */
export function sparkline(series: number[]): string {
  if (series.length === 0) return "";
  const blocks = "▁▂▃▄▅▆▇█";
  return series
    .map((v) => blocks[Math.min(blocks.length - 1, Math.max(0, Math.round((v / 100) * (blocks.length - 1))))])
    .join("");
}
