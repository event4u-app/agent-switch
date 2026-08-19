import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_GUARD_POLICY,
  GUARD_REFUSED_EXIT,
  OVERRIDE_ENV,
  guardVerdict,
  inspectLoad,
  isGuardPolicy,
  overrideFromEnv,
  renderGuardMessage,
  type LoadInspection,
} from "../src/single-load.js";

const CFG = "/home/u/.agent-switch/claude/work/config";
const ENV_VAR = "CLAUDE_CONFIG_DIR";

/** Inspection with the process/fs/env layers fully injected — no real pids. */
function inspect(pids: number[], env: NodeJS.ProcessEnv = {}, cwds: Record<number, string> = {}) {
  return inspectLoad(CFG, ENV_VAR, {
    livePidsOf: () => pids,
    cwdOf: (pid) => cwds[pid] ?? null,
    startedMsOf: () => 1_000,
    env,
  });
}

// ---------- inspectLoad ----------

test("inspectLoad: no live pid means the profile is not loaded", () => {
  const i = inspect([]);
  assert.equal(i.loaded, false);
  assert.deepEqual(i.sessions, []);
  assert.equal(i.nested, false);
});

test("inspectLoad: one live pid carries pid, cwd and start time", () => {
  const i = inspect([4242], {}, { 4242: "/repo/foo" });
  assert.equal(i.loaded, true);
  assert.deepEqual(i.sessions, [{ pid: 4242, cwd: "/repo/foo", startedMs: 1_000 }]);
});

test("inspectLoad: several live pids are all reported", () => {
  const i = inspect([1, 2, 3]);
  assert.equal(i.sessions.length, 3);
  assert.equal(i.loaded, true);
});

test("inspectLoad: an unreadable cwd degrades to null, never throws", () => {
  const i = inspect([7], {}, {});
  assert.equal(i.sessions[0].cwd, null);
});

test("inspectLoad: nested when the isolation env var points at THIS config dir", () => {
  const i = inspect([9], { [ENV_VAR]: CFG });
  assert.equal(i.nested, true);
});

test("inspectLoad: not nested when the env var points at another profile", () => {
  const i = inspect([9], { [ENV_VAR]: "/home/u/.agent-switch/claude/privat/config" });
  assert.equal(i.nested, false);
});

test("inspectLoad: nested comparison is on the raw string (keychain-hash identity)", () => {
  // A trailing slash is a different CLAUDE_CONFIG_DIR string to Claude Code,
  // hence a different keychain entry — so it must NOT count as the same load.
  const i = inspect([9], { [ENV_VAR]: CFG + "/" });
  assert.equal(i.nested, false);
});

test("inspectLoad: a dead pid never reaches the inspection (liveness filter owns it)", () => {
  // liveSessionPids filters dead pids; with the injection returning none, a
  // stale pid file is indistinguishable from no session at all.
  assert.equal(inspect([]).loaded, false);
});

// ---------- guardVerdict ----------

const LOADED: LoadInspection = { sessions: [{ pid: 1, cwd: null, startedMs: null }], loaded: true, nested: false };
const FREE: LoadInspection = { sessions: [], loaded: false, nested: false };
const NESTED: LoadInspection = { ...LOADED, nested: true };

test("guardVerdict: default policy is block", () => {
  assert.equal(DEFAULT_GUARD_POLICY, "block");
});

test("guardVerdict: an unloaded profile always passes", () => {
  for (const policy of ["block", "warn", "off"] as const) {
    assert.equal(guardVerdict({ policy, inspection: FREE }), "allow");
  }
});

test("guardVerdict: block refuses a second load", () => {
  assert.equal(guardVerdict({ policy: "block", inspection: LOADED }), "refuse");
});

test("guardVerdict: warn allows but reports", () => {
  assert.equal(guardVerdict({ policy: "warn", inspection: LOADED }), "warn");
});

test("guardVerdict: off is fully inert", () => {
  assert.equal(guardVerdict({ policy: "off", inspection: LOADED }), "allow");
});

test("guardVerdict: a nested start is never refused", () => {
  assert.equal(guardVerdict({ policy: "block", inspection: NESTED }), "allow");
});

test("guardVerdict: an override downgrades a refusal to a warning, not to silence", () => {
  assert.equal(guardVerdict({ policy: "block", inspection: LOADED, overridden: true }), "warn");
});

test("guardVerdict: an undetectable provider can never refuse", () => {
  // codex/antigravity write no pid files — no evidence must not become a block.
  assert.equal(guardVerdict({ policy: "block", inspection: LOADED, detectable: false }), "allow");
});

// ---------- override env ----------

test("overrideFromEnv: unset / empty / 0 / false do not override", () => {
  for (const v of [undefined, "", "0", "false", "FALSE"]) {
    assert.equal(overrideFromEnv(v === undefined ? {} : { [OVERRIDE_ENV]: v }), false, `value ${String(v)}`);
  }
});

test("overrideFromEnv: any other value overrides", () => {
  for (const v of ["1", "yes", "true"]) {
    assert.equal(overrideFromEnv({ [OVERRIDE_ENV]: v }), true, `value ${v}`);
  }
});

// ---------- policy parsing ----------

test("isGuardPolicy accepts the three values and rejects anything else", () => {
  for (const v of ["block", "warn", "off"]) assert.equal(isGuardPolicy(v), true);
  for (const v of ["BLOCK", "on", "", null, 1, undefined]) assert.equal(isGuardPolicy(v), false);
});

// ---------- message ----------

test("renderGuardMessage: a refusal names the holder and every way forward", () => {
  const msg = renderGuardMessage({
    profile: "work",
    binary: "claude",
    verdict: "refuse",
    offerForceFlag: true,
    now: 1_000 + 5 * 60_000,
    inspection: { loaded: true, nested: false, sessions: [{ pid: 4242, cwd: "/repo/foo", startedMs: 1_000 }] },
  });
  assert.match(msg, /already loaded/);
  assert.match(msg, /pid 4242/);
  assert.match(msg, /started 5m ago/);
  assert.match(msg, /\/repo\/foo/);
  assert.match(msg, /agent-switch use <other-profile>/);
  assert.match(msg, /--force/);
  assert.match(msg, /agent-switch guard warn/);
  assert.match(msg, /agent-switch guard off/);
});

test("renderGuardMessage: exactly ONE override is offered, matching the caller", () => {
  // Two names for one action is a choice the reader has to make for no reason.
  const withFlag = renderGuardMessage({ profile: "w", binary: "claude", verdict: "refuse", offerForceFlag: true, inspection: LOADED });
  assert.match(withFlag, /--force/);
  assert.doesNotMatch(withFlag, new RegExp(OVERRIDE_ENV));

  const wrapper = renderGuardMessage({ profile: "w", binary: "claude", verdict: "refuse", offerForceFlag: false, inspection: LOADED });
  assert.match(wrapper, new RegExp(`${OVERRIDE_ENV}=1 claude`));
  assert.doesNotMatch(wrapper, /--force/);
});

test("renderGuardMessage: free profiles are named, not left for the user to look up", () => {
  const one = renderGuardMessage({ profile: "work", binary: "claude", verdict: "refuse", inspection: LOADED, alternatives: ["privat"] });
  assert.match(one, /agent-switch use privat/);
  assert.doesNotMatch(one, /also free/);

  const many = renderGuardMessage({ profile: "work", binary: "claude", verdict: "refuse", inspection: LOADED, alternatives: ["privat", "event4u"] });
  assert.match(many, /agent-switch use privat/);
  assert.match(many, /also free: event4u/);

  const none = renderGuardMessage({ profile: "work", binary: "claude", verdict: "refuse", inspection: LOADED, alternatives: [] });
  assert.match(none, /agent-switch use <other-profile>/);
});

test("renderGuardMessage: the `use` context describes what happens NEXT, not what just did", () => {
  const refuse = renderGuardMessage({ profile: "work", binary: "claude", verdict: "refuse", context: "use", inspection: LOADED });
  assert.match(refuse, /the next `claude` started here will be refused/);
  assert.doesNotMatch(refuse, /continuing anyway/);

  const warn = renderGuardMessage({ profile: "work", binary: "claude", verdict: "warn", context: "use", inspection: LOADED });
  assert.match(warn, /a second session will be allowed \(guard: warn\)/);
});

test("renderGuardMessage: the action column is wide enough for its widest action", () => {
  const msg = renderGuardMessage({
    profile: "work",
    binary: "claude",
    verdict: "refuse",
    offerForceFlag: false,
    inspection: LOADED,
    alternatives: ["a-rather-long-profile-name"],
  });
  const actions = msg.slice(msg.indexOf("Ways forward:")).split("\n").filter((l) => l.startsWith("  "));
  assert.ok(actions.length >= 3);
  for (const line of actions) {
    // Every row keeps at least two spaces between action and explanation, so
    // the longest action can never run into its own text.
    assert.match(line, /^ {2}\S.*\S {2,}\S/, `columns collide: ${JSON.stringify(line)}`);
  }
  assert.match(msg, /agent-switch use a-rather-long-profile-name {2,}switch to the account that is free/);
});

test("renderGuardMessage: a warning says it is continuing and offers no escape list", () => {
  const msg = renderGuardMessage({ profile: "work", binary: "claude", verdict: "warn", inspection: LOADED });
  assert.match(msg, /continuing anyway/);
  assert.doesNotMatch(msg, /Ways forward/);
});

test("renderGuardMessage: plural wording for several sessions", () => {
  const msg = renderGuardMessage({
    profile: "work",
    binary: "claude",
    verdict: "refuse",
    inspection: { loaded: true, nested: false, sessions: [{ pid: 1, cwd: null, startedMs: null }, { pid: 2, cwd: null, startedMs: null }] },
  });
  assert.match(msg, /2 running claude sessions/);
});

test("renderGuardMessage: a missing start time and cwd simply drop out of the line", () => {
  const msg = renderGuardMessage({
    profile: "work",
    binary: "claude",
    verdict: "refuse",
    inspection: { loaded: true, nested: false, sessions: [{ pid: 55, cwd: null, startedMs: null }] },
  });
  assert.match(msg, /pid 55/);
  assert.doesNotMatch(msg, /started/);
});

test("the wrapper exit code is distinct from every generic failure code", () => {
  assert.equal(GUARD_REFUSED_EXIT, 86);
  for (const generic of [0, 1, 2, 126, 127]) assert.notEqual(GUARD_REFUSED_EXIT, generic);
});
