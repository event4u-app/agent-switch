import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { CredentialStore } from "../src/credentials.js";

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "asw-migrate-"));
process.env.AGENT_SWITCH_HOME = HOME;
const P = await import("../src/profiles.js");

// A recording store so the re-seed path is exercised deterministically without
// touching a real keychain: read() returns a canned credential for the old
// config dir; clearStale/removeEntry just record their calls.
function fakeStore(): CredentialStore & { removed: string[]; cleared: string[] } {
  const rec = {
    removed: [] as string[],
    cleared: [] as string[],
    read: () => "CRED",
    readDefault: () => "CRED",
    removeEntry(dir: string) {
      rec.removed.push(dir);
      return true;
    },
    clearStale(dir: string) {
      rec.cleared.push(dir);
    },
  };
  return rec;
}

function makeLegacyProfile(name: string): void {
  const cfg = path.join(HOME, name, "config"); // v1 layout: <root>/<name>/config
  fs.mkdirSync(cfg, { recursive: true });
  fs.writeFileSync(path.join(cfg, ".claude.json"), "{}");
}

test("migrateLegacyLayout moves v1 Claude profiles under claude/ and re-seeds the credential", () => {
  makeLegacyProfile("work");
  makeLegacyProfile("privat");
  const store = fakeStore();

  const moved = P.migrateLegacyLayout(store).sort();
  assert.deepEqual(moved, ["privat", "work"]);

  // New provider-scoped layout exists; old flat dirs are gone.
  assert.equal(fs.existsSync(path.join(HOME, "claude", "work", "config")), true);
  assert.equal(fs.existsSync(path.join(HOME, "work")), false);
  // The credential was re-seeded at the NEW path (the macOS hash changes with it).
  assert.equal(
    fs.readFileSync(path.join(HOME, "claude", "work", "config", ".credentials.json"), "utf8"),
    "CRED",
  );
  // The stale old-path keychain entry was cleaned up.
  assert.ok(store.removed.some((d) => d.includes(path.join("work", "config"))));
});

test("migrateLegacyLayout is idempotent and ignores provider dirs / non-profiles", () => {
  // After the first migration there is nothing flat left to move.
  assert.deepEqual(P.migrateLegacyLayout(fakeStore()), []);

  // A stray non-profile dir (no config/) and the provider dirs are untouched.
  fs.mkdirSync(path.join(HOME, "not-a-profile"), { recursive: true });
  assert.deepEqual(P.migrateLegacyLayout(fakeStore()), []);
  assert.equal(fs.existsSync(path.join(HOME, "claude", "work", "config")), true);
});

test("migrateLegacyLayout skips a name that already exists under claude/", () => {
  makeLegacyProfile("work"); // recreate a flat v1 dir clashing with the migrated one
  const moved = P.migrateLegacyLayout(fakeStore());
  assert.deepEqual(moved, []); // clash → left for the user, not clobbered
  assert.equal(fs.existsSync(path.join(HOME, "work", "config")), true); // original untouched
});
