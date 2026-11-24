/**
 * One writer per hosted session (road-to-agent-switch-v3-central, Phase 1).
 *
 * Whoever holds a session's input lease may type into it; every other viewer
 * gets a read-only mirror (`TmuxHost.capture`). The lease is a small file per
 * session, created with O_EXCL so two writers can never both win. It moves only
 * by an explicit handover from the holder, or — when the holder is gone (its
 * process died, or it stopped renewing) — by recovery.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { promptDraft } from "./prompt.js";
import type { TmuxHost } from "./tmux-host.js";

/** Typing into a hosted window did not happen; the message says why. */
export class TypeFailed extends Error {}

/** A person who typed in an attached view this recently is still typing (G3). */
export const DRAFT_QUIET_MS = 3_000;
/** How long an automated send waits for that person before it gives up. */
export const DRAFT_WAIT_MS = 60_000;

const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** A holder that has not renewed for this long has lost the lease. */
export const LEASE_TTL_MS = 15_000;

export interface Holder {
  /** A stable id per viewer (an app window, a CLI run). */
  id: string;
  pid: number;
  /** For the UI: "app", "cli", "tray", "remote". */
  kind: string;
}

export interface Lease {
  key: string;
  holder: Holder;
  acquiredAt: string;
  renewedAt: string;
}

export class LeaseHeld extends Error {
  constructor(readonly lease: Lease) {
    super(`${lease.key} is being typed into by ${lease.holder.kind} ${lease.holder.id}`);
  }
}

export class NotHolder extends Error {}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export class InputLeases {
  private readonly dir: string;

  constructor(root: string, private readonly now: () => number = Date.now, private readonly isAlive: (pid: number) => boolean = alive, private readonly sleep: (ms: number) => void = sleepSync) {
    this.dir = path.join(root, "host", "leases");
  }

  private file(key: string): string {
    return path.join(this.dir, crypto.createHash("sha256").update(key).digest("hex").slice(0, 32) + ".json");
  }

  read(key: string): Lease | null {
    try {
      return JSON.parse(fs.readFileSync(this.file(key), "utf8"));
    } catch {
      return null;
    }
  }

  /** Is this lease no longer backed by a live, renewing holder? */
  stale(l: Lease): boolean {
    return !this.isAlive(l.holder.pid) || this.now() - Date.parse(l.renewedAt) > LEASE_TTL_MS;
  }

  private write(lease: Lease, exclusive: boolean): boolean {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const body = JSON.stringify(lease) + "\n";
    if (exclusive) {
      try {
        fs.writeFileSync(this.file(lease.key), body, { flag: "wx", mode: 0o600 });
        return true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
        throw err;
      }
    }
    const tmp = `${this.file(lease.key)}.${process.pid}.${crypto.randomBytes(4).toString("hex")}`;
    fs.writeFileSync(tmp, body, { mode: 0o600 });
    fs.renameSync(tmp, this.file(lease.key));
    return true;
  }

  /** Take the lease, or renew it if `holder` has it already. Throws LeaseHeld while someone else holds it. */
  acquire(key: string, holder: Holder): Lease {
    const at = new Date(this.now()).toISOString();
    for (let attempt = 0; attempt < 3; attempt++) {
      const cur = this.read(key);
      if (!cur) {
        const fresh: Lease = { key, holder, acquiredAt: at, renewedAt: at };
        if (this.write(fresh, true)) return fresh;
        continue; // another writer was faster: look again
      }
      if (cur.holder.id === holder.id) {
        const renewed = { ...cur, holder, renewedAt: at };
        this.write(renewed, false);
        return renewed;
      }
      if (!this.stale(cur)) throw new LeaseHeld(cur);
      // Recovery: remove the dead holder's lease, then race for a fresh one.
      try {
        if (this.read(key)?.renewedAt === cur.renewedAt) fs.unlinkSync(this.file(key));
      } catch {
        // gone already
      }
    }
    const cur = this.read(key);
    if (cur) throw new LeaseHeld(cur);
    throw new Error(`could not take the lease for ${key}`);
  }

  /** Explicit handover: only the holder can give the lease to someone else. */
  handover(key: string, from: Holder, to: Holder): Lease {
    const cur = this.read(key);
    if (!cur || cur.holder.id !== from.id) throw new NotHolder(`${from.id} does not hold ${key}`);
    const at = new Date(this.now()).toISOString();
    const next: Lease = { key, holder: to, acquiredAt: at, renewedAt: at };
    this.write(next, false);
    return next;
  }

  release(key: string, holder: Holder): boolean {
    const cur = this.read(key);
    if (!cur || cur.holder.id !== holder.id) return false;
    try {
      fs.unlinkSync(this.file(key));
    } catch {
      return false;
    }
    return true;
  }

  /**
   * Type `text` into a hosted session — only as the lease holder, only literally.
   * With Enter, only into an empty input line: Enter submits whatever is there,
   * so a draft the user left is never sent along. Every tmux call that fails is
   * reported (TypeFailed), and nothing follows it.
   */
  type(host: TmuxHost, key: string, holder: Holder, text: string, opts: { enter?: boolean } = {}): void {
    const cur = this.read(key);
    if (!cur || cur.holder.id !== holder.id || this.stale(cur)) throw new NotHolder(`${holder.id} does not hold the input lease for ${key}`);
    const window = host.windowOf(key);
    if (!window) throw new Error(`no hosted session ${key}`);
    const tmux = (args: string[]) => {
      const r = host.run(args);
      if (!r.ok) throw new TypeFailed(`typing into ${key} failed: ${r.err.trim() || "tmux refused"}`);
      return r.out;
    };
    // G3: a person typing in a view attached to this window (a terminal start, `host attach`) has
    // the floor. Wait until they have been quiet for a moment; give up rather than mix keys.
    const lastKey = () => {
      const times = tmux(["list-clients", "-F", "#{client_activity} #{window_id}"])
        .split("\n")
        .map((l) => l.trim().split(" "))
        .filter(([, w]) => w === window)
        .map(([a]) => Number(a) * 1000)
        .filter((n) => Number.isFinite(n));
      return times.length ? Math.max(...times) : -Infinity;
    };
    const giveUp = this.now() + DRAFT_WAIT_MS;
    let seen = lastKey();
    while (this.now() - seen < DRAFT_QUIET_MS) {
      if (this.now() >= giveUp) throw new TypeFailed(`nothing was sent: someone is typing in it (${key}); it is left for you`);
      this.sleep(250);
      seen = lastKey();
    }
    if (opts.enter) {
      // -e keeps the styling, which tells a dimmed placeholder from typed text.
      const input = promptDraft(tmux(["capture-pane", "-p", "-e", "-J", "-t", window]));
      if (input.menu) throw new TypeFailed(`nothing was sent: ${key} is waiting for an answer (a permission or a question); answer it in its window first`);
      if (!input.found) throw new TypeFailed(`nothing was sent: ${key} shows no input line to type into right now; type it in its window`);
      if (input.draft) throw new TypeFailed(`nothing was sent: your draft is in the way in ${key} ("${input.draft.length > 40 ? `${input.draft.slice(0, 39)}…` : input.draft}"); send or clear it there first`);
    }
    // -l: the text is typed as-is, never read as tmux key names.
    if (text) tmux(["send-keys", "-t", window, "-l", text]);
    if (opts.enter) {
      // A key between the text and Enter would be submitted with it: take back only what was typed here.
      if (lastKey() > seen) {
        if (text) tmux(["send-keys", "-t", window, "-N", String([...text].length), "BSpace"]);
        throw new TypeFailed(`nothing was sent: someone typed in it while it was being sent (${key}); it is left for you`);
      }
      tmux(["send-keys", "-t", window, "Enter"]);
    }
  }
}
