import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { runtimeState, TRANSCRIPT_FRESH_MS, UNCONFIRMED_AFTER_MS, type RuntimeInput } from "../src/runtime-state.js";

const NOW = 1_795_396_500_000;
const MIN = 60_000;

// The window's rule before Phase 1: live and written within 60 s reads working.
const transcriptOnly = (r: RuntimeInput) => (!r.live ? "done" : r.waiting ? "needs-you" : NOW - r.mtimeMs <= TRANSCRIPT_FRESH_MS ? "working" : "idle");

const cases: { name: string; row: RuntimeInput; state: string | null; source?: string; unconfirmed?: boolean }[] = [
  { name: "long tool call: busy held, transcript quiet for 2 min", row: { live: true, hostStatus: "busy", hostStatusAt: NOW - 2.5 * MIN, mtimeMs: NOW - 2 * MIN }, state: "working", source: "host" },
  { name: "finished turn: idle at once, transcript written seconds ago", row: { live: true, hostStatus: "idle", hostStatusAt: NOW - 2_000, mtimeMs: NOW - 3_000 }, state: "idle", source: "host" },
  { name: "turn ended with a background shell running", row: { live: true, hostStatus: "shell", hostStatusAt: NOW - 5_000, mtimeMs: NOW - 5_000 }, state: "idle", source: "host" },
  { name: "open question or permission prompt outranks the host word", row: { live: true, waiting: true, hostStatus: "busy", hostStatusAt: NOW - MIN, mtimeMs: NOW - MIN }, state: "needs-you", source: "hook" },
  { name: "permission prompt: the host itself says waiting", row: { live: true, hostStatus: "waiting", hostStatusAt: NOW - 4_000, mtimeMs: NOW - 4_000 }, state: "needs-you", source: "host" },
  { name: "busy with eleven silent minutes is unconfirmed", row: { live: true, hostStatus: "busy", hostStatusAt: NOW - 30 * MIN, mtimeMs: NOW - 11 * MIN }, state: "working", source: "host", unconfirmed: true },
  { name: "busy, host word old but transcript fresh, is confirmed", row: { live: true, hostStatus: "busy", hostStatusAt: NOW - 30 * MIN, mtimeMs: NOW - MIN }, state: "working", source: "host" },
  { name: "no registry word: fresh transcript reads working", row: { live: true, mtimeMs: NOW - 10_000 }, state: "working", source: "transcript" },
  { name: "no registry word: quiet transcript reads idle", row: { live: true, mtimeMs: NOW - 5 * MIN }, state: "idle", source: "transcript" },
  { name: "an unknown word is silence", row: { live: true, hostStatus: "compacting-v9", hostStatusAt: NOW, mtimeMs: NOW - 5 * MIN }, state: "idle", source: "transcript" },
  { name: "program: Codex reports working, transcript quiet", row: { live: true, programState: "working", programAt: NOW - 2 * MIN, mtimeMs: NOW - 3 * MIN }, state: "working", source: "program" },
  { name: "program: idle at once though the transcript was written seconds ago", row: { live: true, programState: "idle", programAt: NOW - 1_000, mtimeMs: NOW - 2_000 }, state: "idle", source: "program" },
  { name: "program: done reads idle", row: { live: true, programState: "done", programAt: NOW - 1_000, mtimeMs: NOW - 1_000 }, state: "idle", source: "program" },
  { name: "program: blocked reads needs-you", row: { live: true, programState: "blocked", programAt: NOW - 1_000, mtimeMs: NOW - 1_000 }, state: "needs-you", source: "program" },
  { name: "program: a hook or transcript wait outranks it", row: { live: true, waiting: true, programState: "working", programAt: NOW, mtimeMs: NOW }, state: "needs-you", source: "hook" },
  { name: "program: the host registry word outranks it", row: { live: true, hostStatus: "idle", hostStatusAt: NOW - 1_000, programState: "working", programAt: NOW, mtimeMs: NOW }, state: "idle", source: "host" },
  { name: "program: working with eleven silent minutes is unconfirmed", row: { live: true, programState: "working", programAt: NOW - 20 * MIN, mtimeMs: NOW - 11 * MIN }, state: "working", source: "program", unconfirmed: true },
  { name: "program: an unknown state is silence", row: { live: true, programState: "clear", programAt: NOW, mtimeMs: NOW - 5 * MIN }, state: "idle", source: "transcript" },
  { name: "not live has no runtime", row: { live: false, hostStatus: "busy", mtimeMs: NOW }, state: null },
];

for (const c of cases) {
  test(`runtimeState: ${c.name}`, () => {
    const r = runtimeState(c.row, NOW);
    if (c.state === null) return assert.equal(r, null);
    assert.ok(r);
    assert.equal(r.state, c.state);
    assert.equal(r.source, c.source);
    assert.equal(r.unconfirmed === true, !!c.unconfirmed);
  });
}

test("the two situations the transcript rule gets wrong are the ones the host word fixes", () => {
  const long = cases[0].row;
  const finished = cases[1].row;
  assert.equal(transcriptOnly(long), "idle");
  assert.equal(transcriptOnly(finished), "working");
  assert.equal(runtimeState(long, NOW)!.state, "working");
  assert.equal(runtimeState(finished, NOW)!.state, "idle");
});

test("unconfirmed starts exactly after the threshold", () => {
  const at = NOW - UNCONFIRMED_AFTER_MS;
  assert.equal(runtimeState({ live: true, hostStatus: "busy", hostStatusAt: at, mtimeMs: at }, NOW)!.unconfirmed, undefined);
  assert.equal(runtimeState({ live: true, hostStatus: "busy", hostStatusAt: at - 1, mtimeMs: at - 1 }, NOW)!.unconfirmed, true);
});

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = [path.resolve(here, "fixtures/registry-status-2.1.316.json"), path.resolve(here, "../../tests/fixtures/registry-status-2.1.316.json")].find((p) => fs.existsSync(p))!;

test("every recorded registry step reads as expected", () => {
  const { steps } = JSON.parse(fs.readFileSync(fixture, "utf8")) as { steps: { situation: string; status: string; statusAgeS: number; transcriptAgeS: number; expect: string }[] };
  assert.ok(steps.length >= 10);
  for (const s of steps) {
    const r = runtimeState({ live: true, hostStatus: s.status, hostStatusAt: NOW - s.statusAgeS * 1000, mtimeMs: NOW - s.transcriptAgeS * 1000 }, NOW);
    assert.equal(r?.state, s.expect, s.situation);
    assert.equal(r?.source, "host", s.situation);
  }
});
