import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// profiles.ts reads AGENT_SWITCH_HOME once at module load to compute ROOT, so set
// it BEFORE importing (node's test runner isolates each file in its own
// process, so this env override is local to this file).
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "asw-profiles-"));
process.env.AGENT_SWITCH_HOME = HOME;
const {
  ROOT,
  configDir,
  browserDir,
  profileExists,
  listProfiles,
  readState,
  writeState,
  accountEmail,
  readJson,
} = await import("../src/profiles.js");

test("ROOT honors AGENT_SWITCH_HOME", () => {
  assert.equal(ROOT, HOME);
});

test("configDir / browserDir compose under the profile dir with path.join", () => {
  assert.equal(configDir("work"), path.join(HOME, "work", "config"));
  assert.equal(browserDir("work"), path.join(HOME, "work", "browser"));
});

test("state round-trips through writeState/readState", () => {
  assert.deepEqual(readState(), { active: null }); // absent file → default
  writeState({ active: "privat" });
  assert.deepEqual(readState(), { active: "privat" });
});

test("listProfiles returns sorted names of dirs that have a config/ subdir", () => {
  for (const name of ["zeta", "alpha"]) fs.mkdirSync(configDir(name), { recursive: true });
  fs.mkdirSync(path.join(HOME, "no-config")); // a dir without config/ is not a profile
  assert.deepEqual(listProfiles(), ["alpha", "zeta"]);
  assert.equal(profileExists("alpha"), true);
  assert.equal(profileExists("nope"), false);
});

test("accountEmail reads oauthAccount.emailAddress, null when absent/unparsable", () => {
  const name = "mailtest";
  fs.mkdirSync(configDir(name), { recursive: true });
  fs.writeFileSync(
    path.join(configDir(name), ".claude.json"),
    JSON.stringify({ oauthAccount: { emailAddress: "a@b.com" } }),
  );
  assert.equal(accountEmail(name), "a@b.com");
  const bare = "nomail";
  fs.mkdirSync(configDir(bare), { recursive: true });
  fs.writeFileSync(path.join(configDir(bare), ".claude.json"), "{}");
  assert.equal(accountEmail(bare), null);
  assert.equal(accountEmail("does-not-exist"), null);
});

test("readJson parses valid JSON and returns null on garbage/missing", () => {
  const f = path.join(HOME, "x.json");
  fs.writeFileSync(f, '{"n":1}');
  assert.deepEqual(readJson(f), { n: 1 });
  fs.writeFileSync(f, "not json");
  assert.equal(readJson(f), null);
  assert.equal(readJson(path.join(HOME, "missing.json")), null);
});
