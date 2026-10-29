import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

process.env.AGENT_SWITCH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "asw-daemon-"));
const D = await import("../src/daemon.js");

function tmp(name: string): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "asw-d-")), name);
}

test("daemon state round-trips", () => {
  const f = tmp("state.json");
  const state = { lastPoll: "2026-07-13T12:00:00.000Z", pollIntervalMs: 60_000, profiles: {}, lastError: null };
  D.writeDaemonState(state, f);
  assert.deepEqual(D.readDaemonState(f), state);
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

test("selectPollTargets also polls pool-targeted members, spaced by POOL_POLL_INTERVAL_MS", () => {
  const names = ["work", "a", "b", "c"];
  const now = Date.parse("2026-10-28T12:00:00Z");
  const last: Record<string, number | null> = { a: now - 60_000, b: now - D.POOL_POLL_INTERVAL_MS, c: null };
  const targets = D.selectPollTargets(names, "work", () => false, false, ["a", "b", "c", "ghost"], (n) => last[n] ?? null, now);
  // a was polled a minute ago → not due; b is due; c was never polled; ghost is not a profile
  assert.deepEqual(targets.sort(), ["b", "c", "work"]);
  // the default (no pools) keeps the old behaviour
  assert.deepEqual(D.selectPollTargets(names, "work", () => false), ["work"]);
  // FRESH_USAGE_MS must outlast the pool cadence, or `dir` would see every member as stale
  assert.ok(D.POOL_POLL_INTERVAL_MS < 10 * 60_000);
});

test("nextIntervalMs floors at the minimum and backs off exponentially, capped", () => {
  assert.equal(D.nextIntervalMs(60_000, 0), 60_000); // no failures → base
  assert.equal(D.nextIntervalMs(30_000, 0), D.MIN_INTERVAL_MS); // base floored to the minimum
  assert.equal(D.nextIntervalMs(60_000, 1), 120_000);
  assert.equal(D.nextIntervalMs(60_000, 2), 240_000);
  assert.equal(D.nextIntervalMs(60_000, 100), D.MAX_BACKOFF_MS); // capped
});

test("a failing profile backs off on its own; a good read clears it", () => {
  const now = 1_000_000;
  const one = D.nextProfileBackoff(undefined, false, 60_000, now)!;
  assert.deepEqual(one, { failures: 1, nextAt: now + 120_000 });
  const two = D.nextProfileBackoff(one, false, 60_000, now)!;
  assert.deepEqual(two, { failures: 2, nextAt: now + 240_000 });
  assert.equal(D.nextProfileBackoff(two, true, 60_000, now), undefined);

  assert.equal(D.backoffBlocks(two, now + 239_999), true);
  assert.equal(D.backoffBlocks(two, now + 240_000), false);
  assert.equal(D.backoffBlocks(undefined, now), false);
});

test("a changed login lifts a profile's backoff at once", () => {
  const now = 1_000_000;
  const b = D.nextProfileBackoff(undefined, false, 60_000, now, "login-1")!;
  assert.equal(D.backoffBlocks(b, now + 1, "login-1"), true);
  assert.equal(D.backoffBlocks(b, now + 1, "login-2"), false); // signed in again
  assert.equal(D.backoffBlocks(b, now + 1, null), false); // signed out: let the read report it
  // No stamp recorded (a provider without one): time alone decides.
  const plain = D.nextProfileBackoff(undefined, false, 60_000, now)!;
  assert.equal(D.backoffBlocks(plain, now + 1, "anything"), true);
});

test("loginStamp fingerprints a stored login without keeping it", () => {
  assert.equal(D.loginStamp(null), null);
  assert.equal(D.loginStamp("{a}"), D.loginStamp("{a}"));
  assert.notEqual(D.loginStamp("{a}"), D.loginStamp("{b}"));
  assert.doesNotMatch(D.loginStamp('{"refreshToken":"secret"}')!, /secret/);
});

test("dueTargets over several cycles: a dead login waits, a healthy one never does, a re-login retries", () => {
  const backoff = new Map<string, any>();
  const stamps: Record<string, string> = { dead: "s1", ok: "t1" };
  const stampOf = (n: string) => stamps[n];
  const read = (n: string, now: number) => {
    const ok = n === "ok";
    const b = D.nextProfileBackoff(backoff.get(`claude/${n}`), ok, 60_000, now, stampOf(n));
    if (b) backoff.set(`claude/${n}`, b);
    else backoff.delete(`claude/${n}`);
  };
  let now = 0;
  const cycle = () => {
    const due = D.dueTargets("claude", ["dead", "ok"], backoff, now, stampOf);
    for (const n of due) read(n, now);
    return due;
  };
  assert.deepEqual(cycle(), ["dead", "ok"]);
  now += 60_000;
  assert.deepEqual(cycle(), ["ok"]); // dead waits 2 min
  now += 60_000;
  assert.deepEqual(cycle(), ["dead", "ok"]);
  now += 60_000;
  assert.deepEqual(cycle(), ["ok"]); // dead now waits 4 min
  stamps.dead = "s2"; // the user signed in again
  now += 1_000;
  assert.deepEqual(cycle(), ["dead", "ok"]);
});

test("pollProvider is wired through dueTargets and stamps each failure with the login", () => {
  const src = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/daemon.ts"), "utf8");
  const body = src.slice(src.indexOf("async function pollProvider("), src.indexOf("async function pollOnce("));
  assert.match(body, /dueTargets\(provider, selectPollTargets\(/);
  assert.match(body, /nextProfileBackoff\(.*loginStampFor\(provider, name\)\)/);
});

test("the poll loop backs off only when every read of the cycle failed", () => {
  // Three expired logins next to a healthy one must not slow the healthy one.
  assert.equal(D.nextConsecutiveFailures(2, 3, 4), 0);
  assert.equal(D.nextConsecutiveFailures(2, 4, 4), 3); // offline / API down
  // Nothing due (every target sits in its own backoff): no evidence either way.
  assert.equal(D.nextConsecutiveFailures(2, 0, 0), 2);
});

test("the cache bound covers the daemon's cadence plus one loop wake, and stretches with its backoff", () => {
  assert.equal(D.cacheMaxAgeMs(60_000), D.POOL_POLL_INTERVAL_MS + D.MIN_INTERVAL_MS);
  // A configured 10-min interval: the active profile's snapshot is ~10 min old.
  assert.equal(D.cacheMaxAgeMs(10 * 60_000), 10 * 60_000 + D.MIN_INTERVAL_MS);
  // A loop-wide outage backoff: no point reading live past the daemon.
  assert.equal(D.cacheMaxAgeMs(D.MAX_BACKOFF_MS), D.MAX_BACKOFF_MS + D.MIN_INTERVAL_MS);
  assert.equal(D.cacheMaxAgeMs(undefined), D.POOL_POLL_INTERVAL_MS + D.MIN_INTERVAL_MS);
});

test("a cached snapshot is fresh by its OWN capture time, not by the last poll", () => {
  const now = Date.parse("2026-10-29T15:45:00.000Z");
  const snap = (at: string) => ({ windows: [], routines: null, capturedAt: at });
  assert.equal(D.snapshotFresh(snap("2026-10-29T15:44:00.000Z"), now), true);
  // 4 h old while another profile was polled a minute ago: stale.
  assert.equal(D.snapshotFresh(snap("2026-10-29T11:34:24.988Z"), now), false);
  assert.equal(D.snapshotFresh(snap("2026-10-29T15:45:00.000Z"), now - 1), true);
  assert.equal(D.snapshotFresh(snap("garbage"), now), false);
  assert.equal(D.snapshotFresh(undefined, now), false);
  const bound = 6 * 60_000;
  assert.equal(D.snapshotFresh(snap(new Date(now - bound).toISOString()), now, bound), true);
  assert.equal(D.snapshotFresh(snap(new Date(now - bound - 1).toISOString()), now, bound), false);
});

// D3: the daemon never redeems a Codex reset credit on its own — it only says
// one is available, once per reset cycle.
test("D3: daemon source never calls the Codex redeem endpoint", () => {
  const src = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/daemon.ts"), "utf8");
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

test("fetch failure: a blip is never reported; an outage of 15 minutes is, once, and never as an OS notification", () => {
  const t0 = Date.parse("2026-10-29T11:00:00Z");
  const min = 60_000;
  assert.equal(D.fetchFailureNotice("claude/a", t0, t0 + 2 * min), null, "a single failed poll stays silent");
  assert.equal(D.fetchFailureNotice("claude/a", t0, t0 + 14 * min), null);
  const n = D.fetchFailureNotice("claude/a", t0, t0 + 15 * min);
  assert.ok(n);
  assert.equal(n!.os, false, "fetch failures stay in the app's log, off the desktop");
  assert.match(n!.message, /claude\/a/);
  assert.match(n!.message, /15 min/);
});
