import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { hunkPatch, sharedWorktree, splitDiff } from "../src/commands/diff.js";

const mod = new URL("../src/commands/diff.js", import.meta.url).href;
const pend = new URL("../src/bridge/pending.js", import.meta.url).href;

/** A repo: main with a.txt; a feature commit; then staged, unstaged and new changes. */
function repo() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "asw-rev-")));
  const r = path.join(home, "repo");
  fs.mkdirSync(r);
  const g = (...a: string[]) => execFileSync("git", ["-C", r, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { encoding: "utf8" });
  g("init", "-q", "-b", "main");
  // The commit under test runs plain `git commit`: give the repo an identity (CI has none).
  g("config", "user.name", "t");
  g("config", "user.email", "t@example.com");
  fs.writeFileSync(path.join(r, "a.txt"), "one\ntwo\nthree\n");
  fs.writeFileSync(path.join(r, "b.txt"), "b1\nb2\n");
  g("add", ".");
  g("commit", "-qm", "base");
  g("checkout", "-qb", "feat");
  fs.writeFileSync(path.join(r, "a.txt"), "one\nTWO\nthree\n");
  g("commit", "-qam", "feature");
  fs.writeFileSync(path.join(r, "b.txt"), "b1\nB2\n");
  g("add", "b.txt");
  fs.writeFileSync(path.join(r, "a.txt"), "one\nTWO\nthree\nfour\n");
  fs.writeFileSync(path.join(r, "new.txt"), "fresh\n");
  return { home, r, g };
}

function call(home: string, r: string, body: string) {
  const t = JSON.stringify({ key: "claude/w/s1", provider: "claude", account: "w", sessionId: "s1", cwd: r, transcript: null });
  const res = spawnSync(process.execPath, ["--input-type=module", "-e", `const d = await import(${JSON.stringify(mod)}); const t = ${t}; ${body}`], { env: { ...process.env, AGENT_SWITCH_HOME: path.join(home, "ash") }, encoding: "utf8" });
  assert.equal(res.status, 0, res.stderr);
  return JSON.parse(res.stdout.trim().split("\n").pop()!);
}

test("worktree vs main: committed, staged, unstaged and new files, each hunk with its layer", () => {
  const { home, r } = repo();
  const files = call(home, r, `console.log(JSON.stringify(d.review(t, "worktree").files.map((f) => [f.path, f.status, f.added, f.removed, f.hunks.map((h) => h.layer)])));`);
  assert.deepEqual(files, [
    ["a.txt", "M", 2, 1, ["committed", "unstaged"]],
    ["b.txt", "M", 1, 1, ["staged"]],
    ["new.txt", "?", 1, 0, ["unstaged"]],
  ]);
  const staged = call(home, r, `console.log(JSON.stringify(d.review(t, "staged").files.map((f) => [f.path, f.hunks.map((h) => h.layer)])));`);
  assert.deepEqual(staged, [["b.txt", ["staged"]]], "only what is staged");
});

test("stage, unstage, discard one hunk; a discard is undone; a new file's discard too", () => {
  const { home, r, g } = repo();
  const hunk = (layer: string, file: string) => `d.review(t, "worktree").files.find((f) => f.path === ${JSON.stringify(file)}).hunks.find((h) => h.layer === ${JSON.stringify(layer)}).hash`;
  call(home, r, `console.log(JSON.stringify(d.act(t, "stage", "a.txt", ${hunk("unstaged", "a.txt")})));`);
  assert.match(g("diff", "--cached", "a.txt"), /\+four/);
  call(home, r, `console.log(JSON.stringify(d.act(t, "unstage", "a.txt", null)));`);
  assert.equal(g("diff", "--cached", "a.txt"), "");
  const dis = call(home, r, `console.log(JSON.stringify(d.act(t, "discard", "a.txt", ${hunk("unstaged", "a.txt")})));`);
  assert.equal(dis.undo, true);
  assert.equal(fs.readFileSync(path.join(r, "a.txt"), "utf8"), "one\nTWO\nthree\n");
  call(home, r, `console.log(JSON.stringify(d.undo(t)));`);
  assert.equal(fs.readFileSync(path.join(r, "a.txt"), "utf8"), "one\nTWO\nthree\nfour\n", "the discard is back");
  call(home, r, `console.log(JSON.stringify(d.act(t, "discard", "new.txt", null)));`);
  assert.equal(fs.existsSync(path.join(r, "new.txt")), false);
  call(home, r, `console.log(JSON.stringify(d.undo(t)));`);
  assert.equal(fs.readFileSync(path.join(r, "new.txt"), "utf8"), "fresh\n");
  call(home, r, `try { d.undo(t); console.log("{}") } catch (e) { console.log(JSON.stringify({ e: e.message })) }`);
});

test("refusals: a stale hunk, a busy index, a turn waiting for approval, nothing staged, a commit with the repo's hooks", () => {
  const { home, r, g } = repo();
  const err = (body: string) => call(home, r, `try { ${body}; console.log("{}") } catch (e) { console.log(JSON.stringify({ e: e.message })) }`).e;
  assert.match(err(`d.act(t, "stage", "a.txt", "0000000000000000")`), /no longer there as shown/);
  const lock = path.join(r, ".git", "index.lock");
  fs.writeFileSync(lock, "");
  assert.match(err(`d.act(t, "stage", "a.txt", null)`), /index\.lock/);
  fs.rmSync(lock);
  const p = call(home, r, `const { writePending } = await import(${JSON.stringify(pend)}); writePending(process.env.AGENT_SWITCH_HOME, { key: "claude/w/s1", pid: process.ppid, items: [{ id: "r", tool: "Bash", summary: "", since: "x" }] }); console.log("{}")`);
  assert.deepEqual(p, {});
  assert.match(err(`d.act(t, "stage", "a.txt", null)`), /a turn is running/);
  fs.rmSync(path.join(home, "ash", "bridge"), { recursive: true });
  assert.match(err(`d.commitStaged(t, "")`), /needs a message/);
  const sha = call(home, r, `console.log(JSON.stringify(d.commitStaged(t, "staged b")))`);
  assert.match(sha, /^[0-9a-f]{7,}$/);
  assert.match(g("log", "-1", "--format=%s"), /staged b/);
  assert.match(err(`d.commitStaged(t, "again")`), /nothing is staged/);
  fs.mkdirSync(path.join(home, "plain"));
  assert.match(call(home, path.join(home, "plain"), `try { d.review(t, "worktree") } catch (e) { console.log(JSON.stringify({ e: e.message })) }`).e, /not work in a git repository/);
});

test("splitDiff and hunkPatch", () => {
  const d = splitDiff("diff --git a/x.ts b/x.ts\nindex 1..2 100644\n--- a/x.ts\n+++ b/x.ts\n@@ -1,2 +1,2 @@ fn\n a\n-b\n+c\ndiff --git a/y.ts b/y.ts\nnew file mode 100644\n--- /dev/null\n+++ b/y.ts\n@@ -0,0 +1 @@\n+y\n", "staged");
  assert.deepEqual([...d.keys()], ["x.ts", "y.ts"]);
  assert.equal(d.get("y.ts")!.status, "A");
  assert.equal(d.get("x.ts")!.hunks[0].header, "@@ -1,2 +1,2 @@ fn");
  assert.equal(hunkPatch("x.ts", { oldStart: 1, newStart: 1, lines: [" a", "-b", "+c"] }), "diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n");
});

test("sharedWorktree: other live sessions in the same worktree", () => {
  const { r } = repo();
  const t = { key: "claude/w/s1", provider: "claude" as const, account: "w", sessionId: "s1", cwd: r, transcript: null };
  const top = fs.realpathSync(r);
  assert.deepEqual(sharedWorktree(t, [{ key: "claude/w/s1", toplevel: top, live: true }, { key: "claude/w/s2", toplevel: top, live: true }, { key: "claude/w/s3", toplevel: top, live: false }, { key: "codex/x/t", toplevel: "/elsewhere", live: true }]), ["claude/w/s2"]);
});
