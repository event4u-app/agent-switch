import { test } from "node:test";
import assert from "node:assert/strict";

import { buildLimits, type LimitsInputs } from "../src/link/limits.js";
import type { UsageSnapshot } from "../src/usage.js";

const NOW = Date.parse("2026-11-05T12:00:00Z");
const iso = (minutesFromNow: number) => new Date(NOW + minutesFromNow * 60_000).toISOString();

function snap(capturedMinAgo: number, windows: [string, number | null, number | null][]): UsageSnapshot {
  return {
    capturedAt: iso(-capturedMinAgo),
    routines: null,
    windows: windows.map(([key, utilization, resetInMin]) => ({ key, label: key, utilization, resetsAt: resetInMin === null ? null : iso(resetInMin) })),
  };
}

function inputs(over: Partial<LimitsInputs> & { snaps: Record<string, UsageSnapshot | null> }): LimitsInputs {
  const accounts = Object.keys(over.snaps).map((id) => {
    const [provider, name] = id.split("/") as [LimitsInputs["accounts"][number]["provider"], string];
    return { provider, name, disabled: false };
  });
  return {
    now: NOW,
    accounts,
    usage: (p, n) => {
      const s = over.snaps[`${p}/${n}`] ?? null;
      return { snapshot: s, capturedMs: s ? Date.parse(s.capturedAt) : null };
    },
    threshold: () => 95,
    freshMs: 10 * 60_000,
    ...over,
  };
}

test("a fresh account under its threshold is usable and reports every window", () => {
  const r = buildLimits(inputs({ snaps: { "claude/work": snap(2, [["five_hour", 40, 120], ["seven_day", 20, 3000]]) } }));
  assert.equal(r.v, 1);
  assert.equal(r.at, new Date(NOW).toISOString());
  const a = r.accounts[0];
  assert.equal(a.id, "claude/work");
  assert.equal(a.usable, true);
  assert.equal(a.stale, false);
  assert.equal(a.why, null);
  assert.deepEqual(a.windows.map((w) => [w.key, w.fill]), [["five_hour", 40], ["seven_day", 20]]);
  assert.equal(a.observedAt, iso(-2));
});

test("an account at its threshold in any window is not usable and says which", () => {
  const r = buildLimits(inputs({ snaps: { "claude/work": snap(1, [["five_hour", 96, 30], ["seven_day", 10, 3000]]) } }));
  assert.equal(r.accounts[0].usable, false);
  assert.match(r.accounts[0].why ?? "", /96%/);
});

test("the threshold is read per account", () => {
  const r = buildLimits(inputs({
    snaps: { "claude/a": snap(1, [["five_hour", 85, 30]]), "claude/b": snap(1, [["five_hour", 85, 30]]) },
    threshold: (_p, n) => (n === "a" ? 80 : 95),
  }));
  assert.deepEqual(r.accounts.map((a) => [a.name, a.usable]), [["a", false], ["b", true]]);
});

test("a snapshot older than the freshness window is stale and never usable", () => {
  const r = buildLimits(inputs({ snaps: { "codex/home": snap(11, [["five_hour", 10, 120]]) } }));
  assert.equal(r.accounts[0].stale, true);
  assert.equal(r.accounts[0].usable, false);
  assert.match(r.accounts[0].why ?? "", /stale/);
  // The numbers are still reported: stale is a label, not a deletion.
  assert.equal(r.accounts[0].windows[0].fill, 10);
});

test("a window whose reset has passed reads as unknown, not as its old fill", () => {
  const r = buildLimits(inputs({ snaps: { "claude/work": snap(3, [["five_hour", 99, -1], ["seven_day", 30, 3000]]) } }));
  const five = r.accounts[0].windows.find((w) => w.key === "five_hour")!;
  assert.equal(five.fill, null);
  assert.equal(five.resetPassed, true);
  assert.equal(r.accounts[0].usable, true);
});

test("an account with no readout is reported, not dropped", () => {
  const r = buildLimits(inputs({ snaps: { "antigravity/x": null } }));
  assert.equal(r.accounts.length, 1);
  assert.equal(r.accounts[0].usable, false);
  assert.equal(r.accounts[0].observedAt, null);
  assert.match(r.accounts[0].why ?? "", /no usage/);
});

test("a disabled account is reported as disabled and never usable", () => {
  const i = inputs({ snaps: { "claude/old": snap(1, [["five_hour", 5, 100]]) } });
  i.accounts[0].disabled = true;
  const r = buildLimits(i);
  assert.equal(r.accounts[0].disabled, true);
  assert.equal(r.accounts[0].usable, false);
  assert.match(r.accounts[0].why ?? "", /disabled/);
});

test("accounts come out in provider then name order, independent of input order", () => {
  const i = inputs({ snaps: { "codex/b": null, "claude/z": null, "claude/a": null } });
  const r = buildLimits(i);
  assert.deepEqual(r.accounts.map((a) => a.id), ["claude/a", "claude/z", "codex/b"]);
});

test("each window carries its burn per hour and hours until full, from the account's own captures", () => {
  const history = [{ at: iso(-120), windows: [{ key: "seven_day", utilization: 48 }] }];
  const r = buildLimits(inputs({ snaps: { "claude/work": snap(0, [["five_hour", 10, 120], ["seven_day", 60, 3000]]) }, history: () => history }));
  const w = Object.fromEntries(r.accounts[0].windows.map((x) => [x.key, x]));
  assert.equal(w.seven_day.burnPerHour, 6);
  assert.equal(w.seven_day.etaFull, Math.round(((95 - 60) / 6) * 10) / 10);
  assert.equal(w.five_hour.burnPerHour, null, "no captures for this window → unknown");
  assert.equal(w.five_hour.etaFull, null);
});

test("without history every window still has the two fields, as null", () => {
  const r = buildLimits(inputs({ snaps: { "claude/work": snap(0, [["seven_day", 60, 3000]]) } }));
  assert.equal(r.accounts[0].windows[0].burnPerHour, null);
  assert.equal(r.accounts[0].windows[0].etaFull, null);
});
