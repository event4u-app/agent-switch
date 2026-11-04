import { test } from "node:test";
import assert from "node:assert/strict";

import { parseCodexUsage, parseRolloutRateLimits, rolloutUsage } from "../src/codex-usage.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

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

const rlLine = (ts: string, p: number, s: number) =>
  JSON.stringify({
    timestamp: ts,
    type: "event_msg",
    payload: {
      type: "token_count",
      rate_limits: {
        primary: { used_percent: p, window_minutes: 300, resets_at: 1793705605 },
        secondary: { used_percent: s, window_minutes: 10080, resets_at: 1793775756 },
      },
    },
  });

test("parseRolloutRateLimits maps the session file's rate_limits like the live endpoint", () => {
  const snap = parseRolloutRateLimits(JSON.parse(rlLine("2026-11-04T08:00:00.000Z", 40.4, 18)));
  assert.deepEqual(snap, {
    windows: [
      { key: "five_hour", label: "5h", utilization: 40, resetsAt: new Date(1793705605 * 1000).toISOString() },
      { key: "seven_day", label: "7d", utilization: 18, resetsAt: new Date(1793775756 * 1000).toISOString() },
    ],
    routines: null,
    capturedAt: "2026-11-04T08:00:00.000Z",
    resetCredits: null,
  });
  assert.equal(parseRolloutRateLimits({ type: "event_msg", payload: { type: "token_count", rate_limits: null } }), null);
  assert.equal(parseRolloutRateLimits({ type: "response_item" }), null);
});

test("rolloutUsage reads the newest rate_limits of the newest session file, only when newer than the last capture", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "asw-rollout-"));
  try {
    const day = path.join(home, "sessions", "2026", "11", "04");
    fs.mkdirSync(day, { recursive: true });
    const older = path.join(day, "rollout-a.jsonl");
    const newer = path.join(day, "rollout-b.jsonl");
    fs.writeFileSync(older, rlLine("2026-11-04T07:00:00.000Z", 10, 10) + "\n");
    fs.writeFileSync(newer, [rlLine("2026-11-04T08:00:00.000Z", 50, 20), JSON.stringify({ type: "response_item" }), rlLine("2026-11-04T08:05:00.000Z", 97, 21), "{broken"].join("\n") + "\n");
    fs.utimesSync(older, new Date("2026-11-04T07:00:00Z"), new Date("2026-11-04T07:00:00Z"));
    fs.utimesSync(newer, new Date("2026-11-04T08:05:00Z"), new Date("2026-11-04T08:05:00Z"));
    const got = rolloutUsage(home, Date.parse("2026-11-04T08:01:00Z"));
    assert.equal(got?.windows[0].utilization, 97, "last rate_limits line of the newest file");
    assert.equal(got?.capturedAt, "2026-11-04T08:05:00.000Z");
    assert.equal(rolloutUsage(home, Date.parse("2026-11-04T08:06:00Z")), null, "nothing newer than the last capture");
    assert.equal(rolloutUsage(path.join(home, "nope"), 0), null, "no sessions dir");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
