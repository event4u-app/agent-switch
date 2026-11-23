import { test } from "node:test";
import assert from "node:assert/strict";

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";

import { adopt, adoptLockFile, AdoptRefused, holderAlive, processStart, withAdoptLock, type AdoptDeps, type LockHolder } from "../src/host/adopt.js";

const ID = "0f6a1c2e-1111-4222-8333-944455556666";

function deps(over: Partial<AdoptDeps> = {}): AdoptDeps & { started: unknown[]; stopped: number[][] } {
  const started: unknown[] = [];
  const stopped: number[][] = [];
  return {
    started,
    stopped,
    accounts: (p) => (p === "claude" ? ["work", "side"] : ["main"]),
    hosted: () => new Set(),
    locate: () => ({ cwd: "/repo" }),
    folderExists: () => true,
    liveClaude: () => [],
    codexRunning: () => false,
    stop: (_id, procs) => void stopped.push(procs.map((p) => p.pid)),
    start: (o) => {
      started.push(o);
      return { key: `${o.provider}/${o.account}/${o.sessionId}`, provider: o.provider, account: o.account, sessionId: o.sessionId, window: "@1", cwd: o.cwd, startedAt: "t" };
    },
    ...over,
  };
}

test("take over: a Claude session no longer running resumes hosted on the same account, under its own id", () => {
  const d = deps();
  const s = adopt(d, `claude/work/${ID}`, {});
  assert.equal(s.key, `claude/work/${ID}`, "same account, same key");
  assert.deepEqual(d.started, [{ provider: "claude", account: "work", sessionId: ID, cwd: "/repo", args: ["--resume", ID] }]);
});

test("take over: a Claude session still running in the user's terminal is refused unless asked to end it there", () => {
  const live = [{ pid: 77, sessionId: ID, status: "idle", statusUpdatedAt: null }];
  const d = deps({ liveClaude: () => live });
  assert.throws(() => adopt(d, `claude/work/${ID}`, {}), (e: unknown) => e instanceof AdoptRefused && e.reason === "running" && /PID 77/.test(e.message));
  assert.equal(d.started.length, 0);
  const s = adopt(d, `claude/work/${ID}`, { stopSource: true });
  assert.deepEqual(d.stopped, [[77]], "the source program is ended before the resume");
  assert.equal(s.key, `claude/work/${ID}`);
});

test("take over: a live Claude program that names no session blocks, and --force is the way past it", () => {
  const d = deps({ liveClaude: () => [{ pid: 9, sessionId: null, status: null, statusUpdatedAt: null }] });
  assert.throws(() => adopt(d, `claude/work/${ID}`, {}), (e: unknown) => e instanceof AdoptRefused && e.reason === "unknown-live");
  assert.equal(adopt(d, `claude/work/${ID}`, { force: true }).key, `claude/work/${ID}`);
});

test("take over: a Codex session resumes with `codex resume`; a running codex must be quit first, never ended here", () => {
  const d = deps();
  adopt(d, `codex/main/${ID}`, {});
  assert.deepEqual(d.started, [{ provider: "codex", account: "main", sessionId: ID, cwd: "/repo", args: ["resume", ID] }]);
  const busy = deps({ codexRunning: () => true });
  assert.throws(() => adopt(busy, `codex/main/${ID}`, {}), (e: unknown) => e instanceof AdoptRefused && e.reason === "running" && /\/quit/.test(e.message));
  assert.throws(() => adopt(busy, `codex/main/${ID}`, { stopSource: true }), (e: unknown) => e instanceof AdoptRefused && e.reason === "unsupported");
  assert.equal(adopt(busy, `codex/main/${ID}`, { force: true }).key, `codex/main/${ID}`);
});

test("take over refuses what it cannot do honestly", () => {
  assert.throws(() => adopt(deps({ hosted: () => new Set([`claude/work/${ID}`]) }), `claude/work/${ID}`, {}), /already runs in Agent Switch/);
  assert.throws(() => adopt(deps(), `claude/nobody/${ID}`, {}), /no claude account "nobody"/);
  assert.throws(() => adopt(deps({ locate: () => null }), `claude/work/${ID}`, {}), /not found/);
  assert.throws(() => adopt(deps({ folderExists: () => false }), `claude/work/${ID}`, {}), /no longer exists/);
  assert.throws(() => adopt(deps(), `antigravity/a/${ID}`, {}), /Claude and Codex/);
  assert.throws(() => adopt(deps(), "claude/work/not;an-id", {}), /session key/);
  assert.throws(() => adopt(deps(), "work", {}), /session key/);
});

test("take over: --force never starts a second writer for a session its own program still runs", () => {
  const live = [{ pid: 77, sessionId: ID, status: "idle", statusUpdatedAt: null }];
  const d = deps({ liveClaude: () => live });
  assert.throws(() => adopt(d, `claude/work/${ID}`, { force: true }), (e: unknown) => e instanceof AdoptRefused && e.reason === "running" && /PID 77/.test(e.message) && !/--force/.test(e.message));
  assert.equal(d.started.length, 0, "nothing starts while the source still writes the conversation");
});

test("take over is one at a time per session: a second adopt of the same session is refused while the first runs", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asw-adopt-lock-"));
  const key = `claude/work/${ID}`;
  const other = `claude/work/1${ID.slice(1)}`;
  const alive = (h: LockHolder) => h.pid === 4242 && h.start === "t0";
  const first = { pid: 4242, start: "t0" };
  const second = { pid: 5151, start: "t1" };
  const got = withAdoptLock(dir, key, () => {
    assert.throws(() => withAdoptLock(dir, key, () => "second", { alive, self: second }), (e: unknown) => e instanceof AdoptRefused && /already being taken over \(PID 4242\)/.test(e.message));
    assert.equal(withAdoptLock(dir, other, () => "other", { alive, self: second }), "other", "another session is not held up");
    return "first";
  }, { alive, self: first });
  assert.equal(got, "first");
  assert.deepEqual(fs.readdirSync(dir), [], "released afterwards");
  // A lock left by a process that died is taken over, not obeyed forever — also one from an older version (a bare PID).
  fs.writeFileSync(adoptLockFile(dir, key), "999999");
  assert.equal(withAdoptLock(dir, key, () => "after a crash", { alive, self: first }), "after a crash");
  assert.deepEqual(fs.readdirSync(dir), [], "the dead holder's lock is tidied too");
  // Its PID taken by another process since: the start time tells them apart.
  fs.writeFileSync(adoptLockFile(dir, key), JSON.stringify({ pid: 4242, start: "an earlier process" }));
  assert.equal(withAdoptLock(dir, key, () => "after reuse", { alive, self: second }), "after reuse");
});

test("take over lock: a run that read an old top never holds beside the run that took it meanwhile", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asw-adopt-lock-"));
  const key = `claude/work/${ID}`;
  const dead = JSON.stringify({ pid: 999999, start: "gone" });
  const other = { pid: 5151, start: "t1" };
  fs.writeFileSync(adoptLockFile(dir, key, 0), dead);
  let stepped = false;
  // This run has read generation 0's dead holder. Before it publishes generation 1, another run
  // got there the long way: a third run left generation 1 dead, the other took generation 2 over it
  // and tidied the dead ones below — so generation 1 is free again for this run's link.
  const alive = (h: LockHolder) => {
    if (!stepped) {
      stepped = true;
      fs.writeFileSync(adoptLockFile(dir, key, 2), JSON.stringify(other));
      fs.rmSync(adoptLockFile(dir, key, 0));
    }
    return h.pid === other.pid;
  };
  let ran = false;
  assert.throws(
    () => withAdoptLock(dir, key, () => (ran = true), { alive, self: { pid: 4242, start: "t0" } }),
    (e: unknown) => e instanceof AdoptRefused && /PID 5151/.test(e.message),
  );
  assert.equal(ran, false, "never held beside the other run");
  assert.deepEqual(fs.readdirSync(dir), [path.basename(adoptLockFile(dir, key, 2))], "the other run's lock is untouched, this run's attempt taken back");
});

test("take over lock: the real liveness check tells a running holder from a reused PID", () => {
  const me = { pid: process.pid, start: processStart(process.pid) };
  assert.equal(holderAlive(me), true);
  assert.equal(holderAlive({ pid: 999999, start: null }), false, "no such process");
  if (me.start !== null) assert.equal(holderAlive({ pid: process.pid, start: "Thu Jan  1 00:00:00 1970" }), false, "same PID, another process");
});

/** A child that tries one take-over at `startAt` and logs entering and leaving the held part. */
const CHILD = `
import * as fs from "node:fs";
const [modUrl, dir, key, log, startAt] = process.argv.slice(2);
const { withAdoptLock } = await import(modUrl);
while (Date.now() < Number(startAt)) {}
try {
  withAdoptLock(dir, key, () => {
    fs.appendFileSync(log, "enter " + process.pid + "\\n");
    const until = Date.now() + 40;
    while (Date.now() < until) {}
    fs.appendFileSync(log, "leave " + process.pid + "\\n");
  });
} catch (e) {
  if (!/already being taken over/.test(String(e && e.message))) throw e;
}
`;

/** Runs `n` adopters of one session at the same moment; resolves with the log of who held it when. */
async function race(dir: string, key: string, n: number): Promise<string[]> {
  const script = path.join(dir, "..", "adopter.mjs");
  fs.writeFileSync(script, CHILD);
  const log = path.join(dir, "..", `log-${Date.now()}-${Math.random()}`);
  fs.writeFileSync(log, "");
  const mod = new URL("../src/host/adopt.js", import.meta.url).href;
  const startAt = String(Date.now() + 400);
  const codes = await Promise.all(
    Array.from({ length: n }, () =>
      new Promise<number | null>((resolve) => {
        const c = spawn(process.execPath, [script, mod, dir, key, log, startAt], { stdio: ["ignore", "ignore", "inherit"] });
        c.on("exit", resolve);
      }),
    ),
  );
  assert.deepEqual(codes, codes.map(() => 0), "every adopter ended cleanly");
  return fs.readFileSync(log, "utf8").split("\n").filter(Boolean);
}

/** Holding is exclusive: every enter is followed by the same process leaving before anyone else enters. */
function exclusive(lines: string[]): void {
  assert.ok(lines.length >= 2, "someone took it over");
  for (let i = 0; i < lines.length; i += 2) {
    const [a, pa] = lines[i].split(" ");
    const [b, pb] = (lines[i + 1] ?? "").split(" ");
    assert.deepEqual([a, b, pb], ["enter", "leave", pa], `two adopters held the lock at once: ${lines.join(" | ")}`);
  }
}

const raceGate = { skip: process.platform === "win32" ? "POSIX process timing" : false };

test("take over races: adopters that start at the same moment hold the lock one at a time", raceGate, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "asw-adopt-race-"));
  const dir = path.join(root, "locks");
  fs.mkdirSync(dir, { recursive: true });
  for (let round = 0; round < 4; round++) exclusive(await race(dir, `claude/work/${ID}`, 6));
  assert.deepEqual(fs.readdirSync(dir).filter((f) => !f.startsWith(".")), [], "every hold released");
});

test("take over races: a lock left by a dead process is recovered by exactly one of the adopters racing for it", raceGate, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "asw-adopt-stale-"));
  const dir = path.join(root, "locks");
  fs.mkdirSync(dir, { recursive: true });
  for (let round = 0; round < 6; round++) {
    // A take-over that crashed: its lock names a process that no longer runs.
    fs.writeFileSync(adoptLockFile(dir, `claude/work/${ID}`), "999999");
    exclusive(await race(dir, `claude/work/${ID}`, 6));
  }
});
