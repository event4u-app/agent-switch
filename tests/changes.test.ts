import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { changesIn, parseNumstatZ, parsePorcelainZ } from "../src/commands/changes.js";

test("parsePorcelainZ: status letters, a rename's source path is skipped", () => {
  const out = [" M a.ts", "A  b.ts", " D c.ts", "R  new.ts", "old.ts", "?? d.txt", ""].join("\0");
  assert.deepEqual(parsePorcelainZ(out), [
    { status: "M", path: "a.ts" },
    { status: "A", path: "b.ts" },
    { status: "D", path: "c.ts" },
    { status: "R", path: "new.ts" },
    { status: "?", path: "d.txt" },
  ]);
  assert.deepEqual(parsePorcelainZ(""), []);
});

test("parseNumstatZ: counts, binary as 0/0, a rename keyed by its new path", () => {
  const out = ["3\t1\ta.ts", "-\t-\timg.png", "2\t0\t", "old.ts", "new.ts", ""].join("\0");
  const m = parseNumstatZ(out);
  assert.deepEqual(m.get("a.ts"), { added: 3, removed: 1 });
  assert.deepEqual(m.get("img.png"), { added: 0, removed: 0 });
  assert.deepEqual(m.get("new.ts"), { added: 2, removed: 0 });
  assert.equal(m.size, 3);
});

test("changesIn: a real worktree — modified, deleted, untracked with its line count, names with spaces", () => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "asw-changes-")));
  const g = (...a: string[]) => execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { encoding: "utf8" });
  g("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(repo, "keep.ts"), "a\nb\n");
  fs.writeFileSync(path.join(repo, "gone.ts"), "x\n");
  g("add", ".");
  g("commit", "-qm", "one");
  fs.writeFileSync(path.join(repo, "keep.ts"), "a\nB\nc\n");
  fs.rmSync(path.join(repo, "gone.ts"));
  fs.writeFileSync(path.join(repo, "new file.md"), "1\n2\n3\n4\n");
  const files = changesIn(repo)!;
  const by = new Map(files.map((f) => [f.path, f]));
  assert.deepEqual(by.get("keep.ts"), { status: "M", path: "keep.ts", added: 2, removed: 1 });
  assert.deepEqual(by.get("gone.ts"), { status: "D", path: "gone.ts", added: 0, removed: 1 });
  assert.deepEqual(by.get("new file.md"), { status: "?", path: "new file.md", added: 4, removed: 0 });
  assert.equal(files.length, 3);
  assert.equal(changesIn(path.join(os.tmpdir(), "asw-no-such-dir")), null);
});
