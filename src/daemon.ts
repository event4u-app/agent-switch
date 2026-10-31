/**
 * Background usage daemon — poller, cache, and (opt-in) threshold notifier.
 *
 * It polls Claude and Codex profiles for their OWN usage — the active one, any
 * with a live session, and the members of pools a folder rule targets (spaced
 * to {@link POOL_POLL_INTERVAL_MS}, so `dir`'s pool pick has fresh numbers) —
 * appends history, detects
 * active-profile threshold crossings, and writes `daemon-state.json` so
 * `status`/the GUI can read a fresh snapshot without hitting the API. When
 * `autoSwitch.enabled` (default OFF) it also watches every profile and, once the
 * active one hits the configured threshold, NOTIFIES the operator and SUGGESTS
 * the account with the most headroom — it never switches automatically. The
 * suggestion is a convenience; the actual switch is always a user interaction
 * (see `AutoSwitchConfig`). The daemon never mutates the active profile.
 *
 * Codex banked resets: when the active Codex profile is over the threshold and
 * holds a reset credit, the daemon NOTIFIES that one is available (once per
 * reset cycle). It never redeems one — that is an explicit user action
 * (`agent-switch reset`, or the GUI's confirmed button). It also fires the
 * per-profile protection notice (see `protection.ts`): a warning only, nothing
 * is paused or switched.
 *
 * The pure helpers (single-instance, poll-target selection, backoff, state
 * freshness, suggestion decision in `usage.ts`) are exported for unit testing;
 * `runDaemon` is the loop.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { ROOT, activeFor, configDir, isDisabled, labelFor, listProfiles, readAutoSwitch, readBinaryPath } from "./profiles.js";
import { ProviderId } from "./providers.js";
import { profileDir } from "./profiles.js";
import { fetchUsage, liveSessionPids, readProfileCredential } from "./api.js";
import { claudeLoginRefreshAllowed, defaultFreshenDeps, usageToken } from "./token-freshen.js";
import { parseUsage, detectCrossings, pickSwitchTarget, maxUtilization, SwitchCandidate, ThresholdState, UsageSnapshot } from "./usage.js";
import { readCodexUsage } from "./codex-usage.js";
import { LATEST_FILE, recordHistorySample, writeLatestSnapshot } from "./history.js";
import { appendNotification, markOsNotified, Notification } from "./notifications.js";
import { readOsNotifications } from "./profiles.js";
import { osNotify } from "./os-notify.js";
import { SessionRow, listSessions, listCodexSessions, markLive } from "./sessions.js";
import { readContext } from "./telemetry.js";
import {
  readTelemetryConfig,
  detectContextCrossings,
  coalesce,
  ContextThresholdState,
  ContextSample,
} from "./notify.js";
import { readEvents, eventFile } from "./hooks.js";
import { protectionNotice, readProtection } from "./protection.js";
import { execFileSync } from "node:child_process";

/** Append an event to the shared log and, when the operator opted into
 *  daemon-side OS notifications, fire a desktop notification too — marking the
 *  record so the GUI does not show it a second time. Deduped events (append
 *  returns null) never OS-notify. */
function notify(event: Pick<Notification, "kind" | "title" | "message">, opts: { os?: boolean } = {}): void {
  const created = appendNotification(event);
  if (created && opts.os !== false && readOsNotifications() && osNotify(event.title, event.message)) {
    markOsNotified(created.id);
  }
}

/** How long reads must fail before it counts as an outage. A single failed read
 *  is routine — a rate-limited endpoint answers again a minute later — and the
 *  last known values keep being served meanwhile. */
export const FETCH_OUTAGE_MS = 15 * 60_000;

/** The notice for a profile whose reads have failed since `sinceMs`, or null
 *  while it is still a blip. Kept off the desktop: a fetch failure is a
 *  diagnostic for the app's log, not something to interrupt anyone for. */
export function fetchFailureNotice(
  key: string,
  sinceMs: number,
  now: number,
): { kind: "warning"; title: string; message: string; os: false } | null {
  if (now - sinceMs < FETCH_OUTAGE_MS) return null;
  return {
    kind: "warning",
    title: "Usage fetch failed",
    message: `Could not fetch usage limits for ${key} for ${Math.round((now - sinceMs) / 60_000)} min. Keeping the last known values.`,
    os: false,
  };
}

// Providers the daemon may suggest a switch for on threshold (they expose a
// usage readout to base a headroom suggestion on). Antigravity has none.
const AUTO_PROVIDERS = ["claude", "codex"] as const;

export const PIDFILE = path.join(ROOT, "daemon.pid");
export const STATE_FILE = path.join(ROOT, "daemon-state.json");
export const MIN_INTERVAL_MS = 60_000; // never poll faster than once a minute
export const MAX_BACKOFF_MS = 30 * 60_000; // cap backoff at 30 min

/** A live session's context snapshot for the GUI/status (schema-versioned via
 *  the enclosing DaemonState). Own-session only. */
export interface SessionContextSnapshot {
  sessionId: string;
  pct: number | null;
  contextTokens: number;
  windowTokens: number | null;
  where: string;
  confidence: "high" | "low";
  at: string;
}

export interface DaemonState {
  lastPoll: string | null;
  pollIntervalMs: number;
  /** "claude/<name>" → the profile's own usage snapshot. */
  profiles: Record<string, UsageSnapshot>;
  lastError: string | null;
  /** "provider/<name>" → per-live-session context snapshots (active profile). */
  sessionContext?: Record<string, SessionContextSnapshot[]>;
  /** Persisted usage-window fired state (fixes the restart re-fire gap). */
  usageThresholds?: Record<string, ThresholdState>;
  /** Persisted per-session context fired state. */
  contextThresholds?: Record<string, ContextThresholdState>;
  /** "provider/<name>" → true while a usage-fetch failure has already been
   *  notified, so the daemon warns ONCE per outage instead of every cycle. */
  notifiedFetchFail?: Record<string, boolean>;
  /** When a profile's usage reads started failing (ISO), per `provider/name`. */
  fetchFailingSince?: Record<string, string>;
  /** "provider/<name>" → the window cycle the protection warning last fired for. */
  protectionNotified?: Record<string, string>;
}

// ---------- state file (the cache) ----------

export function readDaemonState(file: string = STATE_FILE): DaemonState | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as DaemonState;
  } catch {
    return null;
  }
}

export function writeDaemonState(state: DaemonState, file: string = STATE_FILE): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
}

// ---------- single instance (pidfile) ----------

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err?.code === "EPERM";
  }
}

export function readPid(file: string = PIDFILE): number | null {
  try {
    const n = Number(fs.readFileSync(file, "utf8").trim());
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * Acquire the single-instance lock. Returns true and writes the pidfile when no
 * live daemon holds it (taking over a stale pidfile); false when another live
 * daemon is already running.
 */
export function acquireSingleInstance(myPid: number, file: string = PIDFILE): boolean {
  const existing = readPid(file);
  if (existing && existing !== myPid && processAlive(existing)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, String(myPid) + "\n", { mode: 0o600 });
  return true;
}

export function releaseSingleInstance(myPid: number, file: string = PIDFILE): void {
  if (readPid(file) === myPid) {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      /* best-effort */
    }
  }
}

// ---------- poll discipline ----------

/** How often a profile that is polled ONLY because a pool rule targets it is
 *  refreshed. Below {@link FRESH_USAGE_MS} (10 min) so `dir` keeps seeing pool
 *  members as fresh, yet five times sparser than the active profile's cadence —
 *  idle pool members cost one usage read per profile every 5 minutes. */
export const POOL_POLL_INTERVAL_MS = 5 * 60_000;

/**
 * Which profiles to poll this cycle. Normally the active one plus any with a
 * live session — never a busy-poll of idle accounts. With `watchAll`
 * (auto-switch enabled) every profile is polled, since the switch decision
 * needs each candidate's headroom. `pooled` profiles (every enabled account:
 * plain starts and pools are balanced across them) are added too, but only once
 * their last capture is at least
 * {@link POOL_POLL_INTERVAL_MS} old — that is what keeps `dir`'s pool pick on
 * fresh numbers without polling idle accounts every minute. `liveCheck` and
 * `lastCapturedMs` are injected for testability.
 */
export function selectPollTargets(
  claudeNames: string[],
  active: string | null,
  liveCheck: (name: string) => boolean,
  watchAll = false,
  pooled: readonly string[] = [],
  lastCapturedMs: (name: string) => number | null = () => null,
  now: number = Date.now(),
): string[] {
  if (watchAll) return [...claudeNames];
  const targets = new Set<string>();
  if (active && claudeNames.includes(active)) targets.add(active);
  for (const n of claudeNames) if (liveCheck(n)) targets.add(n);
  for (const n of pooled) {
    if (!claudeNames.includes(n) || targets.has(n)) continue;
    const last = lastCapturedMs(n);
    if (last === null || now - last >= POOL_POLL_INTERVAL_MS) targets.add(n);
  }
  return [...targets];
}

/** Exponential backoff on consecutive failures, floored at the base interval
 *  and capped at MAX_BACKOFF_MS. */
export function nextIntervalMs(baseMs: number, consecutiveFailures: number, capMs = MAX_BACKOFF_MS): number {
  const base = Math.max(baseMs, MIN_INTERVAL_MS);
  if (consecutiveFailures <= 0) return base;
  return Math.min(base * 2 ** consecutiveFailures, capMs);
}

/** One profile's own backoff: a dead login must not slow the healthy ones. */
export interface ProfileBackoff {
  failures: number;
  /** Epoch ms before which this profile is not read again. */
  nextAt: number;
  /** {@link loginStamp} of the stored login at the failure; a different one
   *  (signed in again, refreshed) lifts the backoff. Absent = time only. */
  stamp?: string | null;
}

/** The profile's backoff after a read — undefined once a read succeeds. */
export function nextProfileBackoff(
  prev: ProfileBackoff | undefined,
  ok: boolean,
  baseMs: number,
  now: number,
  stamp?: string | null,
): ProfileBackoff | undefined {
  if (ok) return undefined;
  const failures = (prev?.failures ?? 0) + 1;
  return { failures, nextAt: now + nextIntervalMs(baseMs, failures), ...(stamp !== undefined ? { stamp } : {}) };
}

export function backoffBlocks(b: ProfileBackoff | undefined, now: number, stamp?: string | null): boolean {
  if (b === undefined) return false;
  if (b.stamp !== undefined && stamp !== b.stamp) return false;
  return now < b.nextAt;
}

/** A fingerprint of a stored login, so a change can be noticed without the
 *  service holding on to the credential. */
export function loginStamp(raw: string | null): string | null {
  return raw === null ? null : crypto.createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 16);
}

/** The targets a cycle reads: those not held back by their own backoff. The
 *  login is read only for a profile that has a backoff entry. */
export function dueTargets(
  provider: ProviderId,
  targets: readonly string[],
  backoff: ReadonlyMap<string, ProfileBackoff>,
  now: number,
  stampOf: (name: string) => string | null,
): string[] {
  return targets.filter((n) => {
    const b = backoff.get(`${provider}/${n}`);
    return !b || !backoffBlocks(b, now, b.stamp !== undefined ? stampOf(n) : undefined);
  });
}

/** The loop-wide failure count after a cycle: it grows only when every read
 *  failed (offline, API down) — single failures are handled by
 *  {@link nextProfileBackoff}. A cycle that read nothing leaves it unchanged. */
export function nextConsecutiveFailures(prev: number, failures: number, attempted: number): number {
  if (attempted === 0) return prev;
  return failures >= attempted ? prev + 1 : 0;
}

/** How old a cached snapshot may be and still be served instead of a live read:
 *  the daemon's slowest cadence (an idle account, or its current interval when
 *  that is longer) plus one loop wake. A healthy daemon answers from cache; a
 *  profile whose reads keep failing ages out and is read live. */
export function cacheMaxAgeMs(pollIntervalMs: number | undefined): number {
  return Math.max(POOL_POLL_INTERVAL_MS, pollIntervalMs ?? 0) + MIN_INTERVAL_MS;
}

export function snapshotFresh(snap: UsageSnapshot | undefined | null, now: number = Date.now(), maxAgeMs = cacheMaxAgeMs(undefined)): boolean {
  if (!snap) return false;
  const t = Date.parse(snap.capturedAt);
  return !isNaN(t) && now - t <= maxAgeMs;
}

// ---------- threshold action decision (pure, no side-effects) ----------

export interface ThresholdAction {
  /** NOTIFY the operator the active profile is out of headroom (with a suggestion). */
  notify: boolean;
  /** The account SUGGESTED (most headroom), or null when none qualifies. NEVER
   *  switched to automatically — the switch is always a user interaction. */
  suggestedTarget: string | null;
}

/**
 * Compliance-locked threshold decision (Council follow-up). Given the active
 * profile and the same-provider candidates polled this cycle, decide whether to
 * NOTIFY and which account to SUGGEST. Pure — no I/O, and crucially NO `setActive`:
 * the daemon never auto-switches. Returns `{ notify: false }` while the active
 * profile still has headroom (or auto-switch is off / there is no active profile).
 * `notify` fires only alongside a concrete suggestion, mirroring the behavior
 * before this decision was extracted from `pollProvider`.
 */
export function decideThresholdAction(
  active: string | null,
  polled: SwitchCandidate[],
  autoSwitch: { enabled: boolean; threshold: number },
  isEligible: (name: string) => boolean = () => true,
): ThresholdAction {
  if (!autoSwitch.enabled || !active) return { notify: false, suggestedTarget: null };
  const activeSnap = polled.find((p) => p.name === active)?.snapshot;
  const activeMax = activeSnap ? maxUtilization(activeSnap) : null;
  if (activeMax === null || activeMax < autoSwitch.threshold) return { notify: false, suggestedTarget: null };
  const target = pickSwitchTarget(active, polled, autoSwitch.threshold, isEligible);
  const suggestedTarget = target && target !== active ? target : null;
  return { notify: suggestedTarget !== null, suggestedTarget };
}

/**
 * The "a banked Codex reset is available" notice (D3). Pure: returns the notice
 * when the active profile is at/over the threshold, holds a reset credit, and
 * this reset cycle was not announced yet — else null. Redeeming stays an
 * explicit user action (`agent-switch reset`, the GUI's confirmed button).
 */
export function codexResetNotice(
  active: string,
  snap: UsageSnapshot,
  threshold: number,
  lastNotifiedCycle: string | undefined,
): { cycle: string; title: string; message: string } | null {
  if ((snap.resetCredits ?? 0) <= 0) return null;
  const stuck = snap.windows.find((w) => typeof w.utilization === "number" && w.utilization >= threshold);
  if (!stuck) return null;
  const cycle = stuck.resetsAt ?? "";
  if (lastNotifiedCycle === cycle) return null;
  return {
    cycle,
    title: "Codex reset available",
    message:
      `codex/${active} hit ≥${threshold}% and has ${snap.resetCredits} banked reset(s). ` +
      `Nothing was redeemed — to use one: agent-switch reset ${active} --provider codex`,
  };
}

// ---------- context monitoring (own-session; Phase 3) ----------

let _claudeVer: string | null | undefined;
function claudeVer(): string | null {
  if (_claudeVer !== undefined) return _claudeVer;
  try {
    _claudeVer = execFileSync("claude", ["--version"], { encoding: "utf8" }).trim() || null;
  } catch {
    _claudeVer = null;
  }
  return _claudeVer;
}

/** Session ids for `provider/name` that saw a real compaction (or a fresh
 *  clear) since `sinceISO`, from the hook event ring — the ground-truth re-arm
 *  signal (Phase 2.5). Empty when hooks are not installed. */
function compactedSince(provider: ProviderId, name: string, sinceISO: string | null): Set<string> {
  const out = new Set<string>();
  const since = sinceISO ? Date.parse(sinceISO) : 0;
  for (const e of readEvents(eventFile(ROOT, provider, name))) {
    if (!e.sessionId) continue;
    const isCompact = e.event === "PreCompact" || e.event === "PostCompact" || (e.event === "SessionStart" && (e.source === "compact" || e.source === "clear"));
    if (isCompact && (!since || Date.parse(e.at) >= since)) out.add(e.sessionId);
  }
  return out;
}

/**
 * Tail the active profile's LIVE sessions, snapshot their own context into the
 * daemon state, detect per-session threshold crossings (edge-triggered, re-armed
 * on real compaction events), and record ONE coalesced event in the shared
 * notification log per cycle when alerts are enabled. Local file reads only —
 * no API calls. Own-session only: nothing here compares profiles. Best-effort;
 * never throws.
 */
export function monitorContext(provider: ProviderId, name: string, state: DaemonState, log: (l: string) => void): void {
  try {
    if (provider !== "claude" && provider !== "codex") return;
    const cfg = configDir(provider, name);
    const rows: SessionRow[] = provider === "codex" ? listCodexSessions(cfg, 30) : listSessions(cfg, 30);
    if (provider === "claude") markLive(cfg, rows);
    const live = rows.filter((r) => r.live && r.file);
    const key = `${provider}/${name}`;
    const now = new Date().toISOString();

    const samples: ContextSample[] = [];
    const snapshots: SessionContextSnapshot[] = [];
    for (const r of live) {
      const c = readContext(provider, r.file!, { claudeVersion: claudeVer() });
      if (!c) continue;
      const where = (r.cwd ?? r.projectDir).split("/").filter(Boolean).slice(-1)[0] || r.projectDir;
      samples.push({ sessionId: r.sessionId, pct: c.pct, where });
      snapshots.push({ sessionId: r.sessionId, pct: c.pct, contextTokens: c.contextTokens, windowTokens: c.windowTokens, where, confidence: c.confidence, at: now });
    }

    state.sessionContext = state.sessionContext ?? {};
    state.sessionContext[key] = snapshots;

    const cfgT = readTelemetryConfig(ROOT);
    const prev: ContextThresholdState = (state.contextThresholds ?? {})[key] ?? {};
    const compacted = compactedSince(provider, name, state.lastPoll);
    const { crossings, state: next } = detectContextCrossings(samples, prev, cfgT.contextThresholds, compacted);
    state.contextThresholds = state.contextThresholds ?? {};
    state.contextThresholds[key] = next;

    for (const c of crossings) log(`context: ${provider}/${name} ${c.where} crossed ${c.threshold}% (now ${c.pct}%)`);
    // Feed the ONE coalesced crossing into the shared notification log (the app's
    // single notifier: the GUI bell/flyout reads it and fires a best-effort
    // desktop notification). Off by default via the alerts config.
    const note = coalesce(crossings);
    if (note && cfgT.notify) {
      appendNotification({ kind: "warning", title: note.title, message: note.body });
    }
  } catch (err: any) {
    log(`context monitor error: ${String(err?.message ?? err)}`);
  }
}

// ---------- the loop ----------

interface RunOptions {
  intervalMs?: number;
  log?: (line: string) => void;
  /** Test seam: stop after N cycles (default: run forever). */
  maxCycles?: number;
}

/** One poll cycle: refresh the state cache for the selected profiles. Returns
 *  the number of failures this cycle (for backoff). */
/** One profile's own usage snapshot: Claude via its OAuth endpoint, Codex via
 *  the live `wham/usage` read. null when unreadable (counts as a poll failure). */
async function snapshotFor(provider: ProviderId, name: string, log: (l: string) => void): Promise<UsageSnapshot | null> {
  if (provider === "codex") return readCodexUsage(configDir("codex", name));
  // An expired access token is the daemon's most common "usage stopped moving"
  // cause — a profile nobody is running never refreshes itself. Let Claude Code
  // refresh it first (cooldown-guarded, no-op while the token is still good) —
  // only while "Keep accounts signed in" allows it (token-freshen.ts).
  const token = usageToken(configDir("claude", name), defaultFreshenDeps(readBinaryPath("claude")), claudeLoginRefreshAllowed(name), (outcome, reason) => {
    if (outcome === "unavailable") log(`freshen: claude/${name} — could not start \`claude doctor\` (${reason}; if Claude Code is installed elsewhere, link it in the app)`);
    else if (outcome === "still-expired") log(`freshen: claude/${name} — Claude Code could not refresh the login (sign in again)`);
  });
  if (!token) return null;
  const raw = await fetchUsage(token);
  return raw ? parseUsage(raw) : null;
}

/** The stored login behind a profile, fingerprinted: Claude's credential
 *  store, Codex's auth.json. Read after a failure, so a refresh the failed
 *  read already triggered counts as the baseline, not as a change. */
function loginStampFor(provider: ProviderId, name: string): string | null {
  if (provider === "claude") return loginStamp(readProfileCredential(configDir("claude", name)));
  try {
    return loginStamp(fs.readFileSync(path.join(configDir(provider, name), "auth.json"), "utf8"));
  } catch {
    return null;
  }
}

interface CycleResult {
  failures: number;
  attempted: number;
}

async function pollProvider(
  provider: ProviderId,
  state: DaemonState,
  thresholds: Map<string, ThresholdState>,
  notifiedReset: Map<string, string>,
  backoff: Map<string, ProfileBackoff>,
  baseMs: number,
  log: (l: string) => void,
): Promise<CycleResult> {
  const names = listProfiles(provider).filter((n) => !isDisabled(provider, n));
  const active = activeFor(provider);
  const autoSwitch = readAutoSwitch(provider);
  const isLive = (n: string) => (provider === "claude" ? liveSessionPids(configDir("claude", n)).length > 0 : false);
  // Every start without a folder rule is balanced across all enabled accounts
  // (dir-resolve.ts), so each one needs fresh numbers — at the pool cadence.
  const pooled = names;
  const lastCaptured = (n: string) => {
    const t = Date.parse(state.profiles[`${provider}/${n}`]?.capturedAt ?? "");
    return isNaN(t) ? null : t;
  };
  const targets = dueTargets(provider, selectPollTargets(names, active, isLive, autoSwitch.enabled, pooled, lastCaptured), backoff, Date.now(), (n) =>
    loginStampFor(provider, n),
  );
  let failures = 0;
  const polled: SwitchCandidate[] = [];

  state.notifiedFetchFail = state.notifiedFetchFail ?? {};
  state.fetchFailingSince = state.fetchFailingSince ?? {};
  for (const name of targets) {
    const key = `${provider}/${name}`;
    const snapshot = await snapshotFor(provider, name, log);
    const nextBackoff = snapshot ? undefined : nextProfileBackoff(backoff.get(key), false, baseMs, Date.now(), loginStampFor(provider, name));
    if (nextBackoff) backoff.set(key, nextBackoff);
    else backoff.delete(key);
    if (!snapshot) {
      failures++;
      // Fail-safe: the last-known snapshot in state.profiles[key] is left intact
      // (never overwritten with null). Only an outage is reported, once.
      const since = state.fetchFailingSince[key] ?? (state.fetchFailingSince[key] = new Date().toISOString());
      const notice = state.notifiedFetchFail[key] ? null : fetchFailureNotice(key, Date.parse(since), Date.now());
      if (notice) {
        state.notifiedFetchFail[key] = true;
        notify(notice, { os: notice.os });
      }
      continue;
    }
    delete state.fetchFailingSince[key];
    if (state.notifiedFetchFail[key]) {
      delete state.notifiedFetchFail[key];
      log(`recovered: ${provider}/${name} usage fetch succeeded again`);
    }
    state.profiles[key] = snapshot;
    polled.push({ name, snapshot });
    // Session protection (per profile, default on at 98 %): a warning only.
    const pNotice = protectionNotice(key, snapshot, readProtection(provider, name), state.protectionNotified?.[key]);
    if (pNotice) {
      state.protectionNotified = { ...(state.protectionNotified ?? {}), [key]: pNotice.cycle };
      log(`protection: ${pNotice.message}`);
      // "info", not "warning": the GUI mutes warnings by default (fetch-failure
      // noise), and a default-on protection notice must actually be seen.
      notify({ kind: "info", title: pNotice.title, message: pNotice.message });
    }
    recordHistorySample(path.join(profileDir(provider, name), "usage-history.json"), snapshot);
    writeLatestSnapshot(path.join(profileDir(provider, name), LATEST_FILE), snapshot);
    if (name === active) {
      const prev = thresholds.get(`${provider}/${name}`) ?? {};
      const { crossings, state: next } = detectCrossings(snapshot, prev);
      thresholds.set(`${provider}/${name}`, next);
      for (const c of crossings) {
        log(`threshold: ${provider}/${name} ${c.window} crossed ${c.threshold}% (now ${c.utilization}%)`);
        notify({
          kind: "info",
          title: "Usage threshold crossed",
          message: `${provider}/${name} ${c.window} passed ${c.threshold}% (now ${c.utilization}%).`,
        });
      }
    }
  }

  // Context monitoring is local file I/O only — it must run for the active
  // profile even when the usage API poll failed (expired token, offline).
  if (active) monitorContext(provider, active, state, log);

  const result = { failures, attempted: targets.length };
  if (!autoSwitch.enabled || !active) return result;

  const activeSnap = polled.find((p) => p.name === active)?.snapshot;
  const activeMax = activeSnap ? maxUtilization(activeSnap) : null;
  if (activeMax === null || activeMax < autoSwitch.threshold) return result; // still has headroom

  // Codex only (banked resets are a Codex feature): a reset credit is scarce and
  // redeeming it is the user's call (D3) — the daemon only says one is there,
  // once per reset cycle, and never calls the redeem endpoint itself.
  if (provider === "codex" && activeSnap) {
    const notice = codexResetNotice(active, activeSnap, autoSwitch.threshold, notifiedReset.get(`codex/${active}`));
    if (notice) {
      notifiedReset.set(`codex/${active}`, notice.cycle);
      log(`threshold: codex/${active} over ≥${autoSwitch.threshold}% with a banked reset available → notifying (no automatic redeem)`);
      notify({ kind: "info", title: notice.title, message: notice.message });
    }
  }

  // Tag filter: only accounts carrying the configured label are eligible switch
  // targets ("all" = no filter). Lets the operator pool e.g. only Work accounts.
  const eligible = (name: string) => autoSwitch.tag === "all" || labelFor(provider, name) === autoSwitch.tag;
  // Compliance decision is a pure function (decideThresholdAction): it returns
  // notify + a suggested target and NEVER a switch — see the daemon no-auto-switch
  // regression test. pollProvider only turns that decision into log + notify I/O.
  const action = decideThresholdAction(active, polled, autoSwitch, eligible);
  const target = action.suggestedTarget;
  if (action.notify && target) {
    // Compliance: the daemon NEVER switches automatically. It only names the
    // suggested account with the most headroom; switching stays a user
    // interaction (CLI/GUI). No `setActive` call here.
    log(`threshold: ${provider}/${active} out of headroom (≥${autoSwitch.threshold}%) → suggesting ${provider}/${target} (no automatic switch)`);
    // Name the command that opens the limit dialog (claude only — rebind is
    // claude-scoped). Wording only; the notify/suggest DECISION above is unchanged.
    const how = provider === "claude"
      ? "Run `agent-switch rebind` to switch (no automatic switch)."
      : "Switch manually (no automatic switch).";
    notify({
      kind: "warning",
      title: "Usage limit near",
      message: `${provider}/${active} hit ≥${autoSwitch.threshold}% — suggested profile: ${provider}/${target}. ${how}`,
    });
  }
  return result;
}

async function pollOnce(
  state: DaemonState,
  thresholds: Map<string, ThresholdState>,
  notifiedReset: Map<string, string>,
  backoff: Map<string, ProfileBackoff>,
  baseMs: number,
  log: (l: string) => void,
): Promise<CycleResult> {
  const total: CycleResult = { failures: 0, attempted: 0 };
  for (const provider of AUTO_PROVIDERS) {
    const r = await pollProvider(provider, state, thresholds, notifiedReset, backoff, baseMs, log);
    total.failures += r.failures;
    total.attempted += r.attempted;
  }
  state.lastPoll = new Date().toISOString();
  state.lastError = total.failures > 0 ? `${total.failures} profile(s) failed to poll` : null;
  return total;
}

/** Run the daemon loop. Single-instance; SIGTERM-clean. */
export async function runDaemon(opts: RunOptions = {}): Promise<void> {
  const log = opts.log ?? ((l: string) => console.log(`[daemon] ${new Date().toISOString()} ${l}`));
  const baseInterval = Math.max(opts.intervalMs ?? MIN_INTERVAL_MS, MIN_INTERVAL_MS);

  if (!acquireSingleInstance(process.pid)) {
    log("another daemon is already running — exiting.");
    return;
  }
  let running = true;
  const stop = () => {
    running = false;
    releaseSingleInstance(process.pid);
    log("stopped.");
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  const state: DaemonState = readDaemonState() ?? {
    lastPoll: null,
    pollIntervalMs: baseInterval,
    profiles: {},
    lastError: null,
  };
  // Load persisted usage-window fired state so crossings do NOT re-fire after a
  // daemon restart within the same window cycle (the pre-existing in-memory gap).
  const thresholds = new Map<string, ThresholdState>(Object.entries(state.usageThresholds ?? {}));
  // `<provider>/<name>` → the window resets_at we last announced a banked reset
  // for, so the "reset available" notice fires once per cycle, not every poll.
  const notifiedReset = new Map<string, string>();
  const backoff = new Map<string, ProfileBackoff>();
  let consecutiveFailures = 0;
  let cycles = 0;

  log(`started (pid ${process.pid}, base interval ${baseInterval}ms).`);
  while (running) {
    try {
      const { failures, attempted } = await pollOnce(state, thresholds, notifiedReset, backoff, baseInterval, log);
      consecutiveFailures = nextConsecutiveFailures(consecutiveFailures, failures, attempted);
    } catch (err: any) {
      consecutiveFailures++;
      state.lastError = String(err?.message ?? err);
      log(`poll error: ${state.lastError}`);
    }
    const wait = nextIntervalMs(baseInterval, consecutiveFailures);
    state.pollIntervalMs = wait;
    state.usageThresholds = Object.fromEntries(thresholds); // persist for restart
    writeDaemonState(state);

    if (opts.maxCycles !== undefined && ++cycles >= opts.maxCycles) break;
    // Jitter ±10% so many machines don't poll in lockstep.
    const jitter = wait * 0.1 * (Math.random() * 2 - 1);
    await new Promise((r) => setTimeout(r, wait + jitter));
  }
  releaseSingleInstance(process.pid);
}
