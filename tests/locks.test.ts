import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { withProperLock } from "../src/locks.js";

// The lock is a proper-lockfile-compatible DIRECTORY at "<target>.lock": mkdir
// atomicity is the mutex, staleness is mtime > 10s. These tests exercise the
// acquire/release, stale-takeover, and contention paths without a real Claude
// Code process.

function tmpTarget(): { dir: string; target: string; lockDir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asw-lock-"));
  const target = path.join(dir, "home");
  return { dir, target, lockDir: `${target}.lock` };
}

test("withProperLock holds the lock during fn and releases it after", async () => {
  const { dir, target, lockDir } = tmpTarget();
  try {
    let heldDuringFn = false;
    const result = await withProperLock(target, () => {
      heldDuringFn = fs.existsSync(lockDir);
      return 42;
    });
    assert.equal(result, 42);
    assert.equal(heldDuringFn, true); // lock existed while fn ran
    assert.equal(fs.existsSync(lockDir), false); // released after
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("withProperLock releases the lock even when fn throws", async () => {
  const { dir, target, lockDir } = tmpTarget();
  try {
    await assert.rejects(
      withProperLock(target, () => {
        throw new Error("boom");
      }),
      /boom/,
    );
    assert.equal(fs.existsSync(lockDir), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("withProperLock takes over a stale lock (mtime older than 10s)", async () => {
  const { dir, target, lockDir } = tmpTarget();
  try {
    fs.mkdirSync(lockDir); // pre-existing lock...
    const old = new Date(Date.now() - 20_000);
    fs.utimesSync(lockDir, old, old); // ...but stale
    let ran = false;
    await withProperLock(target, () => {
      ran = true;
    });
    assert.equal(ran, true); // took over and ran
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("withProperLock times out against a fresh, held lock", async () => {
  const { dir, target, lockDir } = tmpTarget();
  try {
    fs.mkdirSync(lockDir); // held now (fresh mtime)
    await assert.rejects(
      withProperLock(target, () => undefined, 300), // short timeout
      /timed out waiting for Claude Code's lock/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
