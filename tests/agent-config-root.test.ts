import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-acroot-"));
process.env.AGENT_SWITCH_HOME = home;
const R = await import("../src/agent-config-root.js");

/** The contract the GUI's Rust side reads too (gui/src-tauri/src/ac.rs tests). */
const CONTRACT = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../tests/fixtures/agent-config-root.json"), "utf8")) as { marker: string; dir: string; env: string };

function seed(name: string): string {
  const dir = path.join(home, "claude", name);
  fs.mkdirSync(path.join(dir, "config"), { recursive: true });
  return dir;
}

function tree(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      out.push(path.relative(dir, p) + (e.isDirectory() ? "/" : `=${fs.readFileSync(p, "utf8")}`));
      if (e.isDirectory()) walk(p);
    }
  };
  walk(dir);
  return out.sort();
}

test("agent-config root: the marker, the dir and the env name are the shared contract", () => {
  assert.equal(R.AGENT_CONFIG_ROOT_MARKER, CONTRACT.marker);
  assert.equal(R.AGENT_CONFIG_ROOT_DIR, CONTRACT.dir);
  assert.equal(R.AGENT_CONFIG_HOME_ENV, CONTRACT.env);
});

test("agent-config root: off by default — global even when <profile>/agent-config exists", () => {
  const dir = seed("off");
  assert.equal(R.agentConfigRootFor("off"), null);
  fs.mkdirSync(path.join(dir, CONTRACT.dir), { recursive: true });
  fs.writeFileSync(path.join(dir, CONTRACT.dir, "settings.json"), "{}");
  assert.equal(R.agentConfigRootFor("off"), null, "a leftover directory is not an opt-in");
  assert.deepEqual(R.sessionAgentConfigEnv("claude", "off"), {}, "nothing set, so an inherited value stays untouched");
});

test("agent-config root: on → the profile's own root, for the session env too", () => {
  const dir = seed("on");
  R.setOwnAgentConfigRoot("on", true);
  const root = path.join(dir, CONTRACT.dir);
  assert.equal(R.agentConfigRootFor("on"), root);
  assert.deepEqual(R.sessionAgentConfigEnv("claude", "on"), { [CONTRACT.env]: root });
  assert.ok(fs.existsSync(path.join(dir, CONTRACT.marker)));
});

test("agent-config root: only Claude profiles carry it", () => {
  fs.mkdirSync(path.join(home, "codex", "on", "config"), { recursive: true });
  fs.writeFileSync(path.join(home, "codex", "on", CONTRACT.marker), "x");
  assert.deepEqual(R.sessionAgentConfigEnv("codex", "on"), {});
});

test("agent-config root: toggling never copies or deletes config or keys", () => {
  const dir = seed("keep");
  const own = path.join(dir, CONTRACT.dir);
  fs.mkdirSync(own, { recursive: true });
  fs.writeFileSync(path.join(own, "settings.json"), '{"a":1}');
  fs.writeFileSync(path.join(own, "secrets.json"), '{"k":"v"}');
  fs.writeFileSync(path.join(dir, "config", ".credentials.json"), "cred");
  const before = tree(dir).filter((l) => !l.startsWith(CONTRACT.marker));
  R.setOwnAgentConfigRoot("keep", true);
  assert.deepEqual(tree(dir).filter((l) => !l.startsWith(CONTRACT.marker)), before);
  R.setOwnAgentConfigRoot("keep", false);
  assert.deepEqual(tree(dir), before, "disabling keeps the profile's dir and its files");
  assert.equal(R.agentConfigRootFor("keep"), null);
  // A profile with no own dir yet: enabling does not create one (agent-config does, on first use).
  const fresh = seed("fresh");
  R.setOwnAgentConfigRoot("fresh", true);
  assert.equal(fs.existsSync(path.join(fresh, CONTRACT.dir)), false);
});

test("agent-config root: the tmux start and in-place handoff carry it; without it the argv is unchanged", async () => {
  const T = await import("../src/tmux.js");
  const env = { [CONTRACT.env]: "/as/claude/work/agent-config" };
  const start = T.newSessionArgs("s", "CLAUDE_CONFIG_DIR", "/c", ["claude"], env);
  assert.deepEqual(start.slice(start.indexOf("--") - 2), ["-e", `${CONTRACT.env}=/as/claude/work/agent-config`, "--", "claude"]);
  assert.deepEqual(T.newSessionArgs("s", "CLAUDE_CONFIG_DIR", "/c", ["claude"]), ["new-session", "-A", "-s", "s", "-e", "CLAUDE_CONFIG_DIR=/c", "--", "claude"]);
  const moved = T.respawnPaneArgs("t", "/w", "CLAUDE_CONFIG_DIR", "/c", ["claude"], env);
  assert.ok(moved.includes(`${CONTRACT.env}=/as/claude/work/agent-config`));
  assert.ok(!T.respawnPaneArgs("t", "/w", "CLAUDE_CONFIG_DIR", "/c", ["claude"]).some((a) => a.startsWith(CONTRACT.env)));
});

test("agent-config root: a chat run in the window starts with it, and only with it when on", async () => {
  const { ClaudeBridge } = await import("../src/bridge/claude-bridge.js");
  const { EventEmitter } = await import("node:events");
  const { PassThrough } = await import("node:stream");
  const envOf = (env?: Record<string, string>) => {
    let seen: NodeJS.ProcessEnv = {};
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
    new ClaudeBridge({ key: "k", bin: "claude", configDir: "/c", cwd: "/w", sessionId: null, mode: "default", out: () => {}, ...(env ? { env } : {}), spawn: (_c, _a, o) => ((seen = o.env ?? {}), child as never) }).start();
    return seen;
  };
  assert.equal(envOf({ [CONTRACT.env]: "/own" })[CONTRACT.env], "/own");
  assert.equal(envOf()[CONTRACT.env], process.env[CONTRACT.env], "off: whatever the process inherited");
  assert.equal(envOf({ [CONTRACT.env]: "/own", CLAUDE_CONFIG_DIR: "/x" }).CLAUDE_CONFIG_DIR, "/c", "the account's config dir always wins");
});
