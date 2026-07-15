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
  const thresholds = new Map<string, ThresholdState>();
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
    writeDaemonState(state);

    if (opts.maxCycles !== undefined && ++cycles >= opts.maxCycles) break;
    // Jitter ±10% so many machines don't poll in lockstep.
    const jitter = wait * 0.1 * (Math.random() * 2 - 1);
    await new Promise((r) => setTimeout(r, wait + jitter));
  }
  releaseSingleInstance(process.pid);
}
