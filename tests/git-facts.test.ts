import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { gitFacts, parseStatusV2, stripCredentials } from "../src/git-facts.js";

test("parseStatusV2 reads branch, head, ahead/behind and counts every kind of change", () => {
  const out = [
    "# branch.oid 1234567890abcdef1234567890abcdef12345678",
    "# branch.head feat/x",
    "# branch.upstream origin/feat/x",
    "# branch.ab +2 -1",
    "1 .M N... 100644 100644 100644 a b src/a.ts",
    "2 R. N... 100644 100644 100644 a b R100 src/new.ts\tsrc/old.ts",
    "u UU N... 100644 100644 100644 100644 a b c conflict.ts",
    "? notes.txt",
    "",
  ].join("\n");
  assert.deepEqual(parseStatusV2(out), { branch: "feat/x", headSha: "1234567890abcdef1234567890abcdef12345678", dirty: true, changed: 4, ahead: 2, behind: 1, upstream: "origin/feat/x" });
  assert.deepEqual(parseStatusV2("# branch.oid (initial)\n# branch.head (detached)\n"), { branch: null, headSha: null, dirty: false, changed: 0, ahead: null, behind: null, upstream: null });
});

test("stripCredentials removes user and token from a remote URL", () => {
  assert.equal(stripCredentials("https://user:ghp_secret@github.com/o/r.git"), "https://github.com/o/r.git");
  assert.equal(stripCredentials("git@github.com:o/r.git"), "git@github.com:o/r.git");
  assert.equal(stripCredentials("https://github.com/o/r"), "https://github.com/o/r");
});

const g = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

test("gitFacts on a real repo, a linked worktree, a non-repo; a change shows without staleness", () => {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "asw-git-")));
  const origin = path.join(base, "origin.git");
  g(base, "init", "-q", "--bare", origin);
  const repo = path.join(base, "repo");
  g(base, "clone", "-q", origin, repo);
  fs.writeFileSync(path.join(repo, "a.txt"), "1");
  g(repo, "add", ".");
  g(repo, "commit", "-qm", "one");
  g(repo, "push", "-q", "-u", "origin", "HEAD:main");
  g(repo, "branch", "-q", "-u", "origin/main");
  fs.writeFileSync(path.join(repo, "a.txt"), "2");
  g(repo, "commit", "-qam", "two");

  const f = gitFacts(path.join(repo))!;
  assert.equal(f.toplevel, repo);
  assert.ok(f.branch === "main" || f.branch === "master", f.branch!);
  assert.deepEqual([f.ahead, f.behind, f.dirty, f.worktree], [1, 0, false, false]);
  assert.equal(f.remote, origin);

  fs.writeFileSync(path.join(repo, "b.txt"), "new"); // untracked: no index or HEAD change
  const dirty = gitFacts(repo)!;
  assert.deepEqual([dirty.dirty, dirty.changed], [true, 1], "seen at once");

  const wt = path.join(base, "wt");
  g(repo, "worktree", "add", "-q", "-b", "side", wt);
  const w = gitFacts(path.join(wt))!;
  assert.deepEqual([w.branch, w.worktree, w.toplevel], ["side", true, wt]);

  assert.equal(gitFacts(base), null, "not a repo: null");
  assert.equal(gitFacts(path.join(base, "missing")), null);
});

test("gitFacts through a second spelling of the same folder (a symlink here, an 8.3 short name on Windows): still the main checkout, at its real path", () => {
  const real = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "gf-alias-")));
  const link = path.join(fs.realpathSync.native(os.tmpdir()), `gf-link-${process.pid}`);
  try {
    execFileSync("git", ["-C", real, "init", "-q", "-b", "main"]);
    fs.symlinkSync(real, link, "dir");
    const f = gitFacts(link)!;
    assert.equal(f.worktree, false, "the main checkout is not a linked worktree");
    assert.equal(f.toplevel, real);
  } finally {
    fs.rmSync(link, { force: true });
    fs.rmSync(real, { recursive: true, force: true });
  }
});
