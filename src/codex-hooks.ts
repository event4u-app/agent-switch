/**
 * Codex lifecycle hooks (road-to-agent-switch-v3-central Phase 10). Codex reads
 * `$CODEX_HOME/hooks.json` — user level, one file per account — with the same
 * shape and nearly the same stdin as Claude Code's hooks, so the installed
 * command is the same `agent-switch __hook-event` (or the `as-hook` relay in
 * front of it) and the intake tells the two apart by `CODEX_HOME`.
 *
 * Measured on codex-cli 0.166.0 (tests/fixtures/codex-hooks-0.166.0.jsonl):
 * SessionStart, Stop and SessionEnd carry `session_id`, `cwd`, `transcript_path`
 * and `hook_event_name`; the hook runs with `CODEX_HOME` set. Only those three
 * events are installed — the others Codex offers were not captured here.
 *
 * Trust: Codex runs a hook only after the user approved it ("Review hooks" /
 * "Trust all and continue" when `codex` starts), and stores the approval as a
 * hash in `config.toml`. Agent Switch never writes that approval. It recomputes
 * the hash only to tell the user whether the hooks it installed run yet.
 *
 * Our entries carry no marker field — `hooks.json` is Codex's own schema — so
 * ours are the handlers whose command ends in `__hook-event`.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { hookCommand } from "./hooks.js";

export const CODEX_HOOK_EVENTS = ["SessionStart", "Stop", "SessionEnd"] as const;
type CodexHookEvent = (typeof CODEX_HOOK_EVENTS)[number];

/** Codex's own key labels for the events (`config.toml` `[hooks.state]` keys and the trust hash). */
const EVENT_LABEL: Record<CodexHookEvent, string> = { SessionStart: "session_start", Stop: "stop", SessionEnd: "session_end" };

/** Codex runs SessionEnd synchronously and caps it at 3 s; the relay answers in ms, its CLI fallback well inside that. */
export function codexHandler(event: CodexHookEvent, command: string): { type: "command"; command: string; timeout: number; async: boolean } {
  return event === "SessionEnd" ? { type: "command", command, timeout: 3, async: false } : { type: "command", command, timeout: 10, async: true };
}

type HooksFile = { hooks?: Record<string, any[]>; [k: string]: unknown };

const isOurHandler = (h: any) => h?.type === "command" && typeof h.command === "string" && /(^|\s)__hook-event$/.test(h.command);
const isOurGroup = (g: any) => Array.isArray(g?.hooks) && g.hooks.length > 0 && g.hooks.every(isOurHandler);

export function codexHooksFile(codexHome: string): string {
  return path.join(codexHome, "hooks.json");
}

export function readCodexHooks(codexHome: string): HooksFile {
  try {
    const v = JSON.parse(fs.readFileSync(codexHooksFile(codexHome), "utf8"));
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/** Every event has exactly one group of ours, with exactly the handler `command` would install. Pure. */
export function codexHooksInstalled(file: HooksFile, command: string): boolean {
  return CODEX_HOOK_EVENTS.every((ev) => {
    const ours = (file.hooks?.[ev] ?? []).filter(isOurGroup);
    return ours.length === 1 && ours[0].hooks.length === 1 && JSON.stringify(ours[0].hooks[0]) === JSON.stringify(codexHandler(ev, command)) && ours[0].matcher === undefined;
  });
}

/** Some group of ours is present, but not the current one (another command, a relay that came or went). */
export function codexHooksNeedMigration(file: HooksFile, command: string): boolean {
  const anyOurs = Object.values(file.hooks ?? {}).some((arr) => Array.isArray(arr) && arr.some(isOurGroup));
  return anyOurs && !codexHooksInstalled(file, command);
}

/** A NEW file with our groups added or brought current, in place; every other group stays as it is. Pure. */
export function withCodexHooksInstalled(file: HooksFile, command: string): HooksFile {
  const hooks: Record<string, any[]> = { ...(file.hooks ?? {}) };
  for (const ev of CODEX_HOOK_EVENTS) {
    const out: any[] = [];
    let placed = false;
    for (const g of Array.isArray(hooks[ev]) ? hooks[ev] : []) {
      if (!isOurGroup(g)) out.push(g);
      else if (!placed) {
        out.push({ hooks: [codexHandler(ev, command)] });
        placed = true;
      }
    }
    if (!placed) out.push({ hooks: [codexHandler(ev, command)] });
    hooks[ev] = out;
  }
  return { ...file, hooks };
}

/** A NEW file without our groups; empty events and an empty `hooks` are dropped. Pure. */
export function withCodexHooksRemoved(file: HooksFile): HooksFile {
  const hooks: Record<string, any[]> = {};
  for (const [ev, arr] of Object.entries(file.hooks ?? {})) {
    const kept = Array.isArray(arr) ? arr.filter((g) => !isOurGroup(g)) : arr;
    if (!Array.isArray(kept) || kept.length > 0) hooks[ev] = kept;
  }
  const next: HooksFile = { ...file };
  if (Object.keys(hooks).length > 0) next.hooks = hooks;
  else delete next.hooks;
  return next;
}

function writeCodexHooks(codexHome: string, file: HooksFile): void {
  const f = codexHooksFile(codexHome);
  if (!file.hooks && Object.keys(file).length === 0) {
    fs.rmSync(f, { force: true });
    return;
  }
  fs.writeFileSync(`${f}.tmp`, JSON.stringify(file, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(`${f}.tmp`, f);
}

export function installCodexHooks(codexHome: string, bin = "agent-switch", relay?: string | null): { changed: boolean } {
  const before = readCodexHooks(codexHome);
  const command = hookCommand(bin, relay);
  if (codexHooksInstalled(before, command)) return { changed: false };
  writeCodexHooks(codexHome, withCodexHooksInstalled(before, command));
  return { changed: true };
}

export function uninstallCodexHooks(codexHome: string): { changed: boolean } {
  if (!fs.existsSync(codexHooksFile(codexHome))) return { changed: false };
  const before = readCodexHooks(codexHome);
  const after = withCodexHooksRemoved(before);
  if (JSON.stringify(before) === JSON.stringify(after)) return { changed: false };
  writeCodexHooks(codexHome, after);
  return { changed: true };
}

// ---------- trust (read only) ----------

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v as object)
        .sort()
        .map((k) => [k, canonical((v as any)[k])]),
    );
  }
  return v;
}

/**
 * The hash Codex records when the user trusts one handler: sha256 over the
 * key-sorted, compact JSON of `{event_name, matcher?, hooks: [handler]}` with
 * the handler as Codex normalizes it (codex-rs hooks/src/engine/discovery.rs
 * `hook_hash`). Checked against hashes Codex 0.166.0 wrote for real approvals.
 */
export function codexTrustHash(eventLabel: string, handler: object, matcher?: string): string {
  const identity = { event_name: eventLabel, ...(matcher !== undefined ? { matcher } : {}), hooks: [handler] };
  return "sha256:" + createHash("sha256").update(JSON.stringify(canonical(identity))).digest("hex");
}

/** `[hooks.state."<key>"]` tables of a Codex config.toml: key → {trusted_hash, enabled}. Only these two plain values are read. */
export function hookStates(toml: string): Map<string, { trustedHash?: string; enabled?: boolean }> {
  const out = new Map<string, { trustedHash?: string; enabled?: boolean }>();
  let cur: { trustedHash?: string; enabled?: boolean } | null = null;
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      const m = /^\[hooks\.state\."((?:[^"\\]|\\.)*)"\]$/.exec(line);
      cur = m ? {} : null;
      if (m) out.set(m[1].replace(/\\(.)/g, "$1"), cur!);
      continue;
    }
    if (!cur) continue;
    const h = /^trusted_hash\s*=\s*"([^"]*)"/.exec(line);
    if (h) cur.trustedHash = h[1];
    const e = /^enabled\s*=\s*(true|false)/.exec(line);
    if (e) cur.enabled = e[1] === "true";
  }
  return out;
}

export type CodexTrust = "approved" | "awaiting" | "changed" | "disabled";

/**
 * Whether Codex will run the hooks we installed: `approved` when every one of
 * ours carries a matching approval, `disabled` when the user switched one off,
 * `changed` when one was approved in an earlier form, else `awaiting`.
 * `paths` are the spellings of `hooks.json` Codex may have keyed on.
 */
export function codexHooksTrust(file: HooksFile, toml: string, paths: string[]): CodexTrust {
  const states = hookStates(toml);
  let disabled = false;
  let changed = false;
  let awaiting = false;
  for (const ev of CODEX_HOOK_EVENTS) {
    const groups = file.hooks?.[ev] ?? [];
    groups.forEach((g: any, gi: number) => {
      if (!isOurGroup(g)) return;
      g.hooks.forEach((h: any, hi: number) => {
        const state = paths.map((p) => states.get(`${p}:${EVENT_LABEL[ev]}:${gi}:${hi}`)).find(Boolean);
        if (state?.enabled === false) disabled = true;
        else if (!state?.trustedHash) awaiting = true;
        else if (state.trustedHash !== codexTrustHash(EVENT_LABEL[ev], h, g.matcher)) changed = true;
      });
    });
  }
  return disabled ? "disabled" : changed ? "changed" : awaiting ? "awaiting" : "approved";
}

/** The trust state of one Codex home's hooks; null when none of ours are installed. */
export function codexHomeTrust(codexHome: string): CodexTrust | null {
  const file = readCodexHooks(codexHome);
  if (!Object.values(file.hooks ?? {}).some((arr) => Array.isArray(arr) && arr.some(isOurGroup))) return null;
  let toml = "";
  try {
    toml = fs.readFileSync(path.join(codexHome, "config.toml"), "utf8");
  } catch {
    // no config yet: nothing approved
  }
  const f = codexHooksFile(codexHome);
  let real = f;
  try {
    real = path.join(fs.realpathSync(codexHome), "hooks.json");
  } catch {
    // keep the given spelling
  }
  return codexHooksTrust(file, toml, [...new Set([f, real])]);
}
