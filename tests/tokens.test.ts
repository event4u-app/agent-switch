import { test } from "node:test";
import assert from "node:assert/strict";

import { parseCcusageDaily, costBasisFor, resolveCcusageRunner } from "../src/tokens.js";

// A synthetic object matching the real `ccusage daily --json` shape captured in
// spikes/t7 — deliberately synthetic so no real usage/cost data is committed.
const SAMPLE = {
  daily: [
    { agent: "claude", period: "2026-07-14", inputTokens: 100, outputTokens: 20, cacheCreationTokens: 5, cacheReadTokens: 50, totalTokens: 175, totalCost: 1.23, modelsUsed: ["claude-opus-4-8"], modelBreakdowns: [] },
    { agent: "claude", period: "2026-07-15", inputTokens: 200, outputTokens: 40, cacheCreationTokens: 10, cacheReadTokens: 80, totalTokens: 330, totalCost: 2.0, modelsUsed: ["claude-fable-5"], modelBreakdowns: [] },
  ],
  totals: { inputTokens: 300, outputTokens: 60, cacheCreationTokens: 15, cacheReadTokens: 130, totalTokens: 505, totalCost: 3.23 },
};

test("parseCcusageDaily maps the real shape and stamps costBasis", () => {
  const r = parseCcusageDaily(SAMPLE, "notional");
  assert.equal(r.days.length, 2);
  assert.equal(r.days[0].date, "2026-07-14");
  assert.equal(r.days[0].totalTokens, 175);
  assert.equal(r.days[0].cost, 1.23);
  assert.deepEqual(r.days[1].models, ["claude-fable-5"]);
  assert.equal(r.totals.totalTokens, 505);
  assert.equal(r.totals.cost, 3.23);
  assert.equal(r.costBasis, "notional");
});

test("parseCcusageDaily derives totals from days when absent", () => {
  const r = parseCcusageDaily({ daily: SAMPLE.daily }, "computed");
  assert.equal(r.totals.totalTokens, 505); // 175 + 330
  assert.ok(Math.abs(r.totals.cost - 3.23) < 1e-9);
});

test("parseCcusageDaily degrades on unknown/empty shapes, never throws", () => {
  assert.deepEqual(parseCcusageDaily(null, "notional").days, []);
  assert.deepEqual(parseCcusageDaily({}, "notional").days, []);
  assert.deepEqual(parseCcusageDaily({ daily: "nope" }, "notional").days, []);
  // an array at the top level is also accepted
  assert.equal(parseCcusageDaily([{ period: "d", totalTokens: 9, totalCost: 0.1, modelsUsed: [] }], "notional").days.length, 1);
});

test("costBasisFor: subscription/OAuth → notional, raw API key → computed", () => {
  assert.equal(costBasisFor(null), "notional");
  assert.equal(costBasisFor(JSON.stringify({ claudeAiOauth: { accessToken: "x" } })), "notional");
  assert.equal(costBasisFor("sk-ant-abc123"), "computed");
  assert.equal(costBasisFor("sk-proj-xyz"), "computed");
  assert.equal(costBasisFor("garbage"), "notional"); // safe default never overstates spend
});

test("resolveCcusageRunner honours the env override", () => {
  assert.deepEqual(resolveCcusageRunner({ AGENT_SWITCH_CCUSAGE: "npx -y ccusage@latest" } as any), ["npx", "-y", "ccusage@latest"]);
});
