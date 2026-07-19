import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  assertValidSessionId,
  cleanupForkVehicle,
  codexSessionCommand,
  codexSessionId,
  deleteSession,
  encodeProjectDir,
  listSessions,
  listCodexSessions,
  locateSession,
  locateCodexSession,
  markLive,
  readSessionHeader,
  restoreSession,
  sharedHistory,
  sweepTrash,
  transferSession,
  transferCodexSession,
} from "../src/sessions.js";

// A canonical UUID for the delete/restore tests (assertValidSessionId requires one).
const UID = "11111111-1111-4111-8111-111111111111";

// The transfer layer moves OPAQUE transcript blobs between profile config
// dirs. These tests drive the pure file mechanics on seeded fakes — the real
// `claude --resume` semantics are contract-gated (see the roadmap, Phase 2).

const WIN = process.platform === "win32";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "asw-sessions-"));
}

/** Seed a fake transcript; returns its path. First line mimics the metadata
 *  shape ONLY as far as our defensive header read cares (cwd/summary). */
function seedSession(configDir: string, encDir: string, id: string, opts: { cwd?: string; summary?: string; mtimeMs?: number } = {}): string {
  const dir = path.join(configDir, "projects", encDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.jsonl`);
  const header = JSON.stringify({ cwd: opts.cwd, summary: opts.summary, type: "whatever" });
  fs.writeFileSync(file, `${header}\n{"opaque":"blob line 2"}\n`);
  if (opts.mtimeMs !== undefined) fs.utimesSync(file, new Date(opts.mtimeMs), new Date(opts.mtimeMs));
  return file;
}

test("encodeProjectDir replaces every non-alphanumeric with '-' (documented scheme)", () => {
  assert.equal(encodeProjectDir("/Users/me/my project"), "-Users-me-my-project");
  assert.equal(encodeProjectDir("C:\\work\\repo.git"), "C--work-repo-git");
  assert.equal(encodeProjectDir("abc123"), "abc123");
});

test("readSessionHeader reads ONLY the first line, defensively", () => {
  const root = tmp();
  try {
    const f = seedSession(path.join(root, "cfg"), "-proj", "s1", { cwd: "/proj", summary: "hello" });
    assert.deepEqual(readSessionHeader(f), { cwd: "/proj", summary: "hello" });

    // Unparseable first line → nulls, never a throw (format is version-unstable).
    const bad = path.join(root, "bad.jsonl");
    fs.writeFileSync(bad, "not json at all\n{}\n");
    assert.deepEqual(readSessionHeader(bad), { cwd: null, summary: null });

    // Missing file → nulls.
    assert.deepEqual(readSessionHeader(path.join(root, "gone.jsonl")), { cwd: null, summary: null });

    // A first line larger than the 64 KiB cap counts as unparseable — the read
    // must stay capped (opaque-blob rule), not slurp the file.
    const huge = path.join(root, "huge.jsonl");
    fs.writeFileSync(huge, `{"cwd":"${"x".repeat(70 * 1024)}"}\n`);
    assert.deepEqual(readSessionHeader(huge), { cwd: null, summary: null });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("listSessions orders by mtime (newest first) and respects the limit", () => {
  const root = tmp();
  try {
    const cfg = path.join(root, "cfg");
    const t = Date.now();
    seedSession(cfg, "-proj-a", "old", { mtimeMs: t - 60_000 });
    seedSession(cfg, "-proj-a", "new", { mtimeMs: t });
    seedSession(cfg, "-proj-b", "mid", { mtimeMs: t - 30_000 });
    // Non-transcript noise must be ignored.
    fs.writeFileSync(path.join(cfg, "projects", "-proj-a", "sessions-index.json"), "{}");

    const rows = listSessions(cfg, 10);
    assert.deepEqual(rows.map((r) => r.sessionId), ["new", "mid", "old"]);
    assert.equal(rows[0].projectDir, "-proj-a");

    assert.equal(listSessions(cfg, 2).length, 2);
    assert.deepEqual(listSessions(path.join(root, "nope"), 5), []); // no projects dir → empty
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("markLive marks the newest transcript of a live pid's project dir — nothing else", () => {
  const root = tmp();
  try {
    const cfg = path.join(root, "cfg");
    const t = Date.now();
    seedSession(cfg, "-live-proj", "older", { mtimeMs: t - 60_000 });
    seedSession(cfg, "-live-proj", "newest", { mtimeMs: t });
    seedSession(cfg, "-other-proj", "elsewhere", { mtimeMs: t });
    // A live session pid file for THIS test process (alive by definition).
    fs.mkdirSync(path.join(cfg, "sessions"), { recursive: true });
    fs.writeFileSync(path.join(cfg, "sessions", `${process.pid}.json`), "{}");

    const rows = listSessions(cfg, 10);
    markLive(cfg, rows, () => "/live/proj"); // injected cwd → encodes to -live-proj
    const by = Object.fromEntries(rows.map((r) => [r.sessionId, r.live]));
    assert.equal(by.newest, true); // the running session appends to the newest file
    assert.equal(by.older, false); // same dir, but history
    assert.equal(by.elsewhere, false); // different project dir
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("locateSession finds the transcript and its checkpoint subdir", () => {
  const root = tmp();
  try {
    const cfg = path.join(root, "cfg");
    seedSession(cfg, "-proj", "sid", {});
    assert.equal(locateSession(cfg, "missing"), null);
    let loc = locateSession(cfg, "sid");
    assert.ok(loc);
    assert.equal(loc.projectDir, "-proj");
    assert.equal(loc.checkpointDir, null);

    fs.mkdirSync(path.join(cfg, "projects", "-proj", "sid"), { recursive: true });
    loc = locateSession(cfg, "sid");
    assert.ok(loc?.checkpointDir?.endsWith("sid"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("transferSession moves copy→verify→delete; keepSource keeps the original", () => {
  const root = tmp();
  try {
    const src = path.join(root, "src-cfg");
    const tgt = path.join(root, "tgt-cfg");
    seedSession(src, "-proj", "sid", {});
    fs.mkdirSync(path.join(src, "projects", "-proj", "sid"), { recursive: true });
    fs.writeFileSync(path.join(src, "projects", "-proj", "sid", "ckpt"), "x");

    const loc = locateSession(src, "sid")!;
    const res = transferSession(loc, tgt, false);
    assert.equal(fs.existsSync(res.targetJsonl), true); // arrived
    assert.equal(fs.existsSync(loc.jsonl), false); // move: source gone
    assert.equal(fs.existsSync(path.join(tgt, "projects", "-proj", "sid", "ckpt")), true); // checkpoint too
    assert.ok(res.actions.some((a) => a.includes("verified")));

    // keepSource: the source file survives (fork mode).
    const src2 = path.join(root, "src2-cfg");
    const tgt2 = path.join(root, "tgt2-cfg");
    seedSession(src2, "-proj", "sid2", {});
    const loc2 = locateSession(src2, "sid2")!;
    transferSession(loc2, tgt2, true);
    assert.equal(fs.existsSync(loc2.jsonl), true);
    assert.equal(fs.existsSync(path.join(tgt2, "projects", "-proj", "sid2.jsonl")), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("transferSession REFUSES a target collision — an existing same-id transcript is never overwritten", () => {
  const root = tmp();
  try {
    const src = path.join(root, "src-cfg");
    const tgt = path.join(root, "tgt-cfg");
    seedSession(src, "-proj", "sid", {});
    seedSession(tgt, "-proj", "sid", { summary: "the target's own truth" });
    const before = fs.readFileSync(path.join(tgt, "projects", "-proj", "sid.jsonl"), "utf8");

    assert.throws(() => transferSession(locateSession(src, "sid")!, tgt, false), /refusing to overwrite/);
    // Both copies untouched.
    assert.equal(fs.readFileSync(path.join(tgt, "projects", "-proj", "sid.jsonl"), "utf8"), before);
    assert.equal(fs.existsSync(path.join(src, "projects", "-proj", "sid.jsonl")), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("sharedHistory detects one linked projects/ tree (share on --history)", { skip: WIN ? "POSIX symlinks" : false }, () => {
  const root = tmp();
  try {
    const src = path.join(root, "src-cfg");
    const tgt = path.join(root, "tgt-cfg");
    fs.mkdirSync(path.join(src, "projects"), { recursive: true });
    fs.mkdirSync(tgt, { recursive: true });
    fs.symlinkSync(path.join(src, "projects"), path.join(tgt, "projects"), "dir");
    assert.equal(sharedHistory(src, tgt), true);

    const solo = path.join(root, "solo-cfg");
    fs.mkdirSync(path.join(solo, "projects"), { recursive: true });
    assert.equal(sharedHistory(src, solo), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("cleanupForkVehicle removes the original-id transfer copy (the g02 divergence trap)", () => {
  const root = tmp();
  try {
    const tgt = path.join(root, "tgt-cfg");
    seedSession(tgt, "-proj", "sid", {});
    fs.mkdirSync(path.join(tgt, "projects", "-proj", "sid"), { recursive: true });
    cleanupForkVehicle(tgt, "-proj", "sid");
    assert.equal(fs.existsSync(path.join(tgt, "projects", "-proj", "sid.jsonl")), false);
    assert.equal(fs.existsSync(path.join(tgt, "projects", "-proj", "sid")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------- Codex parity (g03 outcome (a)) ----------------------------------
// Codex sessions are date-partitioned rollout files:
//   <config>/sessions/YYYY/MM/DD/rollout-<ISO8601>-<uuid>.jsonl[.zst]
// with no encoded-cwd dir and no checkpoint subdir. These drive the pure file
// mechanics on seeded fakes (the real `codex resume` semantics are verified by
// scripts/spikes/g03, not re-run here).

const UUID_A = "019f621b-287b-7001-820f-bdfcd4cb21cc";
const UUID_B = "019f6218-a8db-7981-81cd-97b3cfcc8d36";

/** Seed a fake codex rollout under a home; returns its path. */
function seedCodexRollout(
  configDir: string,
  datePath: string,
  ts: string,
  uuid: string,
  opts: { zst?: boolean; mtimeMs?: number; bytes?: string } = {},
): string {
  const dir = path.join(configDir, "sessions", datePath);
  fs.mkdirSync(dir, { recursive: true });
  const ext = opts.zst ? ".jsonl.zst" : ".jsonl";
  const file = path.join(dir, `rollout-${ts}-${uuid}${ext}`);
  fs.writeFileSync(file, opts.bytes ?? `{"type":"session_meta","id":"${uuid}"}\n{"opaque":"blob"}\n`);
  if (opts.mtimeMs !== undefined) fs.utimesSync(file, new Date(opts.mtimeMs), new Date(opts.mtimeMs));
  return file;
}

test("codexSessionId extracts the trailing UUID, never the timestamp", () => {
  assert.equal(codexSessionId(`rollout-2026-07-14T21-29-34-${UUID_A}.jsonl`), UUID_A);
  assert.equal(codexSessionId(`rollout-2026-07-14T21-29-34-${UUID_A}.jsonl.zst`), UUID_A);
  assert.equal(codexSessionId("rollout-2026-07-14T21-29-34.jsonl"), null); // no uuid
  assert.equal(codexSessionId("not-a-rollout.txt"), null);
});

test("listCodexSessions walks the date partitions, newest first, capped", () => {
  const root = tmp();
  try {
    const cfg = path.join(root, "codex");
    seedCodexRollout(cfg, "2026/07/12", "2026-07-12T01-00-00", UUID_A, { mtimeMs: 1000 });
    seedCodexRollout(cfg, "2026/07/14", "2026-07-14T02-00-00", UUID_B, { mtimeMs: 3000 });
    const rows = listCodexSessions(cfg, 10);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].sessionId, UUID_B); // newest first
    assert.equal(rows[0].projectDir, path.join("2026", "07", "14"));
    assert.equal(rows[0].cwd, null); // rollout blob never read
    assert.equal(listCodexSessions(cfg, 1).length, 1);
    assert.deepEqual(listCodexSessions(path.join(root, "nope"), 5), []); // no sessions dir → empty
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("locateCodexSession finds the rollout by id and preserves its relative path", () => {
  const root = tmp();
  try {
    const cfg = path.join(root, "codex");
    seedCodexRollout(cfg, "2026/07/14", "2026-07-14T02-00-00", UUID_A);
    assert.equal(locateCodexSession(cfg, "missing"), null);
    const loc = locateCodexSession(cfg, UUID_A);
    assert.ok(loc);
    assert.equal(loc!.rel, path.join("sessions", "2026", "07", "14", `rollout-2026-07-14T02-00-00-${UUID_A}.jsonl`));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("transferCodexSession moves copy→verify→delete, preserving the date partition", () => {
  const root = tmp();
  try {
    const src = path.join(root, "src");
    const tgt = path.join(root, "tgt");
    const srcFile = seedCodexRollout(src, "2026/07/14", "2026-07-14T02-00-00", UUID_A, { bytes: "line1\nline2\n" });
    const loc = locateCodexSession(src, UUID_A)!;
    const res = transferCodexSession(loc, tgt);
    const tgtFile = path.join(tgt, "sessions", "2026", "07", "14", `rollout-2026-07-14T02-00-00-${UUID_A}.jsonl`);
    assert.equal(res.targetJsonl, tgtFile);
    assert.equal(fs.existsSync(tgtFile), true); // copied to same relative path
    assert.equal(fs.existsSync(srcFile), false); // source removed (move)
    assert.equal(fs.readFileSync(tgtFile, "utf8"), "line1\nline2\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("transferCodexSession REFUSES a target collision — never overwrites a same-id rollout", () => {
  const root = tmp();
  try {
    const src = path.join(root, "src");
    const tgt = path.join(root, "tgt");
    seedCodexRollout(src, "2026/07/14", "2026-07-14T02-00-00", UUID_A);
    seedCodexRollout(tgt, "2026/07/14", "2026-07-14T02-00-00", UUID_A); // same rel path already there
    const loc = locateCodexSession(src, UUID_A)!;
    assert.throws(() => transferCodexSession(loc, tgt), /refusing to overwrite/);
    assert.equal(fs.existsSync(loc.rollout), true); // source untouched on refusal
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------- per-session delete / restore / sweep -----------------------------

test("assertValidSessionId accepts a UUID and rejects traversal / non-UUID ids", () => {
  assertValidSessionId(UID); // no throw
  for (const bad of ["../../etc/passwd", "a/b", "..", "", "abc12345", `${UID}/x`]) {
    assert.throws(() => assertValidSessionId(bad), /invalid session id/);
  }
});

test("deleteSession (trash) relocates transcript + checkpoint + manifest; restoreSession round-trips", () => {
  const root = tmp();
  try {
    const cfg = path.join(root, "cfg");
    seedSession(cfg, "-proj", UID, { cwd: "/proj" });
    fs.mkdirSync(path.join(cfg, "projects", "-proj", UID), { recursive: true }); // checkpoint dir
    fs.writeFileSync(path.join(cfg, "projects", "-proj", UID, "ckpt"), "x");

    const loc = locateSession(cfg, UID)!;
    const res = deleteSession(loc, { now: 1000 });
    assert.equal(res.mode, "trash");
    assert.equal(res.trashId, `1000-${UID}`);
    assert.equal(fs.existsSync(loc.jsonl), false); // source gone
    assert.equal(fs.existsSync(loc.checkpointDir!), false);

    const dest = path.join(cfg, ".agent-switch-trash", `1000-${UID}`);
    assert.equal(fs.existsSync(path.join(dest, "projects", "-proj", `${UID}.jsonl`)), true);
    assert.equal(fs.existsSync(path.join(dest, "projects", "-proj", UID, "ckpt")), true);
    assert.equal(fs.existsSync(path.join(dest, "manifest.json")), true);

    const r = restoreSession(cfg, res.trashId!);
    assert.equal(fs.existsSync(r.restored), true);
    assert.equal(fs.existsSync(path.join(cfg, "projects", "-proj", `${UID}.jsonl`)), true);
    assert.equal(fs.existsSync(path.join(cfg, "projects", "-proj", UID, "ckpt")), true);
    assert.equal(fs.existsSync(dest), false); // trash entry consumed
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("deleteSession (purge) removes transcript + checkpoint irreversibly, no trash", () => {
  const root = tmp();
  try {
    const cfg = path.join(root, "cfg");
    seedSession(cfg, "-proj", UID);
    fs.mkdirSync(path.join(cfg, "projects", "-proj", UID), { recursive: true });
    fs.writeFileSync(path.join(cfg, "projects", "-proj", UID, "ckpt"), "x");
    const loc = locateSession(cfg, UID)!;
    const res = deleteSession(loc, { purge: true });
    assert.equal(res.mode, "purge");
    assert.equal(res.residue.length, 0);
    assert.equal(fs.existsSync(loc.jsonl), false);
    assert.equal(fs.existsSync(loc.checkpointDir!), false);
    assert.equal(fs.existsSync(path.join(cfg, ".agent-switch-trash")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("deleteSession succeeds and restores when there is no checkpoint dir", () => {
  const root = tmp();
  try {
    const cfg = path.join(root, "cfg");
    seedSession(cfg, "-proj", UID);
    const loc = locateSession(cfg, UID)!;
    assert.equal(loc.checkpointDir, null);
    const res = deleteSession(loc, { now: 2000 });
    assert.equal(fs.existsSync(loc.jsonl), false);
    restoreSession(cfg, res.trashId!);
    assert.equal(fs.existsSync(path.join(cfg, "projects", "-proj", `${UID}.jsonl`)), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("deleteSession refuses a transcript that resolves OUTSIDE the profile tree", { skip: WIN ? "POSIX symlinks" : false }, () => {
  const root = tmp();
  try {
    const cfg = path.join(root, "cfg");
    const outside = path.join(root, "outside.jsonl");
    fs.writeFileSync(outside, "secret\n");
    const projDir = path.join(cfg, "projects", "-proj");
    fs.mkdirSync(projDir, { recursive: true });
    fs.symlinkSync(outside, path.join(projDir, `${UID}.jsonl`));
    const loc = locateSession(cfg, UID)!;
    assert.throws(() => deleteSession(loc, { purge: true }), /outside/);
    assert.equal(fs.existsSync(outside), true); // never touched
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("sweepTrash drops entries older than the TTL, keeps fresh ones", () => {
  const root = tmp();
  try {
    const cfg = path.join(root, "cfg");
    const trash = path.join(cfg, ".agent-switch-trash");
    fs.mkdirSync(path.join(trash, `1000-${UID}`), { recursive: true }); // old
    fs.mkdirSync(path.join(trash, `9000000000000-${UID}`), { recursive: true }); // fresh
    const now = 1000 + 8 * 24 * 60 * 60 * 1000; // 8 days past the old entry
    assert.equal(sweepTrash(cfg, now), 1);
    assert.equal(fs.existsSync(path.join(trash, `1000-${UID}`)), false);
    assert.equal(fs.existsSync(path.join(trash, `9000000000000-${UID}`)), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("codexSessionCommand maps the native archive/delete/unarchive verbs", () => {
  assert.deepEqual(codexSessionCommand("archive", UID), ["archive", UID]);
  assert.deepEqual(codexSessionCommand("delete", UID), ["delete", UID]);
  assert.deepEqual(codexSessionCommand("unarchive", UID), ["unarchive", UID]);
});
