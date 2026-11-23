import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// In-process: profiles.ts reads AGENT_SWITCH_HOME once at load, so set it before the import.
const ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "asw-waitcmd-")));
process.env.AGENT_SWITCH_HOME = ROOT;
fs.writeFileSync(path.join(ROOT, ".layout-v2"), "2\n");
const { cmdProtection } = await import("../src/commands/usage.js");
const { autoContinueState } = await import("../src/protection.js");

const WIN = process.platform === "win32";
const cfg = (n: string) => path.join(ROOT, "claude", n, "config");

// a and b share one settings.json by link (not on win32), c has its own, d has none yet.
for (const n of ["a", "b", "c", "d"]) fs.mkdirSync(cfg(n), { recursive: true });
const SHARED = path.join(ROOT, "shared", "settings.json");
fs.mkdirSync(path.dirname(SHARED), { recursive: true });
fs.writeFileSync(SHARED, JSON.stringify({ theme: "dark" }));
if (!WIN) {
  fs.symlinkSync(SHARED, path.join(cfg("a"), "settings.json"));
  fs.symlinkSync(SHARED, path.join(cfg("b"), "settings.json"));
}
fs.writeFileSync(path.join(cfg("c"), "settings.json"), JSON.stringify({ autoContinueAtUsageLimit: false }));

function capture(fn: () => void): { out: string; code: number | undefined } {
  const lines: string[] = [];
  const log = console.log;
  console.log = (...a: unknown[]) => void lines.push(a.join(" "));
  const before = process.exitCode;
  process.exitCode = undefined;
  try {
    fn();
    return { out: lines.join("\n"), code: process.exitCode as number | undefined };
  } finally {
    console.log = log;
    process.exitCode = before;
  }
}

test("protection wait --all previews without writing, as text and as JSON", () => {
  const text = capture(() => cmdProtection("wait", ["on"], { all: true }));
  assert.equal(text.code, undefined);
  assert.match(text.out, /protection wait on --all would write \d settings files?:/);
  assert.match(text.out, /Nothing written\. Run again with --yes/);
  if (!WIN) assert.match(text.out, /claude\/a, claude\/b \(shared\)/);
  assert.equal(autoContinueState(cfg("c")), "off");
  assert.equal(autoContinueState(cfg("d")), "default");

  const json = JSON.parse(capture(() => cmdProtection("wait", ["on"], { all: true, json: true })).out);
  assert.equal(json.state, "on");
  assert.equal(json.written, false);
  const c = json.targets.find((t: any) => t.profiles.includes("claude/c"));
  assert.equal(c.before, "off");
});

test("protection wait --all --yes writes every settings file once and keeps a shared link", () => {
  const r = capture(() => cmdProtection("wait", ["on"], { all: true, yes: true }));
  assert.equal(r.code, undefined);
  assert.match(r.out, /Claude auto-continue on for every Claude profile \(\d settings files?\)/);
  for (const n of ["a", "b", "c", "d"]) assert.equal(autoContinueState(cfg(n)), "on");
  if (!WIN) {
    assert.ok(fs.lstatSync(path.join(cfg("a"), "settings.json")).isSymbolicLink());
    assert.equal(JSON.parse(fs.readFileSync(SHARED, "utf8")).theme, "dark");
  }
  const back = JSON.parse(capture(() => cmdProtection("wait", ["default"], { all: true, yes: true, json: true })).out);
  assert.equal(back.written, true);
  assert.ok(back.targets.every((t: any) => t.ok === true && t.before === "on"));
  assert.equal(autoContinueState(cfg("c")), "default");
});

test("protection wait --all --yes reports a file it could not write and sets exit code 1", { skip: WIN || process.getuid?.() === 0 ? "read-only modes differ on win32 / as root" : false }, () => {
  fs.chmodSync(path.join(cfg("c"), "settings.json"), 0o444);
  try {
    const r = capture(() => cmdProtection("wait", ["off"], { all: true, yes: true }));
    assert.equal(r.code, 1);
    assert.match(r.out, /FAILED .*claude\/c/);
    assert.match(r.out, /1 of \d settings files were not written\./);
    assert.equal(autoContinueState(cfg("d")), "off");
    assert.equal(autoContinueState(cfg("c")), "default", "the unwritable one is unchanged");

    const json = capture(() => cmdProtection("wait", ["on"], { all: true, yes: true, json: true }));
    assert.equal(json.code, 1);
    const c = JSON.parse(json.out).targets.find((t: any) => t.profiles.includes("claude/c"));
    assert.equal(c.ok, false);
    assert.match(c.error, /EACCES|permission/i);
  } finally {
    fs.chmodSync(path.join(cfg("c"), "settings.json"), 0o644);
  }
});

test("protection status lists every profile with what Claude does at the limit, as text and JSON", () => {
  const text = capture(() => cmdProtection(undefined, [], {})).out;
  assert.match(text, /claude\/c\s+on\s+at \d+%/);
  assert.match(text, /protection wait on\|off <claude\/name>/);
  const rows = JSON.parse(capture(() => cmdProtection("status", [], { json: true })).out);
  assert.deepEqual(rows.map((r: any) => r.profile).sort(), ["claude/a", "claude/b", "claude/c", "claude/d"]);
  assert.ok(rows.every((r: any) => typeof r.hostWaits === "string"));
});

test("protection wait for one profile names every profile sharing its settings.json", () => {
  const on = capture(() => cmdProtection("wait", ["on", "claude/a"], {})).out;
  assert.match(on, WIN ? /Claude auto-continue on for claude\/a\./ : /Claude auto-continue on for claude\/a, claude\/b \(shared settings\.json\)\./);
  assert.match(on, /waits for the reset and continues by itself/);
  assert.match(capture(() => cmdProtection("wait", ["off", "claude/d"], {})).out, /offers the wait as a choice/);
  assert.equal(autoContinueState(cfg("d")), "off");
  const json = JSON.parse(capture(() => cmdProtection("wait", ["default", "claude/d"], { json: true })).out);
  assert.deepEqual([json.profile, json.hostWaits, json.affected], ["claude/d", "default", ["claude/d"]]);
  assert.match(capture(() => cmdProtection("wait", ["default", "claude/c"], {})).out, /back to Claude Code's default for claude\/c/);
});
