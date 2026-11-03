import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";

import { preflight, realGit, shellLine, type GitProbe, type PreflightInput } from "../src/resume.js";

const probe = (over: Partial<Record<keyof GitProbe, boolean>> = {}): GitProbe => ({
  exists: () => over.exists ?? true,
  branchExists: () => over.branchExists ?? true,
  commitReachable: () => over.commitReachable ?? true,
  dirty: () => over.dirty ?? false,
});
const input = (over: Partial<PreflightInput> = {}): PreflightInput => ({
  sessionId: "7f3c2a91-4b1e",
  account: "work",
  cwd: "/code/app",
  branch: "feat/x",
  headSha: "abc1234",
  worktree: false,
  how: "continue",
  briefPath: "/cfg/handoff/7f3c2a91-4b1e.md",
  account_ready: { signedIn: true, tightestPct: 40 },
  ...over,
});

test("all clear: resume where it ran, with the exact command", () => {
  const p = preflight(input(), probe());
  assert.equal(p.target, "same_cwd");
  assert.ok(p.checks.every((c) => c.ok));
  assert.deepEqual(p.commands, [["agent-switch", "run", "work", "--cwd", "/code/app", "--", "--resume", "7f3c2a91-4b1e"]]);
});

test("branch gone but commit reachable, or the checkout dirty: a new worktree at the last commit", () => {
  for (const over of [{ branchExists: false }, { dirty: true }]) {
    const p = preflight(input(), probe(over));
    assert.equal(p.target, "new_worktree");
    assert.match(p.suggestion, /new worktree at the session's last commit/);
    // A sibling of the checkout, joined the platform's way.
    const wt = path.join("/code", "app-resume-7f3c2a91");
    assert.deepEqual(p.commands[0], ["git", "-C", "/code/app", "worktree", "add", "--detach", wt, "abc1234"]);
    assert.deepEqual(p.commands[1].slice(0, 5), ["agent-switch", "run", "work", "--cwd", wt]);
  }
  const lost = preflight(input(), probe({ branchExists: false, commitReachable: false }));
  assert.equal(lost.target, "same_cwd", "no commit to start a worktree from");
  assert.ok(lost.checks.some((c) => !c.ok && /commit/.test(c.text)));
});

test("the four ways: continue, fork, other account, new with brief", () => {
  assert.deepEqual(preflight(input({ how: "fork" }), probe()).commands.at(-1)!.slice(-3), ["--resume", "7f3c2a91-4b1e", "--fork-session"]);
  assert.deepEqual(preflight(input({ how: "account", toAccount: "side" }), probe()).commands, [["agent-switch", "takeover", "7f3c2a91-4b1e", "--to", "side"]]);
  assert.deepEqual(preflight(input({ how: "brief", toAccount: "side" }), probe()).commands.map((c) => c.slice(0, 3)), [["agent-switch", "handoff", "extract"], ["agent-switch", "handoff", "seed"]]);
});

test("the account check says signed out or how full it is; a gone folder is said in words", () => {
  assert.match(preflight(input({ account_ready: { signedIn: false, tightestPct: null } }), probe()).checks.at(-1)!.text, /not signed in/);
  assert.match(preflight(input(), probe()).checks.at(-1)!.text, /40% of its tightest window/);
  const gone = preflight(input(), probe({ exists: false }));
  assert.equal(gone.checks[0].ok, false);
  assert.match(gone.suggestion, /folder is gone/);
});

test("shellLine quotes only what needs it", () => {
  assert.equal(shellLine(["agent-switch", "run", "work", "--", "--resume", "id"]), "agent-switch run work -- --resume id");
  assert.equal(shellLine(["git", "-C", "/my repo/it's"]), "git -C '/my repo/it'\\''s'");
});

test("a checkout git cannot answer for counts as not clean, so resume never lands on it", () => {
  // A status that fails or times out says nothing about open changes; reading it as clean resumed into them.
  const notARepo = path.join(path.parse(process.cwd()).root, "no-such-folder-asw-resume");
  assert.equal(realGit.dirty(notARepo), true);
});

