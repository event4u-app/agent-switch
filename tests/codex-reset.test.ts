import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { availableResetCredits, redeemResetCredit } from "../src/codex-reset.js";

// The redeem call itself would consume a real, scarce reset credit, so it is not
// exercised here — only the safe-degradation path (no token → no network call).

test("availableResetCredits / redeemResetCredit degrade safely with no auth token", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asw-codex-reset-"));
  try {
    assert.equal(await availableResetCredits(dir), null); // no auth.json → no network
    assert.deepEqual(await redeemResetCredit(dir), { ok: false, reason: "no token" });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

import { autoRedeemDue, resetReflected, usageAfterRedeem } from "../src/codex-reset.js";
import type { UsageSnapshot } from "../src/usage.js";

function snap(utils: number[], credits: number | null = 1, resetsAt: string | null = "2026-11-04T13:00:00.000Z"): UsageSnapshot {
  return {
    windows: utils.map((u, i) => ({ key: i === 0 ? "five_hour" : "seven_day", label: i === 0 ? "5h" : "7d", utilization: u, resetsAt })),
    routines: null,
    capturedAt: "2026-11-04T08:14:31.000Z",
    resetCredits: credits,
  };
}

test("resetReflected: only a drop of the highest window counts as the reset showing up", () => {
  assert.equal(resetReflected(snap([100, 40]), snap([100, 40])), false, "the endpoint still reports the old numbers");
  assert.equal(resetReflected(snap([100, 40]), snap([0, 0])), true);
  assert.equal(resetReflected(snap([100, 40]), null), false, "an unreadable read proves nothing");
  assert.equal(resetReflected(null, snap([0])), true, "no baseline: the first readable snapshot is the best there is");
  assert.equal(resetReflected(snap([0, 0]), snap([0, 0])), true, "nothing to drop from");
});

test("usageAfterRedeem re-reads until the reset shows, then returns that snapshot", async () => {
  const reads = [snap([100]), snap([100]), snap([0])];
  const sleeps: number[] = [];
  const got = await usageAfterRedeem(async () => reads.shift() ?? null, snap([100]), { attempts: 5, delayMs: 7, sleep: async (ms) => void sleeps.push(ms) });
  assert.equal(got?.windows[0].utilization, 0);
  assert.deepEqual(sleeps, [7, 7, 7], "waits before each read, stops at the first reflected one");
});

test("usageAfterRedeem gives up after its attempts and returns the last readable snapshot", async () => {
  let n = 0;
  const got = await usageAfterRedeem(async () => (++n === 2 ? null : snap([100])), snap([100]), { attempts: 3, delayMs: 0, sleep: async () => {} });
  assert.equal(n, 3);
  assert.equal(got?.windows[0].utilization, 100, "last readable read, never null over a known snapshot");
});

test("autoRedeemDue: a limit actually reached, a credit banked, and not yet redeemed in this reset cycle", () => {
  const cycleOf = (s: UsageSnapshot) => s.windows[0].resetsAt ?? "";
  assert.deepEqual(autoRedeemDue(snap([100, 30], 2), undefined), { cycle: cycleOf(snap([100])) });
  assert.equal(autoRedeemDue(snap([99, 30], 2), undefined), null, "below the limit the account still works");
  assert.equal(autoRedeemDue(snap([100], 0), undefined), null, "no credit banked");
  assert.equal(autoRedeemDue(snap([100], null), undefined), null, "credit count unknown — never guess with a scarce credit");
  assert.equal(autoRedeemDue(snap([100], 2), cycleOf(snap([100]))), null, "already redeemed in this cycle");
  assert.deepEqual(autoRedeemDue(snap([40, 100], 1, "2026-11-10T08:00:00.000Z"), "2026-11-04T13:00:00.000Z"), { cycle: "2026-11-10T08:00:00.000Z" }, "a new cycle may redeem again");
});
