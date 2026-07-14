import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  cleanupForkVehicle,
  encodeProjectDir,
  listSessions,
  locateSession,
  markLive,
  readSessionHeader,
  sharedHistory,
  transferSession,
} from "../src/sessions.js";

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
