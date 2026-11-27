/**
 * The Changes window's Shelf, Stash and Rollback (owner, 2026-11-27, after
 * PhpStorm's Commit tool window).
 *
 * The Shelf is Agent Switch's own: copies of files under
 * `<root>/shelf/<folder>/<entry>/`, so it works without git. In a git
 * repository shelving rolls the files back to HEAD afterwards. In a folder
 * without git a full snapshot is the base the Changes list compares against
 * (PhpStorm's Local History); restoring copies a snapshot's files back.
 * Stash is git's own and only runs in a repository.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import type { ChangedFile } from "./changes.js";

const GIT_MS = 10_000;
/** A folder snapshot (no git) skips these and stops at these limits; past them it says so. */
const SKIP_DIRS = new Set(["node_modules", "vendor", "dist", "build", "target", "__pycache__", ".venv", "venv"]);
export const SNAPSHOT_MAX_FILES = 5000;
export const SNAPSHOT_MAX_FILE_BYTES = 1_000_000;
export const SNAPSHOT_MAX_BYTES = 100_000_000;

export interface ShelfFile {
  path: string;
  /** The file did not exist when shelved: unshelving removes it. */
  gone?: boolean;
}

export interface ShelfManifest {
  id: string;
  root: string;
  message: string;
  created: number;
  /** "git": shelved in a repository (the files were rolled back); "local": a copy in a folder without git. */
  kind: "git" | "local";
  /** A full snapshot of a folder without git: the base its Changes list compares against. */
  full?: boolean;
  files: ShelfFile[];
}

export interface StashRow {
  ref: string;
  message: string;
  branch: string | null;
  created: number;
  files: number;
}

function git(cwd: string, args: string[]): { ok: boolean; out: string; err: string } {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout: GIT_MS, maxBuffer: 32 * 1024 * 1024 });
  return { ok: r.status === 0, out: r.stdout ?? "", err: (r.stderr ?? "").trim() || (r.error?.message ?? "") };
}

const folderDir = (shelfRoot: string, root: string) => path.join(shelfRoot, createHash("sha1").update(path.resolve(root)).digest("hex").slice(0, 16));

/** A path inside `root` (no `..`, not absolute), or null. Pure. */
export function inside(root: string, rel: string): string | null {
  const abs = path.resolve(root, rel);
  const r = path.resolve(root);
  return abs.startsWith(r + path.sep) ? abs : null;
}

/** The shelf entries of one folder, newest first. */
export function listShelf(shelfRoot: string, root: string): ShelfManifest[] {
  const dir = folderDir(shelfRoot, root);
  let ids: string[] = [];
  try {
    ids = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: ShelfManifest[] = [];
  for (const id of ids) {
    try {
      out.push(JSON.parse(fs.readFileSync(path.join(dir, id, "manifest.json"), "utf8")) as ShelfManifest);
    } catch {
      /* a half-written entry is skipped */
    }
  }
  return out.sort((a, b) => b.created - a.created);
}

function copyIn(root: string, entryDir: string, files: readonly string[]): ShelfFile[] {
  const out: ShelfFile[] = [];
  for (const rel of files) {
    const abs = inside(root, rel);
    if (!abs) continue;
    if (!fs.existsSync(abs)) {
      out.push({ path: rel, gone: true });
      continue;
    }
    const to = path.join(entryDir, "files", rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(abs, to);
    out.push({ path: rel });
  }
  return out;
}

function writeEntry(shelfRoot: string, root: string, m: Omit<ShelfManifest, "id" | "created" | "files">, files: (dir: string) => ShelfFile[], now = Date.now()): ShelfManifest {
  const id = `${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const dir = path.join(folderDir(shelfRoot, root), id);
  fs.mkdirSync(dir, { recursive: true });
  const manifest: ShelfManifest = { ...m, id, created: now, files: files(dir) };
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}

/** Roll files back to HEAD: tracked ones from HEAD, new ones removed. */
export function rollbackGit(root: string, files: readonly string[]): void {
  for (const rel of files) {
    const abs = inside(root, rel);
    if (!abs) continue;
    if (git(root, ["cat-file", "-e", `HEAD:${rel}`]).ok) {
      const r = git(root, ["checkout", "HEAD", "--", rel]);
      if (!r.ok) throw new Error(`${rel}: ${r.err}`);
    } else {
      git(root, ["rm", "-q", "--cached", "--ignore-unmatch", "--", rel]);
      fs.rmSync(abs, { force: true });
    }
  }
}

/** Keep a copy of `files`; in a repository then roll them back. */
export function shelve(shelfRoot: string, root: string, files: readonly string[], message: string, isGit: boolean): ShelfManifest {
  const m = writeEntry(shelfRoot, root, { root, message, kind: isGit ? "git" : "local" }, (dir) => copyIn(root, dir, files));
  if (isGit) rollbackGit(root, files);
  return m;
}

/** The files of a folder without git, as a snapshot takes them. Says when it stopped at a limit. */
export function walkFolder(root: string): { files: string[]; capped: boolean } {
  const files: string[] = [];
  let bytes = 0;
  let capped = false;
  const walk = (dir: string) => {
    let ents: fs.Dirent[] = [];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents.sort((a, b) => a.name.localeCompare(b.name))) {
      if (capped) return;
      if (e.name.startsWith(".")) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(abs);
      } else if (e.isFile()) {
        const size = fs.statSync(abs).size;
        if (size > SNAPSHOT_MAX_FILE_BYTES) continue;
        if (files.length >= SNAPSHOT_MAX_FILES || bytes + size > SNAPSHOT_MAX_BYTES) {
          capped = true;
          return;
        }
        bytes += size;
        files.push(path.relative(root, abs).split(path.sep).join("/"));
      }
    }
  };
  walk(root);
  return { files, capped };
}

/** A full snapshot of a folder without git: the base its Changes list compares against. */
export function snapshot(shelfRoot: string, root: string, message: string): ShelfManifest & { capped: boolean } {
  const { files, capped } = walkFolder(root);
  const m = writeEntry(shelfRoot, root, { root, message, kind: "local", full: true }, (dir) => copyIn(root, dir, files));
  return { ...m, capped };
}

const lines = (file: string): number => {
  try {
    const s = fs.readFileSync(file, "utf8");
    return s.length === 0 ? 0 : s.split("\n").length - (s.endsWith("\n") ? 1 : 0);
  } catch {
    return 0;
  }
};

const sameBytes = (a: string, b: string): boolean => {
  try {
    const sa = fs.statSync(a);
    const sb = fs.statSync(b);
    return sa.size === sb.size && fs.readFileSync(a).equals(fs.readFileSync(b));
  } catch {
    return false;
  }
};

/** The base of a folder without git: its newest full snapshot. */
export const baseOf = (entries: readonly ShelfManifest[]): ShelfManifest | null => entries.find((e) => e.full) ?? null;

const entryFile = (shelfRoot: string, root: string, e: ShelfManifest, rel: string) => path.join(folderDir(shelfRoot, root), e.id, "files", rel);

/** What changed in a folder without git since its base snapshot; null with no snapshot yet. */
export function localChanges(shelfRoot: string, root: string): ChangedFile[] | null {
  const base = baseOf(listShelf(shelfRoot, root));
  if (!base) return null;
  const before = new Set(base.files.filter((f) => !f.gone).map((f) => f.path));
  const now = walkFolder(root).files;
  const out: ChangedFile[] = [];
  for (const rel of now) {
    const cur = path.join(root, rel);
    if (!before.has(rel)) out.push({ status: "A", path: rel, added: lines(cur), removed: 0 });
    else {
      const old = entryFile(shelfRoot, root, base, rel);
      if (!sameBytes(cur, old)) {
        const d = spawnSync("git", ["diff", "--no-index", "--numstat", "--", old, cur], { encoding: "utf8", timeout: GIT_MS });
        const [a, r] = (d.stdout ?? "").split("\t");
        out.push({ status: "M", path: rel, added: Number(a) || 0, removed: Number(r) || 0 });
      }
    }
  }
  const nowSet = new Set(now);
  for (const rel of before) if (!nowSet.has(rel)) out.push({ status: "D", path: rel, added: 0, removed: lines(entryFile(shelfRoot, root, base, rel)) });
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Put an entry's files back (and remove the ones that did not exist). Without `only`, all of them. */
export function restoreEntry(shelfRoot: string, root: string, e: ShelfManifest, only?: readonly string[]): void {
  const want = only ? new Set(only) : null;
  for (const f of e.files) {
    if (want && !want.has(f.path)) continue;
    const abs = inside(root, f.path);
    if (!abs) continue;
    if (f.gone) fs.rmSync(abs, { force: true });
    else {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.copyFileSync(entryFile(shelfRoot, root, e, f.path), abs);
    }
  }
}

/** Restore files of a folder without git from its base: files the base did not have are removed. */
export function rollbackLocal(shelfRoot: string, root: string, files: readonly string[]): void {
  const base = baseOf(listShelf(shelfRoot, root));
  if (!base) throw new Error("no snapshot yet");
  const had = new Set(base.files.filter((f) => !f.gone).map((f) => f.path));
  restoreEntry(shelfRoot, root, base, files.filter((f) => had.has(f)));
  for (const rel of files) {
    const abs = inside(root, rel);
    if (abs && !had.has(rel)) fs.rmSync(abs, { force: true });
  }
}

export function dropEntry(shelfRoot: string, root: string, id: string): void {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`no shelf entry ${id}`);
  fs.rmSync(path.join(folderDir(shelfRoot, root), id), { recursive: true, force: true });
}

export function findEntry(shelfRoot: string, root: string, id: string): ShelfManifest {
  const e = listShelf(shelfRoot, root).find((x) => x.id === id);
  if (!e) throw new Error(`no shelf entry ${id}`);
  return e;
}

/** `git stash list` lines (`%gd\x1f%s\x1f%ct`) → rows; the branch read from git's "On b:"/"WIP on b:" prefix. Pure. */
export function parseStashList(out: string): Omit<StashRow, "files">[] {
  return out
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [ref, subject = "", ct = "0"] = l.split("\x1f");
      const m = /^(?:WIP on|On) ([^:]+): (.*)$/.exec(subject);
      return { ref, message: m ? m[2] : subject, branch: m ? m[1] : null, created: Number(ct) * 1000 };
    });
}

export function listStashes(root: string): StashRow[] {
  const r = git(root, ["stash", "list", "--format=%gd%x1f%s%x1f%ct"]);
  if (!r.ok) return [];
  return parseStashList(r.out)
    .slice(0, 50)
    .map((s) => {
      const names = git(root, ["stash", "show", "--include-untracked", "--name-only", s.ref]);
      const n = (names.ok ? names : git(root, ["stash", "show", "--name-only", s.ref])).out.split("\n").filter(Boolean).length;
      return { ...s, files: n };
    });
}

const STASH_REF = /^stash@\{\d+\}$/;

export function stashOp(root: string, op: "push" | "apply" | "pop" | "drop", arg: { ref?: string; files?: readonly string[]; message?: string }): void {
  let r;
  if (op === "push") r = git(root, ["stash", "push", "--include-untracked", ...(arg.message ? ["-m", arg.message] : []), "--", ...(arg.files ?? [])]);
  else {
    if (!arg.ref || !STASH_REF.test(arg.ref)) throw new Error(`not a stash: ${arg.ref ?? "(none)"}`);
    r = git(root, ["stash", op, arg.ref]);
  }
  if (!r.ok) throw new Error(r.err || `git stash ${op} failed`);
}
