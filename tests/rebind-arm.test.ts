import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { LiveSession } from "../src/api.js";
import {
  ARM_TTL_MS,
  ArmRefused,
  armForSession,
  armRebind,
  armsFile,
  cancelArms,
  isIdleEdge,
  readArms,
  watchArmsOnce,
  type ArmWatchDeps,
} from "../src/rebind-arm.js";
import { RebindRefused } from "../src/rebind.js";

const T0 = Date.parse("2026-11-01T10:00:00.000Z");

function file(): string {
  return armsFile(fs.mkdtempSync(path.join(os.tmpdir(), "asw-arm-")));
}

function reg(sessionId: string | null, status: string | null, pid = 4242): LiveSession {
  return { pid, sessionId, status, statusUpdatedAt: null };
}

// ---------- arm / cancel / expiry ----------

test("arm records profile, target, the session, creation time and a 30-minute expiry", () => {
  const f = file();
  const arm = armRebind({ profile: "work", target: "side", live: [reg("s-1", "busy")], now: T0 }, f);
  assert.equal(arm.profile, "work");
  assert.equal(arm.target, "side");
  assert.equal(arm.sessionId, "s-1");
  assert.equal(arm.lastStatus, "busy");
  assert.equal(arm.createdAt, new Date(T0).toISOString());
  assert.equal(Date.parse(arm.expiresAt) - T0, ARM_TTL_MS);
  assert.equal(ARM_TTL_MS, 30 * 60_000);
  assert.deepEqual(readArms(f, T0 + 1000).work, arm);
  assert.equal(armForSession(readArms(f, T0), "work", "s-1")?.target, "side");
  assert.equal(armForSession(readArms(f, T0), "work", "other"), null);
});

test("a second arm on the same profile replaces the first; other profiles keep theirs", () => {
  const f = file();
  armRebind({ profile: "work", target: "side", live: [reg("s-1", "busy")], now: T0 }, f);
  armRebind({ profile: "home", target: "side", live: [reg("h-1", "idle")], now: T0 }, f);
  armRebind({ profile: "work", target: "third", live: [reg("s-1", "busy")], now: T0 }, f);
  const arms = readArms(f, T0);
  assert.equal(arms.work.target, "third");
  assert.equal(arms.home.target, "side");
});

test("cancel removes one profile's arm, or every arm without a profile", () => {
  const f = file();
  armRebind({ profile: "work", target: "side", live: [reg("s-1", "busy")], now: T0 }, f);
  armRebind({ profile: "home", target: "side", live: [reg("h-1", "busy")], now: T0 }, f);
  assert.deepEqual(cancelArms("work", f, T0).map((a) => a.profile), ["work"]);
  assert.deepEqual(Object.keys(readArms(f, T0)), ["home"]);
  assert.deepEqual(cancelArms("nobody", f, T0), []);
  assert.deepEqual(cancelArms(undefined, f, T0).map((a) => a.profile), ["home"]);
  assert.deepEqual(readArms(f, T0), {});
});

test("an expired arm is ignored by readers and cleaned, never reported as cancelled", () => {
  const f = file();
  armRebind({ profile: "work", target: "side", live: [reg("s-1", "busy")], now: T0 }, f);
  const later = T0 + ARM_TTL_MS;
  assert.deepEqual(readArms(f, later), {}, "expired at exactly 30 minutes");
  assert.deepEqual(cancelArms(undefined, f, later), [], "an expired arm is not a cancelled one");
  assert.match(fs.readFileSync(f, "utf8"), /"arms": \{\}/, "the expired arm was removed from disk");
});

test("arming is refused for a session without registry state (liveSource cwd)", () => {
  const f = file();
  assert.throws(() => armRebind({ profile: "work", target: "side", live: [reg(null, null)], now: T0 }, f), (e: unknown) => e instanceof ArmRefused && /liveSource "cwd"/.test(e.message));
  assert.throws(() => armRebind({ profile: "work", target: "side", live: [reg(null, null)], sessionId: "s-1", now: T0 }, f), /liveSource "cwd"/);
  assert.throws(() => armRebind({ profile: "work", target: "side", live: [reg("s-1", null)], now: T0 }, f), ArmRefused, "an id without a state word has no edge either");
  assert.throws(() => armRebind({ profile: "work", target: "side", live: [], now: T0 }, f), /no running session/);
  assert.throws(() => armRebind({ profile: "work", target: "work", live: [reg("s-1", "busy")], now: T0 }, f), /already runs on its own account/);
  assert.equal(fs.existsSync(f), false, "a refusal writes nothing");
});

test("several watchable sessions need --session; with it the named one is armed", () => {
  const f = file();
  const live = [reg("s-1", "busy", 1), reg("s-2", "idle", 2)];
  assert.throws(() => armRebind({ profile: "work", target: "side", live, now: T0 }, f), /--session/);
  const arm = armRebind({ profile: "work", target: "side", live, sessionId: "s-2", now: T0 }, f);
  assert.equal(arm.sessionId, "s-2");
  assert.equal(arm.lastStatus, "idle");
});

// ---------- the daemon at the idle edge ----------

function watcher(f: string, script: (string | null)[], over: Partial<ArmWatchDeps> = {}) {
  const calls: { account: string; profile: string }[] = [];
  const notes: { kind: string; title: string; message: string }[] = [];
  let tick = 0;
  let now = T0;
  const deps: ArmWatchDeps = {
    file: f,
    liveSessions: () => {
      const st = script[Math.min(tick, script.length - 1)];
      return st === undefined ? [] : [reg("s-1", st)];
    },
    rebind: async (o) => {
      calls.push(o);
      return { uxNote: "ok" };
    },
    notify: (e) => notes.push(e),
    activity: () => {},
    log: () => {},
    now: () => now,
    ...over,
  };
  return {
    deps,
    calls,
    notes,
    step: async () => {
      const r = await watchArmsOnce(deps);
      tick++;
      now += 2000;
      return r;
    },
  };
}

test("scripted registry busy, busy, idle → rebind runs once, at the edge", async () => {
  const f = file();
  armRebind({ profile: "work", target: "side", live: [reg("s-1", "busy")], now: T0 }, f);
  const w = watcher(f, ["busy", "busy", "idle", "busy", "idle"]);
  assert.deepEqual(await w.step(), []);
  assert.deepEqual(await w.step(), []);
  assert.equal(w.calls.length, 0, "no switch while the turn runs");
  assert.deepEqual(await w.step(), ["work"]);
  assert.deepEqual(w.calls, [{ account: "side", profile: "work" }]);
  assert.deepEqual(readArms(f, T0), {}, "the arm is consumed");
  await w.step();
  await w.step();
  assert.equal(w.calls.length, 1, "at most once per arm — a later edge does nothing");
  assert.equal(w.notes.filter((n) => n.kind === "success").length, 1);
});

test("an arm made while idle waits for a whole turn: idle, busy, idle", async () => {
  const f = file();
  armRebind({ profile: "work", target: "side", live: [reg("s-1", "idle")], now: T0 }, f);
  const w = watcher(f, ["idle", "busy", "idle"]);
  await w.step();
  assert.equal(w.calls.length, 0, "idle at arm time is not an edge");
  await w.step();
  await w.step();
  assert.equal(w.calls.length, 1);
});

test("never for a session without registry state: nothing to arm, nothing runs", async () => {
  const f = file();
  assert.throws(() => armRebind({ profile: "work", target: "side", live: [reg(null, null)], now: T0 }, f), ArmRefused);
  const w = watcher(f, ["busy", "idle"]);
  await w.step();
  await w.step();
  assert.equal(w.calls.length, 0, "no arm → rebind never runs");
});

test("a guard refusal drops the arm and tells the user why", async () => {
  const f = file();
  armRebind({ profile: "work", target: "side", live: [reg("s-1", "busy")], now: T0 }, f);
  const w = watcher(f, ["busy", "idle", "busy", "idle"], {
    rebind: async () => {
      throw new RebindRefused('"side" shares the default login — refusing.');
    },
  });
  await w.step();
  await w.step();
  assert.deepEqual(readArms(f, T0), {}, "the arm is gone");
  const warn = w.notes.find((n) => n.kind === "warning");
  assert.ok(warn, "the user is notified");
  assert.match(warn!.message, /shares the default login/);
  assert.match(warn!.message, /stays on its account/);
  await w.step();
  await w.step();
  assert.equal(w.notes.filter((n) => n.kind === "warning").length, 1, "dropped means it does not retry");
});

test("the watcher cleans an expired arm and drops one whose session ended, without switching", async () => {
  const f = file();
  armRebind({ profile: "work", target: "side", live: [reg("s-1", "busy")], now: T0 }, f);
  const expiredW = watcher(f, ["busy"], { now: () => T0 + ARM_TTL_MS + 1 });
  await watchArmsOnce(expiredW.deps);
  assert.match(fs.readFileSync(f, "utf8"), /"arms": \{\}/);

  const f2 = file();
  armRebind({ profile: "work", target: "side", live: [reg("s-1", "busy")], now: T0 }, f2);
  const gone = watcher(f2, [], { liveSessions: () => [] });
  await gone.step();
  assert.equal(gone.calls.length, 0);
  assert.deepEqual(readArms(f2, T0), {});
  assert.match(gone.notes[0].message, /nothing switched/);
});

test("isIdleEdge is exactly busy → idle", () => {
  assert.equal(isIdleEdge("busy", "idle"), true);
  assert.equal(isIdleEdge("idle", "idle"), false);
  assert.equal(isIdleEdge(null, "idle"), false);
  assert.equal(isIdleEdge("busy", "busy"), false);
  assert.equal(isIdleEdge("busy", null), false);
});
