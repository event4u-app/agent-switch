import { test } from "node:test";
import assert from "node:assert/strict";

import { cleanupWorktrees, worktreesFor } from "../src/commands/library.js";

const LIST = [
  { path: "/r/wt-a", dirty: false, keys: ["claude/w/a", "claude/w/a2"], live: [] },
  { path: "/r/wt-b", dirty: false, keys: ["claude/w/b"], live: [] },
  { path: "/r/wt-c", dirty: true, keys: ["codex/x/c"], live: [] },
];

test("cleanup with sessions named: only the merged worktrees those sessions work in", () => {
  assert.deepEqual(worktreesFor(LIST, ["claude/w/a2", "codex/x/c", "claude/w/none"]).map((w) => w.path), ["/r/wt-a", "/r/wt-c"]);
  assert.deepEqual(worktreesFor(LIST, ["claude/w/none"]), [], "a selection with no merged worktree removes nothing");
});

test("cleanup with no session named: every merged worktree, as before", () => {
  assert.deepEqual(worktreesFor(LIST, []).map((w) => w.path), ["/r/wt-a", "/r/wt-b", "/r/wt-c"]);
});

test("cleanup skips a worktree a live session works in, and one with changes, and says what it removed and skipped", () => {
  const list = [
    { path: "/r/wt-a", dirty: false, keys: ["claude/w/a"], live: [] },
    { path: "/r/wt-live", dirty: false, keys: ["claude/w/b"], live: ["codex/x/other"] },
    { path: "/r/wt-dirty", dirty: true, keys: ["claude/w/c"], live: [] },
    { path: "/r/wt-locked", dirty: false, keys: ["claude/w/d"], live: [] },
  ];
  const removed: string[] = [];
  const remove = (p: string) => (p === "/r/wt-locked" ? "fatal: it is locked" : (removed.push(p), null));
  assert.deepEqual(cleanupWorktrees(list, true, remove), {
    removed: ["/r/wt-a"],
    skipped: [
      { path: "/r/wt-live", reason: "a live session works in it (codex/x/other)" },
      { path: "/r/wt-dirty", reason: "it has changes" },
      { path: "/r/wt-locked", reason: "git kept it: fatal: it is locked" },
    ],
    wouldRemove: [],
  });
  assert.deepEqual(removed, ["/r/wt-a"], "nothing else was touched");
  const dry = cleanupWorktrees(list, false, () => assert.fail("a dry run removes nothing"));
  assert.deepEqual(dry.wouldRemove, ["/r/wt-a", "/r/wt-locked"]);
  assert.deepEqual(dry.removed, []);
});
