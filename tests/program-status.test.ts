import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { matchHostedRows, MAX_BODY, OscScanner, parseReport, programStatusFile, readProgramStatus, runProgramStatus } from "../src/program-status.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = [path.resolve(here, "fixtures/codex-osc-7501-stream.bin"), path.resolve(here, "../../tests/fixtures/codex-osc-7501-stream.bin")].find((p) => fs.existsSync(p))!;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "asw-program-"));
const states = (s: OscScanner, ...chunks: string[]) => chunks.flatMap((c) => s.push(Buffer.from(c, "latin1"))).map((r) => r.state);

test("scanner: a whole report with BEL, and one with ST", () => {
  assert.deepEqual(new OscScanner().push(Buffer.from("x\x1b]7501;state=working:app=codex\x07y")), [{ state: "working", app: "codex" }]);
  assert.deepEqual(states(new OscScanner(), "\x1b]7501;state=done:app=codex\x1b\\"), ["done"]);
});

test("scanner: a report split across chunks at every byte is found once", () => {
  const whole = "out\x1b]7501;state=idle:app=codex\x1b\\more";
  for (let cut = 1; cut < whole.length; cut++) {
    assert.deepEqual(states(new OscScanner(), whole.slice(0, cut), whole.slice(cut)), ["idle"], `cut at ${cut}`);
  }
  assert.deepEqual(states(new OscScanner(), ...whole.split("")), ["idle"], "one byte per chunk");
});

test("scanner: garbage, other OSCs, aborted and unknown reports yield nothing and never throw", () => {
  const s = new OscScanner();
  assert.deepEqual(states(s, "\x1b]0;title\x07", "\x1b]8;;file:///x\x07", "\xff\xfe\x00\x1b\x1b]"), []);
  assert.deepEqual(states(s, "\x1b]7501;state=working\x1b[1m", "\x1b]7501;state=idle\x07"), ["idle"], "an escape that is not ST drops the report, the next one counts");
  assert.deepEqual(states(s, "\x1b]7501;state=sleepy\x07", "\x1b]7501;id=a.b:state=working\x07", "\x1b]7501;?\x07"), [], "unknown state, a child record, a query");
});

test("parseReport: unknown keys are ignored, a bad app is dropped", () => {
  assert.deepEqual(parseReport("state=working:app=codex:progress=40:future=x"), { state: "working", app: "codex" });
  assert.deepEqual(parseReport("app=co;dex:state=idle"), { state: "idle" });
  assert.equal(parseReport("=working"), null);
  assert.equal(parseReport(""), null);
});

test("scanner: an oversized body is dropped and the buffer stays bounded", () => {
  const s = new OscScanner();
  assert.deepEqual(states(s, "\x1b]7501;state=working:" + "a".repeat(MAX_BODY + 10), "\x07"), []);
  const big = "\x1b]7501;" + "b".repeat(10 * MAX_BODY);
  for (let i = 0; i < 20; i++) s.push(big);
  assert.ok(((s as unknown as { pending: string }).pending.length) <= MAX_BODY + 16);
  assert.deepEqual(states(s, "\x07\x1b]7501;state=idle\x07"), ["idle"], "recovers afterwards");
});

test("runProgramStatus: the recorded Codex stream ends in done, written only on changes", async () => {
  const file = path.join(tmp(), "nested", "s.json");
  const bytes = fs.readFileSync(fixture);
  const chunks = [bytes.subarray(0, 37), bytes.subarray(37, 200), bytes.subarray(200)];
  let t = 1000;
  const writes: number[] = [];
  await runProgramStatus(file, Readable.from(chunks), () => {
    writes.push(t);
    return t++;
  });
  assert.equal(writes.length, 5, "idle, working, idle, working, done");
  assert.deepEqual(readProgramStatus(file), { state: "done", app: "codex", at: 1004 });

  await runProgramStatus(file, Readable.from([Buffer.from("\x1b]7501;state=done:app=codex\x07")]), () => 9999);
  assert.equal(readProgramStatus(file)?.at, 1004, "the same state again is no write");
});

test("CLI: __program-status reads stdin and writes the state file", () => {
  const cli = path.resolve(here, "../src/index.js");
  const root = tmp();
  const file = programStatusFile(root, "1234-abcd");
  const r = spawnSync(process.execPath, [cli, "__program-status", file], { input: fs.readFileSync(fixture), env: { ...process.env, AGENT_SWITCH_HOME: root }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "");
  assert.equal(readProgramStatus(file)?.state, "done");
});

test("matchHostedRows: exact id first, else same account and folder, first rollout born after the start", () => {
  const start = Date.parse("2026-11-23T10:00:00Z");
  const rows = [
    { sessionId: "old", profile: "work", cwd: "/w", birthtimeMs: start - 60_000 },
    { sessionId: "r1", profile: "work", cwd: "/w", birthtimeMs: start + 2_000 },
    { sessionId: "r2", profile: "work", cwd: "/w", birthtimeMs: start + 9_000 },
    { sessionId: "other", profile: "side", cwd: "/w", birthtimeMs: start + 1_000 },
    { sessionId: "h3", profile: "side", cwd: "/x", birthtimeMs: start - 3_600_000 },
  ];
  const hosted = [
    { sessionId: "h1", account: "work", cwd: "/w", startedAt: new Date(start).toISOString() },
    { sessionId: "h2", account: "work", cwd: "/w", startedAt: new Date(start + 5_000).toISOString() },
    { sessionId: "h3", account: "side", cwd: "/x", startedAt: new Date(start).toISOString() },
  ];
  const m = matchHostedRows(rows, hosted);
  const by = Object.fromEntries([...m].map(([r, h]) => [h.sessionId, r.sessionId]));
  assert.deepEqual(by, { h1: "r1", h2: "r2", h3: "h3" });
});

test("matchHostedRows: a standalone rollout begun just before the window loses to the window's own, in either listing order", () => {
  const start = Date.parse("2026-11-23T10:00:00Z");
  const before = { sessionId: "standalone", profile: "work", cwd: "/w", birthtimeMs: start - 2_000 };
  const after = { sessionId: "hosted-own", profile: "work", cwd: "/w", birthtimeMs: start + 3_000 };
  const h = [{ sessionId: "h1", account: "work", cwd: "/w", startedAt: new Date(start).toISOString() }];
  for (const rows of [[before, after], [after, before]]) {
    assert.deepEqual([...matchHostedRows(rows, h).keys()].map((r) => r.sessionId), ["hosted-own"]);
  }
  assert.deepEqual([...matchHostedRows([before], h).keys()].map((r) => r.sessionId), ["standalone"], "with nothing after the start, the near-before one may stand in");
  const two = [h[0], { sessionId: "h2", account: "work", cwd: "/w", startedAt: new Date(start + 1_000).toISOString() }];
  const m = matchHostedRows([after], two);
  assert.equal(m.size, 1, "a rollout is never claimed by two windows");
});

test("runProgramStatus: a report from another app (or none) is not taken for Codex", async () => {
  const file = path.join(tmp(), "s.json");
  await runProgramStatus(file, Readable.from([Buffer.from("\x1b]7501;state=working:app=evil\x07\x1b]7501;state=blocked\x07")]), () => 1);
  assert.equal(readProgramStatus(file), null);
  await runProgramStatus(file, Readable.from([Buffer.from("\x1b]7501;state=working:app=codex\x07")]), () => 2);
  assert.equal(readProgramStatus(file)?.state, "working");
});
