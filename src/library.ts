/**
 * The session library and vault (road-to-agent-switch-v3-central Phase 4).
 *
 * Library: per session key (ADR-007) a name, tags, pinned, archived and
 * auto-kept — in the event store, never in the app's localStorage. Archived is
 * not trash: an archived session stays on disk and can come back.
 *
 * Vault: a verified copy of every kept session (pinned, or auto-kept because it
 * has an open PR) under `<root>/vault/`, so Claude's own cleanup cannot take it:
 * the transcript, the session's folder, and its file history. Copy, hash, never
 * move; a kept session whose transcript is gone shows "transcript gone" and can
 * be restored from the vault. Sessions that are neither pinned nor auto-kept are
 * never copied.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import type { Store } from "./store/store.js";

export interface LibraryEntry {
  key: string;
  name: string | null;
  tags: string[];
  pinned: boolean;
  archived: boolean;
  autoKept: boolean;
  updatedAt: string;
}

const now = () => new Date().toISOString();

function row(r: any): LibraryEntry {
  return { key: r.key, name: r.name ?? null, tags: JSON.parse(r.tags ?? "[]"), pinned: !!r.pinned, archived: !!r.archived, autoKept: !!r.auto_kept, updatedAt: r.updated_at };
}

export function libraryEntry(store: Store, key: string): LibraryEntry | null {
  const r = store.db.get("SELECT * FROM library WHERE key = ?", key);
  return r ? row(r) : null;
}

export function libraryAll(store: Store): LibraryEntry[] {
  return store.db.all("SELECT * FROM library ORDER BY updated_at DESC").map(row);
}

/** Change one entry. Names are trimmed to 120 characters; tags to 20 of 40 characters each. */
export function updateLibrary(store: Store, key: string, change: Partial<Pick<LibraryEntry, "name" | "pinned" | "archived" | "autoKept">> & { addTag?: string; removeTag?: string }): LibraryEntry {
  const cur = libraryEntry(store, key) ?? { key, name: null, tags: [], pinned: false, archived: false, autoKept: false, updatedAt: now() };
  const tags = new Set(cur.tags);
  if (change.addTag) {
    const t = change.addTag.trim().slice(0, 40);
    if (t) tags.add(t);
  }
  if (change.removeTag) tags.delete(change.removeTag);
  const next: LibraryEntry = {
    ...cur,
    name: change.name === undefined ? cur.name : change.name ? change.name.trim().slice(0, 120) : null,
    tags: [...tags].slice(0, 20),
    pinned: change.pinned ?? cur.pinned,
    archived: change.archived ?? cur.archived,
    autoKept: change.autoKept ?? cur.autoKept,
    updatedAt: now(),
  };
  store.db.run(
    `INSERT INTO library (key, name, tags, pinned, archived, auto_kept, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET name = excluded.name, tags = excluded.tags, pinned = excluded.pinned, archived = excluded.archived, auto_kept = excluded.auto_kept, updated_at = excluded.updated_at`,
    key,
    next.name,
    JSON.stringify(next.tags),
    next.pinned ? 1 : 0,
    next.archived ? 1 : 0,
    next.autoKept ? 1 : 0,
    next.updatedAt,
  );
  return next;
}

export const kept = (e: LibraryEntry | null) => !!e && (e.pinned || e.autoKept);

export interface Searchable {
  key: string;
  summary: string | null;
  cwd: string | null;
  branch: string | null;
  prs: number[];
}

/** Case-insensitive search over name, tags, summary, folder, branch and PR number. Pure. */
export function searchSessions<T extends Searchable>(rows: readonly T[], entries: ReadonlyMap<string, LibraryEntry>, query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...rows];
  return rows.filter((r) => {
    const e = entries.get(r.key);
    const hay = [e?.name, ...(e?.tags ?? []), r.summary, r.cwd, r.branch, ...r.prs.map((n) => `#${n}`)].filter(Boolean).join(" ").toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

// ---------- deadline ----------

export const DEFAULT_CLEANUP_DAYS = 30;

/** `cleanupPeriodDays` from a Claude config dir's settings, else Claude's default. */
export function cleanupPeriodDays(configDir: string): number {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(configDir, "settings.json"), "utf8")).cleanupPeriodDays;
    return typeof v === "number" && v > 0 ? v : DEFAULT_CLEANUP_DAYS;
  } catch {
    return DEFAULT_CLEANUP_DAYS;
  }
}

export type KeptState = { state: "kept"; bytes: number } | { state: "at-risk"; daysLeft: number } | { state: "lost" };

/** What the Library's "Kept?" column says. Pure. */
export function keptState(opts: { vaultBytes: number | null; transcriptExists: boolean; mtimeMs: number | null; periodDays: number; nowMs: number }): KeptState {
  if (opts.vaultBytes !== null) return { state: "kept", bytes: opts.vaultBytes };
  if (!opts.transcriptExists || opts.mtimeMs === null) return { state: "lost" };
  const left = opts.mtimeMs + opts.periodDays * 86_400_000 - opts.nowMs;
  return { state: "at-risk", daysLeft: Math.max(0, Math.ceil(left / 86_400_000)) };
}

// ---------- vault ----------

export function vaultDir(root: string, key: string): string {
  const [provider, account, sessionId] = key.split("/");
  if (!provider || !account || !sessionId || [provider, account, sessionId].some((p) => p === ".." || p.includes(path.sep))) throw new Error(`bad session key ${key}`);
  return path.join(root, "vault", provider, account, sessionId);
}

function sha256File(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function copyTree(src: string, dst: string): number {
  let bytes = 0;
  const st = fs.lstatSync(src);
  if (st.isSymbolicLink()) return 0; // never follow a link out of the session's own files
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true, mode: 0o700 });
    for (const n of fs.readdirSync(src)) bytes += copyTree(path.join(src, n), path.join(dst, n));
    return bytes;
  }
  fs.copyFileSync(src, dst);
  fs.chmodSync(dst, 0o600);
  return st.size;
}

export interface SessionFiles {
  /** `<config>/projects/<dir>/<id>.jsonl` */
  transcript: string;
  /** `<config>/projects/<dir>/<id>/` (subagents, tool results), may not exist */
  sessionDir: string;
  /** `<config>/file-history/<id>/`, may not exist */
  fileHistory: string;
}

/**
 * Copy one kept session into the vault: into a fresh folder first, checked by
 * hash, then swapped in — an interrupted copy never replaces a good one. The
 * originals are never touched.
 */
export function vaultCopy(store: Store, root: string, key: string, files: SessionFiles): { bytes: number; sha256: string } {
  const dst = vaultDir(root, key);
  const tmp = `${dst}.tmp-${process.pid}`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true, mode: 0o700 });
  let bytes = copyTree(files.transcript, path.join(tmp, "transcript.jsonl"));
  if (fs.existsSync(files.sessionDir)) bytes += copyTree(files.sessionDir, path.join(tmp, "session"));
  if (fs.existsSync(files.fileHistory)) bytes += copyTree(files.fileHistory, path.join(tmp, "file-history"));
  const sha = sha256File(path.join(tmp, "transcript.jsonl"));
  if (sha !== sha256File(files.transcript)) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw new Error(`the transcript of ${key} changed while it was copied; try again`);
  }
  fs.writeFileSync(path.join(tmp, "manifest.json"), JSON.stringify({ key, sha256: sha, bytes, copiedAt: now(), source: files }, null, 2), { mode: 0o600 });
  fs.rmSync(dst, { recursive: true, force: true });
  fs.renameSync(tmp, dst);
  store.db.run(
    `INSERT INTO vault (key, path, sha256, bytes, copied_at, source_mtime) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET path = excluded.path, sha256 = excluded.sha256, bytes = excluded.bytes, copied_at = excluded.copied_at, source_mtime = excluded.source_mtime`,
    key,
    dst,
    sha,
    bytes,
    now(),
    fs.statSync(files.transcript).mtimeMs,
  );
  return { bytes, sha256: sha };
}

export function vaultEntry(store: Store, key: string): { path: string; sha256: string; bytes: number; copiedAt: string; sourceMtime: number } | null {
  const r = store.db.get<any>("SELECT * FROM vault WHERE key = ?", key);
  return r ? { path: r.path, sha256: r.sha256, bytes: r.bytes, copiedAt: r.copied_at, sourceMtime: r.source_mtime } : null;
}

export function vaultBytes(store: Store): number {
  return Number(store.db.get<{ n: number | null }>("SELECT sum(bytes) AS n FROM vault")?.n ?? 0);
}

/** Put a vaulted session back where Claude looks for it. Refuses to overwrite a transcript that is still there. */
export function vaultRestore(store: Store, key: string, files: SessionFiles): void {
  const v = vaultEntry(store, key);
  if (!v) throw new Error(`${key} is not in the vault`);
  if (fs.existsSync(files.transcript)) throw new Error(`${key} still has its transcript; nothing to restore`);
  const src = path.join(v.path, "transcript.jsonl");
  if (sha256File(src) !== v.sha256) throw new Error(`the vault copy of ${key} does not match its hash; not restoring it`);
  fs.mkdirSync(path.dirname(files.transcript), { recursive: true });
  copyTree(src, files.transcript);
  if (fs.existsSync(path.join(v.path, "session")) && !fs.existsSync(files.sessionDir)) copyTree(path.join(v.path, "session"), files.sessionDir);
  if (fs.existsSync(path.join(v.path, "file-history")) && !fs.existsSync(files.fileHistory)) copyTree(path.join(v.path, "file-history"), files.fileHistory);
}
