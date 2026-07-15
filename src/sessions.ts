/**
 * Session inventory + per-session transfer ("takeover") between Claude profiles.
 *
 * Ground truth (docs + upstream issues, re-verified in scripts/spikes/): a
 * Claude Code session is one file — `<config>/projects/<encoded-cwd>/<id>.jsonl`
 * (plus an optional `<id>/` checkpoint subdir). An ACCOUNT handoff keeps the
 * cwd constant, so the encoded project dir is identical in source and target
 * profile; a takeover is moving that file between two same-named dirs and
 * resuming under the target's CLAUDE_CONFIG_DIR.
 *
 * Iron rules (roadmap: road-to-session-handoff):
 *   - Transcripts are OPAQUE, version-unstable blobs FOR TRANSFER. The only
 *     read in THIS module is `readSessionHeader` — first line, capped,
 *     try/catch. Read-only TELEMETRY (context/token counts) is the one
 *     sanctioned exception and lives ONLY in `src/telemetry.ts` (roadmap:
 *     road-to-agent-switch-session-telemetry, decision gate D0) — guarded,
 *     capped, version-gated, confidence-scored. No other module parses a
 *     transcript body.
 *   - Transfers are copy → verify → delete (the `migrateLegacyLayout`
 *     precedent): no step ever leaves zero copies of a transcript.
 *   - Index files (`sessions-index.json`, `history.jsonl`) are never written —
 *     their format is not ours. Resume-by-id is the supported path.
 *   - Same-id divergence is forbidden by construction: move by default,
 *     `--fork-session` forced on keep-source, collision = hard refusal.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { liveSessionPids } from "./api.js";

/** The documented encoding of a project cwd into its transcript dir name:
 *  every non-alphanumeric character of the absolute path becomes `-`. */
export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, "-");
}

/** Best-effort metadata from a transcript's FIRST line only. The line is
 *  capped (a >64 KiB first line counts as unparseable), the parse is fenced,
 *  and absence degrades to nulls — the format is internal and version-unstable,
 *  so a failed parse must never fail a listing. */
const HEADER_CAP = 64 * 1024;

export interface SessionHeader {
  cwd: string | null;
  summary: string | null;
}

export function readSessionHeader(file: string): SessionHeader {
  const none: SessionHeader = { cwd: null, summary: null };
  let fd: number;
  try {
    fd = fs.openSync(file, "r");
  } catch {
    return none;
  }
  try {
    const buf = Buffer.alloc(HEADER_CAP);
    const n = fs.readSync(fd, buf, 0, HEADER_CAP, 0);
    const chunk = buf.subarray(0, n).toString("utf8");
    const nl = chunk.indexOf("\n");
    if (nl < 0 && n === HEADER_CAP) return none; // first line larger than the cap
    const line = nl >= 0 ? chunk.slice(0, nl) : chunk;
    const parsed = JSON.parse(line);
    return {
      cwd: typeof parsed?.cwd === "string" ? parsed.cwd : null,
      summary: typeof parsed?.summary === "string" ? parsed.summary : null,
    };
  } catch {
    return none;
  } finally {
    fs.closeSync(fd);
  }
}

export interface SessionRow {
  sessionId: string;
  /** Encoded project dir name (the on-disk truth). */
  projectDir: string;
  /** Decoded cwd when the header yields one (best-effort), else null. */
  cwd: string | null;
  summary: string | null;
  mtimeMs: number;
  live: boolean;
  /** Absolute transcript/rollout path — the sanctioned telemetry reader
   *  (src/telemetry.ts) consumes this. Optional so seeded fakes need not set it. */
  file?: string;
}

/** Recent sessions of one profile config dir, newest first, capped at `limit`.
 *  Pure directory scan — works on seeded fakes, shared trees, and win32. */
export function listSessions(configDir: string, limit: number): SessionRow[] {
  const projects = path.join(configDir, "projects");
  let dirs: fs.Dirent[];
  try {
    dirs = fs.readdirSync(projects, { withFileTypes: true });
  } catch {
    return [];
  }
  const rows: SessionRow[] = [];
  for (const d of dirs) {
    // A shared-history tree links `projects/` itself, not its children — but be
    // tolerant of either; only descend into directories (or links to them).
    const dirPath = path.join(projects, d.name);
    let entries: string[];
    try {
      if (!fs.statSync(dirPath).isDirectory()) continue;
      entries = fs.readdirSync(dirPath);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".jsonl")) continue;
      const file = path.join(dirPath, entry);
      let st: fs.Stats;
      try {
        st = fs.statSync(file);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      const header = readSessionHeader(file);
      rows.push({
        sessionId: entry.slice(0, -".jsonl".length),
        projectDir: d.name,
        cwd: header.cwd,
        summary: header.summary,
        mtimeMs: st.mtimeMs,
        live: false,
        file,
      });
    }
  }
  rows.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return rows.slice(0, limit);
}

/** A live pid's working directory, without elevated rights. Verified in
 *  scripts/spikes/g04: `/proc/<pid>/cwd` on linux, `lsof -d cwd` on darwin
 *  (works for same-user processes; claude/codex are node binaries, whose
 *  env/cwd are readable — unlike Apple platform binaries). win32: null
 *  (recent-only inventory there, per roadmap). */
export function pidCwd(pid: number): string | null {
  try {
    if (process.platform === "linux") return fs.readlinkSync(`/proc/${pid}/cwd`);
    if (process.platform === "darwin") {
      const out = execFileSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const m = /^n(.+)$/m.exec(out);
      return m ? m[1] : null;
    }
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * Mark the sessions that belong to a live Claude process: a row is live when
 * its profile has a live pid whose cwd encodes to the row's project dir AND
 * the row is that dir's newest transcript (a running session appends to the
 * newest file; older siblings in the same dir are history).
 */
export function markLive(configDir: string, rows: SessionRow[], cwdOf: (pid: number) => string | null = pidCwd): void {
  const pids = liveSessionPids(configDir);
  if (pids.length === 0) return;
  const liveDirs = new Set<string>();
  for (const pid of pids) {
    const cwd = cwdOf(pid);
    if (cwd) liveDirs.add(encodeProjectDir(cwd));
  }
  if (liveDirs.size === 0) return;
  const newestPerDir = new Map<string, SessionRow>();
  for (const r of rows) {
    const seen = newestPerDir.get(r.projectDir);
    if (!seen || r.mtimeMs > seen.mtimeMs) newestPerDir.set(r.projectDir, r);
  }
  for (const [dir, row] of newestPerDir) {
    if (liveDirs.has(dir)) row.live = true;
  }
}

// ---------- takeover (per-session transfer) ----------------------------------

export interface SessionLocation {
  configDir: string;
  projectDir: string;
  jsonl: string;
  /** The `<id>/` checkpoint subdir next to the transcript, when present. */
  checkpointDir: string | null;
}

/** Where a session id lives inside ONE profile config dir, or null. */
export function locateSession(configDir: string, sessionId: string): SessionLocation | null {
  const projects = path.join(configDir, "projects");
  let dirs: string[];
  try {
    dirs = fs.readdirSync(projects);
  } catch {
    return null;
  }
  for (const d of dirs) {
    const jsonl = path.join(projects, d, `${sessionId}.jsonl`);
    if (!fs.existsSync(jsonl)) continue;
    const sub = path.join(projects, d, sessionId);
    return {
      configDir,
      projectDir: d,
      jsonl,
      checkpointDir: fs.existsSync(sub) && fs.statSync(sub).isDirectory() ? sub : null,
    };
  }
  return null;
}

/** Do two profiles share one history tree (`share on --history`)? Then the
 *  transcript is already visible on the target and file ops would be self-moves
 *  — the takeover degrades to just the resume command. */
export function sharedHistory(srcConfigDir: string, tgtConfigDir: string): boolean {
  try {
    const a = fs.realpathSync(path.join(srcConfigDir, "projects"));
    const b = fs.realpathSync(path.join(tgtConfigDir, "projects"));
    return a === b;
  } catch {
    return false;
  }
}

export interface TransferResult {
  /** Human-readable actions, in execution order. */
  actions: string[];
  /** Target transcript path after the transfer. */
  targetJsonl: string;
}

/**
 * Transfer one session's files from its source location into the target
 * profile. copy → verify → delete-source (unless keepSource): the checkpoint
 * subdir first, the transcript LAST — the transcript is the resume trigger, so
 * any crash mid-way leaves the source fully resumable. Verification is
 * existence + byte size for the transcript (the blob is never read).
 *
 * Throws on a target collision — the caller surfaces it; an existing target
 * file under the same id is a divergence about to happen, never overwritten.
 */
export function transferSession(loc: SessionLocation, tgtConfigDir: string, keepSource: boolean): TransferResult {
  const tgtProj = path.join(tgtConfigDir, "projects", loc.projectDir);
  const tgtJsonl = path.join(tgtProj, path.basename(loc.jsonl));
  if (fs.existsSync(tgtJsonl)) {
    throw new Error(
      `target already has a transcript for this session id (${tgtJsonl}) — refusing to overwrite`,
    );
  }
  const actions: string[] = [];
  fs.mkdirSync(tgtProj, { recursive: true, mode: 0o700 });

  if (loc.checkpointDir) {
    const tgtSub = path.join(tgtProj, path.basename(loc.checkpointDir));
    fs.cpSync(loc.checkpointDir, tgtSub, { recursive: true });
    if (!fs.existsSync(tgtSub)) throw new Error(`checkpoint copy failed verification: ${tgtSub}`);
    actions.push(`copied checkpoint dir ${path.basename(loc.checkpointDir)}/`);
  }

  fs.copyFileSync(loc.jsonl, tgtJsonl);
  const srcSize = fs.statSync(loc.jsonl).size;
  const tgtSize = fs.statSync(tgtJsonl).size;
  if (srcSize !== tgtSize) {
    // Bad copy: remove the partial target; the source is untouched.
    fs.rmSync(tgtJsonl, { force: true });
    throw new Error(`transcript copy failed verification (${srcSize} != ${tgtSize} bytes)`);
  }
  actions.push(`copied transcript (${srcSize} bytes, verified)`);

  if (!keepSource) {
    fs.rmSync(loc.jsonl, { force: true });
    if (loc.checkpointDir) fs.rmSync(loc.checkpointDir, { recursive: true, force: true });
    actions.push("removed source copy (move complete)");
  } else {
    actions.push("kept source (fork mode)");
  }
  return { actions, targetJsonl: tgtJsonl };
}

/** Remove the transfer copy that carries the ORIGINAL session id from the
 *  target after a keep-source fork: the fork got its own id, so the vehicle
 *  file must go, or two profiles would own the same id (the g02 trap). */
export function cleanupForkVehicle(tgtConfigDir: string, projectDir: string, sessionId: string): void {
  const proj = path.join(tgtConfigDir, "projects", projectDir);
  fs.rmSync(path.join(proj, `${sessionId}.jsonl`), { force: true });
  fs.rmSync(path.join(proj, sessionId), { recursive: true, force: true });
}

// ---------- Codex parity (verified in scripts/spikes/g03: outcome (a)) --------
//
// Codex CLI's on-disk layout differs from Claude Code's: a session is one
// date-partitioned rollout file — `<config>/sessions/YYYY/MM/DD/rollout-<ISO8601
// timestamp>-<uuid>.jsonl` (optionally `.jsonl.zst`) — with no encoded-cwd
// project dir and no checkpoint subdir. The session id is the trailing UUID in
// the filename. g03 confirmed outcome (a): a rollout MOVED into another
// authenticated CODEX_HOME (preserving the date-partitioned relative path)
// resumes immediately by id — full takeover parity, no index rebuild.
//
// Same iron rules as Claude: transcripts are opaque (never read here), transfers
// are copy → verify → delete, resume-by-id is the supported path. Codex fork
// (`--keep-source`) has NO verified spike, so codex takeover is MOVE-ONLY — the
// caller refuses keep-source rather than risk same-id divergence.

/** The trailing UUID of a codex rollout filename, or null. Anchored on the
 *  `.jsonl[.zst]` tail so the ISO8601 timestamp earlier in the name (which also
 *  contains hyphen-separated digits) can never be mistaken for the id. */
export function codexSessionId(filename: string): string | null {
  const m = /-([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\.jsonl(?:\.zst)?$/.exec(
    filename,
  );
  return m ? m[1] : null;
}

/** All rollout files under a codex home's `sessions/` tree, as [absPath, dirent-relative].
 *  Bounded recursive scan of the date partitions; tolerant of a missing tree. */
function walkCodexRollouts(sessionsDir: string): string[] {
  const out: string[] = [];
  const stack = [sessionsDir];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (e.isFile() && codexSessionId(e.name) !== null) {
        out.push(full);
      }
    }
  }
  return out;
}

/** Recent codex sessions of one home, newest first, capped at `limit`. The
 *  rollout blob is never read (format is opaque + version-unstable), so `cwd`
 *  and `summary` are null; `projectDir` carries the date-partition path for
 *  display parity with the Claude listing. */
export function listCodexSessions(configDir: string, limit: number): SessionRow[] {
  const sessionsDir = path.join(configDir, "sessions");
  const rows: SessionRow[] = [];
  for (const file of walkCodexRollouts(sessionsDir)) {
    const id = codexSessionId(path.basename(file));
    if (id === null) continue;
    let st: fs.Stats;
    try {
      st = fs.statSync(file);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    rows.push({
      sessionId: id,
      projectDir: path.relative(sessionsDir, path.dirname(file)),
      cwd: null,
      summary: null,
      mtimeMs: st.mtimeMs,
      live: false,
      file,
    });
  }
  rows.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return rows.slice(0, limit);
}

export interface CodexSessionLocation {
  configDir: string;
  /** Absolute path to the rollout file. */
  rollout: string;
  /** Path of the rollout relative to `configDir` (e.g. `sessions/2026/07/14/rollout-….jsonl`),
   *  preserved verbatim on transfer so the target's date partitions match. */
  rel: string;
}

/** Where a codex session id lives inside ONE home, or null. */
export function locateCodexSession(configDir: string, sessionId: string): CodexSessionLocation | null {
  const sessionsDir = path.join(configDir, "sessions");
  for (const file of walkCodexRollouts(sessionsDir)) {
    if (codexSessionId(path.basename(file)) === sessionId) {
      return { configDir, rollout: file, rel: path.relative(configDir, file) };
    }
  }
  return null;
}

/**
 * Move one codex rollout into the target home, preserving its date-partitioned
 * relative path. copy → verify (byte size) → delete-source, mirroring
 * `transferSession`. Move-only: codex fork is unverified, so there is no
 * keep-source path here (the caller refuses it) — a same-id copy in two homes
 * would be exactly the divergence the move avoids. Throws on a target collision.
 */
export function transferCodexSession(loc: CodexSessionLocation, tgtConfigDir: string): TransferResult {
  const tgtRollout = path.join(tgtConfigDir, loc.rel);
  if (fs.existsSync(tgtRollout)) {
    throw new Error(
      `target already has a rollout for this session id (${tgtRollout}) — refusing to overwrite`,
    );
  }
  fs.mkdirSync(path.dirname(tgtRollout), { recursive: true, mode: 0o700 });
  const actions: string[] = [];

  fs.copyFileSync(loc.rollout, tgtRollout);
  const srcSize = fs.statSync(loc.rollout).size;
  const tgtSize = fs.statSync(tgtRollout).size;
  if (srcSize !== tgtSize) {
    fs.rmSync(tgtRollout, { force: true });
    throw new Error(`rollout copy failed verification (${srcSize} != ${tgtSize} bytes)`);
  }
  actions.push(`copied rollout (${srcSize} bytes, verified)`);

  fs.rmSync(loc.rollout, { force: true });
  actions.push("removed source copy (move complete)");
  return { actions, targetJsonl: tgtRollout };
}
