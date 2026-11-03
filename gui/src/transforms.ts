/**
 * Pure view-model transforms over the CLI's `--json` contract. No Tauri / React
 * imports so they are unit-testable in isolation. The GUI NEVER re-implements
 * profile logic — it only reshapes what `agent-switch <cmd> --json` returns.
 *
 * Anti-rotation: `nearestLimit` is the max utilization of ONE profile's own
 * windows (its own headroom, as the vendor shows it) — never a comparison
 * across accounts.
 */

import { t, type TKey } from "./i18n/index.js";

export type ProviderId = "claude" | "codex" | "antigravity";

/** The stored label values (CLI data — never translated); show them through
 *  {@link profileLabelText}. */
export const PROFILE_LABELS = ["Work", "Personal", "Other"] as const;
export type ProfileLabel = (typeof PROFILE_LABELS)[number];

const PROFILE_LABEL_KEY: Record<ProfileLabel, TKey> = {
  Work: "vm.profileLabel.work",
  Personal: "vm.profileLabel.personal",
  Other: "vm.profileLabel.other",
};

/** A profile label as shown, in the live language. */
export function profileLabelText(label: ProfileLabel): string {
  return t(PROFILE_LABEL_KEY[label]);
}

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

/** A provider's enabled surfaces, whether its CLI binary is usable (on PATH or
 *  linked), and the linked path if the user pointed us at one. A provider that
 *  is neither installed nor linked is shown but cannot be enabled until linked. */
export interface ProviderStatus extends ProviderSurfaces {
  installed: boolean;
  binaryPath?: string | null;
}
export type ProvidersStatus = Record<ProviderId, ProviderStatus>;

export interface ProfileRow {
  provider: ProviderId;
  name: string;
  identity: string | null;
  label: ProfileLabel | null;
  /** Colour picked with `agent-switch color`; absent from older CLIs. */
  color?: string | null;
  /** `agent-switch disable`; absent from older CLIs. */
  disabled?: boolean;
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
  /** "desktop-app" = run from Claude Desktop (`sessions` attributes it by account). */
  surface?: string;
  /** Waiting on a prompt (last hook event Notification, nothing written since). */
  waiting?: boolean;
  /** What it waits on (the open question's id, or the prompt's time). */
  waitingFor?: string;
  /** How `live` was decided: the host registry named it, or only the cwd guess. */
  liveSource?: "registry" | "cwd";
  /** A switch armed for the end of this session's turn (`rebind --when-idle`). */
  armed?: { target: string; createdAt: string; expiresAt: string } | null;
  /** The session's prompt-cache state (Claude only; null when unknown). */
  cache?: SessionCache | null;
  /** Git facts of the folder the session works in now; null outside a repo. */
  git?: SessionGit | null;
  /** v3: PRs on the session's head commit, from the PR cache (newest first). */
  prs?: unknown[];
  /** v3: helper sessions and subagents (`sessions --json` → children). */
  children?: unknown[];
  childCount?: number;
  /** v3: the session key of the parent, when this one is a helper. */
  parent?: string;
  /** v3: library entry and whether the transcript is kept. */
  library?: { name: string | null; tags: string[]; pinned: boolean; archived: boolean; autoKept: boolean } | null;
  kept?: unknown;
  canResume?: boolean;
}

/** `sessions --json` → `git`; `cwdSource` says where the folder came from. */
export interface SessionGit {
  toplevel: string;
  branch: string | null;
  headSha: string | null;
  dirty: boolean;
  changed: number;
  ahead: number | null;
  behind: number | null;
  upstream: string | null;
  remote: string | null;
  worktree: boolean;
  cwd: string;
  cwdSource: "hook" | "process" | "transcript";
}

/** `sessions --json` → `cache`: whether the prompt cache is still warm and
 *  what the next turn re-sends once it is cold. Tokens only, never money. */
export interface SessionCache {
  state: "warm" | "cold" | "compacted" | "unknown";
  ttl: "5m" | "1h" | null;
  lastResponseAt: string | null;
  expiresAt: string | null;
  resendTokens: number | null;
  source: "transcript" | "host";
}

/** One line for a session's prompt cache, e.g. "warm till 10:42" or
 *  "cold · next turn re-sends ~182k". Empty when nothing is known. Pure. */
export function formatCacheLine(cache: SessionCache | null | undefined): string {
  if (!cache) return "";
  if (cache.state === "warm") {
    if (!cache.expiresAt) return t("vm.cache.warm");
    const d = new Date(cache.expiresAt);
    const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    return t("vm.cache.warmTill", { time });
  }
  if (cache.state === "cold") return cache.resendTokens == null ? t("vm.cache.cold") : t("vm.cache.coldResend", { tokens: formatTokensK(cache.resendTokens) });
  if (cache.state === "compacted") return t("vm.cache.compacted");
  return "";
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

/** Whether any live session on an active profile was written to within the
 *  freshness window — the pet's "working" signal (mid-work ⇒ subtle badge,
 *  clears on idle). Pure so it is unit-testable; `nowMs` is passed in (never
 *  `Date.now()` inside) so tests are deterministic and refresh-timer jitter
 *  stays out of the logic. Guards, per the AI-council review (2026-07-28,
 *  `agents/runtime/council/responses/pet-busy-signal.json`): a future mtime
 *  (forward clock skew) and an impossibly-old mtime on a still-"live" row both
 *  read as not-working, so a stray non-turn file touch can't pin the badge on.
 *  Emitted on the usage-refresh cadence alongside the context mood — during
 *  sustained work the session file's mtime is seconds-old at each tick, so the
 *  badge lights; once work stops it ages past `freshnessMs` and clears within a
 *  cycle. Option (A) from the review — context-delta tracking (B/C) was rejected
 *  for needing prior-snapshot state and false-positiving on token-count jitter. */
export function isProviderWorking(
  sessions: SessionRow[],
  activeProfiles: string[],
  nowMs: number,
  freshnessMs = 60_000,
  maxReasonableAgeMs = 3_600_000,
): boolean {
  const active = new Set(activeProfiles);
  return sessions.some((s) => {
    if (!s.live || !active.has(s.profile)) return false;
    const age = nowMs - s.mtimeMs;
    if (age < 0) return false; // mtime in the future → clock skew, not a signal
    if (age > maxReasonableAgeMs) return false; // "live" but ancient → not working
    return age <= freshnessMs;
  });
}

/** Tray tooltip for the active profile's worst live-session context fill. One
 *  number, active profile only — never a per-profile list. */
export function contextTrayTooltip(pct: number | null): string {
  return pct == null ? "agent-switch" : t("vm.tray.context", { pct: String(pct) });
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

export type PaceStatus = "ahead" | "on-track" | "behind";

const PACE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const PACE_DAY_MS = 24 * 60 * 60 * 1000;
const PACE_MIN_GAP = 0.05;

/** GUI mirror of the CLI's `windowPace` (src/usage.ts) — kept in sync by
 *  transforms.test.ts. "Ahead of pace" = more of the window's quota used than
 *  of its cycle elapsed, measured against the snapshot's `capturedAt` (never the
 *  wall clock, so a stale snapshot is judged against its real capture instant).
 *  PURELY informational — never an input to any switch decision. Null when it
 *  cannot be judged (no data, the 5h window, within 24h of reset, out of cycle). */
export function windowPace(w: UsageWindow, capturedAtIso: string, minGap: number = PACE_MIN_GAP): PaceStatus | null {
  if (w.utilization === null || w.resetsAt === null) return null;
  const durMs = w.key === "five_hour" ? null : w.key.startsWith("seven_day") || w.key.startsWith("weekly") ? PACE_WEEK_MS : null;
  if (durMs === null) return null;
  const reset = Date.parse(w.resetsAt);
  const captured = Date.parse(capturedAtIso);
  if (Number.isNaN(reset) || Number.isNaN(captured)) return null;
  const elapsedMs = captured - (reset - durMs);
  if (elapsedMs < PACE_DAY_MS) return null; // 24h post-reset suppression
  if (elapsedMs <= 0 || elapsedMs > durMs) return null; // outside this cycle
  const aheadBy = w.utilization / 100 - elapsedMs / durMs;
  if (aheadBy > minGap) return "ahead";
  if (aheadBy < -minGap) return "behind";
  return "on-track";
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
  if (!active) return t("vm.tray.noActive");
  const limit = nearestLimit(usage);
  const profile = `${active.provider}/${active.name}`;
  return limit === null ? `agent-switch — ${profile}` : t("vm.tray.used", { profile, pct: String(limit) });
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
