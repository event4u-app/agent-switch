import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// daemon.ts derives module-level constants from ROOT (AGENT_SWITCH_HOME) at load
// time — set it before importing, mirroring daemon.test.ts.
process.env.AGENT_SWITCH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "asw-daemon-requests-"));
const { runRequestsOnce } = await import("../src/daemon.js");
const { RequestStore } = await import("../src/link/requests.js");

const T0 = Date.parse("2026-11-06T12:00:00Z");

function approvedNow(session: string) {
  const store = new RequestStore(fs.mkdtempSync(path.join(os.tmpdir(), "asw-dreq-")), () => T0);
  const { request } = store.raise({
    account: "claude/work",
    session,
    reason: { window: "five_hour", fill: 93, resetsAt: null },
    raisedBy: "ac",
    candidates: [{ target: "claude/b", provider: "claude", fill: 10, resetsAt: null, how: ["after-turn", "now"] }],
  });
  store.decide(request.id, { kind: "approve", target: "claude/b", how: "now", by: "as-gui" });
  return store;
}

/** A fake host: which sessions it holds, and what was typed into them. */
function fakeHost(windows: string[]) {
  const typed: string[] = [];
  return {
    typed,
    ctx: { busy: () => false, hosted: (k: string) => windows.includes(k) },
    carryOn: (k: string): true | string => (windows.includes(k) ? (typed.push(k), true) : `${k} is not hosted`),
  };
}

test("the service rebinds a hosted session now, then types the continuation into its window", () => {
  const store = approvedNow("claude/work/sid-1");
  const host = fakeHost(["claude/work/sid-1"]);
  const calls: string[][] = [];
  const notes: { kind: string; message: string }[] = [];
  const done = runRequestsOnce({
    store,
    run: (argv) => (calls.push(argv), { status: 0, stdout: "now serves b's account\n", stderr: "" }),
    ctx: host.ctx,
    carryOn: host.carryOn,
    notify: (n) => notes.push(n),
    log: () => {},
  });
  assert.deepEqual(calls, [["rebind", "b", "--profile", "work"]]);
  assert.deepEqual(host.typed, ["claude/work/sid-1"]);
  assert.equal(done[0].state, "done");
  assert.equal(notes[0].kind, "success");
  assert.match(notes[0].message, /carries on by itself/);
});

test("a session the host does not hold is not typed into; the notice says to type once", () => {
  const store = approvedNow("claude/work/sid-9");
  const host = fakeHost(["claude/work/sid-1"]);
  const notes: { kind: string; message: string }[] = [];
  runRequestsOnce({ store, run: () => ({ status: 0, stdout: "ok\n", stderr: "" }), ctx: host.ctx, carryOn: host.carryOn, notify: (n) => notes.push(n), log: () => {} });
  assert.deepEqual(host.typed, []);
  assert.doesNotMatch(notes[0].message, /carries on/);
});
