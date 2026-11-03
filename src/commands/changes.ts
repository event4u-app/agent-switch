/**
 * `agent-switch changes <session> [--json]` — the files a session changed in
 * its worktree against HEAD, for the Changes window (spec §9.3). Reads git in
 * the session's own repository only; nothing outside it is listed.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { die } from "../profiles.js";
import { sessionsWithGit } from "./pr.js";

export interface ChangedFile {
  status: "A" | "M" | "D" | "R" | "?";
  path: string;
  added: number;
  removed: number;
}

const GIT_MS = 2000;
const MAX_FILES = 500;
const MAX_UNTRACKED_BYTES = 1_000_000;

/** `git status --porcelain=v1 -z --untracked-files=all`. Pure. */
export function parsePorcelainZ(out: string): { status: ChangedFile["status"]; path: string }[] {
  const parts = out.split("\0");
  const rows: { status: ChangedFile["status"]; path: string }[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.length < 4) continue;
    const xy = p.slice(0, 2);
    const file = p.slice(3);
    if (xy === "??") rows.push({ status: "?", path: file });
    else if (xy.includes("R")) {
      rows.push({ status: "R", path: file });
      i++; // the source path follows a rename
    } else if (xy.includes("D")) rows.push({ status: "D", path: file });
    else if (xy.includes("A")) rows.push({ status: "A", path: file });
    else rows.push({ status: "M", path: file });
  }
  return rows;
}

/** `git diff HEAD --numstat -z`. Binary files count 0/0. Pure. */
export function parseNumstatZ(out: string): Map<string, { added: number; removed: number }> {
  const m = new Map<string, { added: number; removed: number }>();
  const parts = out.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const head = parts[i];
    if (!head) continue;
    const [a, r, file] = head.split("\t");
    const n = (s: string) => (/^\d+$/.test(s) ? Number(s) : 0);
    // A rename is "a\tr\t" followed by the old and the new path.
    if (file === "") {
      m.set(parts[i + 2] ?? "", { added: n(a), removed: n(r) });
      i += 2;
    } else if (file !== undefined) m.set(file, { added: n(a), removed: n(r) });
  }
  return m;
}

function git(cwd: string, args: string[]): string | null {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout: GIT_MS, maxBuffer: 16 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

function lineCount(file: string): number {
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.size > MAX_UNTRACKED_BYTES) return 0;
    const s = fs.readFileSync(file, "utf8");
    return s.length === 0 ? 0 : s.split("\n").length - (s.endsWith("\n") ? 1 : 0);
  } catch {
    return 0;
  }
}

/** The changed files in one worktree. null when it is not a git worktree. */
export function changesIn(toplevel: string): ChangedFile[] | null {
  const st = git(toplevel, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (st === null) return null;
  const counts = parseNumstatZ(git(toplevel, ["diff", "HEAD", "--numstat", "-z"]) ?? "");
  const root = path.resolve(toplevel);
  return parsePorcelainZ(st)
    .slice(0, MAX_FILES)
    .filter((f) => {
      const abs = path.resolve(root, f.path);
      return abs === root || abs.startsWith(root + path.sep);
    })
    .map((f) => {
      const c = counts.get(f.path);
      if (c) return { ...f, ...c };
      return { ...f, added: f.status === "?" ? lineCount(path.join(root, f.path)) : 0, removed: 0 };
    });
}

export function cmdChanges(session: string | undefined, flags: Record<string, string | boolean>): void {
  if (!session) die("usage: agent-switch changes <session> [--json]");
  const id = session.split("/").pop()!;
  const row = sessionsWithGit(50).find((r) => r.key === session || r.row.sessionId === id);
  if (!row) die(`no recent Claude or Codex session ${session}`);
  if (!row.git) die(`${row.key} does not work in a git repository`);
  const files = changesIn(row.git.toplevel) ?? [];
  if (flags.json) return void console.log(JSON.stringify({ key: row.key, worktree: row.git.toplevel, files }, null, 2));
  if (files.length === 0) return void console.log(`No changes in ${row.git.toplevel}.`);
  for (const f of files) console.log(`${f.status} ${f.path}  +${f.added} -${f.removed}`);
}
