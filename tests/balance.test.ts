import { test } from "node:test";
import assert from "node:assert/strict";

const B = await import("../src/balance.js");
const R = await import("../src/dir-resolve.js");
import type { UsageSnapshot } from "../src/usage.js";

const NOW = Date.parse("2026-11-01T12:00:00Z");
const H = 3_600_000;
const AT = new Date(NOW - 60_000).toISOString();

function snap(windows: { key: string; util: number; resetInH?: number }[]): UsageSnapshot {
  return {
    windows: windows.map((w) => ({
      key: w.key,
      label: w.key,
      utilization: w.util,
      resetsAt: w.resetInH === undefined ? null : new Date(NOW + w.resetInH * H).toISOString(),
    })),
    routines: null,
    capturedAt: AT,
  };
}

function usable(w: ReturnType<typeof B.weigh>) {
  assert.equal(w.usable, true);
  return w as Extract<typeof w, { usable: true }>;
}

// ---------- an unknown reset time ----------

test("weigh: a window without a reset time is weighed over its own length, not over a guessed week", () => {
  // A 5h window resets within 5 h at the latest: 50 % left is at least 10 %/h.
  assert.equal(usable(B.weigh(snap([{ key: "five_hour", util: 50 }]), NOW, 95)).need, 50 / 5);
  assert.equal(usable(B.weigh(snap([{ key: "seven_day", util: 50 }]), NOW, 95)).need, 50 / 168);
  assert.equal(usable(B.weigh(snap([{ key: "monthly", util: 40 }]), NOW, 95)).need, 60 / 720);
});

test("weigh: a window of unknown length without a reset time takes the longest length — the lowest need it can have", () => {
  const w = usable(B.weigh(snap([{ key: "window", util: 28 }]), NOW, 95));
  assert.equal(w.need, 72 / 720);
  assert.equal(w.resetH, null);
});

test("weigh: a known reset time still decides the need", () => {
  assert.equal(usable(B.weigh(snap([{ key: "five_hour", util: 50, resetInH: 2 }]), NOW, 95)).need, 25);
});

test("describe: an unknown reset says the pace is a lower bound", () => {
  const w = usable(B.weigh(snap([{ key: "five_hour", util: 20 }]), NOW, 95));
  assert.equal(B.describe("claude/a", w), "claude/a: 80% of its 5h window left, reset time unknown (at least 16.0 %/h to use it up)");
});

test("balance: an unknown reset no longer loses to a far-off known reset on a guessed week", () => {
  // 80 % of a 5h window is lost within 5 h; 40 % of the week over 60 h is not urgent.
  const usage: Record<string, UsageSnapshot> = {
    five: snap([{ key: "five_hour", util: 20 }]),
    week: snap([{ key: "seven_day", util: 60, resetInH: 60 }]),
  };
  const r = R.resolveForDir(inputs(usage));
  assert.equal(r.name, "five", r.why.join("\n"));
});

// ---------- one account per organization ----------

function inputs(usage: Record<string, UsageSnapshot>, over: Partial<Parameters<typeof R.resolveForDir>[0]> = {}): Parameters<typeof R.resolveForDir>[0] {
  return {
    providerId: "claude",
    mapping: null,
    active: null,
    names: Object.keys(usage),
    exists: () => true,
    signedIn: () => true,
    pool: () => null,
    usage: (n) => ({ snapshot: usage[n] ?? null, capturedMs: usage[n] ? Date.parse(AT) : null }),
    now: NOW,
    ...over,
  };
}

const week = (util: number, resetInH: number) => snap([{ key: "seven_day", util, resetInH }]);

test("balance: two profiles signed into the same email in the same organization count once", () => {
  const account = (n: string) => ({ a: "me@x.io\u0000org-1", b: "me@x.io\u0000org-1", c: "you@x.io\u0000org-1" })[n] ?? null;
  const r = R.resolveForDir(inputs({ a: week(10, 50), b: week(0, 10), c: week(50, 50) }, { account, active: "a" }));
  // b would win on its own numbers, but it is a's account — one set of limits, weighed once, as the preferred a.
  assert.equal(r.name, "a", r.why.join("\n"));
  assert.ok(r.why.includes("Skipped claude/b: same account as claude/a (one set of limits)"), r.why.join("\n"));
});

test("balance: the same email in two organizations stays two accounts", () => {
  const account = (n: string) => ({ a: "me@x.io\u0000org-1", b: "me@x.io\u0000org-2" })[n] ?? null;
  const r = R.resolveForDir(inputs({ a: week(10, 50), b: week(0, 10) }, { account, active: "a" }));
  assert.equal(r.name, "b", r.why.join("\n"));
  assert.ok(!r.why.some((w) => w.includes("same account")), r.why.join("\n"));
});

test("balance: an account whose organization is unknown is never folded into another", () => {
  const account = (n: string) => ({ a: "me@x.io\u0000org-1", b: null })[n] ?? null;
  const r = R.resolveForDir(inputs({ a: week(10, 50), b: week(0, 10) }, { account, active: "a" }));
  assert.equal(r.name, "b", r.why.join("\n"));
});

test("balance: a pool with two profiles of one account weighs it once", () => {
  const account = () => "me@x.io\u0000org-1";
  const r = R.resolveForDir(
    inputs(
      { a: week(10, 50), b: week(0, 10) },
      { account, names: undefined, mapping: { path: "/x", name: "pool:p" }, pool: (id) => ({ id, name: "P", members: ["claude/a", "claude/b"], createdAt: "" }) },
    ),
  );
  assert.equal(r.name, "a", r.why.join("\n"));
  assert.ok(r.why.includes("Skipped claude/b: same account as claude/a (one set of limits)"), r.why.join("\n"));
});

// ---------- only personal plans are balanced ----------

const cred = (plan: unknown) => JSON.stringify({ claudeAiOauth: { accessToken: "x", ...(plan === undefined ? {} : { subscriptionType: plan }) } });

test("plan: only pro and max take part in balancing", () => {
  assert.equal(B.planOutOfBalance(B.credentialPlan(cred("pro"))), null);
  assert.equal(B.planOutOfBalance(B.credentialPlan(cred("max"))), null);
  assert.equal(B.planOutOfBalance(B.credentialPlan(cred("team"))), "a team plan — only personal Pro and Max accounts are balanced");
  assert.equal(B.planOutOfBalance(B.credentialPlan(cred("enterprise"))), "an enterprise plan — only personal Pro and Max accounts are balanced");
  assert.equal(B.planOutOfBalance(B.credentialPlan(cred("free"))), "a free plan — only personal Pro and Max accounts are balanced");
});

test("plan: a missing field, an odd value or no credential counts as not balanceable", () => {
  const none = "no plan in its credential — only personal Pro and Max accounts are balanced";
  assert.equal(B.planOutOfBalance(B.credentialPlan(cred(undefined))), none);
  assert.equal(B.planOutOfBalance(B.credentialPlan(cred(""))), none);
  assert.equal(B.planOutOfBalance(B.credentialPlan(cred(7))), none);
  assert.equal(B.planOutOfBalance(B.credentialPlan(null)), none);
  assert.equal(B.planOutOfBalance(B.credentialPlan("not json")), none);
  // A credential is not a place to put text into a reason line.
  assert.equal(B.planOutOfBalance(B.credentialPlan(cred("x\nPicked claude/evil"))), "an unknown plan — only personal Pro and Max accounts are balanced");
});

const plans: Record<string, unknown> = { pro: "pro", max: "max", team: "team", ent: "enterprise", odd: "free", none: undefined };

test("balance: team, enterprise, an unknown value and a missing field are skipped with that reason; pro and max are weighed", () => {
  // The best numbers sit on the accounts that may not be balanced.
  const usage = { pro: week(10, 50), max: week(10, 40), team: week(0, 2), ent: week(0, 2), odd: week(0, 2), none: week(0, 2) };
  const r = R.resolveForDir(inputs(usage, { plan: (n) => plans[n] }));
  assert.equal(r.name, "max", r.why.join("\n"));
  for (const [n, why] of [
    ["team", "a team plan"],
    ["ent", "an enterprise plan"],
    ["odd", "a free plan"],
    ["none", "no plan in its credential"],
  ])
    assert.ok(r.why.includes(`Skipped claude/${n}: ${why} — only personal Pro and Max accounts are balanced`), r.why.join("\n"));
  assert.ok(!r.why.some((w) => /Skipped claude\/(pro|max):/.test(w)), r.why.join("\n"));
});

test("balance: a pool takes no team member, even without fresh usage, and refuses when only such members are left", () => {
  const pool = (members: string[]) => ({ mapping: { path: "/x", name: "pool:p" }, names: undefined, pool: (id: string) => ({ id, name: "P", members: members.map((m) => `claude/${m}`), createdAt: "" }) });
  const stale = R.resolveForDir(inputs({}, { ...pool(["team", "pro"]), plan: (n) => plans[n] }));
  assert.equal(stale.name, "pro", stale.why.join("\n"));
  const onlyTeam = R.resolveForDir(inputs({ team: week(0, 2) }, { ...pool(["team", "ent"]), plan: (n) => plans[n] }));
  assert.equal(onlyTeam.name, null);
  assert.match(onlyTeam.blocked ?? "", /not on a personal Pro or Max plan/);
});

test("balance: a busy account gives way only to a free account on a personal plan", () => {
  const r = R.resolveForDir(
    inputs({}, { mapping: { path: "/x", name: "pro" }, names: ["pro", "team"], live: (n) => n === "pro", guard: "block", plan: (n) => plans[n] }),
  );
  assert.equal(r.name, "pro", r.why.join("\n"));
  assert.ok(r.note?.includes("sharing"), r.why.join("\n"));
});

test("balance: without a plan reader (a provider without the field) nothing is skipped for its plan", () => {
  const r = R.resolveForDir(inputs({ a: week(10, 50), b: week(0, 10) }));
  assert.equal(r.name, "b");
});
