/**
 * Pure view-model transforms over the CLI's `--json` contract. No Tauri / React
 * imports so they are unit-testable in isolation. The GUI NEVER re-implements
 * profile logic — it only reshapes what `agent-switch <cmd> --json` returns.
 *
 * Anti-rotation: `nearestLimit` is the max utilization of ONE profile's own
 * windows (its own headroom, as the vendor shows it) — never a comparison
 * across accounts.
 */

export type ProviderId = "claude" | "codex" | "antigravity";

export const PROFILE_LABELS = ["Work", "Personal", "Other"] as const;
export type ProfileLabel = (typeof PROFILE_LABELS)[number];

/** Which accounts (by label) auto-switch may switch to; "all" = no filter.
 *  Mirrors the CLI's AutoSwitchTag. */
export type AutoSwitchTag = "all" | ProfileLabel;

/** Which surfaces of a provider are enabled (mirrors the CLI `providers` map). */
export interface ProviderSurfaces {
  cli: boolean;
  ui: boolean;
}
export type ProviderSurface = keyof ProviderSurfaces;
export type ProvidersConfig = Record<ProviderId, ProviderSurfaces>;

/** A provider's enabled surfaces plus whether its CLI binary is installed. A
 *  not-installed provider is shown but cannot be enabled. */
export interface ProviderStatus extends ProviderSurfaces {
  installed: boolean;
}
export type ProvidersStatus = Record<ProviderId, ProviderStatus>;

export interface ProfileRow {
  provider: ProviderId;
  name: string;
  identity: string | null;
  label: ProfileLabel | null;
  active: boolean;
  liveSessions: number;
}

/** Context-window readout for a session/status (Claude). `pct` is that ONE
 *  session's own fill — never a cross-session ranking. `confidence: "low"`
 *  means the window size was estimated, so the UI marks it with a `~`. */
export interface SessionContext {
  pct: number | null;
  contextTokens: number;
  windowTokens: number | null;
  model: string | null;
  confidence: "high" | "low";
}

/** One row from `agent-switch sessions --json` (Claude sessions inventory). */
export interface SessionRow {
  provider: ProviderId;
  profile: string;
  sessionId: string;
  projectDir: string;
  cwd: string | null;
  mtimeMs: number;
  /** File creation time — session age (when it started), vs `mtimeMs` (last
   *  activity). Optional: absent from older payloads/fakes → treat as mtime. */
  birthtimeMs?: number;
  live: boolean;
  summary?: string | null;
  context?: SessionContext | null;
}

/** One turn of a session content preview (ADR-002 bounded reader). */
export interface SessionPreviewMessage {
  role: "user" | "assistant";
  text: string;
}

/** The first few conversation turns of a session, from `sessions preview --json`.
 *  `truncated` = more turns exist past those shown (or the read hit its cap). */
export interface SessionPreview {
  messages: SessionPreviewMessage[];
  truncated: boolean;
}

/** Compact "134k" token count. Pure — used by the context badge. */
export function formatTokensK(n: number): string {
  return `${Math.round(n / 1000)}k`;
}

/** Context badge label for a session row, e.g. "67% · 134k/1000k". Degrades to
 *  "134k tok" when the window size is unknown, prefixes "~" on a low-confidence
 *  (estimated-window) readout, and is empty when there is no context at all. */
export function formatContextBadge(context: SessionContext | null | undefined): string {
  if (!context) return "";
  const prefix = context.confidence === "low" ? "~" : "";
  const tokens = formatTokensK(context.contextTokens);
  if (context.windowTokens == null || context.pct == null) {
    return `${prefix}${tokens} tok`;
  }
  return `${prefix}${context.pct}% · ${tokens}/${formatTokensK(context.windowTokens)}`;
}

/** Highest own context-window fill (0-100) across the ACTIVE profile's live
 *  sessions, or null when none is known. Own-account only — the tray shows this
 *  ONE number, never a comparison across profiles. Pure so it is unit-testable. */
export function worstLiveContextPct(sessions: SessionRow[], activeProfiles: string[]): number | null {
  const active = new Set(activeProfiles);
  const pcts = sessions
    .filter((s) => s.live && active.has(s.profile))
    .map((s) => s.context?.pct)
    .filter((p): p is number => typeof p === "number");
  return pcts.length ? Math.max(...pcts) : null;
}

/** Tray tooltip for the active profile's worst live-session context fill. One
 *  number, active profile only — never a per-profile list. */
export function contextTrayTooltip(pct: number | null): string {
  return pct == null ? "agent-switch" : `agent-switch — ${pct}% context`;
}

/** Compact "how long ago" label from an mtime, e.g. "3m", "2h", "5d". Pure. */
export function relativeAge(mtimeMs: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.floor((now - mtimeMs) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
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
  /** Codex only: banked rate-limit reset credits still available. */
  resetCredits?: number | null;
}

export interface StatusJson {
  provider: ProviderId;
  name: string;
  identity: string | null;
  usage: UsageSnapshot | null;
}

/** Whether a provider exposes a usage readout (Claude + Codex). Auto-switch UI
 *  is shown ONLY for these — there is nothing to trigger on otherwise. Mirrors
 *  the CLI's `Provider.hasUsageReadout`. */
export function hasUsageReadout(provider: ProviderId): boolean {
  return provider === "claude" || provider === "codex";
}

/** Group the flat profile list by provider, preserving order. */
export function groupByProvider(rows: ProfileRow[]): Record<ProviderId, ProfileRow[]> {
  const out: Record<ProviderId, ProfileRow[]> = { claude: [], codex: [], antigravity: [] };
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

/** Pick the candidate with the most headroom (lowest nearest-limit) among the
 *  non-active same-provider profiles — the target the daemon's auto-switch would
 *  choose. A candidate with unknown usage (`max === null`) sinks below any known
 *  value and only wins if nothing has usage. Returns null when there is no
 *  candidate. Pure, so the dev-mode "trigger auto-switch" test is unit-testable. */
export function pickMostHeadroom(candidates: { name: string; max: number | null }[]): string | null {
  let best: { name: string; max: number } | null = null;
  for (const c of candidates) {
    const m = c.max ?? 101; // unknown usage → worse than any real 0-100 value
    if (!best || m < best.max) best = { name: c.name, max: m };
  }
  return best?.name ?? null;
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
