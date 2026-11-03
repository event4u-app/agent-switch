/**
 * Open approvals and questions of running bridges, for the Needs-you queue
 * (spec §13.5: one decision). Each bridge keeps one small file; a file whose
 * bridge process is gone is ignored and removed.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export interface PendingItem {
  id: string;
  tool: string;
  summary: string;
  since: string;
}

export interface PendingFile {
  key: string;
  pid: number;
  items: PendingItem[];
}

export const pendingDir = (root: string) => path.join(root, "bridge", "pending");
const fileOf = (root: string, key: string) => path.join(pendingDir(root), crypto.createHash("sha256").update(key).digest("hex").slice(0, 32) + ".json");

export function writePending(root: string, f: PendingFile): void {
  const file = fileOf(root, f.key);
  if (!f.items.length) return void fs.rmSync(file, { force: true });
  fs.mkdirSync(pendingDir(root), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(f), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function clearPending(root: string, key: string): void {
  fs.rmSync(fileOf(root, key), { force: true });
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** Every running bridge's open items; stale files are removed. */
export function readPending(root: string, isAlive: (pid: number) => boolean = alive): PendingFile[] {
  let names: string[];
  try {
    names = fs.readdirSync(pendingDir(root)).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  const out: PendingFile[] = [];
  for (const n of names) {
    const file = path.join(pendingDir(root), n);
    try {
      const f = JSON.parse(fs.readFileSync(file, "utf8")) as PendingFile;
      if (!isAlive(f.pid)) {
        fs.rmSync(file, { force: true });
        continue;
      }
      out.push(f);
    } catch {
      // half-written or foreign: skip
    }
  }
  return out;
}
