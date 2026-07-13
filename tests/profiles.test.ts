import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// profiles.ts reads AGENT_SWITCH_HOME once at module load to compute ROOT, so set
// it BEFORE importing (node's test runner isolates each file in its own process).
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "asw-profiles-"));
process.env.AGENT_SWITCH_HOME = HOME;
const P = await import("../src/profiles.js");

test("ROOT honors AGENT_SWITCH_HOME", () => {
  assert.equal(P.ROOT, HOME);
});

test("paths are provider-scoped: <root>/<provider>/<name>/config", () => {
  assert.equal(P.profileDir("codex", "work"), path.join(HOME, "codex", "work"));
  assert.equal(P.configDir("gemini", "work"), path.join(HOME, "gemini", "work", "config"));
  assert.equal(P.browserDir("claude", "work"), path.join(HOME, "claude", "work", "browser"));
});

test("listProfiles is per-provider; listAllProfiles spans providers", () => {
  for (const [prov, name] of [["claude", "a"], ["claude", "b"], ["codex", "c"], ["gemini", "d"]] as const) {
    fs.mkdirSync(P.configDir(prov, name), { recursive: true });
  }
  assert.deepEqual(P.listProfiles("claude"), ["a", "b"]);
  assert.deepEqual(P.listProfiles("codex"), ["c"]);
  assert.deepEqual(
    P.listAllProfiles().map((r) => `${r.provider}/${r.name}`).sort(),
    ["claude/a", "claude/b", "codex/c", "gemini/d"],
  );
  assert.equal(P.profileExists("gemini", "d"), true);
  assert.equal(P.profileExists("gemini", "x"), false);
});

test("state migrates v1 { active: string } to the per-provider map", () => {
  // v1 shape: a single active name meant the Claude profile.
  fs.writeFileSync(P.STATE_FILE, JSON.stringify({ active: "legacy" }));
  assert.deepEqual(P.readState().active, { claude: "legacy", codex: null, gemini: null });
});

test("activeFor / setActive are per-provider", () => {
  P.writeState({ active: { claude: null, codex: null, gemini: null } }); // clean baseline (shared STATE_FILE)
  P.setActive("codex", "work");
  P.setActive("gemini", "priv");
  assert.equal(P.activeFor("codex"), "work");
  assert.equal(P.activeFor("gemini"), "priv");
  assert.equal(P.activeFor("claude"), null);
  P.setActive("codex", null);
  assert.equal(P.activeFor("codex"), null);
});

test("identity reads the provider's account (claude → .claude.json email)", () => {
  fs.mkdirSync(P.configDir("claude", "id"), { recursive: true });
  fs.writeFileSync(
    path.join(P.configDir("claude", "id"), ".claude.json"),
    JSON.stringify({ oauthAccount: { emailAddress: "x@y.com" } }),
  );
  assert.equal(P.identity("claude", "id"), "x@y.com");
  fs.mkdirSync(P.configDir("claude", "noid"), { recursive: true });
  assert.equal(P.identity("claude", "noid"), null);
});
