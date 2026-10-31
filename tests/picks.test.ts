import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { appendPick, readPicks, trimPicks, PICKS_MAX_LINES } from "../src/picks.js";

function tmp(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "asw-picks-")), "picks.jsonl");
}

test("appendPick records the choice and the resolver's reasons, redacted", () => {
  const f = tmp();
  appendPick({ provider: "claude", chosen: "claude/work", why: ["Pool p: work has 40% left", `token sk-ant-${"x".repeat(30)}`] }, f);
  appendPick({ provider: "claude", chosen: null, why: [], blocked: "rule allows only busy accounts" }, f);
  const all = readPicks(undefined, f);
  assert.equal(all.length, 2);
  assert.equal(all[0].chosen, "claude/work");
  assert.equal(all[0].why[0], "Pool p: work has 40% left");
  assert.doesNotMatch(all[0].why[1], /sk-ant-x/);
  assert.equal(all[1].chosen, null);
  assert.equal(all[1].blocked, "rule allows only busy accounts");
  assert.equal(readPicks(1, f).length, 1);
  if (process.platform !== "win32") assert.equal(fs.statSync(f).mode & 0o777, 0o600);
});

test("readPicks skips malformed lines; trimPicks keeps the newest entries", () => {
  const f = tmp();
  for (let i = 0; i < PICKS_MAX_LINES + 7; i++) appendPick({ provider: "claude", chosen: `claude/p${i}`, why: [] }, f);
  fs.appendFileSync(f, "{broken\n");
  trimPicks(f);
  const all = readPicks(undefined, f);
  assert.equal(all.length, PICKS_MAX_LINES - 1); // the broken line survived the trim, then was skipped
  assert.equal(all[all.length - 1].chosen, `claude/p${PICKS_MAX_LINES + 6}`);
});

test("appendPick never throws when the ledger cannot be written", () => {
  assert.equal(appendPick({ provider: "claude", chosen: null, why: [] }, path.join(os.tmpdir(), "no-such-dir-asw", "x", "picks.jsonl")), null);
});
