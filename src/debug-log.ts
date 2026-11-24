/**
 * Debug log — the last {@link DEBUG_LOG_KEEP} things the person did in the app and
 * what came of them (a CLI call that failed, a chat that would not start, a view
 * switch that was refused), so a bug report can be traced from the file alone.
 *
 * Only what a fix needs: action names, session keys, outcomes, durations and error
 * messages. Never prompt text, file contents, file names or paths: every string
 * passes {@link clean}, which drops quoted text, paths and file names and redacts
 * anything secret-shaped. On by default; `debug-log off` writes a marker
 * file every writer checks, so no process logs while it is off.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { redactSecrets } from "./activity.js";
import { withFileLockSync } from "./locks.js";
import { ROOT, ensureRoot } from "./profiles.js";

export const DEBUG_LOG_FILE = path.join(ROOT, "debug-log.jsonl");
const OFF_MARKER = path.join(ROOT, "debug-log.off");
export const DEBUG_LOG_KEEP = 100;
/** How long a writer waits for another one; past that its entries are dropped, never the app's time. */
const LOCK_WAIT_MS = 2_000;
const MAX_TEXT = 300;
const MAX_NAME = 80;

export const DEBUG_KINDS = ["action", "call", "view", "bridge", "error"] as const;
export type DebugKind = (typeof DEBUG_KINDS)[number];

export interface DebugEntry {
  at: string;
  /** Who wrote it: the app (what the person did and saw) or a CLI process (what it did about it). */
  src: "app" | "cli";
  kind: DebugKind;
  /** What happened, as a short name: an action type, a command verb, a step. */
  what: string;
  /** The session it concerns, as `provider/account/id`. */
  key?: string;
  ok?: boolean;
  ms?: number;
  error?: string;
  /** A few more short facts (an exit code, a step); names and numbers only. */
  detail?: Record<string, string | number | boolean>;
}

/** A session key: provider, account, and an id that is an id (a UUID-like run, or `new`) — never a title shaped like a key. */
export const KEY_RE = /^(claude|codex|antigravity|acp)\/[A-Za-z0-9._-]{1,64}\/([0-9A-Fa-f][0-9A-Fa-f-]{7,63}|new)$/;

/** File kinds a message may name; the name itself (a document title, a project file) never reaches the log. */
const FILE_EXT = "pdf|docx?|xlsx?|pptx?|key|pages|numbers|png|jpe?g|gif|webp|heic|svg|txt|md|rtf|json|ya?ml|toml|csv|zip|tar|gz|ts|tsx|js|mjs|cjs|py|go|rs|java|kt|rb|php|html?|css|scss|sh|log|pem|env|sql|db|sqlite";

/**
 * A string fit for the log: one line; no quoted text (what the person typed, a title); no paths
 * (a project's folders say what it is) and no file names, only their kind; `key=value` secrets
 * and anything token-shaped redacted; short. Pure.
 */
export function clean(s: unknown, max = MAX_TEXT): string {
  let t = String(s ?? "").replace(/[\r\n\t]+/g, " ");
  t = t.replace(/"[^"]*"|“[^”]*”|`[^`]*`/g, (q) => `${q[0]}…${q.at(-1)}`);
  t = t.replace(/(^|[\s(=:'])(?:~?\/|[A-Za-z]:\\)[^\s"'`,;()<>]*/g, "$1<path>");
  t = t.replace(new RegExp(`(?<![\\w<])[\\w][\\w.@+-]*\\.(${FILE_EXT})\\b`, "gi"), (_m, ext: string) => `<file .${ext.toLowerCase()}>`);
  t = t.replace(/\b(pass(?:word)?|passwd|pwd|secret|token|api[-_]?key|auth(?:orization)?|cookie|credentials?)(\s*[:=]\s*)("[^"]*"|\S+)/gi, "$1$2[redacted]");
  t = t.replace(/\bbearer\s+\S+/gi, "Bearer [redacted]");
  t = redactSecrets(t);
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

/** An entry as it may be written: unknown fields dropped, every string cleaned, a key that is not a key dropped. Pure. */
export function sanitize(raw: unknown, now = new Date()): DebugEntry | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (!DEBUG_KINDS.includes(r.kind as DebugKind) || typeof r.what !== "string" || !r.what) return null;
  const e: DebugEntry = {
    at: typeof r.at === "string" && !Number.isNaN(Date.parse(r.at)) ? new Date(r.at).toISOString() : now.toISOString(),
    src: r.src === "cli" ? "cli" : "app",
    kind: r.kind as DebugKind,
    what: clean(r.what, MAX_NAME),
  };
  if (typeof r.key === "string" && KEY_RE.test(r.key)) e.key = r.key;
  if (typeof r.ok === "boolean") e.ok = r.ok;
  if (typeof r.ms === "number" && Number.isFinite(r.ms) && r.ms >= 0) e.ms = Math.round(r.ms);
  if (r.error !== undefined && r.error !== null && r.error !== "") e.error = clean(r.error);
  if (r.detail && typeof r.detail === "object") {
    const d: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(r.detail as Record<string, unknown>).slice(0, 8)) {
      if (!/^[A-Za-z][A-Za-z0-9]{0,31}$/.test(k)) continue;
      if (typeof v === "number" && Number.isFinite(v)) d[k] = v;
      else if (typeof v === "boolean") d[k] = v;
      else if (typeof v === "string") d[k] = clean(v, MAX_NAME);
    }
    if (Object.keys(d).length) e.detail = d;
  }
  return e;
}

export function debugLogEnabled(): boolean {
  return !fs.existsSync(OFF_MARKER);
}

/** Every write and the switch go through one lock across processes: an append cannot be lost to
 *  another writer's trim, and no writer that started before `off` can bring the file back. */
function locked<T>(fn: () => T): T {
  ensureRoot();
  return withFileLockSync(DEBUG_LOG_FILE, fn, LOCK_WAIT_MS);
}

export function setDebugLog(on: boolean): void {
  locked(() => {
    if (on) fs.rmSync(OFF_MARKER, { force: true });
    else {
      fs.writeFileSync(OFF_MARKER, "");
      fs.rmSync(DEBUG_LOG_FILE, { force: true });
    }
  });
}

/** Append entries (sanitized); the file never holds more than the newest {@link DEBUG_LOG_KEEP}.
 *  Returns how many were written, or null when writing failed. Never throws: logging must not break what it logs. */
export function appendDebug(entries: readonly unknown[], file = DEBUG_LOG_FILE): number | null {
  const rows = entries.map((e) => sanitize(e)).filter((e): e is DebugEntry => e !== null);
  if (!rows.length) return 0;
  try {
    return locked(() => {
      if (!debugLogEnabled()) return 0;
      let lines: string[] = [];
      try {
        lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
      } catch {
        // no log yet
      }
      lines = [...lines, ...rows.map((e) => JSON.stringify(e))].slice(-DEBUG_LOG_KEEP);
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, lines.join("\n") + "\n", { mode: 0o600 });
      fs.renameSync(tmp, file);
      return rows.length;
    });
  } catch {
    return null;
  }
}

/** One entry from a CLI process (a bridge, a view switch). */
export function logDebug(e: Omit<DebugEntry, "at" | "src">): void {
  appendDebug([{ ...e, src: "cli" }]);
}

/** The newest {@link DEBUG_LOG_KEEP} entries, oldest first; lines that do not parse are skipped. */
export function readDebug(file = DEBUG_LOG_FILE): DebugEntry[] {
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: DebugEntry[] = [];
  for (const line of text.split("\n").filter(Boolean).slice(-DEBUG_LOG_KEEP)) {
    try {
      out.push(JSON.parse(line) as DebugEntry);
    } catch {
      // a line cut off by a crash
    }
  }
  return out;
}

/** One entry as a line for people. Pure. */
export function formatDebug(e: DebugEntry): string {
  const parts = [e.at, e.src, e.kind, e.what];
  if (e.key) parts.push(e.key);
  if (e.ok !== undefined) parts.push(e.ok ? "ok" : "FAILED");
  if (e.ms !== undefined) parts.push(`${e.ms}ms`);
  if (e.detail) parts.push(Object.entries(e.detail).map(([k, v]) => `${k}=${v}`).join(" "));
  if (e.error) parts.push(`— ${e.error}`);
  return parts.join("  ");
}
