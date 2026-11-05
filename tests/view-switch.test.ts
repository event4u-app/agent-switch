import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { HostedSession } from "../src/host/tmux-host.js";
import type { ViewDeps } from "../src/commands/view.js";

// State root for this file, set before the modules that read it at import.
const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "asw-view-home-")));
process.env.AGENT_SWITCH_HOME = HOME;
const { TmuxHost } = await import("../src/host/tmux-host.js");
const { hasClaudeTranscript, parkedArgv, realViewDeps, restoreAfterChat, resumeArgs, toChat, toTerminal, ViewRefused } = await import("../src/commands/view.js");
const { InputLeases } = await import("../src/host/lease.js");

function fakeHost(rows: HostedSession[]) {
  const log: string[] = [];
  const host: ViewDeps["host"] = {
    list: () => rows.map((r) => ({ ...r, alive: true })),
    park: (key, argv) => {
      log.push(`park ${key} ${argv.join(" ")}`);
      const r = rows.find((x) => x.key === key)!;
      r.parked = true;
      return r;
    },
    respawn: (key, o) => {
      log.push(`respawn ${key} ${o.bin} ${(o.args ?? []).join(" ")}`);
      return rows.find((x) => x.key === key)!;
    },
    unparked: (key) => {
      delete rows.find((x) => x.key === key)!.parked;
    },
  };
  return { host, log };
}
const row = (over: Partial<HostedSession> = {}): HostedSession => ({ key: "claude/work/s1", provider: "claude", account: "work", sessionId: "s1", window: "@1", cwd: "/w", startedAt: "t", ...over });
const deps = (host: ViewDeps["host"], over: Partial<ViewDeps> = {}): ViewDeps => ({ host, turnRunning: () => false, writer: () => null, bin: (p) => p, configDir: (p, a) => `/cfg/${p}/${a}`, parked: (k) => ["notice", k], hasConversation: () => true, ...over });

test("terminal → chat parks the window; chat → terminal resumes the same conversation", () => {
  const rows = [row()];
  const { host, log } = fakeHost(rows);
  assert.equal(toChat(deps(host), "claude/work/s1").parked, true);
  assert.equal(toChat(deps(host), "claude/work/s1").parked, true, "already in chat: nothing happens");
  toTerminal(deps(host), "claude/work/s1");
  assert.equal(rows[0].parked, undefined);
  toTerminal(deps(host), "claude/work/s1");
  assert.deepEqual(log, ["park claude/work/s1 notice claude/work/s1", "respawn claude/work/s1 claude --resume s1"]);
  assert.deepEqual(resumeArgs("codex", "t1"), ["resume", "t1"]);
});

test("chat → terminal before the first turn: the program starts again under its id, there is nothing to resume", () => {
  const rows = [row({ parked: true })];
  const { host, log } = fakeHost(rows);
  toTerminal(deps(host, { hasConversation: () => false }), "claude/work/s1");
  assert.deepEqual(log, ["respawn claude/work/s1 claude "]);
  assert.deepEqual(resumeArgs("claude", "s1", false), []);
  assert.deepEqual(resumeArgs("codex", "t1", false), ["resume", "t1"], "Codex resumes its thread either way");
});

test("hasClaudeTranscript: a transcript in any project folder; no projects folder is no; an unreadable one counts as yes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asw-view-tr-"));
  assert.equal(hasClaudeTranscript(dir, "s1"), false, "no projects folder");
  fs.mkdirSync(path.join(dir, "projects", "-a"), { recursive: true });
  fs.mkdirSync(path.join(dir, "projects", "-b"));
  assert.equal(hasClaudeTranscript(dir, "s1"), false);
  fs.writeFileSync(path.join(dir, "projects", "-b", "s1.jsonl"), "{}\n");
  assert.equal(hasClaudeTranscript(dir, "s1"), true);
  assert.equal(hasClaudeTranscript(dir, "s2"), false);
  if (process.platform !== "win32" && process.getuid?.() !== 0) {
    fs.chmodSync(path.join(dir, "projects"), 0o000);
    try {
      assert.equal(hasClaudeTranscript(dir, "s2"), true, "unreadable: never drop a resume");
    } finally {
      fs.chmodSync(path.join(dir, "projects"), 0o755);
    }
  }
});

test("refusals: not hosted, a provider without a shared conversation, a running turn, a second writer", () => {
  const { host } = fakeHost([row(), row({ key: "antigravity/me/a1", provider: "antigravity", account: "me", sessionId: "a1" })]);
  const refused = (f: () => unknown, re: RegExp) => assert.throws(f, (e: unknown) => e instanceof ViewRefused && re.test(e.message));
  refused(() => toChat(deps(host), "claude/work/elsewhere"), /^Chat needs a session hosted in Agent Switch$/);
  refused(() => toChat(deps(host), "antigravity/me/a1"), /keep the view they started in/);
  refused(() => toChat(deps(host, { turnRunning: () => true }), "claude/work/s1"), /switch after this turn/);
  refused(() => toChat(deps(host, { writer: () => "app bridge:42" }), "claude/work/s1"), /already has a writer \(app bridge:42\)/);
  toChat(deps(host), "claude/work/s1");
  refused(() => toTerminal(deps(host, { writer: () => "app bridge:42" }), "claude/work/s1"), /close the chat first/);
});

const gate = { skip: TmuxHost.available() ? false : "tmux is not installed here" };

test("20 switches on a real tmux window: one program at a time, always the same conversation", gate, () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "asw-view-")));
  const out = path.join(dir, "out");
  fs.mkdirSync(out);
  const bin = path.join(dir, "fake-claude");
  fs.writeFileSync(bin, `#!/bin/sh\necho "$$ $*" >> "${out}/runs"\nwhile IFS= read -r l; do :; done\n`, { mode: 0o755 });
  const notice = path.join(dir, "notice");
  fs.writeFileSync(notice, `#!/bin/sh\necho "parked $$" >> "${out}/runs"\nwhile IFS= read -r l; do :; done\n`, { mode: 0o755 });
  const socket = `asw-view-${process.pid}`;
  const host = new TmuxHost(dir, { socket });
  try {
    const s = host.start({ provider: "claude", account: "work", configDir: dir, cwd: dir, bin, sessionId: "0000aaaa-1111-2222-3333-444455556666" });
    const d: ViewDeps = { host, turnRunning: () => false, writer: () => null, bin: () => bin, configDir: () => dir, parked: () => [notice], hasConversation: () => true };
    const lines = () => (fs.existsSync(path.join(out, "runs")) ? fs.readFileSync(path.join(out, "runs"), "utf8").trim().split("\n") : []);
    const wait = (n: number) => {
      const end = Date.now() + 5000;
      while (lines().length < n && Date.now() < end) spawnSync("sleep", ["0.05"]);
    };
    wait(1);
    for (let i = 0; i < 20; i++) {
      const step = i % 2 === 0 ? toChat(d, s.key) : toTerminal(d, s.key);
      assert.equal(step.key, s.key);
      wait(i + 2);
    }
    const runs = lines();
    assert.equal(runs.length, 21, runs.join("\n"));
    runs.forEach((l, i) => {
      if (i === 0) assert.match(l, /--session-id 0000aaaa/);
      else if (i % 2 === 1) assert.match(l, /^parked \d+$/, `switch ${i} parks`);
      else assert.match(l, /--resume 0000aaaa-1111-2222-3333-444455556666$/, `switch ${i} resumes the same conversation`);
    });
    const panes = host.run(["list-panes", "-t", s.window, "-F", "#{pane_pid} #{pane_dead}"]).out.trim().split("\n");
    assert.equal(panes.length, 1, "one pane, one program");
    assert.equal(host.list().find((x) => x.key === s.key)?.parked, undefined, "ends in the terminal");
  } finally {
    spawnSync("tmux", ["-L", socket, "kill-server"]);
  }
});

test("restoreAfterChat: only a parked session is brought back; it never throws", () => {
  const rows = [row({ parked: true }), row({ key: "claude/work/s2", sessionId: "s2" })];
  const { host, log } = fakeHost(rows);
  assert.equal(restoreAfterChat("claude/work/s2", deps(host)), null, "not parked: nothing to do");
  assert.equal(restoreAfterChat("claude/work/s1", deps(host)), "claude/work/s1");
  assert.deepEqual(log, ["respawn claude/work/s1 claude --resume s1"]);
  rows[0].parked = true;
  assert.equal(restoreAfterChat("claude/work/s1", deps(host, { writer: () => "app bridge:1" })), null, "a refusal is swallowed");
  assert.equal(restoreAfterChat("claude/work/gone", deps(host)), null);
});

test("realViewDeps: the writer is a live lease holder; an unknown session runs no turn", () => {
  const d = realViewDeps();
  assert.equal(d.writer("claude/work/s1"), null);
  new InputLeases(HOME).acquire("claude/work/s1", { id: "bridge:1", pid: process.pid, kind: "app" });
  assert.equal(d.writer("claude/work/s1"), "app bridge:1");
  assert.equal(d.turnRunning("claude/nobody/nothing"), false);
  assert.equal(d.configDir("claude", "work"), path.join(HOME, "claude", "work", "config"));
  assert.deepEqual(parkedArgv("k", "/cli.js"), [process.execPath, "/cli.js", "host", "parked", "k"]);
});
