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

/** The hook events we install. `source`/matcher values confirmed in spikes/t6
 *  (the stdin field is `source`, not `matcher`). */
export const HOOK_EVENTS = ["SessionStart", "SessionEnd", "PreCompact", "PostCompact"] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];

/** Marker stamped on every entry we add, so uninstall touches only our own. */
export const HOOK_MARKER = "asw_managed";

export const EVENT_RING_CAP = 500;

export interface HookEntry {
  hooks: { type: "command"; command: string; [HOOK_MARKER]?: true }[];
  [HOOK_MARKER]?: true;
}

/** The command Claude runs for each hook — reads stdin + CLAUDE_CONFIG_DIR. */
export function hookCommand(bin = "agent-switch"): string {
  return `${bin} __hook-event`;
}

/** Build the marker-keyed entry for one event. `async: true` = non-blocking. */
export function buildHookEntry(bin = "agent-switch"): HookEntry {
  return {
    [HOOK_MARKER]: true,
    hooks: [{ type: "command", command: hookCommand(bin), [HOOK_MARKER]: true }],
  } as HookEntry & { async?: boolean };
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

/** Are our hooks present for every event? (idempotency check). Pure. */
export function hooksInstalled(settings: Settings): boolean {
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== "object") return false;
  return HOOK_EVENTS.every((ev) => Array.isArray(hooks[ev]) && hooks[ev].some(isOurs));
}

/** Return a NEW settings object with our hook entries added (idempotent) —
 *  pure, so it is unit-testable without touching disk. Preserves every entry
 *  the user already has; adds ours only where missing. */
export function withHooksInstalled(settings: Settings, bin = "agent-switch"): Settings {
  const next: Settings = { ...settings, hooks: { ...(settings.hooks ?? {}) } };
  for (const ev of HOOK_EVENTS) {
    const existing: any[] = Array.isArray(next.hooks[ev]) ? [...next.hooks[ev]] : [];
    if (!existing.some(isOurs)) existing.push({ ...buildHookEntry(bin), async: true });
    next.hooks[ev] = existing;
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

export function installHooks(configDir: string, bin = "agent-switch"): { changed: boolean } {
  const before = readSettings(configDir);
  if (hooksInstalled(before)) return { changed: false };
  writeSettings(configDir, withHooksInstalled(before, bin));
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
  at: string; // ISO
}

export function eventFile(root: string, provider: string, profile: string): string {
  return path.join(root, "events", `${provider}-${profile}.jsonl`);
}

export function readEvents(file: string): HookEventRecord[] {
  try {
    return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

/** Append one event, trimming the ring to EVENT_RING_CAP. Tolerant of a
 *  malformed existing file (starts fresh). */
export function appendEvent(file: string, rec: HookEventRecord): void {
  const all = readEvents(file);
  all.push(rec);
  const trimmed = all.slice(-EVENT_RING_CAP);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, trimmed.map((r) => JSON.stringify(r)).join("\n") + "\n", { mode: 0o600 });
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
