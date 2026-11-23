/**
 * "Take over here": a session the user started in their own terminal continues
 * as a session Agent Switch hosts, on the SAME account and under the same id
 * (`host adopt`). Nothing moves between accounts; the program in the user's
 * terminal is the one thing in the way, because two programs writing one
 * conversation corrupt it.
 *
 * - Claude names its process per session (`sessions/<pid>.json`): a running
 *   source is refused, or ended between turns when asked (`--stop-source`).
 * - Codex names none: Agent Switch cannot tell which codex program holds the
 *   session, so it never ends one. Any codex running on the account is refused
 *   with what to do in the terminal; `--force` is for when that program is
 *   another session.
 */

import { execFileSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import type { LiveSession } from "../api.js";
import type { HostedSession } from "./tmux-host.js";

export type AdoptRefusal = "running" | "unknown-live" | "unsupported" | "invalid";

export class AdoptRefused extends Error {
  constructor(
    message: string,
    readonly reason: AdoptRefusal,
  ) {
    super(message);
  }
}

export interface AdoptStart {
  provider: "claude" | "codex";
  account: string;
  sessionId: string;
  cwd: string;
  args: string[];
}

export interface AdoptDeps {
  accounts: (provider: "claude" | "codex") => string[];
  /** Keys of the sessions the host already runs. */
  hosted: () => Set<string>;
  /** The session's transcript on that account, with the folder it ran in. */
  locate: (provider: "claude" | "codex", account: string, sessionId: string) => { cwd: string | null } | null;
  folderExists: (dir: string) => boolean;
  liveClaude: (account: string) => LiveSession[];
  codexRunning: (account: string) => boolean;
  /** End the source between turns and wait for it (refuses mid-turn). */
  stop: (sessionId: string, procs: LiveSession[]) => void;
  start: (o: AdoptStart) => HostedSession;
}

export interface AdoptOptions {
  stopSource?: boolean;
  force?: boolean;
}

const KEY = /^([a-z][a-z0-9-]*)\/([^/]+)\/([0-9a-f-]{8,64})$/i;

export function adopt(d: AdoptDeps, key: string, o: AdoptOptions): HostedSession {
  const m = KEY.exec(key);
  if (!m) throw new AdoptRefused(`"${key}" is not a session key (provider/account/session)`, "invalid");
  const [, provider, account, sessionId] = m;
  if (provider !== "claude" && provider !== "codex") throw new AdoptRefused("taking a session over works for Claude and Codex sessions", "unsupported");
  if (!d.accounts(provider).includes(account)) throw new AdoptRefused(`no ${provider} account "${account}"`, "invalid");
  if (d.hosted().has(key)) throw new AdoptRefused(`${key} already runs in Agent Switch`, "invalid");
  const loc = d.locate(provider, account, sessionId);
  if (!loc) throw new AdoptRefused(`session ${sessionId} not found on ${provider}/${account}`, "invalid");
  if (!loc.cwd) throw new AdoptRefused(`${key} names no folder to resume it in`, "invalid");
  if (!d.folderExists(loc.cwd)) throw new AdoptRefused(`its folder ${loc.cwd} no longer exists`, "invalid");

  if (provider === "claude") {
    const live = d.liveClaude(account);
    const unknown = live.filter((s) => s.sessionId === null).map((s) => s.pid);
    if (unknown.length > 0 && !o.force) {
      throw new AdoptRefused(
        `claude/${account} has running Claude programs that name no session (PIDs ${unknown.join(", ")}); one of them may be this session. ` +
          "End it in its terminal first, or --force if you are sure it is another session.",
        "unknown-live",
      );
    }
    const mine = live.filter((s) => s.sessionId === sessionId);
    if (mine.length > 0) {
      if (o.stopSource) d.stop(sessionId, mine);
      else {
        // Named by its own process: this is the session, so --force (meant for a
        // program that may be another session) never starts a second writer.
        throw new AdoptRefused(
          `${key} still runs in your terminal (PID ${mine.map((s) => s.pid).join(", ")}). End it there (type /exit), or pass --stop-source to end it between turns.`,
          "running",
        );
      }
    }
    return d.start({ provider, account, sessionId, cwd: loc.cwd, args: ["--resume", sessionId] });
  }

  if (o.stopSource) {
    throw new AdoptRefused("--stop-source works for Claude sessions only: Agent Switch cannot tell which codex program holds a session, so it never ends one", "unsupported");
  }
  if (!o.force && d.codexRunning(account)) {
    throw new AdoptRefused(
      `codex is running on codex/${account}. Quit Codex in the terminal that holds this session first (type /quit, or press Ctrl+C twice), then take it over. ` +
        "Agent Switch cannot tell which codex program holds it; --force if the running one is another session.",
      "running",
    );
  }
  return d.start({ provider, account, sessionId, cwd: loc.cwd, args: ["resume", sessionId] });
}

/** Who holds a take-over: the process, and when it started (a PID alone can be reused). */
export interface LockHolder {
  pid: number;
  /** The process's start time as the system reports it; null where it cannot be read. */
  start: string | null;
}

/** When `pid` started, as `ps` reports it; null where that cannot be read. */
export function processStart(pid: number): string | null {
  if (process.platform === "win32") return null;
  try {
    const out = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000 }).trim();
    return out || null;
  } catch {
    return null;
  }
}

/** The holder's process still runs: its PID is taken, and by the process that wrote the lock. */
export function holderAlive(h: LockHolder): boolean {
  try {
    process.kill(h.pid, 0);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EPERM") return false;
  }
  if (h.start === null) return true;
  const now = processStart(h.pid);
  return now === null || now === h.start;
}

const lockBase = (key: string) => crypto.createHash("sha256").update(key).digest("hex").slice(0, 32);

/** One generation of the lock that holds one session's take-over. */
export function adoptLockFile(dir: string, key: string, generation = 0): string {
  return path.join(dir, `${lockBase(key)}.${String(generation).padStart(10, "0")}.lock`);
}

/** The generations of one session's lock on disk, lowest first. */
function generations(dir: string, base: string): number[] {
  const re = new RegExp(`^${base}\\.(\\d{10})\\.lock$`);
  return fs
    .readdirSync(dir)
    .map((f) => re.exec(f)?.[1])
    .filter((g): g is string => g !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
}

/** A lock file's holder; null when it names none (a lock from an older version: a bare PID); "gone" when released meanwhile. */
function readHolder(file: string): LockHolder | null | "gone" {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "gone";
    throw err;
  }
  try {
    const o = JSON.parse(text) as { pid?: unknown; start?: unknown };
    if (typeof o.pid === "number" && Number.isInteger(o.pid) && o.pid > 0) return { pid: o.pid, start: typeof o.start === "string" ? o.start : null };
  } catch {
    /* a bare PID, below */
  }
  const pid = Number.parseInt(text, 10);
  return Number.isInteger(pid) && pid > 0 ? { pid, start: null } : null;
}

export interface AdoptLockOptions {
  /** Whether a holder still runs (tests stand in for the process table). */
  alive?: (h: LockHolder) => boolean;
  /** This process as the lock names it. */
  self?: LockHolder;
}

const ATTEMPTS = 50;

/**
 * One take-over per session at a time: two `host adopt` runs of one session
 * would start two programs writing one conversation. Held through `fn`, which
 * registers the hosted window, so the next run sees the session as hosted.
 *
 * The lock is a chain of generations (`<session>.<n>.lock`), each naming its
 * process and that process's start time. Taking it is publishing generation
 * top+1 — a hard link of a finished file, so it appears whole and only one run
 * can make it — after finding the top one held by no running process, then
 * checking no higher one appeared. Nothing ever removes a lock another live run
 * holds: a dead holder's generation is not deleted to be retaken (two runs that
 * both read the same dead holder would then each delete the other's fresh lock),
 * it is outranked, and only the run holding the top tidies the dead ones below.
 */
export function withAdoptLock<T>(dir: string, key: string, fn: () => T, o: AdoptLockOptions = {}): T {
  const alive = o.alive ?? holderAlive;
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const base = lockBase(key);
  const self = o.self ?? { pid: process.pid, start: processStart(process.pid) };
  const refused = (h: LockHolder | null) => new AdoptRefused(`${key} is already being taken over${h ? ` (PID ${h.pid})` : ""}; wait for that to finish`, "running");
  let mine: string | null = null;
  for (let attempt = 0; attempt < ATTEMPTS && mine === null; attempt++) {
    const top = generations(dir, base).at(-1);
    if (top !== undefined) {
      const h = readHolder(adoptLockFile(dir, key, top));
      if (h === "gone") continue;
      if (h && alive(h)) throw refused(h);
    }
    const next = (top ?? -1) + 1;
    const file = adoptLockFile(dir, key, next);
    const tmp = path.join(dir, `.${base}.${self.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(self), { flag: "wx", mode: 0o600 });
    try {
      fs.linkSync(tmp, file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw err;
    } finally {
      fs.rmSync(tmp, { force: true });
    }
    // A run that read an older top can publish a lower generation after us, never a higher one.
    if (generations(dir, base).at(-1) !== next) {
      fs.rmSync(file, { force: true });
      continue;
    }
    mine = file;
    for (const g of generations(dir, base)) if (g < next) fs.rmSync(adoptLockFile(dir, key, g), { force: true });
  }
  if (mine === null) throw refused(null);
  try {
    return fn();
  } finally {
    fs.rmSync(mine, { force: true });
  }
}
