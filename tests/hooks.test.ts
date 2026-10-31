import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  withHooksInstalled,
  withHooksRemoved,
  hooksInstalled,
  installHooks,
  uninstallHooks,
  readSettings,
  appendEvent,
  readEvents,
  eventFile,
  profileFromConfigDir,
  HOOK_EVENTS,
  HOOK_MARKER,
  EVENT_RING_CAP,
  hookNotice,
  waitingSessions,
} from "../src/hooks.js";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "asw-hooks-"));
}

// ---------- pure settings transforms ----------

test("withHooksInstalled adds a marked entry for every event, preserving user hooks", () => {
  const user = { hooks: { SessionStart: [{ hooks: [{ type: "command", command: "my-own-thing" }] }] }, other: 42 };
  const next = withHooksInstalled(user);
  assert.equal(next.other, 42, "unrelated settings preserved");
  for (const ev of HOOK_EVENTS) {
    assert.ok(Array.isArray(next.hooks[ev]));
    assert.ok(next.hooks[ev].some((e: any) => e[HOOK_MARKER] === true), `ours present for ${ev}`);
  }
  // the user's own SessionStart entry survives
  assert.ok(next.hooks.SessionStart.some((e: any) => e.hooks?.[0]?.command === "my-own-thing"));
});

test("withHooksInstalled is idempotent (no duplicate entries)", () => {
  const once = withHooksInstalled({});
  const twice = withHooksInstalled(once);
  for (const ev of HOOK_EVENTS) {
    const ours = twice.hooks[ev].filter((e: any) => e[HOOK_MARKER] === true);
    assert.equal(ours.length, 1, `exactly one of ours for ${ev}`);
  }
});

test("withHooksRemoved strips only our entries, keeps the user's", () => {
  const user = { hooks: { SessionStart: [{ hooks: [{ type: "command", command: "my-own-thing" }] }] } };
  const withOurs = withHooksInstalled(user);
  const removed = withHooksRemoved(withOurs);
  // user's SessionStart entry remains; our entries gone; empty event arrays dropped
  assert.ok(removed.hooks.SessionStart.some((e: any) => e.hooks?.[0]?.command === "my-own-thing"));
  assert.ok(!removed.hooks.SessionStart.some((e: any) => e[HOOK_MARKER] === true));
  assert.ok(!("SessionEnd" in (removed.hooks ?? {})), "event with only-ours entry is dropped");
});

test("withHooksRemoved drops the hooks object entirely when nothing else remains", () => {
  const removed = withHooksRemoved(withHooksInstalled({}));
  assert.ok(!("hooks" in removed), "empty hooks object removed");
});

test("hooksInstalled detects full vs partial install", () => {
  assert.equal(hooksInstalled({}), false);
  assert.equal(hooksInstalled(withHooksInstalled({})), true);
  const partial = withHooksInstalled({});
  delete partial.hooks.PostCompact; // remove one → not fully installed
  assert.equal(hooksInstalled(partial), false);
});

// ---------- disk round-trip ----------

test("installHooks + uninstallHooks round-trip on disk (idempotent, reversible)", () => {
  const cfg = tmp();
  fs.writeFileSync(path.join(cfg, "settings.json"), JSON.stringify({ model: "x", hooks: { Stop: [{ hooks: [{ type: "command", command: "keep-me" }] }] } }));

  assert.equal(installHooks(cfg).changed, true);
  assert.equal(installHooks(cfg).changed, false, "second install is a no-op");
  const after = readSettings(cfg);
  assert.equal(after.model, "x", "unrelated key preserved");
  assert.ok(after.hooks.Stop.some((e: any) => e.hooks[0].command === "keep-me"), "user's Stop hook preserved");
  assert.ok(hooksInstalled(after));

  assert.equal(uninstallHooks(cfg).changed, true);
  const restored = readSettings(cfg);
  assert.ok(restored.hooks.Stop.some((e: any) => e.hooks[0].command === "keep-me"), "user's Stop hook still there");
  assert.ok(!hooksInstalled(restored));
  assert.equal(uninstallHooks(cfg).changed, false, "uninstall again is a no-op");
});

// ---------- event ring ----------

test("appendEvent rings at the cap and tolerates a malformed file", () => {
  const root = tmp();
  const f = eventFile(root, "claude", "work");
  for (let i = 0; i < EVENT_RING_CAP + 20; i++) appendEvent(f, { event: "SessionStart", at: new Date(0).toISOString(), sessionId: `s${i}` });
  const evs = readEvents(f);
  assert.equal(evs.length, EVENT_RING_CAP, "ring trimmed to cap");
  assert.equal(evs[evs.length - 1].sessionId, `s${EVENT_RING_CAP + 19}`, "newest kept");

  fs.writeFileSync(f, "not json at all\n{bad");
  appendEvent(f, { event: "SessionEnd", at: new Date(0).toISOString() });
  const after = readEvents(f);
  assert.equal(after.length, 1, "malformed file discarded, fresh start");
  assert.equal(after[0].event, "SessionEnd");
});

// ---------- config-dir → profile mapping ----------

test("profileFromConfigDir maps the agent-switch layout, rejects foreign dirs", () => {
  const root = "/root";
  assert.deepEqual(profileFromConfigDir("/root/claude/work/config", root), { provider: "claude", profile: "work" });
  assert.deepEqual(profileFromConfigDir("/root/codex/priv/config", root), { provider: "codex", profile: "priv" });
  assert.equal(profileFromConfigDir("/somewhere/else/.claude", root), null);
  assert.equal(profileFromConfigDir("/root/claude/work", root), null, "must end in /config");
});

// ---------- what a hook event tells the user ----------

const who = { provider: "claude", profile: "work" };
const at = "2026-10-31T10:00:00.000Z";

test("StopFailure is installed, so an existing install upgrades in place", () => {
  assert.ok((HOOK_EVENTS as readonly string[]).includes("StopFailure"));
  const old = withHooksInstalled({}, "agent-switch");
  delete (old.hooks as Record<string, unknown>).StopFailure;
  assert.equal(hooksInstalled(old), false);
  assert.equal(hooksInstalled(withHooksInstalled(old, "agent-switch")), true);
});

test("hookNotice names the reason a session stopped, per StopFailure error", () => {
  const cases: [string, RegExp][] = [
    ["rate_limit", /usage limit/],
    ["authentication_failed", /signed out/],
    ["oauth_org_not_allowed", /signed out/],
    ["account_on_hold", /on hold/],
    ["billing_error", /billing/],
    ["overloaded", /stopped with an error \(overloaded\)/],
  ];
  for (const [error, re] of cases) {
    const n = hookNotice({ event: "StopFailure", error, at }, who);
    assert.ok(n, error);
    assert.equal(n.kind, "warning");
    assert.match(n.message, re, error);
    assert.match(n.message, /claude\/work/);
  }
  const bare = hookNotice({ event: "StopFailure", at }, who);
  assert.match(bare!.message, /stopped with an error/);
});

test("hookNotice maps the host's own wait at the limit, and keeps the old notices", () => {
  assert.match(hookNotice({ event: "Notification", notificationType: "quota_auto_resume_armed", at }, who)!.message, /waiting for the limit to reset/);
  assert.match(hookNotice({ event: "Notification", notificationType: "quota_auto_resume_fired", at }, who)!.message, /resumed/);
  assert.match(hookNotice({ event: "Notification", notificationType: "quota_auto_resume_stale", at }, who)!.message, /stale/);
  assert.match(hookNotice({ event: "Notification", notificationType: "quota_auto_resume_disabled", at }, who)!.message, /auto-continue is off/);
  assert.match(hookNotice({ event: "Notification", notificationType: "quota_auto_resume_cancelled", at }, who)!.message, /cancelled/);
  assert.equal(hookNotice({ event: "Notification", at }, who)!.title, "Claude is waiting");
  assert.equal(hookNotice({ event: "Stop", at }, who)!.title, "Claude finished");
  assert.equal(hookNotice({ event: "SessionStart", at }, who), null);
});

test("waitingSessions: a StopFailure needs you; the host waiting out a limit does not", () => {
  const t = Date.parse(at);
  const events = [
    { event: "StopFailure", error: "rate_limit", sessionId: "a", at },
    { event: "Notification", notificationType: "quota_auto_resume_armed", sessionId: "b", at },
    { event: "Notification", notificationType: "quota_auto_resume_disabled", sessionId: "c", at },
  ];
  const w = waitingSessions(events, () => t);
  assert.equal(w.get("a"), at);
  assert.equal(w.has("b"), false);
  assert.equal(w.get("c"), at);
});
