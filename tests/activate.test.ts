import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

process.env.AGENT_SWITCH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "asw-activate-"));
const { isSourceCheckoutCli } = await import("../src/commands/profiles.js");

test("isSourceCheckoutCli: a package-manager install is not a source checkout", () => {
  for (const cli of [
    "/opt/homebrew/lib/node_modules/@event4u/agent-switch/dist/index.js",
    "/usr/local/lib/node_modules/@event4u/agent-switch/dist/index.js",
    "/home/u/.nvm/versions/node/v22.0.0/lib/node_modules/@event4u/agent-switch/dist/index.js",
    "C:\\Users\\u\\AppData\\Roaming\\npm\\node_modules\\@event4u\\agent-switch\\dist\\index.js",
  ]) {
    assert.equal(isSourceCheckoutCli(cli), false, cli);
  }
});

test("isSourceCheckoutCli: a build inside a repo or worktree is a source checkout", () => {
  for (const cli of [
    "/Users/u/projects/agent-switch/dist/index.js",
    "/Users/u/projects/agent-switch-wt/dev-v3/dist/index.js",
    "C:\\src\\agent-switch\\dist\\index.js",
    // A folder that merely contains the word is not node_modules.
    "/Users/u/node_modules_backup/agent-switch/dist/index.js",
  ]) {
    assert.equal(isSourceCheckoutCli(cli), true, cli);
  }
});
