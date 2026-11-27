/**
 * `agent-switch changes <session> [--json]` — the files a session changed in
 * its worktree against HEAD, for the Changes window (spec §9.3). Reads git in
 * the session's own repository only; nothing outside it is listed.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { die, ROOT } from "../profiles.js";
import { sessionsWithGit } from "./pr.js";
import { baseOf, dropEntry, findEntry, inside, listShelf, listStashes, localChanges, restoreEntry, rollbackGit, rollbackLocal, shelve, snapshot, stashOp } from "./shelf.js";

export interface ChangedFile {
  status: "A" | "M" | "D" | "R" | "?";
  path: string;
  added: number;
  removed: number;
}

const GIT_MS = 2000;
/** Files the Changes list and the Review page list; past it both say how many more there are. */
export const MAX_CHANGED_FILES = 500;
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

/** The one order both lists use, so the same cap keeps the same files. */
export const byPath = (a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path);

/** The changed files in one worktree, by path, at most `MAX_CHANGED_FILES`; `more` counts the rest. null when it is not a git worktree. */
export function changeInventory(toplevel: string): { files: ChangedFile[]; more: number } | null {
  const st = git(toplevel, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (st === null) return null;
  const counts = parseNumstatZ(git(toplevel, ["diff", "HEAD", "--numstat", "-z"]) ?? "");
  const root = path.resolve(toplevel);
  const all = parsePorcelainZ(st)
    .filter((f) => {
      const abs = path.resolve(root, f.path);
      return abs === root || abs.startsWith(root + path.sep);
    })
    .sort(byPath);
  const files = all.slice(0, MAX_CHANGED_FILES).map((f) => {
    const c = counts.get(f.path);
    if (c) return { ...f, ...c };
    return { ...f, added: f.status === "?" ? lineCount(path.join(root, f.path)) : 0, removed: 0 };
  });
  return { files, more: all.length - files.length };
}

/** The listed changed files in one worktree (see `changeInventory`). null when it is not a git worktree. */
export function changesIn(toplevel: string): ChangedFile[] | null {
  return changeInventory(toplevel)?.files ?? null;
}

const OPS = ["rollback", "shelve", "unshelve", "shelf-drop", "snapshot", "stash", "stash-apply", "stash-pop", "stash-drop"] as const;
type Op = (typeof OPS)[number];
const USAGE =
  "usage: agent-switch changes <session> [--json] · changes <session> rollback|shelve|stash [--text MSG] <file>… · changes <session> snapshot [--text MSG] · changes <session> unshelve|shelf-drop <id> · changes <session> stash-apply|stash-pop|stash-drop <stash@{n}>";

/** The session's folder: its git toplevel, or — without git — the folder it runs in. */
function folderOf(session: string): { key: string; root: string; git: boolean } {
  const id = session.split("/").pop()!;
  const row = sessionsWithGit(50).find((r) => r.key === session || r.row.sessionId === id);
  if (!row) die(`no recent Claude or Codex session ${session}`);
  if (row.git) return { key: row.key, root: row.git.toplevel, git: true };
  if (!row.row.cwd) die(`${row.key} has no known folder`);
  return { key: row.key, root: row.row.cwd, git: false };
}

/**
 * `changes <session> [--json]`: the changed files (git: vs HEAD; without git: vs the last local snapshot), the
 * Shelf and, in a repository, the stashes. `changes <session> <op> …`: Rollback, Shelve, Stash, Snapshot and
 * their undo, as the Changes window runs them.
 */
export function cmdChanges(args: readonly string[], flags: Record<string, string | boolean>): void {
  const [session, op, ...rest] = args;
  if (!session) die(USAGE);
  const f = folderOf(session);
  const shelfRoot = path.join(ROOT, "shelf");
  if (op) {
    if (!(OPS as readonly string[]).includes(op)) die(USAGE);
    const message = typeof flags.text === "string" ? flags.text : "";
    try {
      runOp(op as Op, f, shelfRoot, rest, message);
    } catch (e) {
      die(e instanceof Error ? e.message : String(e));
    }
    return void console.log(flags.json ? JSON.stringify({ ok: true, op }) : `${op}: done`);
  }
  const shelf = listShelf(shelfRoot, f.root);
  const shelves = shelf.map((e) => ({ id: e.id, message: e.message, created: e.created, kind: e.kind, full: !!e.full, files: e.files.length }));
  if (f.git) {
    const { files, more } = changeInventory(f.root) ?? { files: [], more: 0 };
    if (flags.json) return void console.log(JSON.stringify({ key: f.key, worktree: f.root, source: { kind: "git" }, files, more, shelves, stashes: listStashes(f.root) }, null, 2));
    if (files.length === 0) console.log(`No changes in ${f.root}.`);
    for (const x of files) console.log(`${x.status} ${x.path}  +${x.added} -${x.removed}`);
    if (more) console.log(`${more} more ${more === 1 ? "file" : "files"} not listed.`);
    return;
  }
  const base = baseOf(shelf);
  const all = localChanges(shelfRoot, f.root);
  const files = (all ?? []).slice(0, MAX_CHANGED_FILES);
  const more = (all?.length ?? 0) - files.length;
  if (flags.json) return void console.log(JSON.stringify({ key: f.key, worktree: f.root, source: { kind: "local", snapshot: base ? base.created : null }, files, more, shelves, stashes: [] }, null, 2));
  if (!base) return void console.log(`${f.root} is not a git repository and has no snapshot yet: agent-switch changes ${f.key} snapshot`);
  if (files.length === 0) console.log(`No changes in ${f.root} since the snapshot.`);
  for (const x of files) console.log(`${x.status} ${x.path}  +${x.added} -${x.removed}`);
}

function runOp(op: Op, f: { root: string; git: boolean }, shelfRoot: string, rest: readonly string[], message: string): void {
  const needFiles = () => {
    if (rest.length === 0) throw new Error(`${op}: name the files`);
    for (const r of rest) if (!inside(f.root, r)) throw new Error(`${r} is not inside ${f.root}`);
    return rest;
  };
  const needGit = () => {
    if (!f.git) throw new Error(`${f.root} is not a git repository; the Shelf works here`);
  };
  switch (op) {
    case "rollback":
      return f.git ? rollbackGit(f.root, needFiles()) : rollbackLocal(shelfRoot, f.root, needFiles());
    case "shelve":
      return void shelve(shelfRoot, f.root, needFiles(), message, f.git);
    case "snapshot": {
      const s = snapshot(shelfRoot, f.root, message);
      if (s.capped) console.error(`snapshot stopped at ${s.files.length} files`);
      return;
    }
    case "unshelve": {
      const e = findEntry(shelfRoot, f.root, rest[0] ?? "");
      restoreEntry(shelfRoot, f.root, e);
      // A shelved change goes back and leaves the Shelf; a snapshot stays, as a point to return to.
      if (!e.full) dropEntry(shelfRoot, f.root, e.id);
      return;
    }
    case "shelf-drop":
      findEntry(shelfRoot, f.root, rest[0] ?? "");
      return dropEntry(shelfRoot, f.root, rest[0]);
    case "stash":
      needGit();
      return stashOp(f.root, "push", { files: needFiles(), message });
    case "stash-apply":
    case "stash-pop":
    case "stash-drop":
      needGit();
      return stashOp(f.root, op.slice(6) as "apply" | "pop" | "drop", { ref: rest[0] });
  }
}
