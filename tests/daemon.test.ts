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

// D3: the daemon never redeems a Codex reset credit on its own — it only says
// one is available, once per reset cycle.
test("D3: daemon source never calls the Codex redeem endpoint", () => {
  const src = fs.readFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../src/daemon.ts"), "utf8");
  assert.doesNotMatch(src, /redeemResetCredit/, "the daemon must not import or call the redeem path");
});

test("D3: codexResetNotice fires once per cycle, only over the threshold with a credit", () => {
  const snap = (util: number, credits: number | null, resetsAt = "2026-11-01T00:00:00Z") => ({
    windows: [{ key: "primary", label: "5h", utilization: util, resetsAt }],
    routines: null,
    capturedAt: "2026-10-28T00:00:00Z",
    resetCredits: credits,
  });
  const n = D.codexResetNotice("work", snap(97, 2), 95, undefined);
  assert.ok(n);
  assert.match(n!.message, /Nothing was redeemed/);
  assert.match(n!.message, /agent-switch reset work --provider codex/);
  assert.equal(D.codexResetNotice("work", snap(97, 2), 95, n!.cycle), null, "same cycle → silent");
  assert.ok(D.codexResetNotice("work", snap(97, 2, "2026-11-02T00:00:00Z"), 95, n!.cycle), "new cycle → notify again");
  assert.equal(D.codexResetNotice("work", snap(90, 2), 95, undefined), null, "under threshold");
  assert.equal(D.codexResetNotice("work", snap(99, 0), 95, undefined), null, "no credit");
  assert.equal(D.codexResetNotice("work", snap(99, null), 95, undefined), null, "credit unknown");
});
