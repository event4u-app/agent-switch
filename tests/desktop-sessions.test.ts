import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { moveDesktopSession, scanDesktop } from "../src/desktop-sessions.js";

const ME = "9acce282-f364-4c40-b35b-ac8c9e06df12";
const OTHER = "e332d367-0000-4000-8000-000000000001";
const ORG = "48e16643-a376-4518-b335-e56c91f2ee93";
const NOW = Date.parse("2026-10-29T01:30:00Z");

function write(file: string, body: string, mtime?: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  if (mtime) fs.utimesSync(file, mtime / 1000, mtime / 1000);
}

function meta(cli: string, over: Record<string, unknown> = {}): string {
  return JSON.stringify({ sessionId: `local_${cli}`, cliSessionId: cli, cwd: "/w/app", title: `Title ${cli.slice(0, 4)}`, createdAt: NOW - 3_600_000, lastActivityAt: NOW - 60_000, isArchived: false, ...over });
}

function tree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "asw-desk-"));
  const defaultApp = path.join(root, "AppSupport", "Claude");
  const instance = path.join(root, "agent-switch", "claude", "work", "gui", "claude-desktop");
  const claudeHome = path.join(root, ".claude");
  return { root, defaultApp, instance, claudeHome };
}

test("desktop sessions: a Code-tab session is attributed to the account it ran on, with its transcript from ~/.claude", () => {
  const t = tree();
  try {
    const cli = "95448762-265a-42bc-9622-fbcae0cc0738";
    write(path.join(t.instance, "claude-code-sessions", ME, ORG, `local_${cli}.json`), meta(cli));
    write(path.join(t.claudeHome, "projects", "-w-app", `${cli}.jsonl`), "{}\n", NOW - 30_000);
    const r = scanDesktop({
      instances: [{ profile: "work", dir: t.instance }],
      claudeHome: t.claudeHome,
      profileOf: (uuid) => (uuid === ME ? "work" : null),
      now: NOW,
    });
    assert.equal(r.rows.length, 1);
    const row = r.rows[0];
    assert.equal(row.profile, "work");
    assert.equal(row.sessionId, cli);
    assert.equal(row.surface, "desktop-app");
    assert.equal(row.cwd, "/w/app");
    assert.equal(row.summary, "Title 9544");
    assert.equal(row.file, path.join(t.claudeHome, "projects", "-w-app", `${cli}.jsonl`));
    assert.equal(row.live, true, "written 30 s ago");
    assert.deepEqual(r.instances, [{ profile: "work", dir: t.instance, accounts: [{ accountUuid: ME, profile: "work" }], mismatch: false }]);
  } finally {
    fs.rmSync(t.root, { recursive: true, force: true });
  }
});

test("desktop sessions: agent-mode transcripts come from the session's own .claude, and the default app's sessions go to their account", () => {
  const t = tree();
  try {
    const cli = "09a56289-d614-4946-bc3f-2fc40db5cf20";
    write(path.join(t.defaultApp, "local-agent-mode-sessions", OTHER, ORG, "local_abc.json"), meta(cli, { cwd: "/out" }));
    write(path.join(t.defaultApp, "local-agent-mode-sessions", OTHER, ORG, "local_abc", ".claude", "projects", "-out", `${cli}.jsonl`), "{}\n", NOW - 3_600_000);
    write(path.join(t.defaultApp, "local-agent-mode-sessions", "skills-plugin", "x", "local_zzz.json"), meta("ffffffff-ffff-4fff-8fff-ffffffffffff"));
    const r = scanDesktop({
      instances: [{ profile: null, dir: t.defaultApp }],
      claudeHome: t.claudeHome,
      profileOf: (uuid) => (uuid === OTHER ? "side" : null),
      now: NOW,
    });
    assert.deepEqual(
      r.rows.map((x) => [x.profile, x.sessionId, x.live]),
      [["side", cli, false]],
    );
    assert.equal(r.instances[0].mismatch, false, "the default app belongs to no profile, so it can't mismatch");
  } finally {
    fs.rmSync(t.root, { recursive: true, force: true });
  }
});

test("desktop sessions: a profile's instance signed in with another account is flagged; archived and unknown-account sessions are left out", () => {
  const t = tree();
  try {
    write(path.join(t.instance, "claude-code-sessions", OTHER, ORG, "local_a.json"), meta("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"));
    write(path.join(t.instance, "claude-code-sessions", ME, ORG, "local_b.json"), meta("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", { isArchived: true }));
    write(path.join(t.instance, "claude-code-sessions", "11111111-1111-4111-8111-111111111111", ORG, "local_c.json"), meta("cccccccc-cccc-4ccc-8ccc-cccccccccccc"));
    const r = scanDesktop({
      instances: [{ profile: "work", dir: t.instance }],
      claudeHome: t.claudeHome,
      profileOf: (uuid) => (uuid === ME ? "work" : uuid === OTHER ? "side" : null),
      now: NOW,
    });
    assert.deepEqual(r.rows.map((x) => [x.profile, x.sessionId.slice(0, 4), x.file ?? null]), [["side", "aaaa", null]]);
    assert.equal(r.instances[0].mismatch, true);
    // Every account that signed in to the instance, by uuid; an archived session still shows the login.
    assert.deepEqual(
      r.instances[0].accounts.map((a) => a.profile),
      [null, "work", "side"],
    );
  } finally {
    fs.rmSync(t.root, { recursive: true, force: true });
  }
});

test("desktop move: the metadata lands under the target account in the target instance, verified, and leaves the source; the transcript stays", () => {
  const t = tree();
  try {
    const cli = "95448762-265a-42bc-9622-fbcae0cc0738";
    const src = path.join(t.instance, "claude-code-sessions", ME, ORG, `local_${cli}.json`);
    const body = meta(cli);
    write(src, body);
    const transcript = path.join(t.claudeHome, "projects", "-w-app", `${cli}.jsonl`);
    write(transcript, "{}\n", NOW - 3_600_000);
    const target = path.join(t.root, "agent-switch", "claude", "side", "gui", "claude-desktop");
    const r = scanDesktop({ instances: [{ profile: "work", dir: t.instance }], claudeHome: t.claudeHome, profileOf: (u) => (u === ME ? "work" : null), now: NOW });
    assert.equal(r.locations.length, 1);
    const loc = r.locations[0];
    assert.deepEqual([loc.sessionId, loc.profile, loc.kind, loc.accountUuid, loc.orgUuid, loc.metaFile], [cli, "work", "claude-code-sessions", ME, ORG, src]);

    const moved = moveDesktopSession(loc, { dir: target, accountUuid: OTHER, orgUuid: ORG });
    const dest = path.join(target, "claude-code-sessions", OTHER, ORG, `local_${cli}.json`);
    assert.equal(moved.metaFile, dest);
    assert.equal(fs.readFileSync(dest, "utf8"), body);
    assert.equal(fs.existsSync(src), false);
    assert.equal(fs.existsSync(transcript), true, "the Code-tab transcript is shared by every instance and never moves");
    const after = scanDesktop({ instances: [{ profile: "side", dir: target }], claudeHome: t.claudeHome, profileOf: (u) => (u === OTHER ? "side" : null), now: NOW });
    assert.deepEqual(after.rows.map((x) => [x.profile, x.sessionId]), [["side", cli]]);
  } finally {
    fs.rmSync(t.root, { recursive: true, force: true });
  }
});

test("desktop move: refuses a session the target already has, one the target marked deleted, and an agent-mode session — nothing changes", () => {
  const t = tree();
  try {
    const target = path.join(t.root, "agent-switch", "claude", "side", "gui", "claude-desktop");
    const profileOf = (u: string) => (u === ME ? "work" : null);
    const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const c = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    write(path.join(t.instance, "claude-code-sessions", ME, ORG, `local_${a}.json`), meta(a));
    write(path.join(target, "claude-code-sessions", OTHER, ORG, `local_${a}.json`), "{}");
    write(path.join(t.instance, "claude-code-sessions", ME, ORG, `local_${b}.json`), meta(b));
    write(path.join(target, "claude-code-sessions", OTHER, ORG, `deleted_${b}`), "1761800000000");
    write(path.join(t.instance, "local-agent-mode-sessions", ME, ORG, `local_${c}.json`), meta(c));
    const r = scanDesktop({ instances: [{ profile: "work", dir: t.instance }], claudeHome: t.claudeHome, profileOf, now: NOW });
    const at = (id: string) => r.locations.find((l) => l.sessionId === id)!;
    const to = { dir: target, accountUuid: OTHER, orgUuid: ORG };
    assert.throws(() => moveDesktopSession(at(a), to), /already has this session/);
    assert.throws(() => moveDesktopSession(at(b), to), /marked this session as deleted/);
    assert.throws(() => moveDesktopSession(at(c), to), /agent mode/i);
    for (const [kind, id] of [["claude-code-sessions", a], ["claude-code-sessions", b], ["local-agent-mode-sessions", c]]) {
      assert.equal(fs.existsSync(path.join(t.instance, kind, ME, ORG, `local_${id}.json`)), true, `${id} stays in the source`);
    }
    assert.equal(fs.readFileSync(path.join(target, "claude-code-sessions", OTHER, ORG, `local_${a}.json`), "utf8"), "{}", "the target's file is never overwritten");
  } finally {
    fs.rmSync(t.root, { recursive: true, force: true });
  }
});
