/**
 * Background usage daemon — poller, cache, and (opt-in) threshold notifier.
 *
 * It polls Claude profiles for their OWN usage, appends history, detects
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

import * as fs from "node:fs";
import * as path from "node:path";

import { ROOT, activeFor, configDir, labelFor, listProfiles, readAutoSwitch, readBinaryPath } from "./profiles.js";
import { ProviderId } from "./providers.js";
import { profileDir } from "./profiles.js";
import { fetchUsage, liveSessionPids } from "./api.js";
import { defaultFreshenDeps, freshAccessToken } from "./token-freshen.js";
import { parseUsage, detectCrossings, pickSwitchTarget, maxUtilization, SwitchCandidate, ThresholdState, UsageSnapshot } from "./usage.js";
import { readCodexUsage } from "./codex-usage.js";
import { recordHistorySample } from "./history.js";
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
function notify(event: Pick<Notification, "kind" | "title" | "message">): void {
  const created = appendNotification(event);
  if (created && readOsNotifications() && osNotify(event.title, event.message)) {
    markOsNotified(created.id);
  }
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

/** True when the state's lastPoll is within maxAgeMs of `now` — the CLI/GUI use
 *  this to decide whether to trust the cache instead of hitting the API. */
export function isFresh(state: DaemonState | null, maxAgeMs: number, now: number = Date.now()): boolean {
  if (!state?.lastPoll) return false;
  const t = Date.parse(state.lastPoll);
  return !isNaN(t) && now - t <= maxAgeMs;
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

/**
 * Which Claude profiles to poll this cycle. Normally the active one plus any
 * with a live session — never a busy-poll of idle accounts. With `watchAll`
 * (auto-switch enabled) every profile is polled, since the switch decision
 * needs each candidate's headroom. `liveCheck` is injected for testability.
 */
export function selectPollTargets(
  claudeNames: string[],
  active: string | null,
  liveCheck: (name: string) => boolean,
  watchAll = false,
): string[] {
  if (watchAll) return [...claudeNames];
  const targets = new Set<string>();
  if (active && claudeNames.includes(active)) targets.add(active);
  for (const n of claudeNames) if (liveCheck(n)) targets.add(n);
  return [...targets];
}

/** Exponential backoff on consecutive failures, floored at the base interval
 *  and capped at MAX_BACKOFF_MS. */
export function nextIntervalMs(baseMs: number, consecutiveFailures: number, capMs = MAX_BACKOFF_MS): number {
  const base = Math.max(baseMs, MIN_INTERVAL_MS);
  if (consecutiveFailures <= 0) return base;
  return Math.min(base * 2 ** consecutiveFailures, capMs);
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
async function snapshotFor(provider: ProviderId, name: string): Promise<UsageSnapshot | null> {
  if (provider === "codex") return readCodexUsage(configDir("codex", name));
  // An expired access token is the daemon's most common "usage stopped moving"
  // cause — a profile nobody is running never refreshes itself. Let Claude Code
  // refresh it first (cooldown-guarded, no-op while the token is still good).
  const token = freshAccessToken(configDir("claude", name), defaultFreshenDeps(readBinaryPath("claude")));
  if (!token) return null;
  const raw = await fetchUsage(token);
  return raw ? parseUsage(raw) : null;
}

async function pollProvider(
  provider: ProviderId,
  state: DaemonState,
  thresholds: Map<string, ThresholdState>,
  notifiedReset: Map<string, string>,
  log: (l: string) => void,
): Promise<number> {
  const names = listProfiles(provider);
  const active = activeFor(provider);
  const autoSwitch = readAutoSwitch(provider);
  const isLive = (n: string) => (provider === "claude" ? liveSessionPids(configDir("claude", n)).length > 0 : false);
  const targets = selectPollTargets(names, active, isLive, autoSwitch.enabled);
  let failures = 0;
  const polled: SwitchCandidate[] = [];

  state.notifiedFetchFail = state.notifiedFetchFail ?? {};
  for (const name of targets) {
    const key = `${provider}/${name}`;
    const snapshot = await snapshotFor(provider, name);
    if (!snapshot) {
      failures++;
      // Fail-safe: the last-known snapshot in state.profiles[key] is left intact
      // (never overwritten with null), and we warn ONCE per outage rather than
      // every cycle — the loop keeps serving the last good numbers meanwhile.
      if (!state.notifiedFetchFail[key]) {
        state.notifiedFetchFail[key] = true;
        notify({
          kind: "warning",
          title: "Usage fetch failed",
          message: `Could not fetch usage limits for ${provider}/${name}. Keeping the last known values.`,
        });
      }
      continue;
    }
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

  if (!autoSwitch.enabled || !active) return failures;

  const activeSnap = polled.find((p) => p.name === active)?.snapshot;
  const activeMax = activeSnap ? maxUtilization(activeSnap) : null;
  if (activeMax === null || activeMax < autoSwitch.threshold) return failures; // still has headroom

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
  return failures;
}

async function pollOnce(
  state: DaemonState,
  thresholds: Map<string, ThresholdState>,
  notifiedReset: Map<string, string>,
  log: (l: string) => void,
): Promise<number> {
  let failures = 0;
  for (const provider of AUTO_PROVIDERS) {
    failures += await pollProvider(provider, state, thresholds, notifiedReset, log);
  }
  state.lastPoll = new Date().toISOString();
  state.lastError = failures > 0 ? `${failures} profile(s) failed to poll` : null;
  return failures;
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
  let consecutiveFailures = 0;
  let cycles = 0;

  log(`started (pid ${process.pid}, base interval ${baseInterval}ms).`);
  while (running) {
    try {
      const failures = await pollOnce(state, thresholds, notifiedReset, log);
      consecutiveFailures = failures > 0 ? consecutiveFailures + 1 : 0;
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
