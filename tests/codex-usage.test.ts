import { test } from "node:test";
import assert from "node:assert/strict";

import { parseCodexUsage } from "../src/codex-usage.js";

// Codex usage comes live from `GET /backend-api/wham/usage`. These test the pure
// parse of that response shape (the network fetch itself is not unit-tested).

test("parseCodexUsage maps primary/secondary windows + reset credits (plus plan)", () => {
  const raw = {
    plan_type: "plus",
    rate_limit: {
      allowed: true,
      limit_reached: false,
      primary_window: { used_percent: 7, limit_window_seconds: 604800, reset_at: 1784689389 },
      secondary_window: { used_percent: 12, limit_window_seconds: 18000, reset_at: 1784600000 },
    },
    rate_limit_reset_credits: { available_count: 4 },
  };
  const s = parseCodexUsage(raw, "AT");
  assert.ok(s);
  assert.deepEqual(
    s!.windows.map((w) => `${w.key}:${w.label}:${w.utilization}`),
    ["seven_day:7d:7", "five_hour:5h:12"],
  );
  assert.equal(s!.windows[0].resetsAt, new Date(1784689389 * 1000).toISOString());
  assert.equal(s!.resetCredits, 4);
  assert.equal(s!.capturedAt, "AT");
});

test("parseCodexUsage maps a monthly window (free plan), no reset credits", () => {
  const raw = {
    plan_type: "free",
    rate_limit: { primary_window: { used_percent: 5, limit_window_seconds: 2592000, reset_at: 1786676591 }, secondary_window: null },
  };
  const s = parseCodexUsage(raw, "AT");
  assert.deepEqual(s!.windows.map((w) => `${w.label}:${w.utilization}`), ["30d:5"]);
  assert.equal(s!.resetCredits, null);
});

test("parseCodexUsage keeps a snapshot that has only reset credits (no window data)", () => {
  const s = parseCodexUsage({ rate_limit: { primary_window: null, secondary_window: null }, rate_limit_reset_credits: { available_count: 2 } }, "AT");
  assert.ok(s);
  assert.deepEqual(s!.windows, []);
  assert.equal(s!.resetCredits, 2);
});

test("parseCodexUsage returns null when there is no rate_limit / nothing to show", () => {
  assert.equal(parseCodexUsage(null, "AT"), null);
  assert.equal(parseCodexUsage({ plan_type: "free" }, "AT"), null);
  assert.equal(parseCodexUsage({ rate_limit: { primary_window: null, secondary_window: null } }, "AT"), null);
});
