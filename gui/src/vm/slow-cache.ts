/**
 * The slow parts of a load, cached between reloads (the classic window's
 * cadence). A reload follows every action and every tray focus; re-running
 * these each time spawns `tooling --json` and `doctor --json` and spends the
 * unauthenticated GitHub budget (60 requests/h) on latest-version lookups.
 *
 * - tooling sweep: kept until "Check now" forces one, or a focus finds it
 *   older than FOCUS_RESWEEP_MS;
 * - latest-version lookups: at most once per LATEST_TTL_MS per tool, forced
 *   sweep or not (a failure is remembered too — a rate-limited answer must not
 *   be retried on the next reload);
 * - doctor: kept until Health asks again (screen open, "Check again", a repair).
 *
 * Module state, one per window (each webview has its own JS context).
 */

export const FOCUS_RESWEEP_MS = 60_000;
export const LATEST_TTL_MS = 3_600_000;

interface Entry<T> {
  at: number;
  value: T;
}

let tooling: Entry<unknown> | null = null;
let doctor: Entry<unknown> | null = null;
const latest = new Map<string, Entry<string | null>>();
let forceTooling = false;
let forceDoctor = false;

/** The next load re-runs the tooling sweep ("Check now"). */
export function forceToolsOnNextLoad(): void {
  forceTooling = true;
}

/** The next load re-runs `doctor` (Health open, "Check again", a repair). */
export function forceDoctorOnNextLoad(): void {
  forceDoctor = true;
}

/** A window focus: re-sweep only when the last sweep is at least FOCUS_RESWEEP_MS old. */
export function resweepToolsIfStale(now: number = Date.now()): void {
  if (tooling && now - tooling.at >= FOCUS_RESWEEP_MS) forceTooling = true;
}

async function cached<T>(
  slot: Entry<unknown> | null,
  force: boolean,
  run: () => Promise<T>,
  store: (e: Entry<T>) => void,
  now: () => number,
): Promise<Entry<T>> {
  if (slot && !force) return slot as Entry<T>;
  const value = await run();
  const entry = { at: now(), value };
  store(entry);
  return entry;
}

/** The tooling sweep, cached. A failed sweep is not cached (it throws through). */
export async function cachedTooling<T>(run: () => Promise<T>, now: () => number = Date.now): Promise<Entry<T>> {
  const force = forceTooling;
  forceTooling = false;
  return cached(tooling, force, run, (e) => (tooling = e), now);
}

/** `doctor`, cached. A failed run is not cached (it throws through). */
export async function cachedDoctor<T>(run: () => Promise<T>, now: () => number = Date.now): Promise<Entry<T>> {
  const force = forceDoctor;
  forceDoctor = false;
  return cached(doctor, force, run, (e) => (doctor = e), now);
}

/** A tool's latest version, looked up at most once per LATEST_TTL_MS. */
export async function cachedLatest(id: string, lookup: () => Promise<string | null>, now: () => number = Date.now): Promise<string | null> {
  const hit = latest.get(id);
  if (hit && now() - hit.at < LATEST_TTL_MS) return hit.value;
  const value = await lookup().catch(() => null);
  latest.set(id, { at: now(), value });
  return value;
}

/** Tests only. */
export function resetSlowCache(): void {
  tooling = null;
  doctor = null;
  latest.clear();
  forceTooling = false;
  forceDoctor = false;
}
