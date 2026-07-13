import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { CredentialStore } from "../src/credentials.js";

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "asw-migrate-"));
process.env.AGENT_SWITCH_HOME = HOME;
const P = await import("../src/profiles.js");

// A recording store: read() returns the FRESH (keychain-first) credential;
// clearStale/removeEntry record their calls. No real keychain touched.
function fakeStore(fresh = "FRESH"): CredentialStore & { removed: string[] } {
  const rec = {
    removed: [] as string[],
    read: () => fresh,
    readDefault: () => fresh,
    removeEntry(dir: string) {
      rec.removed.push(dir);
      return true;
    },
    clearStale() {},
  };
  return rec;
}

/** Reset ROOT to a clean slate so each test is independent of the one-time marker. */
function reset(): void {
  for (const e of fs.existsSync(HOME) ? fs.readdirSync(HOME) : []) {
    fs.rmSync(path.join(HOME, e), { recursive: true, force: true });
  }
}

function makeLegacyProfile(name: string, credFile?: string): void {
  const cfg = path.join(HOME, name, "config"); // v1 layout: <root>/<name>/config
  fs.mkdirSync(cfg, { recursive: true });
  fs.writeFileSync(path.join(cfg, ".claude.json"), "{}");
  if (credFile !== undefined) fs.writeFileSync(path.join(cfg, ".credentials.json"), credFile);
}

test("migrates v1 Claude profiles under claude/ and re-seeds the credential", () => {
  reset();
  makeLegacyProfile("work");
  makeLegacyProfile("privat");
  const moved = P.migrateLegacyLayout(fakeStore()).sort();
  assert.deepEqual(moved, ["privat", "work"]);
  assert.equal(fs.existsSync(path.join(HOME, "claude", "work", "config")), true);
  assert.equal(fs.existsSync(path.join(HOME, "work")), false);
  assert.equal(fs.readFileSync(path.join(HOME, "claude", "work", "config", ".credentials.json"), "utf8"), "FRESH");
});

test("F2: the fresh keychain credential OVERWRITES a stale .credentials.json relic", () => {
  reset();
  // v1 profile carried an OLD file credential; cpSync copies it to the new dir.
  makeLegacyProfile("work", "STALE-DEAD-TOKEN");
  P.migrateLegacyLayout(fakeStore("FRESH-FROM-KEYCHAIN"));
  // The migrated profile must sit on the FRESH credential, not the stale relic —
  // otherwise it would be logged out once the old keychain entry is deleted.
  assert.equal(
    fs.readFileSync(path.join(HOME, "claude", "work", "config", ".credentials.json"), "utf8"),
    "FRESH-FROM-KEYCHAIN",
  );
});

test("is idempotent (marker short-circuits) and ignores non-profile dirs", () => {
  reset();
  makeLegacyProfile("work");
  assert.deepEqual(P.migrateLegacyLayout(fakeStore()), ["work"]);
  // Second run: nothing left + marker present → no-op.
  assert.deepEqual(P.migrateLegacyLayout(fakeStore()), []);
  assert.equal(fs.existsSync(path.join(HOME, ".layout-v2")), true);
});

test("skips a name that already exists under claude/ and leaves the original", () => {
  reset();
  fs.mkdirSync(path.join(HOME, "claude", "work", "config"), { recursive: true }); // occupied
  makeLegacyProfile("work"); // flat v1 dir clashing with it
  const moved = P.migrateLegacyLayout(fakeStore());
  assert.deepEqual(moved, []); // clash → not clobbered
  assert.equal(fs.existsSync(path.join(HOME, "work", "config")), true); // original untouched
  assert.equal(fs.existsSync(path.join(HOME, ".layout-v2")), false); // NOT marked done — a legacy dir remains
});
