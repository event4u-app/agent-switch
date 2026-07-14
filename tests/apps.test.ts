import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// apps.ts → profiles.ts reads AGENT_SWITCH_HOME at load to compute ROOT, so set
// it BEFORE importing. Types are import-type (erased, no runtime load).
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "asw-apps-"));
process.env.AGENT_SWITCH_HOME = HOME;
const A = await import("../src/apps.js");
import type { AppDescriptor } from "../src/apps.js";

const envApp: AppDescriptor = {
  id: "codex-ide",
  displayName: "Codex (IDE)",
  bundleId: "com.example.codex",
  provider: "codex",
  strategy: "env",
  envVar: "CODEX_HOME",
};
const uddApp: AppDescriptor = {
  id: "claude-desktop",
  displayName: "Claude Desktop",
  bundleId: "com.anthropic.claudefordesktop",
  provider: "claude",
  strategy: "user-data-dir",
};

test("buildLaunch env strategy exports the provider env var at the profile config dir", () => {
  const spec = A.buildLaunch(envApp, "work");
  assert.equal(spec.program, "open");
  assert.deepEqual(spec.args, [
    "-n",
    "--env",
    `CODEX_HOME=${path.join(HOME, "codex", "work", "config")}`,
    "-b",
    "com.example.codex",
  ]);
});

test("buildLaunch user-data-dir strategy passes --user-data-dir to the app", () => {
  const spec = A.buildLaunch(uddApp, "privat");
  assert.deepEqual(spec.args, [
    "-n",
    "-b",
    "com.anthropic.claudefordesktop",
    "--args",
    `--user-data-dir=${path.join(HOME, "claude", "privat", "gui", "claude-desktop")}`,
  ]);
});

test("buildLaunch throws on an env-strategy app with no envVar", () => {
  assert.throws(() => A.buildLaunch({ ...envApp, envVar: undefined }, "work"), /envVar/);
});

test("buildLaunch combined strategy sets BOTH --env and --user-data-dir", () => {
  const both: AppDescriptor = { ...envApp, id: "codex-desktop", bundleId: "com.openai.codex", strategy: "env+user-data-dir" };
  const spec = A.buildLaunch(both, "work");
  assert.deepEqual(spec.args, [
    "-n",
    "--env",
    `CODEX_HOME=${path.join(HOME, "codex", "work", "config")}`,
    "-b",
    "com.openai.codex",
    "--args",
    `--user-data-dir=${path.join(HOME, "codex", "work", "gui", "codex-desktop")}`,
  ]);
});

test("findApp resolves by id; unknown ids are null", () => {
  assert.equal(A.findApp("nope"), null);
  assert.equal(A.findApp("codex-ide", [envApp])?.id, "codex-ide");
});

test("codex-ide is registered (env strategy → CODEX_HOME, targets VS Code)", () => {
  const app = A.findApp("codex-ide");
  assert.ok(app, "codex-ide should be registered");
  assert.equal(app!.strategy, "env");
  assert.equal(app!.envVar, "CODEX_HOME");
  assert.equal(app!.provider, "codex");
  const spec = A.buildLaunch(app!, "work");
  assert.deepEqual(spec.args, ["-n", "--env", `CODEX_HOME=${path.join(HOME, "codex", "work", "config")}`, "-b", "com.microsoft.VSCode"]);
});

test("claude-desktop is registered (user-data-dir) and builds an isolated launch", () => {
  const app = A.findApp("claude-desktop");
  assert.ok(app, "claude-desktop should be registered");
  assert.equal(app!.strategy, "user-data-dir");
  assert.equal(app!.provider, "claude");
  const spec = A.buildLaunch(app!, "work");
  // uses the profile's OWN gui data dir — never the default Claude install dir
  const dataDir = path.join(HOME, "claude", "work", "gui", "claude-desktop");
  assert.deepEqual(spec.args, ["-n", "-b", "com.anthropic.claudefordesktop", "--args", `--user-data-dir=${dataDir}`]);
  assert.ok(!spec.args.some((a) => a.includes("Application Support/Claude")), "must not target the default install dir");
});
