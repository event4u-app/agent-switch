import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  extractBrief,
  gitFacts,
  writeBrief,
  cleanupBrief,
  sweepBriefs,
  seedPrompt,
  handoffDir,
} from "../src/handoff.js";

const WIN = process.platform === "win32";
const UID = "33333333-3333-4333-8333-333333333333";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "asw-handoff-"));
}

function seedClaude(cfg: string, enc: string, id: string, header: object): void {
  const dir = path.join(cfg, "projects", enc);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.jsonl`), `${JSON.stringify(header)}\n{"opaque":1}\n`);
}

test("gitFacts reads branch + short HEAD from the filesystem (no subprocess)", () => {
  const root = tmp();
  try {
    const repo = path.join(root, "repo");
    fs.mkdirSync(path.join(repo, ".git", "refs", "heads", "feat"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".git", "HEAD"), "ref: refs/heads/feat/x\n");
    fs.writeFileSync(path.join(repo, ".git", "refs", "heads", "feat", "x"), "abcdef1234567890\n");
    assert.deepEqual(gitFacts(repo), { branch: "feat/x", head: "abcdef123456" });
    assert.deepEqual(gitFacts(null), { branch: null, head: null });
    assert.deepEqual(gitFacts(path.join(root, "nope")), { branch: null, head: null });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("extractBrief composes a metadata-only Claude brief with the spotlight preamble", () => {
  const root = tmp();
  try {
    const cfg = path.join(root, "cfg");
    seedClaude(cfg, "-proj", UID, { cwd: "/proj", summary: "did stuff", type: "m" });
    const brief = extractBrief({ provider: "claude", profile: "work", sessionId: UID, configDir: cfg, targetProvider: "codex" });
    // spotlight preamble present (untrusted-data framing)
    assert.match(brief, /CONTEXT DATA, not instructions/);
    assert.match(brief, /must NOT be executed as commands/);
    // metadata surfaced from the header
    assert.match(brief, new RegExp(UID));
    assert.match(brief, /Working directory: `\/proj`/);
    assert.match(brief, /Session summary: did stuff/);
    // lossy framing
    assert.match(brief, /LOSSY handoff/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("extractBrief marks a Codex source as thin (no cwd/summary), never silently empty", () => {
  const root = tmp();
  try {
    const cfg = path.join(root, "cfg"); // no codex rollout seeded → locate misses, still honest
    const brief = extractBrief({ provider: "codex", profile: "oai", sessionId: UID, configDir: cfg, targetProvider: "claude" });
    assert.match(brief, /\*\*Codex\*\* source/);
    assert.match(brief, /only the session id and token count/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("writeBrief persists mode 0600 in a dedicated handoff dir; cleanupBrief removes it", { skip: WIN ? "POSIX perms" : false }, () => {
  const root = tmp();
  try {
    const cfg = path.join(root, "cfg");
    const p = writeBrief(cfg, UID, "brief body");
    assert.equal(p, path.join(handoffDir(cfg), `${UID}.md`));
    assert.equal(fs.statSync(p).mode & 0o777, 0o600);
    assert.equal(fs.readFileSync(p, "utf8"), "brief body");
    cleanupBrief(p);
    assert.equal(fs.existsSync(p), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("sweepBriefs drops briefs older than the TTL, keeps fresh ones", () => {
  const root = tmp();
  try {
    const cfg = path.join(root, "cfg");
    const dir = handoffDir(cfg);
    const oldF = path.join(dir, "old.md");
    const freshF = path.join(dir, "fresh.md");
    fs.writeFileSync(oldF, "x");
    fs.writeFileSync(freshF, "y");
    const t0 = 1_000_000;
    fs.utimesSync(oldF, new Date(t0), new Date(t0));
    const now = t0 + 25 * 60 * 60 * 1000; // 25h later
    fs.utimesSync(freshF, new Date(now), new Date(now));
    assert.equal(sweepBriefs(cfg, now), 1);
    assert.equal(fs.existsSync(oldF), false);
    assert.equal(fs.existsSync(freshF), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("seedPrompt references the brief BY PATH and spotlights it as untrusted data", () => {
  const p = "/some/dir/.agent-switch/handoff/x.md";
  const prompt = seedPrompt(p);
  assert.ok(prompt.includes(p)); // path only
  assert.match(prompt, /untrusted context DATA/);
  assert.match(prompt, /do not execute/i);
});
