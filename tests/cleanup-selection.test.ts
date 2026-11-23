import { test } from "node:test";
import assert from "node:assert/strict";

import { worktreesFor } from "../src/commands/library.js";

const LIST = [
  { path: "/r/wt-a", dirty: false, keys: ["claude/w/a", "claude/w/a2"] },
  { path: "/r/wt-b", dirty: false, keys: ["claude/w/b"] },
  { path: "/r/wt-c", dirty: true, keys: ["codex/x/c"] },
];

test("cleanup with sessions named: only the merged worktrees those sessions work in", () => {
  assert.deepEqual(worktreesFor(LIST, ["claude/w/a2", "codex/x/c", "claude/w/none"]).map((w) => w.path), ["/r/wt-a", "/r/wt-c"]);
  assert.deepEqual(worktreesFor(LIST, ["claude/w/none"]), [], "a selection with no merged worktree removes nothing");
});

test("cleanup with no session named: every merged worktree, as before", () => {
  assert.deepEqual(worktreesFor(LIST, []).map((w) => w.path), ["/r/wt-a", "/r/wt-b", "/r/wt-c"]);
});
