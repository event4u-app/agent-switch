import { test } from "node:test";
import assert from "node:assert/strict";

import { adopt, AdoptRefused, type AdoptDeps } from "../src/host/adopt.js";

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
