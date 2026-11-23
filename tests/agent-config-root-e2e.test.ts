import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// Over the BUILT CLI: the session launch path and the toggle command.
const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist/index.js");
const skip = !fs.existsSync(CLI) ? "run `npm run build` first" : process.platform === "win32" ? "fake binaries are POSIX shell scripts" : false;

function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-acroot-e2e-"));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "asw-acroot-bin-"));
  const cfg = path.join(home, "claude", "work", "config");
  fs.mkdirSync(cfg, { recursive: true });
  fs.writeFileSync(path.join(cfg, ".claude.json"), "{}");
  const log = path.join(bin, "claude.log");
  fs.writeFileSync(path.join(bin, "claude"), `#!/bin/sh\n[ "$1" = "--version" ] && { echo "1.0.0"; exit 0; }\necho "\${EVENT4U_CONFIG_HOME-<unset>}" >> "${log}"\nexit 0\n`, { mode: 0o755 });
  const run = (args: string[], env: Record<string, string> = {}) => {
    const e: NodeJS.ProcessEnv = { ...process.env, HOME: home, AGENT_SWITCH_HOME: home, PATH: `${bin}${path.delimiter}${process.env.PATH}`, ...env };
    if (!("EVENT4U_CONFIG_HOME" in env)) delete e.EVENT4U_CONFIG_HOME;
    return spawnSync("node", [CLI, ...args], { env: e, encoding: "utf8" });
  };
  const seen = () => fs.readFileSync(log, "utf8").trim().split("\n").at(-1);
  const done = () => (fs.rmSync(home, { recursive: true, force: true }), fs.rmSync(bin, { recursive: true, force: true }));
  return { home, run, seen, done };
}

test("agent-config root: off → a session gets no EVENT4U_CONFIG_HOME, and an inherited one is left as it is", { skip }, () => {
  const t = setup();
  try {
    fs.mkdirSync(path.join(t.home, "claude", "work", "agent-config"));
    assert.equal(t.run(["run", "work"]).status, 0);
    assert.equal(t.seen(), "<unset>", "a leftover <profile>/agent-config is not an opt-in");
    assert.equal(t.run(["run", "work"], { EVENT4U_CONFIG_HOME: "/elsewhere" }).status, 0);
    assert.equal(t.seen(), "/elsewhere");
  } finally {
    t.done();
  }
});

test("agent-config root: on → a session of that profile gets the profile's root; off again → global", { skip }, () => {
  const t = setup();
  try {
    const own = path.join(t.home, "claude", "work", "agent-config");
    const on = t.run(["agent-config-root", "work", "own", "--json"]);
    assert.equal(on.status, 0, on.stderr);
    assert.deepEqual(JSON.parse(on.stdout), { provider: "claude", name: "work", root: "own", path: own });
    t.run(["run", "work"], { EVENT4U_CONFIG_HOME: "/elsewhere" });
    assert.equal(t.seen(), own, "opted in: the profile's root wins over an inherited one");
    const status = JSON.parse(t.run(["agent-config-root", "work", "--json"]).stdout);
    assert.equal(status.root, "own");
    assert.equal(t.run(["agent-config-root", "work", "global"]).status, 0);
    t.run(["run", "work"]);
    assert.equal(t.seen(), "<unset>");
    assert.deepEqual(JSON.parse(t.run(["agent-config-root", "work", "status", "--json"]).stdout), { provider: "claude", name: "work", root: "global", path: null });
  } finally {
    t.done();
  }
});

test("agent-config root: the command refuses another provider, an unknown profile and an unknown mode", { skip }, () => {
  const t = setup();
  try {
    assert.notEqual(t.run(["agent-config-root", "work", "--provider", "codex"]).status, 0);
    assert.notEqual(t.run(["agent-config-root", "nobody", "own"]).status, 0);
    const bad = t.run(["agent-config-root", "work", "mine"]);
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /own\|global\|status/);
    assert.equal(fs.existsSync(path.join(t.home, "claude", "work", "own-agent-config")), false);
  } finally {
    t.done();
  }
});

test("agent-config root: `list --json` names the root a Claude profile uses (null = the shared one)", { skip }, () => {
  const t = setup();
  try {
    const row = () => (JSON.parse(t.run(["list", "--json"]).stdout) as { name: string; agentConfigRoot?: string | null }[]).find((r) => r.name === "work");
    assert.equal(row()?.agentConfigRoot, null);
    t.run(["agent-config-root", "work", "own"]);
    assert.equal(row()?.agentConfigRoot, path.join(t.home, "claude", "work", "agent-config"));
  } finally {
    t.done();
  }
});
