import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { Store, storeFile } from "../src/store/store.js";
import { openDriver, StoreUnavailable } from "../src/store/driver.js";
import { updateLibrary, libraryEntry, libraryAll, searchSessions, keptState, cleanupPeriodDays, vaultCopy, vaultEntry, vaultRestore, vaultDir, vaultBytes, kept } from "../src/library.js";

const skip = await openDriver(":memory:").then(
  (d) => (d.close(), false as const),
  (e) => (e instanceof StoreUnavailable ? e.message : (() => { throw e; })()),
);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "asw-lib-"));
const KEY = "claude/work/7f3c2a91-4b1e";

test("library: pin, name, tags, archive — separate flags, in the store", { skip }, async () => {
  const store = await Store.open(storeFile(tmp()));
  try {
    updateLibrary(store, KEY, { pinned: true, name: "  Release notes 2.11  " });
    updateLibrary(store, KEY, { addTag: "release" });
    updateLibrary(store, KEY, { addTag: "release" });
    updateLibrary(store, KEY, { addTag: "docs", archived: true });
    const e = libraryEntry(store, KEY)!;
    assert.deepEqual([e.name, e.tags, e.pinned, e.archived, e.autoKept], ["Release notes 2.11", ["release", "docs"], true, true, false]);
    updateLibrary(store, KEY, { removeTag: "docs", archived: false, name: "" });
    assert.deepEqual([libraryEntry(store, KEY)!.name, libraryEntry(store, KEY)!.tags, libraryEntry(store, KEY)!.archived], [null, ["release"], false]);
    assert.equal(updateLibrary(store, "claude/work/x", { name: "n".repeat(500) }).name!.length, 120);
    assert.equal(libraryAll(store).length, 2);
    assert.equal(kept(libraryEntry(store, KEY)), true);
    assert.equal(kept(updateLibrary(store, KEY, { pinned: false })), false);
    assert.equal(kept(updateLibrary(store, KEY, { autoKept: true })), true);
  } finally {
    store.close();
  }
});

test("search covers name, tags, summary, folder, branch and PR; all words must match", () => {
  const rows = [
    { key: "a", summary: "wire the event store", cwd: "/code/agent-switch", branch: "feat/event-store", prs: [142] },
    { key: "b", summary: "fix checkout", cwd: "/code/shop", branch: "main", prs: [] },
  ];
  const lib = new Map([["b", { key: "b", name: "Checkout a11y", tags: ["urgent"], pinned: true, archived: false, autoKept: false, updatedAt: "" }]]);
  const keys = (q: string) => searchSessions(rows, lib, q).map((r) => r.key);
  assert.deepEqual(keys("#142"), ["a"]);
  assert.deepEqual(keys("event agent-switch"), ["a"]);
  assert.deepEqual(keys("URGENT"), ["b"]);
  assert.deepEqual(keys("a11y shop"), ["b"]);
  assert.deepEqual(keys("event shop"), []);
  assert.deepEqual(keys(" "), ["a", "b"]);
});

test("keptState: kept with size, at risk with the days Claude leaves, lost without a transcript", () => {
  const now = Date.UTC(2026, 10, 2);
  assert.deepEqual(keptState({ vaultBytes: 2_400_000, transcriptExists: false, mtimeMs: null, periodDays: 30, nowMs: now }), { state: "kept", bytes: 2_400_000 });
  assert.deepEqual(keptState({ vaultBytes: null, transcriptExists: true, mtimeMs: now - 27 * 86_400_000, periodDays: 30, nowMs: now }), { state: "at-risk", daysLeft: 3 });
  assert.deepEqual(keptState({ vaultBytes: null, transcriptExists: true, mtimeMs: now - 40 * 86_400_000, periodDays: 30, nowMs: now }), { state: "at-risk", daysLeft: 0 });
  assert.deepEqual(keptState({ vaultBytes: null, transcriptExists: false, mtimeMs: null, periodDays: 30, nowMs: now }), { state: "lost" });
});

test("cleanupPeriodDays: the account's setting, else Claude's 30", () => {
  const cfg = tmp();
  assert.equal(cleanupPeriodDays(cfg), 30);
  fs.writeFileSync(path.join(cfg, "settings.json"), JSON.stringify({ cleanupPeriodDays: 7 }));
  assert.equal(cleanupPeriodDays(cfg), 7);
  fs.writeFileSync(path.join(cfg, "settings.json"), JSON.stringify({ cleanupPeriodDays: -1 }));
  assert.equal(cleanupPeriodDays(cfg), 30);
});

test("vault: verified copy of transcript, session folder and file history; restore after Claude deleted it", { skip }, async () => {
  const root = tmp();
  const cfg = path.join(root, "cfg");
  const files = {
    transcript: path.join(cfg, "projects", "-repo", "7f3c2a91-4b1e.jsonl"),
    sessionDir: path.join(cfg, "projects", "-repo", "7f3c2a91-4b1e"),
    fileHistory: path.join(cfg, "file-history", "7f3c2a91-4b1e"),
  };
  fs.mkdirSync(path.join(files.sessionDir, "subagents"), { recursive: true });
  fs.mkdirSync(files.fileHistory, { recursive: true });
  fs.writeFileSync(files.transcript, '{"type":"user"}\n');
  fs.writeFileSync(path.join(files.sessionDir, "subagents", "agent-a.jsonl"), "{}\n");
  fs.writeFileSync(path.join(files.fileHistory, "v1"), "old content");
  fs.symlinkSync("/etc/passwd", path.join(files.sessionDir, "escape"));
  const store = await Store.open(storeFile(root));
  try {
    const r = vaultCopy(store, root, KEY, files);
    const dir = vaultDir(root, KEY);
    assert.equal(r.bytes, 16 + 3 + 11);
    assert.ok(fs.existsSync(path.join(dir, "session", "subagents", "agent-a.jsonl")));
    assert.ok(!fs.existsSync(path.join(dir, "session", "escape")), "a symlink is not followed out");
    assert.equal(vaultEntry(store, KEY)!.sha256, r.sha256);
    assert.equal(vaultBytes(store), r.bytes);
    assert.ok(fs.existsSync(files.transcript), "copy, never move");
    if (process.platform !== "win32") assert.equal(fs.statSync(path.join(dir, "transcript.jsonl")).mode & 0o777, 0o600);

    assert.throws(() => vaultRestore(store, KEY, files), /still has its transcript/);
    fs.rmSync(files.transcript);
    fs.rmSync(files.sessionDir, { recursive: true });
    vaultRestore(store, KEY, files);
    assert.equal(fs.readFileSync(files.transcript, "utf8"), '{"type":"user"}\n');
    assert.ok(fs.existsSync(path.join(files.sessionDir, "subagents", "agent-a.jsonl")));

    fs.writeFileSync(path.join(dir, "transcript.jsonl"), "tampered");
    fs.rmSync(files.transcript);
    assert.throws(() => vaultRestore(store, KEY, files), /does not match its hash/);
    assert.throws(() => vaultDir(root, "claude/../x"), /bad session key/);
  } finally {
    store.close();
  }
});

test("libraryRound: open PR → auto-kept and vaulted; merged > 24 h → archived once; an unarchive sticks", { skip }, async () => {
  const { execFileSync, spawnSync } = await import("node:child_process");
  const home = fs.realpathSync(tmp());
  const repo = path.join(home, "repo");
  fs.mkdirSync(repo);
  const g = (...a: string[]) => execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { encoding: "utf8" });
  g("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(repo, "a"), "1");
  g("add", ".");
  g("commit", "-qm", "one");
  g("remote", "add", "origin", "git@github.com:o/r.git");
  g("update-ref", "refs/remotes/origin/main", "HEAD");
  g("branch", "-q", "-u", "origin/main");
  const sha = g("rev-parse", "HEAD").trim();
  const cfg = path.join(home, "claude", "work", "config");
  fs.mkdirSync(path.join(cfg, "projects", "-repo"), { recursive: true });
  fs.writeFileSync(path.join(cfg, ".claude.json"), "{}");
  fs.writeFileSync(path.join(cfg, "projects", "-repo", "8888-round.jsonl"), JSON.stringify({ cwd: repo }) + "\n");
  const pr = (lifecycle: string, updatedAt: string) => ({ "o/r": { fetchedAt: new Date().toISOString(), rateRemaining: null, rateLimit: null, prs: [{ repo: "o/r", number: 7, url: "", headRepo: "o/r", headSha: sha, lifecycle, mergeable: "MERGEABLE", review: "NONE", ci: "SUCCESS", failingChecks: [], updatedAt }] } });
  const round = () => {
    const mod = new URL("../src/commands/library.js", import.meta.url).href;
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", `const { libraryRound } = await import(${JSON.stringify(mod)}); console.log(JSON.stringify(await libraryRound()));`], { env: { ...process.env, AGENT_SWITCH_HOME: home }, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout.trim().split("\n").pop()!);
  };
  const KEY8 = "claude/work/8888-round";
  const entry = async () => {
    const st = await Store.open(storeFile(home));
    try {
      return libraryEntry(st, KEY8);
    } finally {
      st.close();
    }
  };

  fs.writeFileSync(path.join(home, "pr-cache.json"), JSON.stringify(pr("OPEN", new Date().toISOString())));
  assert.deepEqual(round(), { autoKept: 1, released: 0, archived: 0, copied: 1 });
  assert.ok(fs.existsSync(path.join(home, "vault", "claude", "work", "8888-round", "transcript.jsonl")));
  assert.deepEqual(round(), { autoKept: 0, released: 0, archived: 0, copied: 0 }, "unchanged transcript: nothing to copy");

  fs.writeFileSync(path.join(home, "pr-cache.json"), JSON.stringify(pr("MERGED", new Date(Date.now() - 2 * 86_400_000).toISOString())));
  assert.deepEqual(round(), { autoKept: 0, released: 1, archived: 1, copied: 0 });
  assert.equal((await entry())!.archived, true);

  const st = await Store.open(storeFile(home));
  updateLibrary(st, KEY8, { archived: false });
  st.close();
  assert.equal(round().archived, 0, "the user's unarchive sticks");
  assert.equal((await entry())!.archived, false);

  // `sessions library --json`: the page's rows, from the store plus the session on disk.
  const cli = new URL("../src/index.js", import.meta.url).pathname;
  const r = spawnSync(process.execPath, [cli, "sessions", "library", "--json"], { env: { ...process.env, AGENT_SWITCH_HOME: home }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const l = JSON.parse(r.stdout);
  assert.equal(l.autoKeep, true);
  assert.ok(l.vaultBytes > 0);
  assert.equal(l.entries.length, 1);
  const e = l.entries[0];
  assert.equal(e.key, KEY8);
  assert.deepEqual([e.pinned, e.archived, e.autoKept, e.branch, e.canResume], [false, false, false, "main", true]);
  assert.deepEqual(e.pr, { number: 7, lifecycle: "MERGED" });
  assert.equal(e.kept.state, "kept");
  assert.equal(e.cwd, repo);
});
