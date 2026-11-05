import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ASK_AT_PCT, askWindow, raiseForAccount } from "../src/link/raise.js";
import { RequestStore, type Candidate } from "../src/link/requests.js";
import type { UsageSnapshot } from "../src/usage.js";

const NOW = Date.parse("2026-11-05T12:00:00Z");
const at = (min: number) => new Date(NOW + min * 60_000).toISOString();
const snap = (w: [string, number, number][]): UsageSnapshot => ({
  capturedAt: at(0),
  routines: null,
  windows: w.map(([key, utilization, reset]) => ({ key, label: key, utilization, resetsAt: at(reset) })),
});
const cand: Candidate[] = [{ target: "claude/b", provider: "claude", fill: 10, resetsAt: null, how: ["after-turn", "now"] }];
const store = () => new RequestStore(fs.mkdtempSync(path.join(os.tmpdir(), "asw-raise-")), () => NOW);

test("askWindow picks the fullest window at or over the ask mark", () => {
  assert.equal(askWindow(snap([["five_hour", ASK_AT_PCT - 1, 60]]), NOW, 98), null);
  assert.deepEqual(askWindow(snap([["five_hour", 91, 60], ["seven_day", 95, 3000]]), NOW, 98), { window: "seven_day", fill: 95, resetsAt: at(3000) });
});

test("a lower protection threshold moves the ask mark down with it", () => {
  assert.equal(askWindow(snap([["five_hour", 86, 60]]), NOW, 85)?.fill, 86);
});

test("a window whose reset has passed never asks", () => {
  assert.equal(askWindow(snap([["five_hour", 99, -1]]), NOW, 98), null);
});

test("one request per live session, and none for an account nothing runs on", () => {
  const s = store();
  const input = { account: "claude/work", snapshot: snap([["five_hour", 93, 60]]), thresholdPct: 98, now: NOW, candidates: () => cand };
  assert.equal(raiseForAccount(s, { ...input, sessions: [] }).length, 0);
  const created = raiseForAccount(s, { ...input, sessions: ["s1", "s2"] });
  assert.deepEqual(created.map((r) => r.session), ["claude/work/s1", "claude/work/s2"]);
  assert.equal(created[0].raisedBy, "as-daemon");
  assert.equal(raiseForAccount(s, { ...input, sessions: ["s1", "s2"] }).length, 0, "the next poll creates nothing new");
});

test("a live account whose sessions are unknown gets one account-level request", () => {
  const s = store();
  const created = raiseForAccount(s, { account: "codex/one", sessions: null, snapshot: snap([["five_hour", 95, 60]]), thresholdPct: 98, now: NOW, candidates: () => cand });
  assert.equal(created.length, 1);
  assert.equal(created[0].session, null);
});

test("nothing to offer, nothing raised", () => {
  const s = store();
  assert.equal(raiseForAccount(s, { account: "claude/work", sessions: ["s1"], snapshot: snap([["five_hour", 95, 60]]), thresholdPct: 98, now: NOW, candidates: () => [] }).length, 0);
});
