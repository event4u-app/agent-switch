/**
 * Quota from Claude Code's statusLine (ADR-011). Claude Code runs the command set
 * as `statusLine` in a profile's settings.json on every render and passes it a
 * JSON payload on stdin; since 2.1.316 that payload carries `rate_limits`
 * (tests/fixtures/statusline-stdin.json). The managed command, `agent-switch
 * __statusline`, records those windows per profile with no network call and no
 * token read, and prints nothing.
 *
 * Opt-in only (`agent-switch statusline on|off|status`). A profile that already
 * has a statusLine of its own is never touched; wrapping one is out of scope
 * until its lifecycle is proven (ADR-011 rule 2).
 *
 * Per profile, next to the usage history (never inside the config dir, so
 * `share` cannot carry them):
 *   - `usage-statusline.json` — the last sample, monotone within a reset window;
 *   - `statusline-installed`  — "we installed here", so `doctor` can tell a
 *     displaced install from one that never existed.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { readSettings, readSettingsStrict, writeSettings } from "./hooks.js";
import { withFileLockSync } from "./locks.js";
import { parseStatuslineUsage, sameResetCycle, type UsageSnapshot, type UsageWindow } from "./usage.js";

export const STATUSLINE_FILE = "usage-statusline.json";
export const STATUSLINE_MARKER = "statusline-installed";
export const STATUSLINE_ARG = "__statusline";

/** A sample younger than this is served instead of a poll. Below the GUI's
 *  10-minute grey-out, so a served sample never draws as stale on arrival. */
export const STATUSLINE_TTL_MS = 5 * 60_000;

/** The newest Claude Code whose statusLine payload a fixture proves. A newer
 *  one still works; `status` and `doctor` say the contract is unverified. */
export const NEWEST_KNOWN_VERSION = "2.1.316";

/** A render must never wait on another one for long: past this the sample is skipped. */
const WRITE_LOCK_TIMEOUT_MS = 200;

export interface StatuslineCache {
  schema: 1;
  /** Claude Code's `version` from the payload, when it sent one. */
  version: string | null;
  snapshot: UsageSnapshot;
}

export function readStatuslineCache(profileDir: string): StatuslineCache | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(profileDir, STATUSLINE_FILE), "utf8"));
    const snap = raw?.snapshot;
    if (!snap || !Array.isArray(snap.windows) || snap.windows.length === 0 || isNaN(Date.parse(snap.capturedAt))) return null;
    return { schema: 1, version: typeof raw.version === "string" ? raw.version : null, snapshot: { routines: null, ...snap } };
  } catch {
    return null;
  }
}

export function readStatuslineSnapshot(profileDir: string): UsageSnapshot | null {
  return readStatuslineCache(profileDir)?.snapshot ?? null;
}

/** ADR-011 rule 6, per window: within one reset window `used_percentage` never
 *  goes down (several sessions render the last payload each saw); a later reset
 *  starts a new window; a payload still on an earlier one changes nothing. Each
 *  window keeps the capture time of the reading it actually holds, and the
 *  sample's `capturedAt` is its OLDEST window (the rule `mergeUsage` uses), so
 *  replaying an old reading never makes it look fresh. */
export function mergeMonotone(prev: UsageSnapshot | null, next: UsageSnapshot): UsageSnapshot {
  const stamp = (w: UsageWindow, s: UsageSnapshot): UsageWindow => ({ ...w, capturedAt: w.capturedAt ?? s.capturedAt });
  const nextWins = next.windows.map((w) => stamp(w, next));
  if (!prev) return { ...next, windows: nextWins, capturedAt: oldestOf(nextWins, next.capturedAt) };
  const prevBy = new Map(prev.windows.map((w) => [w.key, stamp(w, prev)]));
  const windows = nextWins.map((n) => {
    const p = prevBy.get(n.key);
    prevBy.delete(n.key);
    if (!p) return n;
    if (sameResetCycle(p.resetsAt, n.resetsAt)) return (p.utilization ?? -1) > (n.utilization ?? -1) ? p : n;
    const tp = p.resetsAt ? Date.parse(p.resetsAt) : NaN;
    const tn = n.resetsAt ? Date.parse(n.resetsAt) : NaN;
    return !isNaN(tp) && !isNaN(tn) && tn < tp ? p : n;
  });
  const all = [...windows, ...prevBy.values()];
  return { ...next, windows: all, capturedAt: oldestOf(all, next.capturedAt) };
}

function oldestOf(windows: UsageWindow[], fallback: string): string {
  let best = fallback;
  for (const w of windows) if (w.capturedAt && Date.parse(w.capturedAt) < Date.parse(best)) best = w.capturedAt;
  return best;
}

/** Record a sample (monotone against the file). A null sample writes nothing. */
export function writeStatuslineSnapshot(profileDir: string, snap: UsageSnapshot | null, version: string | null): boolean {
  if (!snap || snap.windows.length === 0) return false;
  const file = path.join(profileDir, STATUSLINE_FILE);
  return withFileLockSync(
    file,
    () => {
      const merged = mergeMonotone(readStatuslineSnapshot(profileDir), snap);
      const body: StatuslineCache = { schema: 1, version: version ?? readStatuslineCache(profileDir)?.version ?? null, snapshot: merged };
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(body) + "\n", { mode: 0o600 });
      fs.renameSync(tmp, file);
      return true;
    },
    WRITE_LOCK_TIMEOUT_MS,
  );
}

/** Young enough to serve, and no window's reset has passed since it was read. */
export function statuslineFresh(snap: UsageSnapshot | null | undefined, now: number = Date.now()): boolean {
  if (!snap) return false;
  const t = Date.parse(snap.capturedAt);
  if (isNaN(t) || now - t >= STATUSLINE_TTL_MS) return false;
  return !snap.windows.some((w) => w.resetsAt !== null && Date.parse(w.resetsAt) <= now);
}

// ---------- the runtime: one render ----------

/** The registered Claude profile whose config dir is `configDir`, or null. Both
 *  sides are canonicalised, so a symlinked or trailing-slash spelling still maps;
 *  an unknown or ambiguous dir maps to nothing (ADR-011 rule 5). */
export function profileForConfigDir(configDir: string | undefined, root: string): string | null {
  if (!configDir) return null;
  const real = (p: string) => {
    try {
      return fs.realpathSync(p);
    } catch {
      return null;
    }
  };
  const want = real(configDir);
  if (!want) return null;
  let names: string[];
  try {
    names = fs.readdirSync(path.join(root, "claude"));
  } catch {
    return null;
  }
  const hits = names.filter((n) => /^[A-Za-z0-9_-]+$/.test(n) && real(path.join(root, "claude", n, "config")) === want);
  return hits.length === 1 ? hits[0] : null;
}

/** One statusLine render: stdin text + env → the profile's cache. Reads only
 *  `rate_limits` and `version`; never throws. */
export function captureStatusline(stdinText: string, env: Record<string, string | undefined>, root: string, capturedAt: string = new Date().toISOString()): void {
  try {
    const name = profileForConfigDir(env.CLAUDE_CONFIG_DIR, root);
    if (!name || !isMarkedInstalled(path.join(root, "claude", name))) return;
    const payload = JSON.parse(stdinText);
    const snap = parseStatuslineUsage({ rate_limits: payload?.rate_limits }, capturedAt);
    if (!snap) return;
    const version = typeof payload?.version === "string" && /^[0-9][0-9A-Za-z.+-]{0,31}$/.test(payload.version) ? payload.version : null;
    writeStatuslineSnapshot(path.join(root, "claude", name), snap, version);
  } catch {
    // a render must never fail because of us
  }
}

/** Is `a` a newer dotted version than `b`? Unparsable → false. */
export function versionNewer(a: string, b: string): boolean {
  const parts = (v: string) => (/^\d+(\.\d+)*/.exec(v)?.[0] ?? "").split(".").filter(Boolean).map(Number);
  const pa = parts(a);
  const pb = parts(b);
  if (pa.length === 0 || pb.length === 0) return false;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

// ---------- settings.json: the managed statusLine ----------

type Settings = Record<string, any>;

const shellQuote = (p: string) => (/^[A-Za-z0-9_./:@%+=-]+$/.test(p) ? p : `'${p.replace(/'/g, "'\\''")}'`);

export function statuslineCommand(bin: string): string {
  return `${shellQuote(bin)} ${STATUSLINE_ARG}`;
}

/** What counts as Agent Switch's own statusLine: the command recorded when it
 *  was installed, or one whose program is an Agent Switch binary. A command of
 *  another tool that happens to end in `__statusline` is not ours. */
export interface Ownership {
  commands: string[];
  binaries: string[];
}

/** The program of a `<path> __statusline` command, unquoted; null for any other shape. */
function programOf(cmd: unknown): string | null {
  if (typeof cmd !== "string") return null;
  const m = /^('(?:[^']|'\\'')*'|\S+) __statusline$/.exec(cmd.trim());
  if (!m) return null;
  return m[1].startsWith("'") ? m[1].slice(1, -1).replace(/'\\''/g, "'") : m[1];
}

function realOrSelf(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

export function isOurStatusline(entry: unknown, own: Ownership): boolean {
  const cmd = (entry as any)?.command;
  const prog = programOf(cmd);
  if (prog === null) return false;
  if (own.commands.includes((cmd as string).trim())) return true;
  const real = realOrSelf(prog);
  return own.binaries.some((b) => realOrSelf(b) === real);
}

export type InstallReason = "has-own" | "repointed";
export type RemoveReason = "not-ours" | "absent";

export function withStatuslineInstalled(settings: Settings, command: string, own: Ownership): { settings: Settings; changed: boolean; reason?: InstallReason } {
  const cur = settings.statusLine;
  if (cur?.command === command && programOf(command) !== null) return { settings, changed: false };
  if (cur !== undefined && !isOurStatusline(cur, own)) return { settings, changed: false, reason: "has-own" };
  const repointed = cur !== undefined;
  return { settings: { ...settings, statusLine: { type: "command", command, padding: 0 } }, changed: true, ...(repointed ? { reason: "repointed" as const } : {}) };
}

export function withStatuslineRemoved(settings: Settings, own: Ownership): { settings: Settings; changed: boolean; reason?: RemoveReason } {
  if (settings.statusLine === undefined) return { settings, changed: false, reason: "absent" };
  if (!isOurStatusline(settings.statusLine, own)) return { settings, changed: false, reason: "not-ours" };
  const next = { ...settings };
  delete next.statusLine;
  return { settings: next, changed: true };
}

/**
 * The absolute path the managed command runs: `agent-switch` as found on PATH
 * (survives upgrades and node switches), else the script running now. Null when
 * neither resolves — then nothing is installed and the poll stays.
 */
export function resolveStatuslineBinary(opts: { pathEnv?: string; argv1?: string; platform?: NodeJS.Platform } = {}): string | null {
  const platform = opts.platform ?? process.platform;
  const pathEnv = opts.pathEnv ?? process.env.PATH ?? "";
  const names = platform === "win32" ? ["agent-switch.cmd", "agent-switch.exe", "agent-switch"] : ["agent-switch"];
  const isFile = (p: string) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  };
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir || !path.isAbsolute(dir)) continue;
    for (const n of names) {
      const p = path.join(dir, n);
      if (isFile(p)) return p;
    }
  }
  const script = "argv1" in opts ? opts.argv1 : process.argv[1];
  if (script && path.isAbsolute(script) && isFile(script)) return script;
  return null;
}

function markerFile(profileDir: string): string {
  return path.join(profileDir, STATUSLINE_MARKER);
}

/** Record that collection is on for this profile, and with which command. */
export function markInstalled(profileDir: string, command: string): void {
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(markerFile(profileDir), `${command}\n`, { mode: 0o600 });
}

export function isMarkedInstalled(profileDir: string): boolean {
  return fs.existsSync(markerFile(profileDir));
}

/** This profile's ownership: its recorded command plus the binaries Agent Switch runs from here. */
export function ownershipFor(profileDir: string): Ownership {
  let recorded: string[] = [];
  try {
    recorded = fs.readFileSync(markerFile(profileDir), "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    // never installed here
  }
  const binaries = [resolveStatuslineBinary(), process.argv[1]].filter((b): b is string => typeof b === "string" && path.isAbsolute(b));
  return { commands: recorded, binaries };
}

/** The sample the usage source may use: only while collection is on for the profile. */
export function servedStatuslineSnapshot(profileDir: string): UsageSnapshot | null {
  return isMarkedInstalled(profileDir) ? readStatuslineSnapshot(profileDir) : null;
}

export function installStatusline(configDir: string, profileDir: string, command: string): { changed: boolean; reason?: InstallReason } {
  const r = withStatuslineInstalled(readSettingsStrict(configDir), command, ownershipFor(profileDir));
  if (r.changed) writeSettings(configDir, r.settings);
  if (r.reason !== "has-own") markInstalled(profileDir, command);
  return { changed: r.changed, ...(r.reason ? { reason: r.reason } : {}) };
}

/** Removes ours, the marker and the cache: a session still running the old
 *  command records nothing once the marker is gone. */
export function uninstallStatusline(configDir: string, profileDir: string): { changed: boolean; reason?: RemoveReason } {
  const r = withStatuslineRemoved(readSettingsStrict(configDir), ownershipFor(profileDir));
  if (r.changed) writeSettings(configDir, r.settings);
  fs.rmSync(markerFile(profileDir), { force: true });
  fs.rmSync(path.join(profileDir, STATUSLINE_FILE), { force: true });
  return { changed: r.changed, ...(r.reason ? { reason: r.reason } : {}) };
}

/** `present` ours is set and collecting · `displaced` we installed and something
 *  else took the slot · `missing` we installed and the slot is empty · `off`
 *  not turned on (a leftover command of ours without the marker records nothing). */
export type StatuslineHealth = "present" | "displaced" | "missing" | "off";

export function statuslineHealth(configDir: string, profileDir: string): StatuslineHealth {
  if (!isMarkedInstalled(profileDir)) return "off";
  const cur = readSettings(configDir).statusLine;
  if (isOurStatusline(cur, ownershipFor(profileDir))) return "present";
  return cur === undefined ? "missing" : "displaced";
}

/** The binary an installed command of ours runs, or null when it is not ours. */
export function installedBinary(configDir: string, profileDir: string): string | null {
  const cur = readSettings(configDir).statusLine;
  return isOurStatusline(cur, ownershipFor(profileDir)) ? programOf(cur.command) : null;
}

export { readSettingsStrict };
