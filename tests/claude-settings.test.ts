import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { FIRST_BACKUP, isAccountScopedEnv, isAccountScopedKey, masked, mergeSettings, parsePath, profileExtras, setPath, shareable, SNAPSHOT, syncProfileSettings, toggleListEntries, withLock } from "../src/claude-settings.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "as-claude-settings-"));
const write = (f: string, v: unknown) => (fs.mkdirSync(path.dirname(f), { recursive: true }), fs.writeFileSync(f, JSON.stringify(v, null, 2)));
const read = (f: string) => JSON.parse(fs.readFileSync(f, "utf8"));
type O = Parameters<typeof mergeSettings>[0];

/** Run the merge over a sequence of global files, the way repeated syncs do. */
function syncs(profile: O, ...globals: O[]): O {
  let snap: O | null = null;
  let p = profile;
  for (const g of globals) ({ value: p, snapshot: snap } = mergeSettings(g, p, snap));
  return p;
}

test("merge: a global value wins, objects merge per key, what only the profile has stays", () => {
  const global = { model: "opus", env: { CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: "1" }, theme: "dark" };
  const profile = { model: "sonnet", env: { DISABLE_AUTOUPDATER: "1" }, statusLine: { type: "command" } };
  assert.deepEqual(syncs(profile, global), {
    model: "opus",
    env: { DISABLE_AUTOUPDATER: "1", CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: "1" },
    statusLine: { type: "command" },
    theme: "dark",
  });
});

test("merge: lists get the global entries they lack, appended; the profile's order stays", () => {
  const g = { permissions: { allow: ["Bash(git *)", "Read(**)"] } };
  const p = { permissions: { allow: ["Read(**)", "Bash(make *)"], defaultMode: "plan" } };
  assert.deepEqual(syncs(p, g), { permissions: { allow: ["Read(**)", "Bash(make *)", "Bash(git *)"], defaultMode: "plan" } });
});

test("undo: a value the global file stops setting returns to what the profile had, or goes when it had none", () => {
  const p = { model: "sonnet" };
  assert.deepEqual(syncs(p, { model: "opus", theme: "dark" }, {}), { model: "sonnet" });
  // Unless the profile changed it meanwhile: then it is the profile's.
  const first = mergeSettings({ model: "opus" }, {}, null);
  const edited = { ...first.value, model: "haiku" };
  assert.deepEqual(mergeSettings({}, edited, first.snapshot).value, { model: "haiku" });
});

test("undo: a rule the profile already had survives being ticked and unticked globally (review finding 3)", () => {
  const p = { permissions: { allow: ["Bash(make *)"] } };
  const out = syncs(p, { permissions: { allow: ["Bash(make *)", "Bash(git *)"] } }, { permissions: { allow: [] } }, {});
  assert.deepEqual(out, { permissions: { allow: ["Bash(make *)"] } });
});

test("undo: a list the sync created goes when emptied; objects left empty are pruned", () => {
  assert.deepEqual(syncs({ theme: "light" }, { permissions: { allow: ["Bash(git *)"] }, env: { A: "1" } }, {}), { theme: "light" });
});

test("a first-version snapshot (bare global object) migrates without dropping profile rules", () => {
  const legacy = { model: "opus", permissions: { allow: ["Bash(git *)"] } };
  const profile = { model: "opus", permissions: { allow: ["Bash(git *)", "Bash(make *)"] } };
  assert.deepEqual(mergeSettings({}, profile, legacy).value, { permissions: { allow: ["Bash(git *)", "Bash(make *)"] } });
});

test("account-scoped settings never travel, and limits named *_TOKENS still do (review finding 1)", () => {
  for (const k of ["mcpServers", "forceLoginOrgUUID", "forceLoginMethod", "apiKeyHelper", "awsAuthRefresh", "otelHeadersHelper", "enabledMcpjsonServers", "oauthToken"]) assert.ok(isAccountScopedKey(k), k);
  for (const k of ["model", "permissions", "hooks", "env", "statusLine"]) assert.ok(!isAccountScopedKey(k), k);
  for (const k of ["ANTHROPIC_BASE_URL", "ANTHROPIC_CUSTOM_HEADERS", "AWS_PROFILE", "CLAUDE_CODE_USE_BEDROCK", "GH_TOKEN", "ANTHROPIC_API_KEY"]) assert.ok(isAccountScopedEnv(k, "x"), k);
  assert.ok(isAccountScopedEnv("HTTPS_PROXY", "http://me:pw@proxy:8080"));
  assert.ok(!isAccountScopedEnv("HTTPS_PROXY", "http://proxy:8080"));
  for (const k of ["MAX_THINKING_TOKENS", "CLAUDE_CODE_MAX_OUTPUT_TOKENS", "DISABLE_AUTOUPDATER"]) assert.ok(!isAccountScopedEnv(k, "1"), k);
  const { value, withheld } = shareable({ forceLoginOrgUUID: "org", env: { ANTHROPIC_BASE_URL: "u", MAX_THINKING_TOKENS: "8000" }, model: "opus" });
  assert.deepEqual(value, { env: { MAX_THINKING_TOKENS: "8000" }, model: "opus" });
  assert.deepEqual(withheld.sort(), ["env.ANTHROPIC_BASE_URL", "forceLoginOrgUUID"]);
  assert.deepEqual(masked({ apiKeyHelper: "x", env: { GH_TOKEN: "t", A: "1" } }), { apiKeyHelper: "(hidden)", env: { GH_TOKEN: "(hidden)", A: "1" } });
});

test("a profile's own account-scoped values are never touched, even if an older sync recorded them", () => {
  const legacy = { env: { ANTHROPIC_BASE_URL: "u" }, forceLoginOrgUUID: "org" };
  const profile = { env: { ANTHROPIC_BASE_URL: "u", ANTHROPIC_API_KEY: "k" }, forceLoginOrgUUID: "org", mcpServers: { s: {} } };
  assert.deepEqual(mergeSettings({}, profile, legacy).value, profile);
});

test("entries compare regardless of key order; a key named __proto__ stays an ordinary key", () => {
  const hook = { matcher: "Bash", hooks: [{ type: "command", command: "x" }] };
  const reordered = { hooks: [{ command: "x", type: "command" }], matcher: "Bash" };
  assert.deepEqual(syncs({ hooks: { Stop: [reordered] } }, { hooks: { Stop: [hook] } }), { hooks: { Stop: [reordered] } });
  const g = JSON.parse('{"__proto__": {"x": 1}}');
  const out = mergeSettings(g, {}, null).value;
  assert.ok(Object.prototype.hasOwnProperty.call(out, "__proto__"));
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
});

test("profileExtras names the keys and list entries only the profile has, not its account-scoped ones", () => {
  const p = { env: { A: "1", OWN: "1" }, permissions: { allow: ["x", "y", "z"] }, statusLine: {}, mcpServers: {} };
  assert.deepEqual(profileExtras(p, { env: { A: "1" }, permissions: { allow: ["x"] } }), ["env.OWN", "permissions.allow (+2)", "statusLine"]);
});

test("paths: dotted, or a JSON array for keys with dots (review finding 5); empty ones refused", () => {
  assert.deepEqual(parsePath("env.X"), ["env", "X"]);
  assert.deepEqual(parsePath('["enabledPlugins","lsp@acme.tools"]'), ["enabledPlugins", "lsp@acme.tools"]);
  for (const bad of ["", ".", "env.", "[]", '[""]', "[1]"]) assert.throws(() => parsePath(bad), bad);
  assert.deepEqual(setPath({}, ["enabledPlugins", "lsp@acme.tools"], true), { enabledPlugins: { "lsp@acme.tools": true } });
  assert.deepEqual(setPath({ env: { X: "1" }, model: "m" }, ["env", "X"], undefined), { model: "m" });
});

test("toggleListEntries adds several rules once and removes them, dropping the emptied list", () => {
  const on = toggleListEntries({}, ["permissions", "allow"], ["Bash(git *)", "Bash(ls *)", "Bash(git *)"], true);
  assert.deepEqual(on, { permissions: { allow: ["Bash(git *)", "Bash(ls *)"] } });
  assert.deepEqual(toggleListEntries(on, ["permissions", "allow"], ["Bash(git *)", "Bash(ls *)"], false), {});
});

test("withLock: a second holder waits, a stale lock is taken over", () => {
  const d = tmp();
  const f = path.join(d, "settings.json");
  fs.writeFileSync(`${f}.agent-switch.lock`, "");
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(`${f}.agent-switch.lock`, old, old);
  assert.equal(withLock(f, () => 42), 42);
  assert.ok(!fs.existsSync(`${f}.agent-switch.lock`));
});

test("sync: writes the merge, keeps the mode, backs up the profile's file once, then reports in-sync", () => {
  const d = tmp();
  const global = path.join(d, "home", "settings.json");
  const prof = path.join(d, "p1");
  write(global, { env: { CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: "1" }, mcpServers: { s: {} } });
  write(path.join(prof, "settings.json"), { theme: "light" });
  fs.chmodSync(path.join(prof, "settings.json"), 0o644);
  assert.equal(syncProfileSettings(global, prof), "updated");
  assert.deepEqual(read(path.join(prof, "settings.json")), { theme: "light", env: { CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: "1" } });
  assert.deepEqual(read(path.join(prof, FIRST_BACKUP)), { theme: "light" });
  // Windows has no POSIX permission bits to keep.
  if (process.platform !== "win32") assert.equal(fs.statSync(path.join(prof, "settings.json")).mode & 0o777, 0o644);
  assert.equal(read(path.join(prof, SNAPSHOT)).v, 2);
  assert.equal(syncProfileSettings(global, prof), "in-sync");
  write(global, {});
  assert.equal(syncProfileSettings(global, prof), "updated");
  assert.deepEqual(read(path.join(prof, "settings.json")), { theme: "light" });
  assert.deepEqual(read(path.join(prof, FIRST_BACKUP)), { theme: "light" }, "the backup is taken once, before the first change");
});

test("sync: any linked settings.json is left alone — global, another profile's, or a dotfile (review finding 4)", { skip: process.platform === "win32" && "file symlinks need Developer Mode on Windows" }, () => {
  const d = tmp();
  const global = path.join(d, "settings.json");
  write(global, { model: "opus" });
  const other = path.join(d, "other", "settings.json");
  write(other, { theme: "light" });
  for (const [name, target] of [["p-global", global], ["p-other", other]] as const) {
    const dir = path.join(d, name);
    fs.mkdirSync(dir);
    fs.symlinkSync(target, path.join(dir, "settings.json"));
    assert.equal(syncProfileSettings(global, dir), "linked");
    assert.ok(fs.lstatSync(path.join(dir, "settings.json")).isSymbolicLink());
  }
  assert.deepEqual(read(other), { theme: "light" });
});

test("sync: an unreadable profile file and a missing global change nothing", () => {
  const d = tmp();
  const global = path.join(d, "settings.json");
  assert.equal(syncProfileSettings(global, path.join(d, "p0")), "no-global");
  write(global, { model: "opus" });
  const broken = path.join(d, "p2");
  fs.mkdirSync(broken);
  fs.writeFileSync(path.join(broken, "settings.json"), "{ not json");
  assert.equal(syncProfileSettings(global, broken), "invalid");
  assert.equal(fs.readFileSync(path.join(broken, "settings.json"), "utf8"), "{ not json");
  const fresh = path.join(d, "p3");
  assert.equal(syncProfileSettings(global, fresh), "updated");
  assert.deepEqual(read(path.join(fresh, "settings.json")), { model: "opus" });
  assert.ok(!fs.existsSync(path.join(fresh, FIRST_BACKUP)), "nothing to back up for a new file");
});

// ---- the built CLI, against a throw-away HOME ----

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist/index.js");
const gate = { skip: fs.existsSync(CLI) ? false : "run `npm run build` first (dist/index.js missing)" };

function home() {
  const h = tmp();
  const as = path.join(h, "as");
  for (const n of ["work", "side"]) {
    const dir = path.join(as, "claude", n, "config");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, ".claude.json"), "{}");
  }
  const cli = (...args: string[]) => execFileSync("node", [CLI, ...args], { env: { ...process.env, HOME: h, USERPROFILE: h, AGENT_SWITCH_HOME: as }, encoding: "utf8", cwd: h });
  return { h, as, cli, global: path.join(h, ".claude", "settings.json"), prof: (n: string) => path.join(as, "claude", n, "config", "settings.json") };
}

test("cli: set / unset / rule write the global file and every profile; bare words are strings", gate, () => {
  const t = home();
  t.cli("claude-settings", "set", "env.CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY", '"1"');
  t.cli("claude-settings", "set", "model", "opus");
  t.cli("claude-settings", "set", '["enabledPlugins","lsp@acme.tools"]', "true");
  t.cli("claude-settings", "rule", "allow", "Bash(git *)", "Bash(ls *)", "on");
  const expected = { env: { CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: "1" }, model: "opus", enabledPlugins: { "lsp@acme.tools": true }, permissions: { allow: ["Bash(git *)", "Bash(ls *)"] } };
  assert.deepEqual(read(t.global), expected);
  for (const n of ["work", "side"]) assert.deepEqual(read(t.prof(n)), expected);
  t.cli("claude-settings", "rule", "allow", "Bash(git *)", "off");
  t.cli("claude-settings", "unset", "model");
  assert.deepEqual(read(t.prof("work")).permissions, { allow: ["Bash(ls *)"] });
  assert.equal(read(t.prof("work")).model, undefined);
  const s = JSON.parse(t.cli("claude-settings", "status", "--json"));
  assert.deepEqual(s.profiles.map((p: { state: string }) => p.state), ["in-sync", "in-sync"]);
});

test("cli: an invalid global file is never changed; an empty path is a usage error, not a crash", gate, () => {
  const t = home();
  fs.mkdirSync(path.dirname(t.global), { recursive: true });
  fs.writeFileSync(t.global, "{ broken");
  assert.throws(() => t.cli("claude-settings", "set", "model", "opus"), /not valid JSON/);
  assert.equal(fs.readFileSync(t.global, "utf8"), "{ broken");
  assert.throws(() => t.cli("claude-settings", "set", "", "x"), (e: { stderr?: string }) => /usage/.test(String(e.stderr)) && !/at .*\.js/.test(String(e.stderr)));
});

test("cli: status masks account-scoped values", gate, () => {
  const t = home();
  write(t.global, { apiKeyHelper: "/bin/secret", env: { ANTHROPIC_API_KEY: "sk-test", A: "1" } });
  const s = JSON.parse(t.cli("claude-settings", "status", "--json"));
  assert.deepEqual(s.settings, { apiKeyHelper: "(hidden)", env: { ANTHROPIC_API_KEY: "(hidden)", A: "1" } });
});

test("cli: the global file written through a dotfiles link stays a link", { ...gate, skip: gate.skip || (process.platform === "win32" && "file symlinks need Developer Mode on Windows") }, () => {
  const t = home();
  const real = path.join(t.h, "dotfiles", "claude-settings.json");
  write(real, {});
  fs.mkdirSync(path.dirname(t.global), { recursive: true });
  fs.symlinkSync(real, t.global);
  t.cli("claude-settings", "set", "model", "opus");
  assert.ok(fs.lstatSync(t.global).isSymbolicLink());
  assert.deepEqual(read(real), { model: "opus" });
});

test("cli: the shell wrapper's `dir --guard` brings the chosen profile up to date (review finding 7)", gate, () => {
  const t = home();
  write(t.global, { model: "opus" });
  // A folder rule picks the account; the test profiles are not signed in, so balancing would pick none.
  t.cli("map", "--provider", "claude", "work", t.h);
  const out = t.cli("dir", "--provider", "claude", "--guard").trim();
  assert.equal(path.resolve(out), path.resolve(path.dirname(t.prof("work"))));
  assert.deepEqual(read(t.prof("work")), { model: "opus" });
  assert.ok(!fs.existsSync(t.prof("side")), "only the account that starts is touched");
});
