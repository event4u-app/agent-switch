import { test } from "node:test";
import assert from "node:assert/strict";

import { candidatesFor } from "../src/link/candidates.js";
import type { AccountLimits, LimitsReport } from "../src/link/limits.js";

function acct(id: string, fills: number[], over: Partial<AccountLimits> = {}): AccountLimits {
  const [provider, name] = id.split("/") as [AccountLimits["provider"], string];
  return {
    id, provider, name, disabled: false, usable: true, why: null, stale: false,
    observedAt: "2026-11-05T12:00:00.000Z", thresholdPct: 95,
    windows: fills.map((fill, k) => ({ key: k === 0 ? "five_hour" : "seven_day", fill, resetsAt: null, resetPassed: false, burnPerHour: null, etaFull: null })),
    snapshot: null,
    ...over,
  };
}

const report = (...accounts: AccountLimits[]): LimitsReport => ({ v: 1, at: "2026-11-05T12:00:00.000Z", accounts });
const idle = () => false;

test("same-provider Claude accounts are offered after-turn and now, emptiest first", () => {
  const c = candidatesFor("claude/work", report(acct("claude/work", [92]), acct("claude/b", [60, 40]), acct("claude/a", [10, 20])), idle);
  assert.deepEqual(c.map((x) => [x.target, x.how]), [
    ["claude/a", ["after-turn", "now"]],
    ["claude/b", ["after-turn", "now"]],
  ]);
  assert.equal(c[0].fill, 20, "fill is the fullest window");
});

test("the source account and unusable accounts are never offered", () => {
  const c = candidatesFor("claude/work", report(
    acct("claude/work", [92]),
    acct("claude/full", [97], { usable: false, why: "at 97%" }),
    acct("claude/stale", [5], { usable: false, stale: true, why: "stale" }),
  ), idle);
  assert.deepEqual(c, []);
});

test("a Claude account running its own session is not lent; handoff remains", () => {
  const c = candidatesFor("claude/work", report(acct("claude/work", [92]), acct("claude/busy", [10])), (id) => id === "claude/busy");
  assert.deepEqual(c.map((x) => [x.target, x.how]), [["claude/busy", ["handoff"]]]);
});

test("Codex moves by takeover (now) or handoff, never after-turn", () => {
  const c = candidatesFor("codex/one", report(acct("codex/one", [95]), acct("codex/two", [5])), idle);
  assert.deepEqual(c.map((x) => [x.target, x.how]), [["codex/two", ["now", "handoff"]]]);
});

test("the emptiest usable account of another provider is offered as a handoff, after same-provider ones", () => {
  const c = candidatesFor("claude/work", report(
    acct("claude/work", [92]),
    acct("claude/b", [50]),
    acct("codex/x", [30]),
    acct("codex/y", [5]),
  ), idle);
  assert.deepEqual(c.map((x) => [x.target, x.how]), [
    ["claude/b", ["after-turn", "now"]],
    ["codex/y", ["handoff"]],
  ]);
});

test("Antigravity is never a target: it has no move path", () => {
  const c = candidatesFor("claude/work", report(acct("claude/work", [92]), acct("antigravity/g", [1])), idle);
  assert.deepEqual(c, []);
});
