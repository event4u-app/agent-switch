import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { changesIn } from "../src/commands/changes.js";
import { baseOf, dropEntry, inside, listShelf, listStashes, localChanges, parseStashList, restoreEntry, rollbackGit, rollbackLocal, shelve, snapshot, stashOp } from "../src/commands/shelf.js";

const tmp = (p: string) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p)));
const read = (f: string) => fs.readFileSync(f, "utf8");

function repo() {
  const dir = tmp("asw-shelf-repo-");
  const g = (...a: string[]) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { encoding: "utf8" });
  g("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(dir, "a.ts"), "one\n");
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "b.ts"), "two\n");
  g("add", ".");
  g("commit", "-qm", "init");
  return { dir, g };
}

test("parseStashList: ref, message and branch from git's prefix", () => {
  const out = ["stash@{0}\x1fOn main: try the store\x1f1700000000", "stash@{1}\x1fWIP on feat/x: abc123 msg\x1f1690000000", ""].join("\n");
  assert.deepEqual(parseStashList(out), [
    { ref: "stash@{0}", message: "try the store", branch: "main", created: 1700000000000 },
    { ref: "stash@{1}", message: "abc123 msg", branch: "feat/x", created: 1690000000000 },
  ]);
});

test("inside: only paths in the folder", () => {
  assert.equal(inside("/r", "a/b.ts"), "/r/a/b.ts");
  assert.equal(inside("/r", "../x"), null);
  assert.equal(inside("/r", "/etc/passwd"), null);
});

test("shelve in a repository keeps a copy, rolls the files back, and unshelving puts them back", () => {
  const { dir } = repo();
  const shelf = tmp("asw-shelf-");
  fs.writeFileSync(path.join(dir, "a.ts"), "changed\n");
  fs.writeFileSync(path.join(dir, "new.ts"), "fresh\n");
  const e = shelve(shelf, dir, ["a.ts", "new.ts"], "wip", true);
  assert.equal(read(path.join(dir, "a.ts")), "one\n");
  assert.equal(fs.existsSync(path.join(dir, "new.ts")), false);
  assert.deepEqual(changesIn(dir), []);
  assert.equal(listShelf(shelf, dir)[0].message, "wip");
  restoreEntry(shelf, dir, e);
  assert.equal(read(path.join(dir, "a.ts")), "changed\n");
  assert.equal(read(path.join(dir, "new.ts")), "fresh\n");
  dropEntry(shelf, dir, e.id);
  assert.deepEqual(listShelf(shelf, dir), []);
});

test("rollback in a repository: tracked files from HEAD, new ones removed", () => {
  const { dir } = repo();
  fs.writeFileSync(path.join(dir, "src", "b.ts"), "x\n");
  fs.writeFileSync(path.join(dir, "n.ts"), "n\n");
  rollbackGit(dir, ["src/b.ts", "n.ts"]);
  assert.equal(read(path.join(dir, "src", "b.ts")), "two\n");
  assert.equal(fs.existsSync(path.join(dir, "n.ts")), false);
});

test("stash: push named files, list them, pop them back", () => {
  const { dir } = repo();
  fs.writeFileSync(path.join(dir, "a.ts"), "stashed\n");
  stashOp(dir, "push", { files: ["a.ts"], message: "try" });
  assert.equal(read(path.join(dir, "a.ts")), "one\n");
  const s = listStashes(dir);
  assert.equal(s.length, 1);
  assert.equal(s[0].message, "try");
  assert.equal(s[0].files, 1);
  stashOp(dir, "pop", { ref: s[0].ref });
  assert.equal(read(path.join(dir, "a.ts")), "stashed\n");
  assert.throws(() => stashOp(dir, "drop", { ref: "HEAD; rm -rf /" }), /not a stash/);
});

test("a folder without git: a snapshot is the base, changes are listed against it, rollback restores", () => {
  const dir = tmp("asw-local-");
  const shelf = tmp("asw-shelf-");
  fs.writeFileSync(path.join(dir, "notes.md"), "a\nb\n");
  fs.writeFileSync(path.join(dir, "old.txt"), "old\n");
  fs.mkdirSync(path.join(dir, "node_modules"));
  fs.writeFileSync(path.join(dir, "node_modules", "x.js"), "skip\n");
  assert.equal(localChanges(shelf, dir), null);
  snapshot(shelf, dir, "start");
  assert.ok(baseOf(listShelf(shelf, dir)));
  assert.deepEqual(localChanges(shelf, dir), []);
  fs.writeFileSync(path.join(dir, "notes.md"), "a\nB\nc\n");
  fs.rmSync(path.join(dir, "old.txt"));
  fs.writeFileSync(path.join(dir, "new.txt"), "n\n");
  const ch = localChanges(shelf, dir)!;
  assert.deepEqual(
    ch.map((c) => [c.status, c.path]),
    [
      ["A", "new.txt"],
      ["M", "notes.md"],
      ["D", "old.txt"],
    ],
  );
  rollbackLocal(shelf, dir, ["notes.md", "old.txt", "new.txt"]);
  assert.equal(read(path.join(dir, "notes.md")), "a\nb\n");
  assert.equal(read(path.join(dir, "old.txt")), "old\n");
  assert.equal(fs.existsSync(path.join(dir, "new.txt")), false);
  assert.deepEqual(localChanges(shelf, dir), []);
});
