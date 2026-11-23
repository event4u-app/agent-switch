import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// In-process: profiles.ts reads AGENT_SWITCH_HOME once at load, so set it before the import.
const ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "asw-slcmd-")));
process.env.AGENT_SWITCH_HOME = ROOT;
fs.writeFileSync(path.join(ROOT, ".layout-v2"), "2\n");
const { cmdStatuslineCli, sampleLine } = await import("../src/commands/statusline.js");
const { markInstalled, writeStatuslineSnapshot } = await import("../src/statusline.js");

const WIN = process.platform === "win32";
const cfg = (n: string) => path.join(ROOT, "claude", n, "config");
const settingsOf = (n: string) => JSON.parse(fs.readFileSync(path.join(cfg(n), "settings.json"), "utf8"));

function profile(n: string, settings?: unknown): void {
  fs.mkdirSync(cfg(n), { recursive: true });
  if (settings !== undefined) fs.writeFileSync(path.join(cfg(n), "settings.json"), JSON.stringify(settings));
}

/** Run a command function and return what it printed (stdout + stderr) and the exit code it set. */
function capture(fn: () => void): { out: string; code: number | undefined } {
  const lines: string[] = [];
  const log = console.log;
  const err = console.error;
  console.log = (...a: unknown[]) => void lines.push(a.join(" "));
  console.error = (...a: unknown[]) => void lines.push(a.join(" "));
  const before = process.exitCode;
  process.exitCode = undefined;
  try {
    fn();
    return { out: lines.join("\n"), code: process.exitCode as number | undefined };
  } finally {
    console.log = log;
    console.error = err;
    process.exitCode = before;
  }
}

test("statusline on → status → off for one fresh profile", () => {
  profile("fresh", { model: "opus" });
  const on = capture(() => cmdStatuslineCli("on", "fresh"));
  assert.equal(on.code, undefined);
  assert.match(on.out, /claude\/fresh: on/);
  assert.match(on.out, /share sync/);
  assert.match(settingsOf("fresh").statusLine.command, / __statusline$/);
  assert.match(capture(() => cmdStatuslineCli("on", "fresh")).out, /claude\/fresh: already on/);
  assert.doesNotMatch(capture(() => cmdStatuslineCli("on", "fresh")).out, /share sync/, "no reminder without a change");

  assert.match(capture(() => cmdStatuslineCli("status", "fresh")).out, /claude\/fresh: on · no sample yet/);
  writeStatuslineSnapshot(path.join(ROOT, "claude", "fresh"), { windows: [{ key: "five_hour", label: "5h", utilization: 5, resetsAt: new Date(Date.now() + 3_600_000).toISOString() }], routines: null, capturedAt: new Date().toISOString() }, "2.9.0");
  const status = capture(() => cmdStatuslineCli(undefined, "fresh")).out;
  assert.match(status, /last sample just now from Claude Code 2\.9\.0/);
  assert.match(status, /newer than 2\.1\.316/);

  const off = capture(() => cmdStatuslineCli("off", "fresh"));
  assert.match(off.out, /claude\/fresh: off/);
  assert.deepEqual(settingsOf("fresh"), { model: "opus" });
  assert.match(capture(() => cmdStatuslineCli("off", "fresh")).out, /claude\/fresh: already off/);
  assert.match(capture(() => cmdStatuslineCli("status", "fresh")).out, /claude\/fresh: off — usage is polled/);
});

test("statusline on leaves a profile with its own statusLine alone; off keeps it too", () => {
  profile("own", { statusLine: { type: "command", command: "my-bar" } });
  assert.match(capture(() => cmdStatuslineCli("on", "own")).out, /claude\/own: left alone — it has a statusLine of its own/);
  assert.match(capture(() => cmdStatuslineCli("off", "own")).out, /claude\/own: left alone — the statusLine there is not Agent Switch's/);
  assert.equal(settingsOf("own").statusLine.command, "my-bar");
});

test("statusline on names every profile one shared settings.json serves", { skip: WIN ? "file symlinks" : false }, () => {
  const shared = path.join(ROOT, "shared-settings.json");
  fs.writeFileSync(shared, "{}");
  for (const n of ["sha", "shb"]) {
    profile(n);
    fs.symlinkSync(shared, path.join(cfg(n), "settings.json"));
  }
  const r = capture(() => cmdStatuslineCli("on", "sha")).out;
  assert.match(r, /claude\/sha, claude\/shb share one settings\.json — this turns it on for all of them/);
  assert.match(r, /claude\/sha: on/);
  assert.match(r, /claude\/shb: already on/);
  assert.ok(fs.lstatSync(path.join(cfg("sha"), "settings.json")).isSymbolicLink());
  assert.match(capture(() => cmdStatuslineCli("off", "shb")).out, /this turns it off for all of them/);
});

test("statusline status: displaced, removed, and a command pointing at a missing binary", () => {
  profile("disp", {});
  capture(() => cmdStatuslineCli("on", "disp"));
  fs.writeFileSync(path.join(cfg("disp"), "settings.json"), JSON.stringify({ statusLine: { type: "command", command: "npx ccstatusline" } }));
  assert.match(capture(() => cmdStatuslineCli("status", "disp")).out, /claude\/disp: displaced/);

  profile("gone", {});
  capture(() => cmdStatuslineCli("on", "gone"));
  fs.writeFileSync(path.join(cfg("gone"), "settings.json"), "{}");
  assert.match(capture(() => cmdStatuslineCli("status", "gone")).out, /claude\/gone: removed/);

  profile("moved", { statusLine: { type: "command", command: "/nowhere/agent-switch __statusline", padding: 0 } });
  markInstalled(path.join(ROOT, "claude", "moved"), "/nowhere/agent-switch __statusline");
  assert.match(capture(() => cmdStatuslineCli("status", "moved")).out, /points at a missing binary \(\/nowhere\/agent-switch\)/);
  assert.match(capture(() => cmdStatuslineCli("on", "moved")).out, /claude\/moved: on \(re-pointed at /);
});

test("statusline status over every profile; sampleLine says when a sample is stale", () => {
  const all = capture(() => cmdStatuslineCli("status")).out;
  for (const n of ["fresh", "own", "disp"]) assert.match(all, new RegExp(`claude/${n}: `));
  profile("old", {});
  writeStatuslineSnapshot(path.join(ROOT, "claude", "old"), { windows: [{ key: "five_hour", label: "5h", utilization: 5, resetsAt: null }], routines: null, capturedAt: new Date(Date.now() - 3 * 3_600_000).toISOString() }, null);
  assert.match(sampleLine("old"), /^last sample 3h ago \(stale/);
  assert.match(sampleLine("old", Date.now() + 3 * 86_400_000), /d ago/);
});
