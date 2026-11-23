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

/** The lock file that holds one session's take-over. */
export function adoptLockFile(dir: string, key: string): string {
  return path.join(dir, crypto.createHash("sha256").update(key).digest("hex").slice(0, 32) + ".lock");
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * One take-over per session at a time: two `host adopt` runs of one session
 * would start two programs writing one conversation. The lock file names its
 * process; a second run is refused while that process lives, and a lock left by
 * a process that died is taken over.
 */
export function withAdoptLock<T>(dir: string, key: string, fn: () => T, alive: (pid: number) => boolean = processAlive, pid = process.pid): T {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = adoptLockFile(dir, key);
  for (let attempt = 0; ; attempt++) {
    try {
      fs.writeFileSync(file, String(pid), { flag: "wx", mode: 0o600 });
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const holder = Number.parseInt(fs.readFileSync(file, "utf8"), 10);
      if (attempt === 0 && !(Number.isInteger(holder) && holder > 0 && alive(holder))) {
        fs.rmSync(file, { force: true });
        continue;
      }
      throw new AdoptRefused(`${key} is already being taken over${Number.isInteger(holder) ? ` (PID ${holder})` : ""}; wait for that to finish`, "running");
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(file, { force: true });
  }
}
