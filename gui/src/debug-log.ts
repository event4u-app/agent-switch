/**
 * The app's half of the debug log (the CLI's `src/debug-log.ts` keeps the file):
 * what the person did, which CLI calls failed or changed something, what the chat
 * and the view switch did, and every error the window saw. Entries are batched and
 * handed to `agent-switch debug-log add`, which sanitizes them again and keeps the
 * newest 100.
 *
 * Never content: action names and session keys, outcomes, durations, error messages
 * with quoted text cut out. A failure that repeats (a poll every few seconds) is
 * written once, then as a count.
 */

import { Command } from "@tauri-apps/plugin-shell";

import { redactSecrets } from "./redact.js";

export type DebugKind = "action" | "call" | "view" | "bridge" | "error";

export interface DebugEntry {
  at: string;
  src: "app";
  kind: DebugKind;
  what: string;
  key?: string;
  ok?: boolean;
  ms?: number;
  error?: string;
  detail?: Record<string, string | number | boolean>;
}

const PREF_KEY = "agent-switch-debug-log";
const MAX_PENDING = 100;
const FLUSH_MS = 2_000;
/** A failure is written soon: the app may be about to hang or close. */
const FLUSH_FAILURE_MS = 200;
/** How long after something the person did a successful call still counts as its outcome. */
const ACTION_WINDOW_MS = 5_000;

/** A session key whose id is an id (UUID-like, or `new`): a title shaped like a key is not one. Mirrors the CLI's. */
const KEY_RE = /^(claude|codex|antigravity|acp)\/[A-Za-z0-9._-]{1,64}\/([0-9A-Fa-f][0-9A-Fa-f-]{7,63}|new)$/;

const FILE_EXT = "pdf|docx?|xlsx?|pptx?|key|pages|numbers|png|jpe?g|gif|webp|heic|svg|txt|md|rtf|json|ya?ml|toml|csv|zip|tar|gz|ts|tsx|js|mjs|cjs|py|go|rs|java|kt|rb|php|html?|css|scss|sh|log|pem|env|sql|db|sqlite";
const FILE_RE = new RegExp(`(?<![\\w<])[\\w][\\w.@+-]*\\.(${FILE_EXT})\\b`, "gi");

/** One line; no quoted text, paths or file names (only their kind); `key=value` secrets and anything
 *  token-shaped redacted; short. Mirrors `clean` in the CLI's src/debug-log.ts, which runs again on write. Pure. */
export function cleanText(s: unknown, max = 300): string {
  let t = String(s ?? "").replace(/[\r\n\t]+/g, " ");
  t = t.replace(/"[^"]*"|“[^”]*”|`[^`]*`/g, (q) => `${q[0]}…${q.at(-1)}`);
  t = t.replace(/(^|[\s(=:'])(?:~?\/|[A-Za-z]:\\)[^\s"'`,;()<>]*/g, "$1<path>");
  t = t.replace(FILE_RE, (_m, ext: string) => `<file .${ext.toLowerCase()}>`);
  t = t.replace(/\b(pass(?:word)?|passwd|pwd|secret|token|api[-_]?key|auth(?:orization)?|cookie|credentials?)(\s*[:=]\s*)("[^"]*"|\S+)/gi, "$1$2[redacted]");
  t = t.replace(/\bbearer\s+\S+/gi, "Bearer [redacted]");
  t = redactSecrets(t);
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

/** The session key among a call's arguments, if any. Pure. */
export function keyOf(values: readonly unknown[]): string | undefined {
  return values.find((v): v is string => typeof v === "string" && KEY_RE.test(v));
}

/** Verbs whose calls only read. Their successes are not written (they poll); their failures are. */
const READ_VERBS = new Set([
  "engine", "changes", "alerts", "auto-reset", "autoswitch", "claude-settings", "keep-signed-in", "launcher", "open-targets",
  "sessions", "timeline", "needs", "status", "usage", "tooling", "providers", "protection", "remote", "quiet-hours", "os-notify",
  "pace", "strategy", "sync", "share", "terminal-sync", "link", "pool", "pr", "diff", "files", "mcp", "host", "activity",
  "gui-settings", "open-targets", "notifications", "library", "agents", "limits", "doctor", "auth-status", "picks", "switch",
]);
const READ_SUBS = new Set(["status", "list", "history", "preview", "suggest", "library", "get"]);
/** Subcommands the app runs. A word not in here after the verb is a value (a profile or pool name) and is never named. */
const KNOWN_SUBS = new Set([
  ...READ_SUBS, "add", "adopt", "approve", "attach", "cleanup", "clear", "confirm", "copy", "create", "delete", "end", "executor", "install",
  "keep", "later", "link", "name", "off", "on", "open", "rc", "remove", "rename", "respawn", "restart", "restore", "reveal", "rule", "run",
  "seen", "set", "ssh", "start", "sync", "uninstall", "unlink", "stage", "unstage", "discard", "commit", "undo", "deny",
]);

/** A CLI call as the log names it: its verb and a known subcommand (also after a session key, as in
 *  `diff <key> stage`), never the values passed (names, titles, paths). Pure. */
export function describeCall(args: readonly string[]): { what: string; key?: string; read: boolean } {
  const verb = /^[a-z][a-z-]{0,30}$/.test(args[0] ?? "") ? args[0] : "?";
  let i = 1;
  if (args[i] !== undefined && KEY_RE.test(args[i])) i++;
  const sub = args[i] !== undefined && KNOWN_SUBS.has(args[i]) ? args[i] : undefined;
  const read = READ_VERBS.has(verb) && (!sub || READ_SUBS.has(sub));
  return { what: sub ? `${verb} ${sub}` : verb, key: keyOf(args), read };
}

export interface DebugLog {
  record(e: Omit<DebugEntry, "at" | "src">): void;
  /** Did the person act within the last `ms`? A call that succeeds is only worth a line then: the rest polls. */
  recentAction(ms?: number): boolean;
  flush(): Promise<void>;
  enabled(): boolean;
  setEnabled(on: boolean): void;
}

export interface DebugLogDeps {
  write: (batch: DebugEntry[]) => Promise<void>;
  /** Whether the log is on, as the CLI's marker says (the one switch every process obeys); null when unknown. */
  readEnabled?: () => Promise<boolean | null>;
  now: () => Date;
  schedule: (f: () => void, ms: number) => unknown;
  cancel: (h: unknown) => void;
  load: () => string | null;
  save: (v: string) => void;
}

export function createDebugLog(deps: DebugLogDeps): DebugLog {
  let on = deps.load() !== "off";
  let pending: DebugEntry[] = [];
  let timer: unknown = null;
  let dueAt = Infinity;
  let last: { sig: string; entry: DebugEntry; repeats: number } | null = null;
  // One write at a time: a slow shell never piles up writers.
  let writing: Promise<void> | null = null;
  let lastActionAt = -Infinity;

  const push = (e: DebugEntry) => {
    pending.push(e);
    if (pending.length > MAX_PENDING) pending = pending.slice(-MAX_PENDING);
  };
  const closeRepeats = () => {
    if (last && last.repeats > 0) push({ ...last.entry, at: deps.now().toISOString(), detail: { ...last.entry.detail, repeated: last.repeats } });
    if (last) last.repeats = 0;
  };
  const arm = (ms: number) => {
    const at = Date.now() + ms;
    if (timer !== null && at >= dueAt) return;
    if (timer !== null) deps.cancel(timer);
    dueAt = at;
    timer = deps.schedule(() => void log.flush(), ms);
  };

  const log: DebugLog = {
    record(raw) {
      if (!on) return;
      const e: DebugEntry = { ...raw, at: deps.now().toISOString(), src: "app", what: cleanText(raw.what, 80) };
      if (raw.error !== undefined) e.error = cleanText(raw.error);
      if (raw.key !== undefined && !KEY_RE.test(raw.key)) delete e.key;
      if (e.kind === "action" || e.kind === "view") lastActionAt = deps.now().getTime();
      const sig = JSON.stringify([e.kind, e.what, e.key, e.ok, e.error]);
      if (last?.sig === sig && e.ok === false) {
        last.repeats++;
        return;
      }
      closeRepeats();
      last = { sig, entry: e, repeats: 0 };
      push(e);
      arm(e.ok === false || e.kind === "error" ? FLUSH_FAILURE_MS : FLUSH_MS);
    },
    async flush() {
      if (timer !== null) deps.cancel(timer);
      timer = null;
      dueAt = Infinity;
      if (writing) {
        // Behind the write in flight; what arrives meanwhile goes in the next batch.
        await writing;
        return log.flush();
      }
      closeRepeats();
      if (!on || !pending.length) return;
      const batch = pending;
      pending = [];
      writing = deps.write(batch).catch(() => {
        // The log never breaks the app; a lost batch is the price.
      });
      try {
        await writing;
      } finally {
        writing = null;
      }
    },
    recentAction: (ms = ACTION_WINDOW_MS) => deps.now().getTime() - lastActionAt <= ms,
    enabled: () => on,
    setEnabled(next) {
      on = next;
      deps.save(next ? "on" : "off");
      if (!next) {
        pending = [];
        last = null;
      }
    },
  };
  return log;
}

const realDeps: DebugLogDeps = {
  // Straight to the shell: a call through `ipc` would be logged itself.
  write: async (batch) => {
    const out = await Command.create("agent-switch", ["debug-log", "add", JSON.stringify(batch)]).execute();
    if (out.code !== 0) throw new Error(out.stderr || "debug-log add failed");
  },
  readEnabled: async () => {
    try {
      const out = await Command.create("agent-switch", ["debug-log", "status", "--json"]).execute();
      const o = JSON.parse(out.stdout.trim()) as { enabled?: unknown };
      return typeof o.enabled === "boolean" ? o.enabled : null;
    } catch {
      return null;
    }
  },
  now: () => new Date(),
  schedule: (f, ms) => setTimeout(f, ms),
  cancel: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  load: () => {
    try {
      return localStorage.getItem(PREF_KEY);
    } catch {
      return null;
    }
  },
  save: (v) => {
    try {
      localStorage.setItem(PREF_KEY, v);
    } catch {
      // no storage: the CLI's marker still decides what is written
    }
  },
};

/** The main window's log; a window that never calls {@link installDebugLog} only buffers nothing. */
let active: DebugLog | null = null;

export function debugLog(): DebugLog | null {
  return active;
}

/** The line of a failed command's stderr that says what went wrong: an error line if there is one,
 *  never Node's version trailer or a stack frame. Pure. */
export function errorLine(stderr: string | undefined): string {
  const lines = (stderr ?? "").split("\n").map((l) => l.trim()).filter((l) => l && !/^Node\.js v\d/.test(l) && !/^at\s/.test(l) && !/^\^+$/.test(l));
  return [...lines].reverse().find((l) => /error|refused|denied|not found|no such|cannot|can't|failed|invalid|usage:/i.test(l)) ?? lines.at(-1) ?? "";
}

/** Did the person act a moment ago? False while the log is off or not installed. */
export function recentAction(): boolean {
  return active?.enabled() === true && active.recentAction();
}

/** Shorthand used across the app; a no-op until the main window installed the log. */
export function recordDebug(e: Omit<DebugEntry, "at" | "src">): void {
  active?.record(e);
}

/** The main window only: start the log and catch every error the window sees. */
export function installDebugLog(deps: DebugLogDeps = realDeps, target: Pick<Window, "addEventListener"> = window): DebugLog {
  active = createDebugLog(deps);
  // The CLI's switch decides (set in the app or with `agent-switch debug-log on|off`); the app follows it.
  const mine = active;
  void deps.readEnabled?.().then((on) => {
    if (on !== null && on !== mine.enabled()) mine.setEnabled(on);
  });
  target.addEventListener("error", (ev: Event) => {
    const e = ev as ErrorEvent;
    recordDebug({ kind: "error", what: "window error", ok: false, error: e.message || String(e.error ?? "error"), detail: e.filename ? { at: `${e.filename.split("/").pop()}:${e.lineno}` } : undefined });
  });
  target.addEventListener("unhandledrejection", (ev: Event) => {
    const r = (ev as PromiseRejectionEvent).reason;
    recordDebug({ kind: "error", what: "unhandled rejection", ok: false, error: r instanceof Error ? r.message : String(r) });
  });
  // A window closing writes what it still holds.
  target.addEventListener("beforeunload", () => void active?.flush());
  return active;
}
