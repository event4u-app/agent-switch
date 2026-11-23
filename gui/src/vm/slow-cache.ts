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
 * One cache for both windows: the tray and the main window are separate
 * webviews with their own module state but one localStorage, so every entry is
 * written there with its time, and a read takes the newer of the shared entry
 * and this window's own. The force flags stay per window — they mean "this
 * window's next load", and the run they cause is shared like any other.
 */

export const FOCUS_RESWEEP_MS = 60_000;
export const LATEST_TTL_MS = 3_600_000;

interface Entry<T> {
  at: number;
  value: T;
}

export const SHARED_KEY = "agent-switch.slow-cache.v1";

interface Shared {
  tooling?: Entry<unknown>;
  doctor?: Entry<unknown>;
  latest?: Record<string, Entry<string | null>>;
}

function isEntry(e: unknown): e is Entry<unknown> {
  return !!e && typeof e === "object" && typeof (e as Entry<unknown>).at === "number" && Number.isFinite((e as Entry<unknown>).at) && "value" in e;
}

/** localStorage can be missing or throw (a locked-down webview); that is a miss. */
function readShared(): Shared {
  try {
    const raw = JSON.parse(localStorage.getItem(SHARED_KEY) ?? "{}") as Shared;
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function writeShared(change: (s: Shared) => void): void {
  try {
    const s = readShared();
    change(s);
    localStorage.setItem(SHARED_KEY, JSON.stringify(s));
  } catch {
    /* this window keeps its own copy */
  }
}

function newer<T>(own: Entry<T> | null | undefined, shared: unknown): Entry<T> | null {
  const other = isEntry(shared) ? (shared as Entry<T>) : null;
  if (!own) return other;
  return other && other.at > own.at ? other : own;
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
  const last = newer(tooling, readShared().tooling);
  if (last && now - last.at >= FOCUS_RESWEEP_MS) forceTooling = true;
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
  tooling = newer(tooling, readShared().tooling);
  return cached(tooling, force, run, (e) => ((tooling = e), writeShared((s) => void (s.tooling = e))), now);
}

/** `doctor`, cached. A failed run is not cached (it throws through). */
export async function cachedDoctor<T>(run: () => Promise<T>, now: () => number = Date.now): Promise<Entry<T>> {
  const force = forceDoctor;
  forceDoctor = false;
  doctor = newer(doctor, readShared().doctor);
  return cached(doctor, force, run, (e) => ((doctor = e), writeShared((s) => void (s.doctor = e))), now);
}

/** A tool's latest version, looked up at most once per LATEST_TTL_MS. */
export async function cachedLatest(id: string, lookup: () => Promise<string | null>, now: () => number = Date.now): Promise<string | null> {
  const hit = newer(latest.get(id), readShared().latest?.[id]);
  if (hit && now() - hit.at < LATEST_TTL_MS) return hit.value;
  const value = await lookup().catch(() => null);
  const entry = { at: now(), value };
  latest.set(id, entry);
  writeShared((s) => void (s.latest = { ...(s.latest && typeof s.latest === "object" ? s.latest : {}), [id]: entry }));
  return value;
}

/** Tests only. */
export function resetSlowCache(): void {
  tooling = null;
  doctor = null;
  latest.clear();
  forceTooling = false;
  forceDoctor = false;
  try {
    localStorage.removeItem(SHARED_KEY);
  } catch {
    /* nothing shared to drop */
  }
}
