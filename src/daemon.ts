/**
 * Background usage daemon — poller, cache, and (opt-in) auto-switcher.
 *
 * It polls Claude profiles for their OWN usage, appends history, detects
 * active-profile threshold crossings, and writes `daemon-state.json` so
 * `status`/the GUI can read a fresh snapshot without hitting the API. When
 * `autoSwitch.enabled` (default OFF) it also watches every profile and moves the
 * active pointer to the account with the most headroom once the active one hits
 * the configured threshold — pooling accounts to route around limits, which the
 * operator opts into deliberately (see `AutoSwitchConfig`). With auto-switch off
 * it stays a pure poller/cache that never mutates the active profile.
 *
 * The pure helpers (single-instance, poll-target selection, backoff, state
 * freshness, switch decision in `usage.ts`) are exported for unit testing;
 * `runDaemon` is the loop.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { ROOT, activeFor, configDir, listProfiles, readAutoSwitch, setActive, readSwitchStrategy, SwitchStrategy } from "./profiles.js";
import { ProviderId } from "./providers.js";
import { profileDir } from "./profiles.js";
import { accessTokenOf, fetchUsage, liveSessionPids, readProfileCredential } from "./api.js";
import { parseUsage, detectCrossings, pickSwitchTarget, maxUtilization, SwitchCandidate, ThresholdState, UsageSnapshot } from "./usage.js";
import { readCodexUsage } from "./codex-usage.js";
import { redeemResetCredit } from "./codex-reset.js";
import { appendSample } from "./history.js";
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

// Providers whose active profile the daemon may auto-switch (they expose a
// usage readout to base a headroom decision on). Gemini has none.
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
  const creds = readProfileCredential(configDir("claude", name));
  const token = creds ? accessTokenOf(creds) : null;
  if (!token) return null;
  const raw = await fetchUsage(token);
  return raw ? parseUsage(raw) : null;
}

async function pollProvider(
  provider: ProviderId,
  strategy: SwitchStrategy,
  state: DaemonState,
  thresholds: Map<string, ThresholdState>,
  redeemed: Map<string, string>,
  log: (l: string) => void,
): Promise<number> {
  const names = listProfiles(provider);
  const active = activeFor(provider);
  const autoSwitch = readAutoSwitch(provider);
  const isLive = (n: string) => (provider === "claude" ? liveSessionPids(configDir("claude", n)).length > 0 : false);
  const targets = selectPollTargets(names, active, isLive, autoSwitch.enabled);
  let failures = 0;
  const polled: SwitchCandidate[] = [];

  for (const name of targets) {
    const snapshot = await snapshotFor(provider, name);
    if (!snapshot) {
      failures++;
      notify({
        kind: "warning",
        title: "Usage fetch failed",
        message: `Could not fetch usage limits for ${provider}/${name}.`,
      });
      continue;
    }
    state.profiles[`${provider}/${name}`] = snapshot;
    polled.push({ name, snapshot });
    appendSample(path.join(profileDir(provider, name), "usage-history.json"), snapshot);
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

  // reset-first (Codex only — banked resets are a Codex feature): redeem a reset
  // instead of switching, but AT MOST ONCE per reset cycle. We record the
  // window's resets_at BEFORE calling, so a buggy reset that doesn't actually
  // clear usage can never loop and burn the whole balance — it falls through to
  // a profile switch on the same poll's next-cycle.
  if (strategy === "reset-first" && provider === "codex" && activeSnap) {
    const stuck = activeSnap.windows.find((w) => typeof w.utilization === "number" && w.utilization >= autoSwitch.threshold);
    const cycle = stuck?.resetsAt ?? "";
    const guardKey = `codex/${active}`;
    if ((activeSnap.resetCredits ?? 0) > 0 && redeemed.get(guardKey) !== cycle) {
      redeemed.set(guardKey, cycle);
      const r = await redeemResetCredit(configDir("codex", active));
      if (r.ok) {
        log(`auto-switch: codex/${active} over ≥${autoSwitch.threshold}% → redeemed a reset (windows_reset=${r.windowsReset ?? "?"}); staying on ${active}`);
        notify({
          kind: "success",
          title: "Codex reset redeemed",
          message: `codex/${active} hit ≥${autoSwitch.threshold}% — redeemed a banked reset and stayed on ${active}.`,
        });
        return failures;
      }
      log(`auto-switch: codex/${active} reset redeem failed (${r.reason ?? "?"}) → falling back to a profile switch`);
    }
  }

  const target = pickSwitchTarget(active, polled, autoSwitch.threshold);
  if (target && target !== active) {
    setActive(provider, target);
    log(`auto-switch: ${provider}/${active} out of headroom (≥${autoSwitch.threshold}%) → switched active to ${provider}/${target}`);
    notify({
      kind: "success",
      title: "Auto-switched account",
      message: `${provider}/${active} hit ≥${autoSwitch.threshold}% — switched active to ${provider}/${target}.`,
    });
  }
  return failures;
}

async function pollOnce(
  state: DaemonState,
  thresholds: Map<string, ThresholdState>,
  redeemed: Map<string, string>,
  log: (l: string) => void,
): Promise<number> {
  const strategy = readSwitchStrategy();
  let failures = 0;
  for (const provider of AUTO_PROVIDERS) {
    failures += await pollProvider(provider, strategy, state, thresholds, redeemed, log);
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
  // Anti-loop guard for reset-first: `<provider>/<name>` → the window resets_at
  // we last redeemed for, so we never redeem the same stuck cycle twice.
  const redeemed = new Map<string, string>();
  let consecutiveFailures = 0;
  let cycles = 0;

  log(`started (pid ${process.pid}, base interval ${baseInterval}ms).`);
  while (running) {
    try {
      const failures = await pollOnce(state, thresholds, redeemed, log);
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
