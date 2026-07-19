import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// mappings.ts imports profiles.ts (ROOT), which reads AGENT_SWITCH_HOME at load.
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "asw-map-"));
process.env.AGENT_SWITCH_HOME = HOME;
const M = await import("../src/mappings.js");

test("canonicalizeWin32 uppercases the drive letter on win32, no-op elsewhere", () => {
  assert.equal(M.canonicalizeWin32("c:\\Users\\x\\proj", "win32"), "C:\\Users\\x\\proj");
  assert.equal(M.canonicalizeWin32("c:\\Users\\lower\\Mixed", "win32"), "C:\\Users\\lower\\Mixed");
  assert.equal(M.canonicalizeWin32("/home/u/proj", "linux"), "/home/u/proj");
  assert.equal(M.canonicalizeWin32("c:/lower", "darwin"), "c:/lower");
});

test("normalizePath returns an absolute, idempotent path", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asw-np-"));
  try {
    const norm = M.normalizePath(dir);
    assert.equal(path.isAbsolute(norm), true);
    assert.equal(M.normalizePath(norm), norm);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("setMapping / resolveMapping resolve the nearest ancestor per provider", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "asw-repo-"));
  const sub = path.join(repo, "packages", "app");
  fs.mkdirSync(sub, { recursive: true });
  try {
    M.setMapping(repo, "claude", "work");
    M.setMapping(repo, "codex", "oai");
    // A descendant resolves to the ancestor mapping, per provider.
    assert.equal(M.resolveMapping(sub, "claude")?.name, "work");
    assert.equal(M.resolveMapping(sub, "codex")?.name, "oai");
    // antigravity has no mapping here.
    assert.equal(M.resolveMapping(sub, "antigravity"), null);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("pruneMappings drops only the (provider, name) it is given", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asw-prune-"));
  try {
    M.setMapping(dir, "claude", "gone");
    M.setMapping(dir, "codex", "stays");
    const removed = M.pruneMappings("claude", "gone");
    assert.equal(removed.length, 1);
    assert.equal(M.resolveMapping(dir, "claude"), null);
    assert.equal(M.resolveMapping(dir, "codex")?.name, "stays"); // untouched
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("loadMappings migrates a v1 bare-string value to { claude: <name> }", () => {
  // Write a v1-shaped mappings file directly and confirm it reads as provider-keyed.
  fs.writeFileSync(
    path.join(HOME, "mappings.json"),
    JSON.stringify({ schema: 1, mappings: { "/some/dir": "legacy" } }),
  );
  const loaded = M.loadMappings();
  assert.deepEqual(loaded["/some/dir"], { claude: "legacy" });
});
