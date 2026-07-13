import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

process.env.AGENT_SWITCH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "asw-daemon-"));
const D = await import("../src/daemon.js");

function tmp(name: string): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "asw-d-")), name);
}

test("daemon state round-trips and reports freshness against its poll interval", () => {
  const f = tmp("state.json");
  const state = { lastPoll: "2026-07-13T12:00:00.000Z", pollIntervalMs: 60_000, profiles: {}, lastError: null };
  D.writeDaemonState(state, f);
  assert.deepEqual(D.readDaemonState(f), state);

  const now = Date.parse("2026-07-13T12:00:30.000Z"); // 30s later, interval 60s → fresh
  assert.equal(D.isFresh(state, state.pollIntervalMs, now), true);
  const later = Date.parse("2026-07-13T12:02:00.000Z"); // 120s later → stale
  assert.equal(D.isFresh(state, state.pollIntervalMs, later), false);
  assert.equal(D.isFresh(null, 60_000, now), false);
});

test("single-instance: acquire when free, refuse when a live pid holds it, take over a stale pidfile", () => {
  const f = tmp("daemon.pid");
  // free → acquire
  assert.equal(D.acquireSingleInstance(process.pid, f), true);
  assert.equal(D.readPid(f), process.pid);

  // a live OTHER pid holds it → refuse
  fs.writeFileSync(f, String(process.pid) + "\n");
  assert.equal(D.acquireSingleInstance(999_999_999, f), false); // caller isn't the holder, holder is alive

  // stale pid (not alive) → take over
  fs.writeFileSync(f, "2147483646\n"); // implausible, not running
  assert.equal(D.acquireSingleInstance(process.pid, f), true);
  assert.equal(D.readPid(f), process.pid);
});

test("selectPollTargets = active + live-session profiles, never idle ones", () => {
  const names = ["work", "privat", "client"];
  const live = new Set(["client"]);
  const targets = D.selectPollTargets(names, "work", (n) => live.has(n));
  assert.deepEqual(targets.sort(), ["client", "work"]); // active + live, not idle "privat"
  // no active set → only live ones
  assert.deepEqual(D.selectPollTargets(names, null, (n) => live.has(n)), ["client"]);
});

test("nextIntervalMs floors at the minimum and backs off exponentially, capped", () => {
  assert.equal(D.nextIntervalMs(60_000, 0), 60_000); // no failures → base
  assert.equal(D.nextIntervalMs(30_000, 0), D.MIN_INTERVAL_MS); // base floored to the minimum
  assert.equal(D.nextIntervalMs(60_000, 1), 120_000);
  assert.equal(D.nextIntervalMs(60_000, 2), 240_000);
  assert.equal(D.nextIntervalMs(60_000, 100), D.MAX_BACKOFF_MS); // capped
});
