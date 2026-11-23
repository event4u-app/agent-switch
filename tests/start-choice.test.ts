import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { parseArgs, parseRun } from "../src/args.js";
import { choiceArgs, newWorktree, removeWorktree, worktreeName } from "../src/start-choice.js";

test("choiceArgs: Claude takes --model and --effort as they are", () => {
  assert.deepEqual(choiceArgs("claude", { model: "opus", effort: "high" }), ["--model", "opus", "--effort", "high"]);
  assert.deepEqual(choiceArgs("claude", { effort: "max" }), ["--effort", "max"]);
  assert.deepEqual(choiceArgs("claude", {}), []);
});

test("choiceArgs: Codex takes --model, and thinking as its reasoning effort setting", () => {
  assert.deepEqual(choiceArgs("codex", { model: "gpt-5", effort: "medium" }), ["--model", "gpt-5", "-c", 'model_reasoning_effort="medium"']);
});

test("choiceArgs: Antigravity has no model or thinking choice, so asking for one is refused", () => {
  assert.deepEqual(choiceArgs("antigravity", {}), []);
  assert.throws(() => choiceArgs("antigravity", { model: "x" }), /Antigravity/);
  assert.throws(() => choiceArgs("antigravity", { effort: "high" }), /Antigravity/);
});

test("choiceArgs: a value that is not a plain word is refused", () => {
  assert.throws(() => choiceArgs("claude", { model: "--dangerously-skip-permissions" }), /model/);
  assert.throws(() => choiceArgs("codex", { effort: 'high" x="y' }), /thinking/);
});

test("worktreeName: the tool and the start time, sortable", () => {
  assert.equal(worktreeName("claude", new Date(2026, 10, 23, 9, 5, 7)), "claude-20261123-090507");
});

/** A repository `app` with one commit and a `sub` folder, in a fresh temp root. */
function repoFixture(): { root: string; repo: string; g: (...a: string[]) => string } {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "asw-wt-")));
  const repo = path.join(root, "app");
  fs.mkdirSync(path.join(repo, "sub"), { recursive: true });
  const g = (...a: string[]) => execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { encoding: "utf8" }).trim();
  g("init", "-q");
  fs.writeFileSync(path.join(repo, "sub", "f.txt"), "x");
  g("add", ".");
  g("commit", "-qm", "init");
  return { root, repo, g };
}

test("newWorktree: a new branch in a sibling <repo>.worktrees folder, at the folder's HEAD", () => {
  const { root, repo, g } = repoFixture();
  const at = new Date(2026, 10, 23, 9, 5, 7);
  const made = newWorktree(path.join(repo, "sub"), "codex", at);
  const dir = made.cwd;
  assert.equal(dir, path.join(root, "app.worktrees", "codex-20261123-090507", "sub"));
  assert.equal(made.dir, path.join(root, "app.worktrees", "codex-20261123-090507"));
  assert.equal(made.branch, "agent-switch/codex-20261123-090507");
  assert.ok(fs.existsSync(path.join(dir, "f.txt")));
  assert.equal(execFileSync("git", ["-C", dir, "branch", "--show-current"], { encoding: "utf8" }).trim(), "agent-switch/codex-20261123-090507");
  assert.equal(execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), g("rev-parse", "HEAD"));
});

test("newWorktree: two starts in the same second get their own branch and folder", () => {
  const { repo } = repoFixture();
  const at = new Date(2026, 10, 23, 9, 5, 7);
  const a = newWorktree(repo, "claude", at);
  const b = newWorktree(repo, "claude", at);
  assert.notEqual(a.dir, b.dir);
  assert.notEqual(a.branch, b.branch);
  assert.ok(fs.existsSync(a.dir) && fs.existsSync(b.dir));
});

test("newWorktree: started from inside a worktree, the new one sits beside the main repository, not inside the worktree's folder", () => {
  const { root, repo } = repoFixture();
  const first = newWorktree(path.join(repo, "sub"), "claude", new Date(2026, 10, 23, 9, 5, 7));
  const second = newWorktree(first.cwd, "claude", new Date(2026, 10, 23, 9, 6, 0));
  assert.equal(second.dir, path.join(root, "app.worktrees", "claude-20261123-090600"));
  assert.equal(second.cwd, path.join(second.dir, "sub"));
});

test("removeWorktree: takes back the checkout and its branch", () => {
  const { repo, g } = repoFixture();
  const made = newWorktree(repo, "claude", new Date(2026, 10, 23, 9, 5, 7));
  removeWorktree(made);
  assert.equal(fs.existsSync(made.dir), false);
  assert.equal(g("branch", "--list", made.branch), "");
});

test("newWorktree: outside a git repository it says so", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asw-nogit-"));
  assert.throws(() => newWorktree(dir, "claude"), /not a git repository/);
});

test("parseRun: --model, --effort and --worktree are agent-switch's before a bare --", () => {
  const r = parseRun(["work", "--model", "opus", "--effort", "high", "--worktree", "--", "--model", "kept"]);
  assert.equal(r.name, "work");
  assert.equal(r.model, "opus");
  assert.equal(r.effort, "high");
  assert.equal(r.worktree, true);
  assert.deepEqual(r.args, ["--model", "kept"]);
  assert.throws(() => parseRun(["work", "--model"]), /--model needs a value/);
});

test("parseArgs: host start --worktree is a switch, --model and --effort take values", () => {
  const p = parseArgs(["host", "start", "work", "--model", "opus", "--effort", "high", "--worktree", "--cwd", "/r"]);
  assert.deepEqual(p.positional, ["start", "work"]);
  assert.equal(p.flags.model, "opus");
  assert.equal(p.flags.effort, "high");
  assert.equal(p.flags.worktree, true);
});
