import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

// The same behaviour as the src tests, run against the SHIPPED build (dist/), in
// process: what users install is what is checked here.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(HERE, "../../dist");
const FIX = path.resolve(HERE, "../../tests/fixtures");
const built = fs.existsSync(path.join(DIST, "index.js"));
const gate = { skip: built ? false : "run `npm run build` first (dist/index.js missing)" };
const WIN = process.platform === "win32";

// profiles.js reads AGENT_SWITCH_HOME once at load: set it before any dist import.
const ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "asw-built-")));
process.env.AGENT_SWITCH_HOME = ROOT;
fs.writeFileSync(path.join(ROOT, ".layout-v2"), "2\n");

const load = async (rel: string): Promise<any> => (built ? import(pathToFileURL(path.join(DIST, rel)).href) : {});
const SL = await load("statusline.js");
const SLCMD = await load("commands/statusline.js");
const PS = await load("program-status.js");
const RS = await load("runtime-state.js");
const U = await load("usage.js");
const PROT = await load("protection.js");
const UCMD = await load("commands/usage.js");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "asw-built-t-"));
const fixture = (n: string) => fs.readFileSync(path.join(FIX, n));
const CMD = "/opt/bin/agent-switch __statusline";

function capture<T>(fn: () => T): { out: string; code: number | undefined; value: T } {
  const lines: string[] = [];
  const log = console.log;
  console.log = (...a: unknown[]) => void lines.push(a.join(" "));
  const before = process.exitCode;
  process.exitCode = undefined;
  try {
    const value = fn();
    return { out: lines.join("\n"), code: process.exitCode as number | undefined, value };
  } finally {
    console.log = log;
    process.exitCode = before;
  }
}

function claudeProfile(name: string, settings?: unknown): string {
  const cfg = path.join(ROOT, "claude", name, "config");
  fs.mkdirSync(cfg, { recursive: true });
  if (settings !== undefined) fs.writeFileSync(path.join(cfg, "settings.json"), typeof settings === "string" ? settings : JSON.stringify(settings));
  return cfg;
}

test("dist/usage.js parses the captured statusLine payload; the free tier gives null", gate, () => {
  const s = U.parseStatuslineUsage(JSON.parse(fixture("statusline-stdin.json").toString()), "2026-11-23T12:00:00.000Z");
  assert.deepEqual(s.windows.map((w: any) => [w.key, w.utilization, w.resetsAt]), [
    ["five_hour", 7, new Date(1795414200 * 1000).toISOString()],
    ["seven_day", 3, new Date(1795806000 * 1000).toISOString()],
  ]);
  assert.equal(U.parseStatuslineUsage(JSON.parse(fixture("statusline-stdin-freetier.json").toString())), null);
});

test("dist/statusline.js monotone merge keeps the retained reading's own time", gate, () => {
  const R = "2026-11-23T15:00:00.000Z";
  const snap = (u: number, at: string, weekly = true) => ({
    windows: [{ key: "five_hour", label: "5h", utilization: u, resetsAt: R }, ...(weekly ? [{ key: "seven_day", label: "7d", utilization: 10, resetsAt: "2026-11-28T00:00:00.000Z" }] : [])],
    routines: null,
    capturedAt: at,
  });
  const m = SL.mergeMonotone(snap(60, "2026-11-23T12:00:00.000Z"), snap(40, "2026-11-23T12:01:00.000Z", false));
  assert.deepEqual(m.windows.map((w: any) => [w.key, w.utilization, w.capturedAt]), [
    ["five_hour", 60, "2026-11-23T12:00:00.000Z"],
    ["seven_day", 10, "2026-11-23T12:00:00.000Z"],
  ]);
  assert.equal(m.capturedAt, "2026-11-23T12:00:00.000Z");
});

test("dist/statusline.js install, remove, refusal, and the strict unreadable-file refusal", gate, () => {
  const dir = tmp();
  const cfg = path.join(dir, "config");
  fs.mkdirSync(cfg);
  fs.writeFileSync(path.join(cfg, "settings.json"), JSON.stringify({ model: "opus" }));
  assert.equal(SL.installStatusline(cfg, dir, CMD).changed, true);
  assert.equal(SL.statuslineHealth(cfg, dir), "present");
  assert.equal(SL.uninstallStatusline(cfg, dir).changed, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(cfg, "settings.json"), "utf8")), { model: "opus" });

  fs.writeFileSync(path.join(cfg, "settings.json"), JSON.stringify({ statusLine: { type: "command", command: "/usr/local/bin/other __statusline" } }));
  assert.equal(SL.installStatusline(cfg, dir, CMD).reason, "has-own");

  const broken = '{"theme": "dark", "hooks": {';
  fs.writeFileSync(path.join(cfg, "settings.json"), broken);
  assert.throws(() => SL.installStatusline(cfg, dir, CMD), /nothing was written/);
  assert.equal(fs.readFileSync(path.join(cfg, "settings.json"), "utf8"), broken);
});

test("dist/commands/statusline.js on → status → off in a temp home, own bar left alone", gate, () => {
  const work = claudeProfile("work", { model: "opus" });
  claudeProfile("own", { statusLine: { type: "command", command: "my-bar" } });
  const on = capture(() => SLCMD.cmdStatuslineCli("on"));
  assert.match(on.out, /claude\/own: left alone/);
  assert.match(on.out, /claude\/work: on/);
  assert.match(JSON.parse(fs.readFileSync(path.join(work, "settings.json"), "utf8")).statusLine.command, / __statusline$/);
  assert.match(capture(() => SLCMD.cmdStatuslineCli("status", "work")).out, /claude\/work: on · no sample yet/);
  assert.match(capture(() => SLCMD.cmdStatuslineCli("off", "work")).out, /claude\/work: off/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(work, "settings.json"), "utf8")), { model: "opus" });
  assert.match(capture(() => SLCMD.cmdStatuslineCli("status", "work")).out, /claude\/work: off/);
});

test("dist/usage.js: a fresh sample merges onto the poll's per-model window without a request", gate, async () => {
  const now = Date.now();
  const at = (ago: number) => new Date(now - ago).toISOString();
  const w = (key: string, u: number) => ({ key, label: key, utilization: u, resetsAt: new Date(now + 3_600_000).toISOString() });
  const sl = { windows: [w("five_hour", 20), w("seven_day", 10)], routines: null, capturedAt: at(30_000), source: "statusline" };
  const base = { windows: [w("five_hour", 5), w("seven_day_opus", 95)], routines: null, capturedAt: at(60_000) };
  let calls = 0;
  const poll = async () => (calls++, null);
  const fresh = (s: any) => !!s && now - Date.parse(s.capturedAt) < 300_000;
  const r = await U.resolveClaudeUsage({ statusline: sl, base, now, fresh, pollOnlyMaxAgeMs: 300_000, poll });
  assert.equal(calls, 0);
  assert.deepEqual(r.snapshot.windows.map((x: any) => [x.key, x.utilization, x.source]), [["five_hour", 20, "statusline"], ["seven_day_opus", 95, "poll"], ["seven_day", 10, "statusline"]]);
  const failed = await U.resolveClaudeUsage({ statusline: sl, base: { ...base, capturedAt: at(600_000) }, now, fresh, pollOnlyMaxAgeMs: 300_000, poll });
  assert.equal(calls, 1);
  assert.equal(failed.pollFailed, true);
  assert.equal(failed.snapshot.windows.find((x: any) => x.key === "five_hour").utilization, 20);
  assert.equal(U.mergeUsage(null, base), base);
});

test("dist/program-status.js scans the recorded Codex stream, ignores other apps, matches hosted rows", gate, async () => {
  const file = path.join(tmp(), "s.json");
  const bytes = fixture("codex-osc-7501-stream.bin");
  let t = 1000;
  await PS.runProgramStatus(file, Readable.from([bytes.subarray(0, 37), bytes.subarray(37)]), () => t++);
  assert.equal(PS.readProgramStatus(file).state, "done");
  const other = path.join(tmp(), "o.json");
  await PS.runProgramStatus(other, Readable.from([Buffer.from("\x1b]7501;state=working:app=evil\x07")]), () => 1);
  assert.equal(PS.readProgramStatus(other), null);

  const start = Date.parse("2026-11-23T10:00:00Z");
  const before = { sessionId: "standalone", profile: "work", cwd: "/w", birthtimeMs: start - 2_000 };
  const after = { sessionId: "hosted-own", profile: "work", cwd: "/w", birthtimeMs: start + 3_000 };
  const h = [{ sessionId: "h1", account: "work", cwd: "/w", startedAt: new Date(start).toISOString() }];
  for (const rows of [[before, after], [after, before]]) assert.deepEqual([...PS.matchHostedRows(rows, h).keys()].map((r: any) => r.sessionId), ["hosted-own"]);
});

test("dist/runtime-state.js reads every recorded registry step as expected", gate, () => {
  const NOW = 1_795_396_500_000;
  const { steps } = JSON.parse(fixture("registry-status-2.1.316.json").toString());
  assert.ok(steps.length >= 10);
  for (const s of steps) {
    const r = RS.runtimeState({ live: true, hostStatus: s.status, hostStatusAt: NOW - s.statusAgeS * 1000, mtimeMs: NOW - s.transcriptAgeS * 1000 }, NOW);
    assert.equal(r?.state, s.expect, s.situation);
    assert.equal(r?.source, "host", s.situation);
  }
});

test("dist/protection.js + dist/commands/usage.js: wait --all previews, then writes each settings file once", { skip: gate.skip || (WIN ? "file symlinks and read-only modes differ on win32" : false) }, () => {
  const shared = path.join(ROOT, "shared-wait", "settings.json");
  fs.mkdirSync(path.dirname(shared), { recursive: true });
  fs.writeFileSync(shared, JSON.stringify({ theme: "dark" }));
  for (const n of ["wa", "wb"]) fs.symlinkSync(shared, path.join(claudeProfile(n), "settings.json"));
  const names = fs.readdirSync(path.join(ROOT, "claude"));
  const targets = PROT.waitTargets(names.map((name) => ({ name, configDir: path.join(ROOT, "claude", name, "config") })));
  assert.deepEqual(targets.find((t: any) => t.file === fs.realpathSync(shared))?.profiles, ["wa", "wb"]);

  const preview = capture(() => UCMD.cmdProtection("wait", ["on"], { all: true }));
  assert.match(preview.out, /Nothing written/);
  assert.equal(PROT.autoContinueState(path.join(ROOT, "claude", "wa", "config")), "default");
  const done = capture(() => UCMD.cmdProtection("wait", ["on"], { all: true, yes: true }));
  assert.equal(done.code, undefined, done.out);
  assert.equal(PROT.autoContinueState(path.join(ROOT, "claude", "wb", "config")), "on");
  assert.ok(fs.lstatSync(path.join(ROOT, "claude", "wa", "config", "settings.json")).isSymbolicLink());
  assert.equal(JSON.parse(fs.readFileSync(shared, "utf8")).theme, "dark");
  const back = PROT.applyWait(PROT.waitTargets([{ name: "wa", configDir: path.join(ROOT, "claude", "wa", "config") }]), "default");
  assert.ok(back.every((r: any) => r.ok));
});

// The shipped host: start, respawn, view, capture, end on a private tmux server.
const HOST = await load("host/tmux-host.js");
const tmuxGate = { skip: !built ? gate.skip : WIN || !HOST.TmuxHost?.available() ? "tmux is not available here" : false };

test("built host: start, respawn on another account, view, capture and end a hosted session", tmuxGate, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "asw-built-host-"));
  const out = path.join(root, "out");
  fs.mkdirSync(out);
  const bin = path.join(root, "fake-agent");
  fs.writeFileSync(bin, `#!/bin/sh\necho "args: $*" > "$AS_STUB_OUT/$$.txt"\necho ready\nwhile IFS= read -r line; do echo "got: $line"; done\n`, { mode: 0o755 });
  const socket = `as-built-${process.pid}`;
  const host = new HOST.TmuxHost(root, { socket });
  const until = (pred: () => boolean) => {
    for (const end = Date.now() + 3000; Date.now() < end; ) {
      if (pred()) return true;
      spawnSync("sleep", ["0.05"]);
    }
    return pred();
  };
  try {
    const s = host.start({ provider: "claude", account: "work", configDir: "/cfg/work", cwd: root, bin, env: { AS_STUB_OUT: out } }, "h");
    assert.ok(until(() => fs.readdirSync(out).length === 1), "the program started");
    const moved = host.respawn(s.key, { provider: "claude", account: "side", configDir: "/cfg/side", cwd: root, bin, args: ["--resume", s.sessionId], env: { AS_STUB_OUT: out } }, "h");
    assert.equal(moved.key, `claude/side/${s.sessionId}`);
    assert.equal(moved.window, s.window, "same window");
    assert.deepEqual(host.list().map((r: { key: string }) => r.key), [moved.key]);
    assert.ok(until(() => /ready/.test(host.capture(moved.key) ?? "")), "its screen is readable");
    assert.deepEqual(host.view(moved.key, "app1").slice(-3), ["attach-session", "-t", "=view-app1"]);
    assert.throws(() => host.start({ provider: "x;y", account: "work", configDir: "/cfg", cwd: root, bin }));
    host.end(moved.key);
    assert.ok(until(() => host.list().length === 0), "ended");
  } finally {
    host.killServer();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("built host: a hosted Codex window pipes its output to the status reader, and park keeps the window", tmuxGate, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "asw-built-cx-"));
  const bin = path.join(root, "fake-codex");
  fs.writeFileSync(bin, `#!/bin/sh\nprintf '\\033]7501;state=working:app=codex\\007'\nwhile IFS= read -r line; do echo "got: $line"; done\n`, { mode: 0o755 });
  const host = new HOST.TmuxHost(root, { socket: `as-built-cx-${process.pid}` });
  const cli = `'${process.execPath}' '${path.join(DIST, "index.js")}'`;
  try {
    const s = host.start({ provider: "codex", account: "work", configDir: path.join(root, "cfg"), cwd: root, bin }, cli);
    const file = PS.programStatusFile(root, s.sessionId);
    const end = Date.now() + 5000;
    while (Date.now() < end && !fs.existsSync(file)) spawnSync("sleep", ["0.05"]);
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).state, "working", "the report reached the state file");
    const parked = host.park(s.key, [bin]);
    assert.equal(parked.window, s.window);
    assert.equal(fs.existsSync(file), false, "parking drops the old report");
  } finally {
    host.killServer();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
