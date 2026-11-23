import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "asw-slsrc-"));
process.env.AGENT_SWITCH_HOME = HOME;
const { claudeSnapshot } = await import("../src/commands/shared.js");
const { markInstalled, writeStatuslineSnapshot } = await import("../src/statusline.js");
const { cmdStatus } = await import("../src/commands/usage.js");
const { detectCrossings, maxUtilization, pickSwitchTarget, resolveClaudeUsage } = await import("../src/usage.js");
type UsageSnapshot = import("../src/usage.js").UsageSnapshot;

const NOW = Date.now();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const ahead = (ms: number) => new Date(NOW + ms).toISOString();
const win = (key: string, utilization: number) => ({ key, label: key, utilization, resetsAt: ahead(3_600_000) });

function seedProfile(name: string, turnedOn = true): string {
  const dir = path.join(HOME, "claude", name);
  fs.mkdirSync(path.join(dir, "config"), { recursive: true });
  // A valid-looking login, so the old code path would go on to poll.
  fs.writeFileSync(
    path.join(dir, "config", ".credentials.json"),
    JSON.stringify({ claudeAiOauth: { accessToken: "test-token-not-real", expiresAt: NOW + 24 * 3_600_000 } }),
  );
  if (turnedOn) markInstalled(dir, "/opt/bin/agent-switch __statusline");
  return dir;
}

async function countingFetch<T>(body: unknown, status: number, run: () => Promise<T>, profileBody?: unknown): Promise<{ result: T; calls: number }> {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (url: string | URL) => {
    const profile = String(url).endsWith("/api/oauth/profile");
    if (!profile) calls++;
    const [b, st] = profile ? [profileBody ?? {}, profileBody ? 200 : 500] : [body, status];
    return new Response(JSON.stringify(b), { status: st, headers: { "content-type": "application/json", "retry-after": "0.001" } });
  }) as typeof fetch;
  try {
    return { result: await run(), calls };
  } finally {
    globalThis.fetch = real;
  }
}

test("claudeSnapshot: a fresh statusline sample is served with zero usage requests", async () => {
  const dir = seedProfile("fresh");
  writeStatuslineSnapshot(dir, { windows: [win("five_hour", 12), win("seven_day", 4)], routines: null, capturedAt: ago(30_000), source: "statusline" }, "2.1.316");
  const { result, calls } = await countingFetch({ five_hour: { utilization: 99 } }, 200, () => claudeSnapshot("fresh"));
  assert.equal(calls, 0);
  assert.deepEqual(result?.windows.map((w) => [w.key, w.utilization]), [["five_hour", 12], ["seven_day", 4]]);
});

test("claudeSnapshot: a stale sample polls exactly once; a 429 serves the last real snapshot, not null", async () => {
  const dir = seedProfile("stale");
  writeStatuslineSnapshot(dir, { windows: [win("five_hour", 33), win("seven_day", 8)], routines: null, capturedAt: ago(20 * 60_000), source: "statusline" }, "2.1.316");
  const ok = await countingFetch({ five_hour: { utilization: 40, resets_at: ahead(3_600_000) }, seven_day: { utilization: 9, resets_at: ahead(86_400_000) } }, 200, () => claudeSnapshot("stale"));
  assert.equal(ok.calls, 1);
  assert.equal(ok.result?.windows.find((w) => w.key === "five_hour")?.utilization, 40);
  const limited = await countingFetch({ error: "rate_limited" }, 429, () => claudeSnapshot("stale"));
  assert.ok(limited.calls >= 1);
  assert.equal(limited.result?.windows.find((w) => w.key === "five_hour")?.utilization, 33);
});

test("claudeSnapshot: a cache left by a profile that is turned off is not trusted", async () => {
  const dir = seedProfile("wasoff", false);
  writeStatuslineSnapshot(dir, { windows: [win("five_hour", 12), win("seven_day", 4)], routines: null, capturedAt: ago(30_000), source: "statusline" }, "2.1.316");
  const { result, calls } = await countingFetch({ five_hour: { utilization: 70, resets_at: ahead(3_600_000) } }, 200, () => claudeSnapshot("wasoff"));
  assert.equal(calls, 1);
  assert.equal(result?.windows.find((w) => w.key === "five_hour")?.utilization, 70);
});

test("plain `status` shows the statusline numbers too, through the same resolver", async () => {
  const dir = seedProfile("human");
  writeStatuslineSnapshot(dir, { windows: [win("five_hour", 23), win("seven_day", 6)], routines: null, capturedAt: ago(30_000), source: "statusline" }, "2.1.316");
  const lines: string[] = [];
  const log = console.log;
  console.log = (...a: unknown[]) => void lines.push(a.join(" "));
  try {
    const { calls } = await countingFetch({ error: "rate_limited" }, 429, () => cmdStatus("claude", "human", false), { organization: { name: "Acme" } });
    assert.equal(calls, 0, "no usage request while the sample is fresh");
  } finally {
    console.log = log;
  }
  const out = lines.join("\n");
  assert.match(out, /org: Acme/);
  assert.match(out, /five_hour:\s+23%/);
  assert.match(out, /seven_day:\s+6%/);
});

// ---------- the pure source selection ----------

const sl = (u5: number, ageMs = 30_000): UsageSnapshot => ({ windows: [win("five_hour", u5), win("seven_day", 10)], routines: null, capturedAt: ago(ageMs), source: "statusline" });
const fresh = (s: UsageSnapshot | null) => !!s && NOW - Date.parse(s.capturedAt) < 5 * 60_000;
const spyPoll = (snap: UsageSnapshot | null) => {
  const spy = { calls: 0, poll: async () => (spy.calls++, snap) };
  return spy;
};

test("resolveClaudeUsage: fresh sample and nothing only the poll knows → no poll", async () => {
  const spy = spyPoll(null);
  const r = await resolveClaudeUsage({ statusline: sl(20), base: { windows: [win("five_hour", 5), win("seven_day", 9)], routines: null, capturedAt: ago(3_600_000) }, now: NOW, fresh, pollOnlyMaxAgeMs: 5 * 60_000, poll: spy.poll });
  assert.equal(spy.calls, 0);
  assert.equal(r.snapshot?.capturedAt, ago(30_000));
});

test("resolveClaudeUsage: per-model windows from the poll are kept and refreshed only once they age", async () => {
  const base: UsageSnapshot = { windows: [win("five_hour", 5), win("seven_day", 9), win("seven_day_opus", 95)], routines: null, capturedAt: ago(60_000) };
  const young = spyPoll(null);
  const r1 = await resolveClaudeUsage({ statusline: sl(20), base, now: NOW, fresh, pollOnlyMaxAgeMs: 5 * 60_000, poll: young.poll });
  assert.equal(young.calls, 0);
  assert.deepEqual(r1.snapshot?.windows.map((w) => [w.key, w.utilization, w.source]), [["five_hour", 20, "statusline"], ["seven_day", 10, "statusline"], ["seven_day_opus", 95, "poll"]]);
  assert.equal(r1.snapshot?.capturedAt, ago(60_000), "the merge is as old as its oldest bar");

  const old = { ...base, capturedAt: ago(10 * 60_000) };
  const polled: UsageSnapshot = { windows: [win("five_hour", 6), win("seven_day", 9), win("seven_day_opus", 96)], routines: null, capturedAt: ago(0) };
  const spy = spyPoll(polled);
  const r2 = await resolveClaudeUsage({ statusline: sl(20), base: old, now: NOW, fresh, pollOnlyMaxAgeMs: 5 * 60_000, poll: spy.poll });
  assert.equal(spy.calls, 1);
  assert.equal(r2.snapshot?.windows.find((w) => w.key === "seven_day_opus")?.utilization, 96);
});

test("resolveClaudeUsage: stale sample polls; a failed poll gives null plus the merged fallback", async () => {
  const spy = spyPoll(null);
  const base: UsageSnapshot = { windows: [win("five_hour", 5), win("seven_day_opus", 50)], routines: null, capturedAt: ago(3_600_000) };
  const r = await resolveClaudeUsage({ statusline: sl(44, 20 * 60_000), base, now: NOW, fresh, pollOnlyMaxAgeMs: 5 * 60_000, poll: spy.poll });
  assert.equal(spy.calls, 1);
  assert.equal(r.snapshot, null);
  assert.deepEqual(r.fallback?.windows.map((w) => [w.key, w.utilization]), [["five_hour", 44], ["seven_day_opus", 50], ["seven_day", 10]]);
});

test("switch path: a per-model window at 95% known only to the poll still crosses and suggests a switch", async () => {
  const base: UsageSnapshot = { windows: [win("five_hour", 5), win("seven_day", 9), win("seven_day_opus", 95)], routines: null, capturedAt: ago(60_000) };
  const { snapshot } = await resolveClaudeUsage({ statusline: sl(10), base, now: NOW, fresh, pollOnlyMaxAgeMs: 5 * 60_000, poll: async () => null });
  assert.equal(maxUtilization(snapshot!), 95);
  assert.deepEqual(detectCrossings(snapshot!, {}).crossings.map((c) => [c.window, c.threshold]), [["seven_day_opus", 75], ["seven_day_opus", 90]]);
  const other = { windows: [win("five_hour", 1)], routines: null, capturedAt: ago(0) };
  assert.equal(pickSwitchTarget("work", [{ name: "work", snapshot: snapshot! }, { name: "side", snapshot: other }], 90), "side");
});

test("resolveClaudeUsage: a failed poll with a fresh sample still answers with the merge", async () => {
  const base: UsageSnapshot = { windows: [win("five_hour", 5), win("seven_day", 9), win("seven_day_opus", 50)], routines: null, capturedAt: ago(10 * 60_000) };
  const spy = spyPoll(null);
  const r = await resolveClaudeUsage({ statusline: sl(30), base, now: NOW, fresh, pollOnlyMaxAgeMs: 5 * 60_000, poll: spy.poll });
  assert.equal(spy.calls, 1);
  assert.equal(r.pollFailed, true);
  assert.deepEqual(r.snapshot?.windows.map((w) => [w.key, w.utilization]), [["five_hour", 30], ["seven_day", 10], ["seven_day_opus", 50]]);
});

test("resolveClaudeUsage: with polling held back (backoff) a fresh sample is still read, a stale one gives nothing", async () => {
  const base: UsageSnapshot = { windows: [win("five_hour", 5), win("seven_day_opus", 50)], routines: null, capturedAt: ago(10 * 60_000) };
  const spy = spyPoll({ windows: [win("five_hour", 1)], routines: null, capturedAt: ago(0) });
  const r = await resolveClaudeUsage({ statusline: sl(30), base, now: NOW, fresh, pollOnlyMaxAgeMs: 5 * 60_000, poll: spy.poll, mayPoll: false });
  assert.equal(spy.calls, 0);
  assert.equal(r.snapshot?.windows.find((w) => w.key === "five_hour")?.utilization, 30);
  const stale = await resolveClaudeUsage({ statusline: sl(30, 20 * 60_000), base, now: NOW, fresh, pollOnlyMaxAgeMs: 5 * 60_000, poll: spy.poll, mayPoll: false });
  assert.equal(spy.calls, 0);
  assert.equal(stale.snapshot, null);
});

test("daemon: a profile held back by its poll backoff still reads its fresh local sample", () => {
  const here = path.dirname(new URL(import.meta.url).pathname);
  const src = fs.readFileSync([path.resolve(here, "../src/daemon.ts"), path.resolve(here, "../../src/daemon.ts")].find((p) => fs.existsSync(p))!, "utf8");
  const body = src.slice(src.indexOf("async function pollProvider("), src.indexOf("async function pollOnce("));
  assert.match(body, /const localOnly = .*statuslineFresh\(servedStatuslineSnapshot\(/);
  assert.match(body, /const targets = \[\.\.\.due, \.\.\.localOnly\]/);
  assert.match(body, /snapshotFor\(provider, name, log, state\.profiles\[key\], mayPoll\)/);
  assert.match(body, /snapshot && !read\.pollFailed \? undefined : nextProfileBackoff\(/);
});
