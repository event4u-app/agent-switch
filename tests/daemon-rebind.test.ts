import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type { UsageSnapshot } from "../src/usage.js";

// daemon.ts derives module-level constants from ROOT (AGENT_SWITCH_HOME) at load
// time — set it before importing, mirroring daemon.test.ts.
process.env.AGENT_SWITCH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "asw-daemon-rebind-"));
const { decideThresholdAction, startArmWatcher } = await import("../src/daemon.js");
const { armRebind, armsFile } = await import("../src/rebind-arm.js");

const AUTO = { enabled: true, threshold: 80 };

/** A one-window snapshot whose max utilization is `util`. */
function snap(util: number): UsageSnapshot {
  return {
    windows: [{ key: "five_hour", label: "5h", utilization: util, resetsAt: null }],
    routines: null,
    capturedAt: "2026-07-24T00:00:00.000Z",
  };
}

// The whole roadmap is locked around the compliance invariant: the daemon may
// NOTIFY and SUGGEST when the active profile crosses its usage threshold, but it
// NEVER switches automatically. These lock that behavior in place.

test("threshold crossed → daemon NOTIFIES and SUGGESTS the account with headroom (never switches)", () => {
  const action = decideThresholdAction(
    "work",
    [
      { name: "work", snapshot: snap(95) }, // active, out of headroom
      { name: "privat", snapshot: snap(20) }, // most headroom
    ],
    AUTO,
  );
  assert.equal(action.notify, true, "over threshold with a headroom candidate → notify");
  assert.equal(action.suggestedTarget, "privat", "suggests the account with the most headroom");
  // Compliance lock: the action can ONLY carry notify + a suggestion — there is
  // no switch / setActive field the daemon could act on automatically.
  assert.deepEqual(Object.keys(action).sort(), ["notify", "suggestedTarget"], "no switch action — only notify + suggestion");
});

test("active profile still has headroom → no notify, no suggestion", () => {
  const action = decideThresholdAction(
    "work",
    [
      { name: "work", snapshot: snap(50) },
      { name: "privat", snapshot: snap(20) },
    ],
    AUTO,
  );
  assert.deepEqual(action, { notify: false, suggestedTarget: null });
});

test("auto-switch disabled → no notify even when the active profile is over threshold", () => {
  const action = decideThresholdAction(
    "work",
    [
      { name: "work", snapshot: snap(99) },
      { name: "privat", snapshot: snap(5) },
    ],
    { enabled: false, threshold: 80 },
  );
  assert.deepEqual(action, { notify: false, suggestedTarget: null });
});

test("over threshold but no candidate has headroom → notify stays off (nothing to suggest)", () => {
  const action = decideThresholdAction(
    "work",
    [
      { name: "work", snapshot: snap(95) },
      { name: "privat", snapshot: snap(96) }, // also maxed → not a target
    ],
    AUTO,
  );
  assert.deepEqual(action, { notify: false, suggestedTarget: null });
});

test("the daemon threshold path contains NO setActive call (never auto-switches)", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, "../../src/daemon.ts"), "utf8");
  assert.ok(!/setActive\s*\(/.test(src), "daemon.ts must never call setActive() — switching is always a user interaction");
});

// D3 "switch when this turn ends": the daemon's own timer drives the arm watch.
// A scripted registry busy, busy, idle → rebind exactly once, at the edge.
test("daemon arm watcher: registry busy, busy, idle → rebind once at the edge", async () => {
  const file = armsFile(fs.mkdtempSync(path.join(os.tmpdir(), "asw-daemon-arm-")));
  armRebind({ profile: "work", target: "side", live: [{ pid: 1, sessionId: "s-1", status: "busy", statusUpdatedAt: null }] }, file);
  const script = ["busy", "busy", "idle", "busy", "idle"];
  let reads = 0;
  const calls: string[] = [];
  const stop = startArmWatcher(
    {
      file,
      liveSessions: () => [{ pid: 1, sessionId: "s-1", status: script[Math.min(reads++, script.length - 1)], statusUpdatedAt: null }],
      rebind: async (o) => {
        calls.push(`${o.profile}->${o.account}@read${reads}`);
        return { uxNote: "" };
      },
      notify: () => {},
      activity: () => {},
      log: () => {},
    },
    5,
  );
  const deadline = Date.now() + 2000;
  while (calls.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 5));
  await new Promise((r) => setTimeout(r, 60)); // more ticks: a consumed arm never runs again
  stop();
  assert.deepEqual(calls, ["work->side@read3"], "one switch, on the third read (the first idle)");
});
