import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

process.env.AGENT_SWITCH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "asw-quiet-"));
const Q = await import("../src/quiet-hours.js");
const D = await import("../src/daemon.js");
const NF = await import("../src/notifications.js");

/** A local wall-clock time today. */
const at = (h: number, m = 0) => new Date(2026, 10, 23, h, m);

test("parseQuietHours: HH:MM-HH:MM, anything else is no window", () => {
  assert.deepEqual(Q.parseQuietHours("22:00-07:00"), { start: 22 * 60, end: 7 * 60 });
  assert.deepEqual(Q.parseQuietHours("09:30-12:15"), { start: 9 * 60 + 30, end: 12 * 60 + 15 });
  for (const bad of ["", "22-07", "24:00-07:00", "22:60-07:00", "07:00-07:00", "x", null, 5, undefined]) assert.equal(Q.parseQuietHours(bad), null, String(bad));
  assert.equal(Q.formatQuietHours({ start: 22 * 60, end: 7 * 60 }), "22:00-07:00");
});

test("inQuietHours: a window inside one day — start inclusive, end exclusive", () => {
  const w = Q.parseQuietHours("09:30-12:15");
  assert.equal(Q.inQuietHours(w, at(9, 29)), false);
  assert.equal(Q.inQuietHours(w, at(9, 30)), true);
  assert.equal(Q.inQuietHours(w, at(12, 14)), true);
  assert.equal(Q.inQuietHours(w, at(12, 15)), false);
});

test("inQuietHours: a window that crosses midnight holds both sides of it", () => {
  const w = Q.parseQuietHours("22:00-07:00");
  for (const [h, m, quiet] of [[21, 59, false], [22, 0, true], [23, 59, true], [0, 0, true], [3, 0, true], [6, 59, true], [7, 0, false], [12, 0, false]] as const) {
    assert.equal(Q.inQuietHours(w, at(h, m)), quiet, `${h}:${m}`);
  }
  assert.equal(Q.inQuietHours(null, at(23)), false, "no window → never quiet");
});

test("daemon notice inside quiet hours is recorded in the in-app list but not sent to the OS", () => {
  let sent = 0;
  const deps = { osOn: () => true, quiet: () => Q.parseQuietHours("22:00-07:00"), os: () => (sent++, true) };
  D.notify({ kind: "warning", title: "Near limit", message: "work at 92%" }, {}, { ...deps, now: () => at(23, 30) });
  const list = NF.readNotifications();
  assert.equal(list.at(-1)?.title, "Near limit");
  assert.equal(list.at(-1)?.osNotified, undefined, "not marked as shown: the app may still list it, never pop it on the desktop");
  assert.equal(sent, 0);
  D.notify({ kind: "warning", title: "Near limit", message: "lab at 93%" }, {}, { ...deps, now: () => at(8, 0) });
  assert.equal(sent, 1, "outside the window it is sent");
  assert.equal(NF.readNotifications().at(-1)?.osNotified, true);
});

const CLI = (() => {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const c = path.join(dir, "dist", "index.js");
    if (fs.existsSync(c)) return c;
    dir = path.dirname(dir);
  }
  throw new Error("dist/index.js not found");
})();

test("quiet-hours: set, read back, refuse a bad window, turn off", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-quiet-cli-"));
  const run = (...args: string[]) => execFileSync("node", [CLI, "quiet-hours", ...args], { env: { ...process.env, AGENT_SWITCH_HOME: home }, encoding: "utf8" });
  try {
    assert.deepEqual(JSON.parse(run("status", "--json")), { window: null });
    run("22:00-07:00");
    assert.deepEqual(JSON.parse(run("--json")), { window: "22:00-07:00" });
    assert.throws(() => run("25:00-07:00"), /HH:MM-HH:MM/);
    assert.deepEqual(JSON.parse(run("--json")), { window: "22:00-07:00" }, "a refused value changes nothing");
    run("off");
    assert.deepEqual(JSON.parse(run("--json")), { window: null });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("the GUI's quiet-hours helpers are the CLI's, byte for byte", () => {
  const read = (rel: string) => {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 6; i++) {
      const c = path.join(dir, rel);
      if (fs.existsSync(c)) return fs.readFileSync(c, "utf8");
      dir = path.dirname(dir);
    }
    throw new Error(`not found: ${rel}`);
  };
  const body = (src: string) => src.slice(src.indexOf("export interface QuietHours"));
  assert.equal(body(read(path.join("gui", "src", "quiet-hours.ts"))), body(read(path.join("src", "quiet-hours.ts"))), "gui/src/quiet-hours.ts drifted from src/quiet-hours.ts");
});
