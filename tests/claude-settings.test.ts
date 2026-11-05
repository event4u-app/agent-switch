import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { mergeSettings, profileExtras, setPath, shareable, SNAPSHOT, syncProfileSettings, toggleListEntry } from "../src/claude-settings.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "as-claude-settings-"));
const write = (f: string, v: unknown) => (fs.mkdirSync(path.dirname(f), { recursive: true }), fs.writeFileSync(f, JSON.stringify(v, null, 2)));
const read = (f: string) => JSON.parse(fs.readFileSync(f, "utf8"));

test("merge: a global value wins, objects merge per key, what only the profile has stays", () => {
  const global = { model: "opus", env: { CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: "1" }, theme: "dark" };
  const profile = { model: "sonnet", env: { DISABLE_AUTOUPDATER: "1" }, statusLine: { type: "command" } };
  assert.deepEqual(mergeSettings(global, profile, null), {
    model: "opus",
    env: { DISABLE_AUTOUPDATER: "1", CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: "1" },
    statusLine: { type: "command" },
    theme: "dark",
  });
});

test("merge: lists are united, global entries first, no duplicates", () => {
  const g = { permissions: { allow: ["Bash(git *)", "Read(**)"] } };
  const p = { permissions: { allow: ["Read(**)", "Bash(make *)"], defaultMode: "plan" } };
  assert.deepEqual(mergeSettings(g, p, null), { permissions: { allow: ["Bash(git *)", "Read(**)", "Bash(make *)"], defaultMode: "plan" } });
});

test("merge: what the global file dropped leaves the profile, unless the profile changed it", () => {
  const prev = { model: "opus", env: { A: "1", B: "1" }, permissions: { allow: ["Bash(git *)", "Bash(npm *)"] } };
  const global = { env: { A: "1" }, permissions: { allow: ["Bash(git *)"] } };
  const profile = { model: "opus", env: { A: "1", B: "2" }, permissions: { allow: ["Bash(git *)", "Bash(npm *)", "Bash(make *)"] } };
  assert.deepEqual(mergeSettings(global, profile, prev), {
    env: { A: "1", B: "2" },
    permissions: { allow: ["Bash(git *)", "Bash(make *)"] },
  });
  // Without a snapshot nothing is dropped: a first sync only adds.
  assert.equal(mergeSettings(global, profile, null).model, "opus");
});

test("shareable: MCP servers and token-, secret- and key-shaped names stay out, also inside env", () => {
  const { value, withheld } = shareable({ mcpServers: {}, apiKeyHelper: "x", env: { ANTHROPIC_API_KEY: "k", GH_TOKEN: "t", DISABLE_AUTOUPDATER: "1" }, model: "opus" });
  assert.deepEqual(value, { env: { DISABLE_AUTOUPDATER: "1" }, model: "opus" });
  assert.deepEqual(withheld.sort(), ["apiKeyHelper", "env.ANTHROPIC_API_KEY", "env.GH_TOKEN", "mcpServers"]);
});

test("profileExtras names the keys and list entries only the profile has", () => {
  const merged = { env: { A: "1", OWN: "1" }, permissions: { allow: ["x", "y", "z"] }, statusLine: {} };
  assert.deepEqual(profileExtras(merged, { env: { A: "1" }, permissions: { allow: ["x"] } }), ["env.OWN", "permissions.allow (+2)", "statusLine"]);
});

test("setPath and toggleListEntry edit nested values and drop what became empty", () => {
  assert.deepEqual(setPath({}, "env.X", "1"), { env: { X: "1" } });
  assert.deepEqual(setPath({ env: { X: "1" }, model: "m" }, "env.X", undefined), { model: "m" });
  const on = toggleListEntry({}, "permissions.allow", "Bash(git *)", true);
  assert.deepEqual(on, { permissions: { allow: ["Bash(git *)"] } });
  assert.deepEqual(toggleListEntry(toggleListEntry(on, "permissions.allow", "Bash(git *)", true), "permissions.allow", "Bash(ls *)", true), { permissions: { allow: ["Bash(git *)", "Bash(ls *)"] } });
  assert.deepEqual(toggleListEntry(on, "permissions.allow", "Bash(git *)", false), {});
});

test("syncProfileSettings: writes the merge, keeps the file's mode, records the snapshot, then reports in-sync", () => {
  const d = tmp();
  const global = path.join(d, "home", "settings.json");
  const prof = path.join(d, "p1");
  write(global, { env: { CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: "1" }, mcpServers: { s: {} } });
  write(path.join(prof, "settings.json"), { theme: "light" });
  fs.chmodSync(path.join(prof, "settings.json"), 0o644);
  assert.equal(syncProfileSettings(global, prof), "updated");
  assert.deepEqual(read(path.join(prof, "settings.json")), { theme: "light", env: { CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: "1" } });
  // Windows has no POSIX permission bits to keep.
  if (process.platform !== "win32") assert.equal(fs.statSync(path.join(prof, "settings.json")).mode & 0o777, 0o644);
  assert.deepEqual(read(path.join(prof, SNAPSHOT)), { env: { CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: "1" } });
  assert.equal(syncProfileSettings(global, prof), "in-sync");
  // Removing the value globally removes it from the profile on the next sync.
  write(global, {});
  assert.equal(syncProfileSettings(global, prof), "updated");
  assert.deepEqual(read(path.join(prof, "settings.json")), { theme: "light" });
});

test("syncProfileSettings: a profile linked to the global file, a broken profile file and a missing global are left alone", () => {
  const d = tmp();
  const global = path.join(d, "settings.json");
  assert.equal(syncProfileSettings(global, path.join(d, "p0")), "no-global");
  write(global, { model: "opus" });
  const linked = path.join(d, "p1");
  fs.mkdirSync(linked);
  fs.symlinkSync(global, path.join(linked, "settings.json"));
  assert.equal(syncProfileSettings(global, linked), "linked");
  const broken = path.join(d, "p2");
  fs.mkdirSync(broken);
  fs.writeFileSync(path.join(broken, "settings.json"), "{ not json");
  assert.equal(syncProfileSettings(global, broken), "invalid");
  assert.equal(fs.readFileSync(path.join(broken, "settings.json"), "utf8"), "{ not json");
  const fresh = path.join(d, "p3");
  assert.equal(syncProfileSettings(global, fresh), "updated");
  assert.deepEqual(read(path.join(fresh, "settings.json")), { model: "opus" });
});
