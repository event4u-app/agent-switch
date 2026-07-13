/**
 * Background usage daemon — a responsible poller and a cache, never a switcher.
 *
 * It polls each Claude profile that has a live session (plus the active
 * profile) for its OWN usage, appends history, detects active-profile threshold
 * crossings, and writes `daemon-state.json` so `status`/the GUI can read a fresh
 * snapshot without hitting the API. There is deliberately NO code path here that
 * mutates the active profile or ranks accounts (the anti-rotation lock).
 *
 * The pure helpers (single-instance, poll-target selection, backoff, state
 * freshness) are exported for unit testing; `runDaemon` is the loop.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { ROOT, activeFor, configDir, listProfiles } from "./profiles.js";
import { profileDir } from "./profiles.js";
import { accessTokenOf, fetchUsage, liveSessionPids, readProfileCredential } from "./api.js";
import { parseUsage, detectCrossings, ThresholdState, UsageSnapshot } from "./usage.js";
import { appendSample } from "./history.js";

export const PIDFILE = path.join(ROOT, "daemon.pid");
export const STATE_FILE = path.join(ROOT, "daemon-state.json");
export const MIN_INTERVAL_MS = 60_000; // never poll faster than once a minute
export const MAX_BACKOFF_MS = 30 * 60_000; // cap backoff at 30 min

export interface DaemonState {
  lastPoll: string | null;
  pollIntervalMs: number;
  /** "claude/<name>" → the profile's own usage snapshot. */
  profiles: Record<string, UsageSnapshot>;
  lastError: string | null;
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
 * Which Claude profiles to poll this cycle: the active one plus any with a live
 * session — never a busy-poll of idle accounts. `liveCheck` is injected so the
 * selection is unit-testable.
 */
export function selectPollTargets(
  claudeNames: string[],
  active: string | null,
  liveCheck: (name: string) => boolean,
): string[] {
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

// ---------- the loop ----------

interface RunOptions {
  intervalMs?: number;
  log?: (line: string) => void;
  /** Test seam: stop after N cycles (default: run forever). */
  maxCycles?: number;
}

/** One poll cycle: refresh the state cache for the selected profiles. Returns
 *  the number of failures this cycle (for backoff). */
async function pollOnce(state: DaemonState, thresholds: Map<string, ThresholdState>, log: (l: string) => void): Promise<number> {
  const names = listProfiles("claude");
  const active = activeFor("claude");
  const targets = selectPollTargets(names, active, (n) => liveSessionPids(configDir("claude", n)).length > 0);
  let failures = 0;

  for (const name of targets) {
    const creds = readProfileCredential(configDir("claude", name));
    const token = creds ? accessTokenOf(creds) : null;
    if (!token) {
      // Credential unreadable → log once (by omission of the snapshot), back
      // off, never prompt from the daemon.
      failures++;
      continue;
    }
    const raw = await fetchUsage(token);
    if (!raw) {
      failures++;
      continue;
    }
    const snapshot = parseUsage(raw);
    state.profiles[`claude/${name}`] = snapshot;
    appendSample(path.join(profileDir("claude", name), "usage-history.json"), snapshot);

    // Threshold crossings for the ACTIVE profile only.
    if (name === active) {
      const prev = thresholds.get(name) ?? {};
      const { crossings, state: next } = detectCrossings(snapshot, prev);
      thresholds.set(name, next);
      for (const c of crossings) log(`threshold: claude/${name} ${c.window} crossed ${c.threshold}% (now ${c.utilization}%)`);
    }
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
  const thresholds = new Map<string, ThresholdState>();
  let consecutiveFailures = 0;
  let cycles = 0;

  log(`started (pid ${process.pid}, base interval ${baseInterval}ms).`);
  while (running) {
    try {
      const failures = await pollOnce(state, thresholds, log);
      consecutiveFailures = failures > 0 ? consecutiveFailures + 1 : 0;
    } catch (err: any) {
      consecutiveFailures++;
      state.lastError = String(err?.message ?? err);
      log(`poll error: ${state.lastError}`);
    }
    const wait = nextIntervalMs(baseInterval, consecutiveFailures);
    state.pollIntervalMs = wait;
    writeDaemonState(state);

    if (opts.maxCycles !== undefined && ++cycles >= opts.maxCycles) break;
    // Jitter ±10% so many machines don't poll in lockstep.
    const jitter = wait * 0.1 * (Math.random() * 2 - 1);
    await new Promise((r) => setTimeout(r, wait + jitter));
  }
  releaseSingleInstance(process.pid);
}
