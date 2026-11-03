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

import type { TmuxHost } from "./tmux-host.js";

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

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export class InputLeases {
  private readonly dir: string;

  constructor(root: string, private readonly now: () => number = Date.now, private readonly isAlive: (pid: number) => boolean = alive) {
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

  /** Type `text` into a hosted session — only as the lease holder, only literally. */
  type(host: TmuxHost, key: string, holder: Holder, text: string, opts: { enter?: boolean } = {}): void {
    const cur = this.read(key);
    if (!cur || cur.holder.id !== holder.id || this.stale(cur)) throw new NotHolder(`${holder.id} does not hold the input lease for ${key}`);
    const window = host.windowOf(key);
    if (!window) throw new Error(`no hosted session ${key}`);
    // -l: the text is typed as-is, never read as tmux key names.
    if (text) host.run(["send-keys", "-t", window, "-l", text]);
    if (opts.enter) host.run(["send-keys", "-t", window, "Enter"]);
  }
}
