import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { canonicalizeWin32, normalizePath } from "../src/mappings.js";

// Windows path handling for directory mappings: NTFS is case-insensitive and
// drive letters appear in both cases, so a mapping must resolve regardless of
// the drive-letter case the user typed.

test("canonicalizeWin32 uppercases the drive letter on win32", () => {
  assert.equal(canonicalizeWin32("c:\\Users\\x\\proj", "win32"), "C:\\Users\\x\\proj");
  assert.equal(canonicalizeWin32("d:\\repo", "win32"), "D:\\repo");
  assert.equal(canonicalizeWin32("C:\\already", "win32"), "C:\\already"); // idempotent
});

test("canonicalizeWin32 only touches the drive letter, not the rest of the path", () => {
  // A lowercase segment after the drive must survive untouched.
  assert.equal(canonicalizeWin32("c:\\Users\\lower\\Mixed", "win32"), "C:\\Users\\lower\\Mixed");
});

test("canonicalizeWin32 is a no-op off win32", () => {
  assert.equal(canonicalizeWin32("/home/u/proj", "linux"), "/home/u/proj");
  assert.equal(canonicalizeWin32("/Users/x/proj", "darwin"), "/Users/x/proj");
  assert.equal(canonicalizeWin32("c:/lower", "linux"), "c:/lower");
});

test("normalizePath returns an absolute, resolved path", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asw-map-"));
  try {
    const norm = normalizePath(dir);
    assert.equal(path.isAbsolute(norm), true);
    // realpath of the same dir is stable / idempotent under normalizePath.
    assert.equal(normalizePath(norm), norm);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
