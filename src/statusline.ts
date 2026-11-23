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

import { readSettings, writeSettings } from "./hooks.js";
import { withFileLockSync } from "./locks.js";
import { parseStatuslineUsage, sameResetCycle, type UsageSnapshot } from "./usage.js";

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
 *  starts a new window; a payload still on an earlier one changes nothing. */
export function mergeMonotone(prev: UsageSnapshot | null, next: UsageSnapshot): UsageSnapshot {
  if (!prev) return next;
  const prevBy = new Map(prev.windows.map((w) => [w.key, w]));
  const windows = next.windows.map((n) => {
    const p = prevBy.get(n.key);
    prevBy.delete(n.key);
    if (!p) return n;
    if (sameResetCycle(p.resetsAt, n.resetsAt)) {
      return (p.utilization ?? -1) > (n.utilization ?? -1) ? { ...n, utilization: p.utilization } : n;
    }
    const tp = p.resetsAt ? Date.parse(p.resetsAt) : NaN;
    const tn = n.resetsAt ? Date.parse(n.resetsAt) : NaN;
    return !isNaN(tp) && !isNaN(tn) && tn < tp ? p : n;
  });
  return { ...next, windows: [...windows, ...prevBy.values()] };
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
    if (!name) return;
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

/** "Ours" is the command running `__statusline`, whatever path it names — so a
 *  moved binary is still ours to re-point or remove. Nothing else marks it: the
 *  object stays `{type, command, padding}`. */
export function isOurStatusline(entry: unknown): boolean {
  const cmd = (entry as any)?.command;
  return typeof cmd === "string" && /^('(?:[^']|'\\'')*'|\S+) __statusline$/.test(cmd.trim());
}

export type InstallReason = "has-own" | "repointed";
export type RemoveReason = "not-ours" | "absent";

export function withStatuslineInstalled(settings: Settings, command: string): { settings: Settings; changed: boolean; reason?: InstallReason } {
  const cur = settings.statusLine;
  if (isOurStatusline(cur) && cur.command === command) return { settings, changed: false };
  if (cur !== undefined && !isOurStatusline(cur)) return { settings, changed: false, reason: "has-own" };
  const repointed = isOurStatusline(cur);
  return { settings: { ...settings, statusLine: { type: "command", command, padding: 0 } }, changed: true, ...(repointed ? { reason: "repointed" as const } : {}) };
}

export function withStatuslineRemoved(settings: Settings): { settings: Settings; changed: boolean; reason?: RemoveReason } {
  if (settings.statusLine === undefined) return { settings, changed: false, reason: "absent" };
  if (!isOurStatusline(settings.statusLine)) return { settings, changed: false, reason: "not-ours" };
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

export function installStatusline(configDir: string, profileDir: string, command: string): { changed: boolean; reason?: InstallReason } {
  const r = withStatuslineInstalled(readSettings(configDir), command);
  if (r.changed) writeSettings(configDir, r.settings);
  if (r.changed || isOurStatusline(r.settings.statusLine)) {
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(markerFile(profileDir), `${command}\n`, { mode: 0o600 });
  }
  return { changed: r.changed, ...(r.reason ? { reason: r.reason } : {}) };
}

export function uninstallStatusline(configDir: string, profileDir: string): { changed: boolean; reason?: RemoveReason } {
  const r = withStatuslineRemoved(readSettings(configDir));
  if (r.changed) writeSettings(configDir, r.settings);
  fs.rmSync(markerFile(profileDir), { force: true });
  return { changed: r.changed, ...(r.reason ? { reason: r.reason } : {}) };
}

/** `present` ours is set · `displaced` we installed and something else took the
 *  slot · `missing` we installed and the slot is empty · `off` never installed. */
export type StatuslineHealth = "present" | "displaced" | "missing" | "off";

export function statuslineHealth(configDir: string, profileDir: string): StatuslineHealth {
  const cur = readSettings(configDir).statusLine;
  if (isOurStatusline(cur)) return "present";
  if (!fs.existsSync(markerFile(profileDir))) return "off";
  return cur === undefined ? "missing" : "displaced";
}

/** The binary an installed command of ours runs, or null when it is not ours. */
export function installedBinary(configDir: string): string | null {
  const cmd = readSettings(configDir).statusLine?.command;
  if (!isOurStatusline({ command: cmd })) return null;
  const head = (cmd as string).trim().slice(0, -` ${STATUSLINE_ARG}`.length);
  return head.startsWith("'") ? head.slice(1, -1).replace(/'\\''/g, "'") : head;
}
