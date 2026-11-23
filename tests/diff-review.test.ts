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
  for (const name of ["plain.ts", "a b.ts", "tab\tq\"b\\.ts", "ä/😀.md"]) assert.equal(d.unquotePath(d.quotePath(name)), name, name);
  assert.equal(d.unquotePath('"b/\\303\\244.txt"'), "b/ä.txt");
  assert.equal(d.unquotePath("b/with space.txt\t"), "b/with space.txt");
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

test("uncommitted: exactly what `changes` lists (staged, unstaged and new vs HEAD), nothing committed; base HEAD", async () => {
  const { r } = repo();
  const { changesIn } = await import("../src/commands/changes.js");
  const rev = d.review(target(r), "uncommitted");
  assert.deepEqual(rev.files.map((f) => f.path), changesIn(r)!.map((f) => f.path).sort());
  assert.ok(rev.files.every((f) => f.hunks.every((h) => h.layer !== "committed")));
  assert.equal(rev.baseRef, "HEAD");
  assert.equal(rev.note, null);
});

test("the compare base is named: the main line for worktree, HEAD for staged", () => {
  const { r } = repo();
  const w = d.review(target(r), "worktree");
  assert.equal(w.baseRef, "main");
  assert.match(w.base!, /^[0-9a-f]{40}$/);
  assert.equal(d.review(target(r), "staged").baseRef, "HEAD");
});

test("session scope without a findable start says so and does not fall back to the main line", () => {
  const { r } = repo();
  const s = d.review(target(r), "session");
  assert.deepEqual(s.files, []);
  assert.equal(s.base, null);
  assert.match(s.note!, /start/i);
  assert.match(s.note!, /Branch vs main/);
});

test("a large review keeps every file and its counts, but drops hunks past the line budget", () => {
  const { r } = repo();
  const full = d.review(target(r), "worktree");
  const capped = d.review(target(r), "worktree", { maxLines: 3 });
  assert.deepEqual(capped.files.map((f) => [f.path, f.added, f.removed]), full.files.map((f) => [f.path, f.added, f.removed]));
  const omitted = capped.files.filter((f) => f.omitted);
  assert.ok(omitted.length > 0, "something is past the budget");
  assert.ok(omitted.every((f) => f.hunks.length === 0));
  assert.equal(capped.omitted, omitted.length);
  assert.equal(full.omitted, 0);
});

test("a failed git diff is refused, not shown as no changes", () => {
  const { r } = repo();
  fs.writeFileSync(path.join(r, ".git", "index"), "not an index");
  assert.match(refusal(() => d.review(target(r), "uncommitted")), /git (diff|ls-files) failed/);
});

test("gitFailure names a timeout and a too-large output", () => {
  assert.equal(d.gitFailure({ status: 0, signal: null, stderr: "" }), null);
  assert.match(d.gitFailure({ status: null, signal: "SIGTERM", error: Object.assign(new Error("x"), { code: "ETIMEDOUT" }), stderr: "" })!, /timed out/);
  assert.match(d.gitFailure({ status: null, signal: "SIGTERM", error: Object.assign(new Error("x"), { code: "ENOBUFS" }), stderr: "" })!, /too large/);
  assert.match(d.gitFailure({ status: 128, signal: null, stderr: "fatal: bad\nmore" })!, /fatal: bad$/);
});

test("fingerprint: the same while nothing changes, different after an edit or for another scope", () => {
  const { r } = repo();
  const t = target(r);
  const a = d.fingerprint(t, "uncommitted");
  assert.equal(d.fingerprint(t, "uncommitted"), a);
  assert.notEqual(d.fingerprint(t, "staged"), a);
  fs.writeFileSync(path.join(r, "new.txt"), "fresh\nand more\n");
  assert.notEqual(d.fingerprint(t, "uncommitted"), a);
});

/** A repo whose file names git quotes: a space, a tab, a double quote, a backslash and an umlaut. */
const ODD = ["with space.txt", "tab\there.txt", 'qu"ote.txt', "back\\slash.txt", "ä-umlaut.txt", "dir with space/ö.txt"];
function oddRepo() {
  const r = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "asw-rev-odd-")));
  const g = (...a: string[]) => execFileSync("git", ["-C", r, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.autocrlf=false", ...a], { encoding: "utf8" });
  g("init", "-q", "-b", "main");
  for (const f of ODD) {
    fs.mkdirSync(path.dirname(path.join(r, f)), { recursive: true });
    fs.writeFileSync(path.join(r, f), "one\ntwo\n");
  }
  g("add", ".");
  g("commit", "-qm", "base");
  for (const f of ODD) fs.writeFileSync(path.join(r, f), "one\nTWO\n");
  fs.writeFileSync(path.join(r, "neu ü.txt"), "fresh\n");
  return { r, g };
}

test("file names with spaces, tabs, quotes, backslashes and non-ASCII: listed as written, the same as `changes`", async () => {
  const { r } = oddRepo();
  const { changesIn } = await import("../src/commands/changes.js");
  const listed = d.review(target(r), "uncommitted").files.map((f) => f.path);
  assert.deepEqual(listed, [...ODD, "neu ü.txt"].sort((a, b) => a.localeCompare(b)));
  assert.deepEqual(listed, changesIn(r)!.map((f) => f.path));
});

test("file names git quotes: stage, unstage and discard act on them; the staged copy is listed under the same name", () => {
  const { r, g } = oddRepo();
  const t = target(r);
  for (const f of ODD) {
    d.act(t, "stage", f, null);
    assert.ok(d.review(t, "staged").files.some((x) => x.path === f), `${JSON.stringify(f)} staged`);
    d.act(t, "unstage", f, null);
    d.act(t, "discard", f, null);
    assert.equal(fs.readFileSync(path.join(r, f), "utf8"), "one\ntwo\n", `${JSON.stringify(f)} discarded`);
  }
  assert.equal(g("diff", "--name-only").trim(), "");
});

test("one inventory with `changes`: the same files and the same cap, the rest counted on both", async () => {
  const { r } = repo();
  const { changeInventory, MAX_CHANGED_FILES } = await import("../src/commands/changes.js");
  for (let i = 0; i < MAX_CHANGED_FILES + 7; i++) fs.writeFileSync(path.join(r, `n${String(i).padStart(4, "0")}.txt`), "x\n");
  const inv = changeInventory(r)!;
  const rev = d.review(target(r), "uncommitted", { maxFiles: MAX_CHANGED_FILES });
  assert.equal(inv.files.length, MAX_CHANGED_FILES);
  assert.deepEqual(rev.files.map((f) => f.path), inv.files.map((f) => f.path));
  // repo() leaves 3 changed files; with the new ones that is 10 past the cap.
  assert.equal(inv.more, 10);
  assert.equal(rev.more, 10);
  assert.equal(d.review(target(r), "uncommitted").more, 0, "no cap asked, none applied");
});

test("the --since token covers who else works here: a new shared session is never hidden by an unchanged review", () => {
  const { r } = repo();
  const t = target(r);
  const first = d.reviewJson(t, "uncommitted", { shared: [] });
  assert.equal(first.unchanged, undefined);
  assert.deepEqual(d.reviewJson(t, "uncommitted", { since: first.fingerprint as string, shared: [] }), { key: t.key, scope: "uncommitted", unchanged: true, fingerprint: first.fingerprint });
  const now = d.reviewJson(t, "uncommitted", { since: first.fingerprint as string, shared: ["claude/w/other"] });
  assert.equal(now.unchanged, undefined);
  assert.deepEqual(now.shared, ["claude/w/other"]);
});

/** A repo with keep.txt, del.txt, other.txt and a binary img.png committed on main. */
function wholeRepo() {
  const r = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "asw-rev-whole-")));
  const g = (...a: string[]) => execFileSync("git", ["-C", r, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.autocrlf=false", ...a], { encoding: "utf8" });
  g("init", "-q", "-b", "main");
  // The code under test commits without -c flags; the repo carries its own identity (CI has no global one).
  g("config", "user.name", "t");
  g("config", "user.email", "t@example.com");
  for (const f of ["keep.txt", "del.txt", "other.txt"]) fs.writeFileSync(path.join(r, f), `${f}\n`);
  fs.writeFileSync(path.join(r, "img.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 0, 255]));
  g("add", ".");
  g("commit", "-qm", "base");
  return { r, g, status: (f: string) => g("status", "--porcelain=v1", "--", f).slice(0, 2) };
}

test("a whole-file stage of a deletion stages the deletion; unstage puts it back in the index; nothing is emptied", () => {
  const { r, status } = wholeRepo();
  const t = target(r);
  fs.rmSync(path.join(r, "keep.txt"));
  d.act(t, "stage", "keep.txt", null);
  assert.equal(status("keep.txt"), "D ", "the deletion is staged, not an empty file");
  d.act(t, "unstage", "keep.txt", null);
  assert.equal(status("keep.txt"), " D", "unstaged: deleted in the worktree only");
});

test("unstage of a staged deletion (git rm) restores the index entry", () => {
  const { r, g, status } = wholeRepo();
  g("rm", "-q", "del.txt");
  d.act(target(r), "unstage", "del.txt", null);
  assert.equal(status("del.txt"), " D");
});

test("discard of a worktree deletion brings the file back; undo deletes it again", () => {
  const { r, status } = wholeRepo();
  const t = target(r);
  fs.rmSync(path.join(r, "keep.txt"));
  assert.equal(d.act(t, "discard", "keep.txt", null).undo, true);
  assert.equal(fs.readFileSync(path.join(r, "keep.txt"), "utf8"), "keep.txt\n");
  assert.equal(status("keep.txt"), "");
  d.undo(t);
  assert.equal(fs.existsSync(path.join(r, "keep.txt")), false);
});

test("stage then unstage a new file leaves it untracked; a later commit of another file leaves it out", () => {
  const { r, g, status } = wholeRepo();
  const t = target(r);
  fs.writeFileSync(path.join(r, "new.txt"), "fresh\n");
  d.act(t, "stage", "new.txt", null);
  assert.equal(status("new.txt"), "A ");
  d.act(t, "unstage", "new.txt", null);
  assert.equal(status("new.txt"), "??", "untracked again, not an empty staged file");
  assert.equal(fs.readFileSync(path.join(r, "new.txt"), "utf8"), "fresh\n");
  fs.writeFileSync(path.join(r, "other.txt"), "changed\n");
  d.act(t, "stage", "other.txt", null);
  d.commitStaged(t, "other only");
  assert.equal(g("show", "--name-only", "--format=", "HEAD").trim(), "other.txt");
});

test("binary, large new and symlinked files: listed without a preview, staged, unstaged and discarded as whole files", () => {
  const { r, status } = wholeRepo();
  const t = target(r);
  fs.writeFileSync(path.join(r, "img.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 9, 9, 9, 0, 255]));
  fs.writeFileSync(path.join(r, "big.txt"), "x".repeat(2_000_000));
  fs.symlinkSync("other.txt", path.join(r, "link"));
  const files = new Map(d.review(t, "uncommitted").files.map((f) => [f.path, f]));
  assert.equal(files.get("img.png")!.preview, "binary");
  assert.equal(files.get("big.txt")!.preview, "too large");
  assert.equal(files.get("link")!.preview, "link");
  for (const f of ["img.png", "big.txt", "link"]) assert.deepEqual(files.get(f)!.layers, ["unstaged"], f);
  for (const f of ["img.png", "big.txt", "link"]) d.act(t, "stage", f, null);
  assert.deepEqual([status("img.png"), status("big.txt"), status("link")], ["M ", "A ", "A "]);
  const staged = new Map(d.review(t, "uncommitted").files.map((f) => [f.path, f]));
  for (const f of ["img.png", "big.txt", "link"]) assert.deepEqual(staged.get(f)!.layers, ["staged"], `${f} counts as staged`);
  for (const f of ["img.png", "big.txt", "link"]) d.act(t, "unstage", f, null);
  assert.deepEqual([status("img.png"), status("big.txt"), status("link")], [" M", "??", "??"]);
  for (const f of ["img.png", "big.txt", "link"]) d.act(t, "discard", f, null);
  assert.deepEqual([status("img.png"), status("big.txt"), status("link")], ["", "", ""]);
  d.undo(t);
  assert.equal(fs.readlinkSync(path.join(r, "link")), "other.txt", "the link comes back as a link");
});

test("a whole-file action carries the hash of what was shown and is refused when the file changed since", () => {
  const { r } = wholeRepo();
  const t = target(r);
  fs.writeFileSync(path.join(r, "keep.txt"), "keep.txt\nmine\n");
  const shown = d.review(t, "uncommitted").files.find((f) => f.path === "keep.txt")!;
  assert.match(shown.hash, /^[0-9a-f]{16}$/);
  fs.writeFileSync(path.join(r, "keep.txt"), "keep.txt\nmine\nand typed after the page was read\n");
  for (const action of ["stage", "discard"] as const) assert.equal(refusal(() => d.act(t, action, "keep.txt", null, shown.hash)), "the file changed since you looked — read it again");
  assert.equal(fs.readFileSync(path.join(r, "keep.txt"), "utf8"), "keep.txt\nmine\nand typed after the page was read\n", "nothing was discarded");
  const now = d.review(t, "uncommitted").files.find((f) => f.path === "keep.txt")!;
  assert.match(d.act(t, "discard", "keep.txt", null, now.hash).done, /discarded keep\.txt/);
});
