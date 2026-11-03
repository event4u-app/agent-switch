import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// The undo store and the open-approval files live under the state root: one per file, set before the import.
const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "asw-rev-home-")));
process.env.AGENT_SWITCH_HOME = HOME;
const d = await import("../src/commands/diff.js");
const { writePending, clearPending } = await import("../src/bridge/pending.js");

/** A repo: main with a.txt; a feature commit; then staged, unstaged and new changes. */
function repo() {
  const r = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "asw-rev-")));
  const g = (...a: string[]) => execFileSync("git", ["-C", r, ...a], { encoding: "utf8" });
  g("init", "-q", "-b", "main");
  // The commit under test runs plain `git commit`, and Windows runners check out with CRLF.
  g("config", "user.name", "t");
  g("config", "user.email", "t@example.com");
  g("config", "core.autocrlf", "false");
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
  return { r, g };
}

let n = 0;
const target = (cwd: string, transcript: string | null = null) => ({ key: `claude/w/s${++n}`, provider: "claude" as const, account: "w", sessionId: `s${n}`, cwd, transcript });
const refusal = (f: () => unknown): string => {
  try {
    f();
  } catch (e) {
    assert.ok(e instanceof d.ReviewRefused, String(e));
    return e.message;
  }
  assert.fail("not refused");
};

test("worktree vs main: committed, staged, unstaged and new files, each hunk with its layer", () => {
  const { r } = repo();
  const t = target(r);
  const files = d.review(t, "worktree").files.map((f) => [f.path, f.status, f.added, f.removed, f.hunks.map((h) => h.layer)]);
  assert.deepEqual(files, [
    ["a.txt", "M", 2, 1, ["committed", "unstaged"]],
    ["b.txt", "M", 1, 1, ["staged"]],
    ["new.txt", "?", 1, 0, ["unstaged"]],
  ]);
  assert.deepEqual(d.review(t, "staged").files.map((f) => [f.path, f.hunks.map((h) => h.layer)]), [["b.txt", ["staged"]]], "only what is staged");
  assert.ok(d.review(t, "worktree").base, "the merge base with main");
});

test("session scope starts where the transcript began; this turn reads the last turn's diff events", () => {
  const { r } = repo();
  const tr = path.join(r, "..", `t-${path.basename(r)}.jsonl`);
  const ts = new Date(Date.now() + 60_000).toISOString();
  fs.writeFileSync(
    tr,
    [
      { type: "user", timestamp: ts, message: { role: "user", content: "go" } },
      { type: "assistant", timestamp: ts, message: { role: "assistant", content: [{ type: "tool_use", id: "u1", name: "Edit", input: { file_path: path.join(r, "a.txt"), old_string: "three", new_string: "four" } }] } },
      { type: "user", timestamp: ts, toolUseResult: { filePath: path.join(r, "a.txt"), structuredPatch: [{ oldStart: 3, newStart: 3, lines: ["-three", "+four"] }] }, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "u1", content: "ok" }] } },
    ]
      .map((o) => JSON.stringify(o))
      .join("\n") + "\n",
  );
  const t = target(r, tr);
  const session = d.review(t, "session").files;
  assert.ok(session.every((f) => f.hunks.every((h) => h.layer !== "committed")), "nothing committed since the session began");
  const turn = d.review(t, "turn").files;
  assert.ok(turn.length <= 1);
  for (const f of turn) assert.ok(f.hunks.every((h) => h.layer === "turn"));
  assert.deepEqual(d.review(target(r), "turn").files, [], "no transcript: no turn");
});

test("stage, unstage, discard one hunk; a discard is undone; a new file's discard too", () => {
  const { r, g } = repo();
  const t = target(r);
  const hunk = (layer: string, file: string) => d.review(t, "worktree").files.find((f) => f.path === file)!.hunks.find((h) => h.layer === layer)!.hash;
  assert.match(d.act(t, "stage", "a.txt", hunk("unstaged", "a.txt")).done, /^staged a change in a\.txt$/);
  assert.match(g("diff", "--cached", "a.txt"), /\+four/);
  d.act(t, "unstage", "a.txt", null);
  assert.equal(g("diff", "--cached", "a.txt"), "");
  assert.equal(d.act(t, "discard", "a.txt", hunk("unstaged", "a.txt")).undo, true);
  assert.equal(fs.readFileSync(path.join(r, "a.txt"), "utf8"), "one\nTWO\nthree\n");
  d.undo(t);
  assert.equal(fs.readFileSync(path.join(r, "a.txt"), "utf8"), "one\nTWO\nthree\nfour\n", "the discard is back");
  d.act(t, "discard", "new.txt", null);
  assert.equal(fs.existsSync(path.join(r, "new.txt")), false);
  d.undo(t);
  assert.equal(fs.readFileSync(path.join(r, "new.txt"), "utf8"), "fresh\n");
  assert.match(refusal(() => d.undo(t)), /nothing to undo/);
  assert.equal(d.act(t, "stage", "new.txt", null).done, "staged new.txt");
  d.act(t, "discard", "a.txt", null);
  fs.writeFileSync(path.join(r, "a.txt"), "changed meanwhile\n");
  assert.match(refusal(() => d.undo(t)), /cannot be put back cleanly/);
});

test("refusals: a stale hunk, a busy index, a turn waiting for approval, nothing staged; the commit runs", () => {
  const { r, g } = repo();
  const t = target(r);
  assert.match(refusal(() => d.act(t, "stage", "a.txt", "0000000000000000")), /no longer there as shown/);
  assert.match(refusal(() => d.act(t, "unstage", "new.txt", null)), /nothing staged in new\.txt/);
  const lock = path.join(r, ".git", "index.lock");
  fs.writeFileSync(lock, "");
  assert.match(refusal(() => d.act(t, "stage", "a.txt", null)), /index\.lock/);
  fs.rmSync(lock);
  writePending(HOME, { key: t.key, pid: process.pid, items: [{ id: "r", tool: "Bash", summary: "", since: "x" }] });
  assert.match(refusal(() => d.act(t, "stage", "a.txt", null)), /a turn is running/);
  clearPending(HOME, t.key);
  assert.match(refusal(() => d.commitStaged(t, "")), /needs a message/);
  assert.match(d.commitStaged(t, "staged b"), /^[0-9a-f]{7,}$/);
  assert.match(g("log", "-1", "--format=%s"), /staged b/);
  assert.match(refusal(() => d.commitStaged(t, "again")), /nothing is staged/);
  const plain = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "asw-plain-")));
  assert.match(refusal(() => d.review(target(plain), "worktree")), /not work in a git repository/);
  assert.match(refusal(() => d.act(target(plain), "stage", "x", null)), /not work in a git repository/);
});

test("splitDiff and hunkPatch", () => {
  const sd = d.splitDiff("diff --git a/x.ts b/x.ts\nindex 1..2 100644\n--- a/x.ts\n+++ b/x.ts\n@@ -1,2 +1,2 @@ fn\n a\n-b\n+c\ndiff --git a/y.ts b/y.ts\nnew file mode 100644\n--- /dev/null\n+++ b/y.ts\n@@ -0,0 +1 @@\n+y\ndiff --git a/z.ts b/z.ts\ndeleted file mode 100644\n--- a/z.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-z\n", "staged");
  assert.deepEqual([...sd.keys()], ["x.ts", "y.ts", "z.ts"]);
  assert.deepEqual([...sd.values()].map((v) => v.status), ["M", "A", "D"]);
  assert.equal(sd.get("x.ts")!.hunks[0].header, "@@ -1,2 +1,2 @@ fn");
  assert.equal(d.hunkPatch("x.ts", { oldStart: 1, newStart: 1, lines: [" a", "-b", "+c"] }), "diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n");
  assert.match(d.hunkPatch("n.ts", { oldStart: 0, newStart: 1, lines: ["+n"] }, true), /new file mode 100644\n--- \/dev\/null/);
});

test("sharedWorktree: other live sessions in the same worktree, however git spells the folder", () => {
  const { r, g } = repo();
  const t = target(r);
  const top = g("rev-parse", "--show-toplevel").trim();
  assert.deepEqual(
    d.sharedWorktree(t, [
      { key: t.key, toplevel: top, live: true },
      { key: "claude/w/other", toplevel: top, live: true },
      { key: "claude/w/raw", toplevel: r, live: true },
      { key: "claude/w/ended", toplevel: top, live: false },
      { key: "codex/x/t", toplevel: os.tmpdir(), live: true },
      { key: "codex/x/none", toplevel: null, live: true },
    ]),
    ["claude/w/other", "claude/w/raw"],
  );
});
