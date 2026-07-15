import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// tmux.ts reads AGENT_SWITCH_HOME (via profiles.ts) at load for TMUX_STATE.
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "asw-tmux-"));
process.env.AGENT_SWITCH_HOME = HOME;
const T = await import("../src/tmux.js");

test("tmuxSessionName is deterministic and provider-scoped", () => {
  assert.equal(T.tmuxSessionName("claude", "work"), "asw-claude-work");
  assert.equal(T.tmuxSessionName("codex", "work"), "asw-codex-work");
});

test("newSessionArgs attaches-or-creates with the env exported and the cmd after --", () => {
  assert.deepEqual(T.newSessionArgs("asw-claude-work", "CLAUDE_CONFIG_DIR", "/cfg", ["claude", "--resume", "x"]), [
    "new-session",
    "-A",
    "-s",
    "asw-claude-work",
    "-e",
    "CLAUDE_CONFIG_DIR=/cfg",
    "--",
    "claude",
    "--resume",
    "x",
  ]);
});

test("respawnPaneArgs uses -k (kill+replace) and re-exports the target env", () => {
  assert.deepEqual(T.respawnPaneArgs("asw-claude-work", "CLAUDE_CONFIG_DIR", "/cfg2", ["claude", "--resume", "x"]), [
    "respawn-pane",
    "-k",
    "-t",
    "asw-claude-work",
    "-e",
    "CLAUDE_CONFIG_DIR=/cfg2",
    "--",
    "claude",
    "--resume",
    "x",
  ]);
});

test("sendKeysArgs types a literal command + Enter into a target pane", () => {
  assert.deepEqual(T.sendKeysArgs("asw-claude-work", "/compact"), ["send-keys", "-t", "asw-claude-work", "/compact", "Enter"]);
});

test("managed-session registry round-trips and forgets", () => {
  const f = path.join(HOME, "tmux-reg.json");
  assert.deepEqual(T.readTmuxRegistry(f), {});
  T.recordManagedSession("asw-claude-work", { provider: "claude", profile: "work" }, f);
  assert.deepEqual(T.readTmuxRegistry(f), { "asw-claude-work": { provider: "claude", profile: "work" } });
  T.forgetManagedSession("asw-claude-work", f);
  assert.deepEqual(T.readTmuxRegistry(f), {});
});

test("currentManagedSession only matches a recorded name; null for foreign panes", () => {
  const reg = { "asw-claude-work": { provider: "claude" as const, profile: "work" } };
  assert.deepEqual(T.currentManagedSession("asw-claude-work", reg), { provider: "claude", profile: "work" });
  assert.equal(T.currentManagedSession("my-own-tmux", reg), null); // never touch a user's session
  assert.equal(T.currentManagedSession(null, reg), null);
});

test("insideTmux reads $TMUX", () => {
  assert.equal(T.insideTmux({ TMUX: "/tmp/tmux-501/default,123,0" }), true);
  assert.equal(T.insideTmux({}), false);
});
