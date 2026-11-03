/**
 * Lifecycle push channel (roadmap: road-to-agent-switch-session-telemetry,
 * Phase 2.5). Installs ADDITIVE, async (non-blocking) Claude Code hooks into a
 * profile's settings.json so the daemon learns *when* things happen
 * (session start/end, real compaction) — the transcript still says *how much*
 * (src/telemetry.ts). Hooks carry no token fields (verified spikes/t6).
 *
 * Safety (share.ts precedent): settings.json is a SHARED, fork-prone link when
 * `share on` is active. All edits here are:
 *   - marker-keyed (`asw_managed: true` on every entry we add) — we only ever
 *     touch our own entries, never the user's other hooks;
 *   - idempotent — installing twice is a no-op;
 *   - fully reversible — `uninstallHooks` removes exactly our entries.
 *
 * The installed command is `agent-switch __hook-event`, which reads the hook's
 * stdin JSON + its own CLAUDE_CONFIG_DIR env (so it maps back to the right
 * profile even under a shared settings.json) and appends one line to the event
 * ring. Zero deps.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import type { ResumeFacts } from "./telemetry.js";

/** The hook events we install. `source`/matcher values confirmed in spikes/t6
 *  (the stdin field is `source`, not `matcher`). `Stop` fires when Claude ends a
 *  turn (finished / now waiting on you); `Notification` fires when it needs your
 *  attention (a permission prompt, or a long idle) — the two session-awareness
 *  signals the pet surfaces. `StopFailure` fires when a turn ends on an API
 *  error; its stdin carries `error` (`rate_limit`, `authentication_failed`, …),
 *  read from the Claude Code 2.1.314 binary. `SubagentStart`/`SubagentStop` carry
 *  the parent's `session_id` plus `agent_id`, `agent_type` and `cwd` (captured
 *  live from 2.1.316, tests/fixtures/claude-subagent-hooks-2.1.316.jsonl). */
export const HOOK_EVENTS = ["SessionStart", "SessionEnd", "PreCompact", "PostCompact", "Stop", "Notification", "StopFailure", "SubagentStart", "SubagentStop"] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];

/** Marker stamped on every entry we add, so uninstall touches only our own. */
export const HOOK_MARKER = "asw_managed";

export const EVENT_RING_CAP = 500;

export interface HookEntry {
  hooks: { type: "command"; command: string; async?: true; [HOOK_MARKER]?: true }[];
  [HOOK_MARKER]?: true;
}

/** The command Claude runs for each hook — reads stdin + CLAUDE_CONFIG_DIR.
 *  With the `as-hook` relay installed the relay runs first and calls the same
 *  CLI command only when the engine does not take the event. */
export function hookCommand(bin = "agent-switch", relay?: string | null): string {
  return relay ? `'${relay.replace(/'/g, "'\\''")}' ${bin} __hook-event` : `${bin} __hook-event`;
}

/** The installed relay, `<root>/bin/as-hook`, or null while there is none. */
export function relayPath(root: string, platform: NodeJS.Platform = process.platform): string | null {
  const p = path.join(root, "bin", platform === "win32" ? "as-hook.exe" : "as-hook");
  return fs.existsSync(p) ? p : null;
}

/** Build the marker-keyed entry for one event. `async: true` sits on the
 *  command handler: Claude Code ignores it on the matcher group and holds the
 *  turn until the hook exits (agents/evidence/hook-blocking-probe-2026-11.md). */
export function buildHookEntry(bin = "agent-switch", relay?: string | null): HookEntry {
  return {
    [HOOK_MARKER]: true,
    hooks: [{ type: "command", command: hookCommand(bin, relay), async: true, [HOOK_MARKER]: true }],
  };
}

type Settings = Record<string, any>;

export function readSettings(configDir: string): Settings {
  try {
    return JSON.parse(fs.readFileSync(path.join(configDir, "settings.json"), "utf8"));
  } catch {
    return {};
  }
}

function writeSettings(configDir: string, settings: Settings): void {
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "settings.json"), JSON.stringify(settings, null, 2) + "\n", { mode: 0o600 });
}

function isOurs(entry: any): boolean {
  return !!entry && typeof entry === "object" && entry[HOOK_MARKER] === true;
}

/** Ours, and in the current shape: no group-level `async`, every handler async.
 *  An entry written by agent-switch ≤ 2.11 fails this and gets migrated. Given
 *  a command, it must also be that command — so an install made before the
 *  relay existed moves to it, and one made with it moves back when it is gone. */
function isCurrent(entry: any, command?: string): boolean {
  return (
    isOurs(entry) &&
    !("async" in entry) &&
    Array.isArray(entry.hooks) &&
    entry.hooks.length > 0 &&
    entry.hooks.every((h: any) => h?.async === true && (command === undefined || h?.command === command))
  );
}

/** Are our hooks present, in the current shape (and with `command`, when given), for every event? Pure. */
export function hooksInstalled(settings: Settings, command?: string): boolean {
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== "object") return false;
  return HOOK_EVENTS.every((ev) => Array.isArray(hooks[ev]) && hooks[ev].some((e: any) => isCurrent(e, command)) && hooks[ev].filter(isOurs).length === 1);
}

/** Does this install record subagents? `sessions --json` leaves `children`
 *  out, rather than empty, for a profile whose hooks cannot see them. */
export function hooksRecordSubagents(settings: Settings): boolean {
  const list = settings.hooks?.SubagentStart;
  return Array.isArray(list) && list.some(isOurs);
}

/** Some entry of ours is present but the install is not current — an install
 *  from agent-switch ≤ 2.11, or a partial one. `hooks status` migrates it. */
export function hooksNeedMigration(settings: Settings, command?: string): boolean {
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== "object") return false;
  const anyOurs = Object.values(hooks).some((arr) => Array.isArray(arr) && arr.some(isOurs));
  return anyOurs && !hooksInstalled(settings, command);
}

/** Return a NEW settings object with our hook entries added or brought to the
 *  current shape (idempotent) — pure, so it is unit-testable without touching
 *  disk. Every entry the user has stays as it is, where it is; an old entry of
 *  ours is replaced in its own position, and duplicates of ours are dropped. */
export function withHooksInstalled(settings: Settings, bin = "agent-switch", relay?: string | null): Settings {
  const command = hookCommand(bin, relay);
  const next: Settings = { ...settings, hooks: { ...(settings.hooks ?? {}) } };
  for (const ev of HOOK_EVENTS) {
    const existing: any[] = Array.isArray(next.hooks[ev]) ? next.hooks[ev] : [];
    const out: any[] = [];
    let placed = false;
    for (const e of existing) {
      if (!isOurs(e)) out.push(e);
      else if (!placed) {
        out.push(isCurrent(e, command) ? e : buildHookEntry(bin, relay));
        placed = true;
      }
    }
    if (!placed) out.push(buildHookEntry(bin, relay));
    next.hooks[ev] = out;
  }
  return next;
}

/** Return a NEW settings object with ONLY our entries removed. Pure. Empty
 *  event arrays are dropped; an empty `hooks` object is dropped entirely. */
export function withHooksRemoved(settings: Settings): Settings {
  if (!settings.hooks || typeof settings.hooks !== "object") return settings;
  const hooks: Settings = {};
  for (const [ev, arr] of Object.entries(settings.hooks)) {
    if (!Array.isArray(arr)) { hooks[ev] = arr; continue; }
    const kept = arr.filter((e) => !isOurs(e));
    if (kept.length > 0) hooks[ev] = kept;
  }
  const next: Settings = { ...settings };
  if (Object.keys(hooks).length > 0) next.hooks = hooks;
  else delete next.hooks;
  return next;
}

export function installHooks(configDir: string, bin = "agent-switch", relay?: string | null): { changed: boolean } {
  const before = readSettings(configDir);
  if (hooksInstalled(before, hookCommand(bin, relay))) return { changed: false };
  writeSettings(configDir, withHooksInstalled(before, bin, relay));
  return { changed: true };
}

export function uninstallHooks(configDir: string): { changed: boolean } {
  const before = readSettings(configDir);
  const after = withHooksRemoved(before);
  const changed = JSON.stringify(before) !== JSON.stringify(after);
  if (changed) writeSettings(configDir, after);
  return { changed };
}

// ---------- event ring ----------

export interface HookEventRecord {
  event: string; // hook_event_name
  source?: string; // SessionStart matcher: startup|resume|clear|compact
  sessionId?: string;
  /** StopFailure: the error type, never the message body. */
  error?: string;
  /** Notification: `notification_type` (`quota_auto_resume_armed`, …). */
  notificationType?: string;
  /** SessionStart `resume`/`fork` (Claude Code v2.1.251+): numbers and a flag, never content. */
  resume?: { secondsSinceLastResponse?: number; contextTokens?: number; cacheLikelyExpired?: boolean };
  /** SubagentStart/Stop: which subagent; `sessionId` is its parent. */
  agentId?: string;
  agentType?: string;
  /** SessionStart, Stop, SubagentStart/Stop: the working folder at that moment (a worktree shows here). */
  cwd?: string;
  /** SessionStart: who started this session, from the env it inherited
   *  (docs/lineage-contract.md). Never inferred from timing or folders. */
  lineage?: Lineage;
  /** SessionStart: the Claude process (`CLAUDE_PID`), to tell a `/clear` in the same process from a new start. */
  hostPid?: number;
  at: string; // ISO
}

export const LINEAGE_KINDS = ["subagent", "council", "arena", "court", "helper", "other", "continued_from"] as const;

/** A positive integer pid from an env value, or undefined. */
export function pidFrom(v: string | undefined): number | undefined {
  return v && /^[1-9][0-9]{0,9}$/.test(v) ? Number(v) : undefined;
}

/**
 * `/clear` starts a new session id in the same Claude process. The previous
 * session of that process — the last SessionStart with the same host pid and
 * another id — is the one that was cleared. Nothing else links them: without a
 * pid on both sides there is no edge. Pure.
 */
export function clearedFrom(rec: HookEventRecord, earlier: readonly HookEventRecord[]): string | undefined {
  if (rec.event !== "SessionStart" || rec.source !== "clear" || !rec.hostPid || !rec.sessionId) return undefined;
  for (let i = earlier.length - 1; i >= 0; i--) {
    const e = earlier[i];
    if (e.event === "SessionStart" && e.hostPid === rec.hostPid && e.sessionId && e.sessionId !== rec.sessionId) return e.sessionId;
  }
  return undefined;
}

export interface Lineage {
  /** The parent's session key (`provider/account/sessionId`) or bare session id. */
  parent: string;
  kind: (typeof LINEAGE_KINDS)[number] | "started_by" | "cleared";
  label?: string;
  /** The parent's tool, when the parent named it. */
  agent?: string;
  /** `lineage`: the parent set AGENT_SWITCH_PARENT_*; `host`: started inside an AS-hosted window
   *  or resumed by AS; `hook`: the host's own hook data (a `/clear` in the same process). */
  source: "lineage" | "host" | "hook";
}

const PARENT_RE = /^(?:[a-z][a-z0-9-]*\/[^/\s]{1,64}\/)?[A-Za-z0-9][A-Za-z0-9-]{3,63}$/;

/**
 * The lineage a session inherited through its environment. The contract's vars
 * win; otherwise a session started inside an AS-hosted window (which exports
 * AGENT_SWITCH_HOST_PANE) is that window's child — unless it IS that window's
 * session. Malformed values are dropped, never guessed around. Pure.
 */
export function lineageFromEnv(env: Record<string, string | undefined>, ownSessionId: string | undefined, ownKey?: string): Lineage | undefined {
  // A full key on another account with the same id is a continuation (takeover), not the session itself.
  const own = (parent: string) => !!ownSessionId && (parent === ownSessionId || (parent.includes("/") ? (ownKey ? parent === ownKey : parent.endsWith(`/${ownSessionId}`)) : false));
  const p = env.AGENT_SWITCH_PARENT_SESSION;
  if (p && PARENT_RE.test(p) && !own(p)) {
    const kind = (LINEAGE_KINDS as readonly string[]).includes(env.AGENT_SWITCH_PARENT_KIND ?? "") ? (env.AGENT_SWITCH_PARENT_KIND as Lineage["kind"]) : "other";
    const label = env.AGENT_SWITCH_PARENT_LABEL?.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80);
    const agent = env.AGENT_SWITCH_PARENT_AGENT && /^[a-z][a-z0-9-]{0,30}$/.test(env.AGENT_SWITCH_PARENT_AGENT) ? env.AGENT_SWITCH_PARENT_AGENT : undefined;
    // continued_from is set by AS itself when it resumes a session elsewhere (takeover, fork).
    return { parent: p, kind, ...(label ? { label } : {}), ...(agent ? { agent } : {}), source: kind === "continued_from" ? "host" : "lineage" };
  }
  const h = env.AGENT_SWITCH_HOST_PANE;
  if (h && PARENT_RE.test(h) && h.includes("/") && !own(h)) return { parent: h, kind: "started_by", source: "host" };
  return undefined;
}

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

/** One hook stdin payload → the record the ring keeps. Pure. Only ids, types,
 *  error codes and a working directory are kept — never prompt or answer text
 *  (`last_assistant_message`) or transcript paths. */
export function recordFromPayload(o: any, at: string): HookEventRecord {
  const event = str(o?.hook_event_name) ?? "unknown";
  const rec: HookEventRecord = {
    event,
    source: str(o?.source),
    sessionId: str(o?.session_id),
    error: str(o?.error),
    notificationType: str(o?.notification_type),
    resume: resumeFields(o),
    at,
  };
  if (event === "SubagentStart" || event === "SubagentStop") {
    rec.agentId = str(o.agent_id);
    rec.agentType = str(o.agent_type);
  }
  // Where the session works right now: a mid-session worktree switch shows at the next Stop.
  if (["SessionStart", "Stop", "SubagentStart", "SubagentStop"].includes(event)) rec.cwd = str(o.cwd);
  for (const k of Object.keys(rec) as (keyof HookEventRecord)[]) if (rec[k] === undefined) delete rec[k];
  return rec;
}

export interface SubagentChild {
  agentId: string;
  type?: string;
  state: "running" | "done";
  cwd?: string;
}

/** The subagents one session started, in start order: running until their
 *  SubagentStop or the parent's SessionEnd. A stop whose start was rotated
 *  away still shows, as done. */
export function childrenOf(events: readonly HookEventRecord[], sessionId: string): SubagentChild[] {
  const kids = new Map<string, SubagentChild>();
  for (const e of events) {
    if (e.sessionId !== sessionId) continue;
    if (e.event === "SessionEnd") {
      for (const k of kids.values()) k.state = "done";
      continue;
    }
    if ((e.event !== "SubagentStart" && e.event !== "SubagentStop") || !e.agentId) continue;
    const prev = kids.get(e.agentId);
    const child: SubagentChild = { agentId: e.agentId, type: e.agentType ?? prev?.type, state: e.event === "SubagentStart" ? "running" : "done", cwd: e.cwd ?? prev?.cwd };
    if (child.type === undefined) delete child.type;
    if (child.cwd === undefined) delete child.cwd;
    kids.set(e.agentId, child);
  }
  return [...kids.values()];
}

/** The resume fields of a SessionStart stdin payload, or undefined when the host sent none. */
export function resumeFields(o: any): HookEventRecord["resume"] {
  if (o?.hook_event_name !== "SessionStart" || typeof o.prompt_cache_likely_expired !== "boolean") return undefined;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  return {
    secondsSinceLastResponse: num(o.seconds_since_last_response),
    contextTokens: num(o.context_tokens),
    cacheLikelyExpired: o.prompt_cache_likely_expired,
  };
}

/** The folder a session's newest hook reported, or null. Subagent events name the subagent's folder, not the session's. */
export function lastHookCwd(events: readonly HookEventRecord[], sessionId: string): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.sessionId === sessionId && e.cwd && (e.event === "SessionStart" || e.event === "Stop")) return e.cwd;
  }
  return null;
}

/** The newest resume facts recorded for one session, or null. */
export function resumeFactsFor(events: readonly HookEventRecord[], sessionId: string): ResumeFacts | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.sessionId === sessionId && e.event === "SessionStart" && e.resume) return { at: e.at, ...e.resume };
  }
  return null;
}

/** The host waiting out a usage limit by itself — the session needs nothing
 *  from the user. `_disabled`, `_stale` and `_offer` do ask something of them. */
const HOST_WAIT_TYPES = new Set(["quota_auto_resume_armed", "quota_auto_resume_fired", "quota_auto_resume_cancelled", "quota_auto_resume_setting"]);

const STOP_REASONS: Record<string, string> = {
  rate_limit: "hit its usage limit",
  authentication_failed: "is signed out",
  oauth_org_not_allowed: "is signed out",
  account_on_hold: "stopped: the account is on hold",
  billing_error: "stopped: the account has a billing problem",
};

const HOST_WAIT_TEXT: Record<string, string> = {
  quota_auto_resume_armed: "is waiting for the limit to reset, then continues by itself",
  quota_auto_resume_fired: "resumed after the limit reset",
  quota_auto_resume_stale: "was waiting for a limit reset, but the wait went stale",
  quota_auto_resume_disabled: "hit the limit and auto-continue is off",
  quota_auto_resume_cancelled: "was waiting for a limit reset; the wait was cancelled",
};

/** What one hook event should tell the user, or null for events that are only
 *  recorded. Pure, so every branch is tested without a hook process. */
export function hookNotice(
  rec: HookEventRecord,
  who: { provider: string; profile: string },
): { kind: "info" | "warning"; title: string; message: string } | null {
  const name = `${who.provider}/${who.profile}`;
  if (rec.event === "StopFailure") {
    const reason = (rec.error && STOP_REASONS[rec.error]) ?? `stopped with an error${rec.error ? ` (${rec.error})` : ""}`;
    return { kind: "warning", title: "Claude stopped", message: `${name} ${reason}.` };
  }
  if (rec.event === "Notification") {
    const wait = rec.notificationType ? HOST_WAIT_TEXT[rec.notificationType] : undefined;
    if (wait) return { kind: rec.notificationType === "quota_auto_resume_fired" ? "info" : "warning", title: "Claude at the limit", message: `${name} ${wait}.` };
    return { kind: "warning", title: "Claude is waiting", message: `${name} needs your input.` };
  }
  if (rec.event === "Stop") return { kind: "info", title: "Claude finished", message: `${name} finished its turn.` };
  return null;
}

export function eventFile(root: string, provider: string, profile: string): string {
  return path.join(root, "events", `${provider}-${profile}.jsonl`);
}

function readLines(file: string): HookEventRecord[] {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: HookEventRecord[] = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // a torn or foreign line costs that line only
    }
  }
  return out;
}

/** The ring as one ordered list: kept "needs you" lines, the previous
 *  generation, then the live file. */
export function readEvents(file: string): HookEventRecord[] {
  return [...readLines(`${file}.pin`), ...readLines(`${file}.1`), ...readLines(file)];
}

/**
 * Sessions waiting on the user: their last hook event is `Notification` (a
 * permission prompt, or a long wait for input) or `StopFailure` (the turn died
 * on an error — a limit, a lapsed login) and the transcript has not been
 * written since — a reply or an approval writes to it. `Stop` alone is not
 * waiting: it ends every turn. Neither is the host waiting out a limit by itself.
 */
export function waitingSessions(events: readonly HookEventRecord[], mtimeMs: (sessionId: string) => number | null): Map<string, string> {
  const last = new Map<string, HookEventRecord>();
  for (const e of events) if (e.sessionId) last.set(e.sessionId, e);
  // sessionId → when it started waiting.
  const out = new Map<string, string>();
  for (const [id, e] of last) {
    const written = mtimeMs(id);
    // Two seconds of slack: the notification and the transcript line that led to it land together.
    const asks = e.event === "StopFailure" || (e.event === "Notification" && !(e.notificationType && HOST_WAIT_TYPES.has(e.notificationType)));
    if (asks && written !== null && Date.parse(e.at) + 2000 >= written) out.set(id, e.at);
  }
  return out;
}

/** The live file rotates once it reaches this size — about EVENT_RING_CAP
 *  records — so the ring holds one to two generations. */
export const ROTATE_BYTES = EVENT_RING_CAP * 256;
/** A rotation lock older than this was left by a crashed writer. */
const STALE_LOCK_MS = 30_000;
/** Kept "needs you" lines older than this are dropped at the next rotation. */
const PIN_MAX_AGE_MS = 7 * 24 * 3600_000;
const PINNED_EVENTS = new Set(["Notification", "StopFailure"]);

/**
 * Append one event. Lossless under concurrent hook processes: the record is a
 * single O_APPEND write of one short line (well under PIPE_BUF), so writers
 * never overwrite each other. Size is bounded by rotation, not by rewriting:
 * past `rotateBytes` one writer takes the lock, renames the live file to `.1`
 * (dropping the generation before it) and goes on. A writer that finds the lock
 * held skips the rotation — the append path never waits. Before a generation is
 * dropped, each session whose last event in it is a Notification or StopFailure
 * keeps that line in `.pin`, so a burst of other events cannot hide that a
 * session needs you.
 */
export function appendEvent(file: string, rec: HookEventRecord, opts: { rotateBytes?: number } = {}): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let size = 0;
  let fd: number;
  try {
    fd = fs.openSync(file, "a+", 0o600); // a+: append-only writes, and the last byte is readable
  } catch {
    return;
  }
  try {
    size = fs.fstatSync(fd).size;
    // A file cut off mid-line would glue this record onto the broken one.
    let lead = "";
    if (size > 0) {
      const last = Buffer.alloc(1);
      fs.readSync(fd, last, 0, 1, size - 1);
      if (last[0] !== 0x0a) lead = "\n";
    }
    const line = lead + JSON.stringify(rec) + "\n";
    fs.writeSync(fd, line);
    size += Buffer.byteLength(line);
  } finally {
    fs.closeSync(fd);
  }
  if (size >= (opts.rotateBytes ?? ROTATE_BYTES)) rotate(file, opts.rotateBytes ?? ROTATE_BYTES);
}

function takeLock(lock: string): boolean {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.closeSync(fs.openSync(lock, "wx", 0o600));
      return true;
    } catch {
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs < STALE_LOCK_MS) return false;
        fs.unlinkSync(lock);
      } catch {
        // gone in between: try once more
      }
    }
  }
  return false;
}

function rotate(file: string, rotateBytes: number): void {
  const lock = `${file}.lock`;
  if (!takeLock(lock)) return;
  try {
    // Another writer may have rotated between our append and the lock.
    if (fs.statSync(file).size < rotateBytes) return;
    const pins = new Map<string, HookEventRecord>();
    for (const e of readLines(`${file}.pin`)) if (e.sessionId) pins.set(e.sessionId, e);
    for (const e of readLines(`${file}.1`)) {
      if (!e.sessionId) continue;
      if (PINNED_EVENTS.has(e.event)) pins.set(e.sessionId, e);
      else pins.delete(e.sessionId);
    }
    const cutoff = Date.now() - PIN_MAX_AGE_MS;
    const kept = [...pins.values()].filter((e) => Date.parse(e.at) >= cutoff);
    const tmp = `${file}.pin.tmp`;
    fs.writeFileSync(tmp, kept.map((e) => JSON.stringify(e) + "\n").join(""), { mode: 0o600 });
    fs.renameSync(tmp, `${file}.pin`);
    // Atomic: a writer that opened the old file finishes its line in `.1`.
    fs.renameSync(file, `${file}.1`);
  } catch {
    // rotation is housekeeping; the next append tries again
  } finally {
    try {
      fs.unlinkSync(lock);
    } catch {
      // already gone
    }
  }
}

/** Map a running claude's CLAUDE_CONFIG_DIR back to {provider, profile} using
 *  the agent-switch layout `<ROOT>/<provider>/<name>/config`. Returns null when
 *  the dir is not an agent-switch profile config dir. */
export function profileFromConfigDir(configDir: string, root: string): { provider: string; profile: string } | null {
  const rel = path.relative(root, configDir);
  const parts = rel.split(path.sep);
  // expected: <provider>/<name>/config
  if (parts.length === 3 && parts[2] === "config" && !parts[0].startsWith("..")) {
    return { provider: parts[0], profile: parts[1] };
  }
  return null;
}
