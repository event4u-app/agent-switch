import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { credentialStore } from "../src/credentials.js";

// The credential store abstracts WHERE Claude Code keeps a profile's credential
// per OS. These tests pin the file-backend behavior (linux/win32) and the
// read-only contract; the darwin keychain derivation is pinned separately in
// keychain.test.ts (it needs the `security` binary + a real login to exercise).

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "asw-cred-"));
}

test("credentialStore selects a file-only store off darwin (no OS entry)", () => {
  for (const platform of ["linux", "win32"] as const) {
    const store = credentialStore(platform);
    // Nothing OS-managed to remove or shadow — removeEntry is false, clearStale a no-op.
    assert.equal(store.removeEntry("/anything/config"), false);
    assert.doesNotThrow(() => store.clearStale("/anything/config"));
  }
});

test("file store reads .credentials.json from a config dir", () => {
  const dir = tmpDir();
  try {
    const cred = '{"claudeAiOauth":{"accessToken":"tok"}}';
    fs.writeFileSync(path.join(dir, ".credentials.json"), cred);
    const store = credentialStore("linux");
    assert.equal(store.read(dir), cred);
    assert.equal(store.readDefault(dir), cred);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("file store returns null when no credential file exists", () => {
  const dir = tmpDir();
  try {
    assert.equal(credentialStore("win32").read(dir), null);
    assert.equal(credentialStore("win32").readDefault(dir), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
