import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  withHooksInstalled,
  withHooksRemoved,
  hooksInstalled,
  hooksNeedMigration,
  installHooks,
  uninstallHooks,
  readSettings,
  appendEvent,
  readEvents,
  eventFile,
  profileFromConfigDir,
  HOOK_EVENTS,
  HOOK_MARKER,
  hookNotice,
  waitingSessions,
  resumeFields,
  resumeFactsFor,
  recordFromPayload,
  lastHookCwd,
  childrenOf,
  hooksRecordSubagents,
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

// The shape agent-switch ≤ 2.11 wrote: `async` on the matcher group, where
// Claude Code ignores it, so the turn waits for the hook
// (agents/evidence/hook-blocking-probe-2026-11.md).
function legacyEntry(bin = "agent-switch") {
  return { [HOOK_MARKER]: true, async: true, hooks: [{ type: "command", command: `${bin} __hook-event`, [HOOK_MARKER]: true }] };
}
function legacyInstall(user: Record<string, unknown> = {}) {
  const hooks: Record<string, unknown[]> = { ...(user as any).hooks };
  for (const ev of HOOK_EVENTS) hooks[ev] = [...((hooks[ev] as unknown[]) ?? []), legacyEntry()];
  return { ...user, hooks };
}
const ours = (arr: any[]) => arr.filter((e) => e[HOOK_MARKER] === true);

test("a fresh install puts async on the command handler, not on the group", () => {
  const next = withHooksInstalled({});
  for (const ev of HOOK_EVENTS) {
    const [entry] = ours(next.hooks[ev]);
    assert.equal(entry.async, undefined, `${ev}: no group-level async`);
    assert.equal(entry.hooks.length, 1);
    assert.equal(entry.hooks[0].async, true, `${ev}: handler is async`);
  }
});

test("an install from ≤ 2.11 is not current and is migrated in place, user entries untouched", () => {
  const user = { hooks: { Stop: [{ hooks: [{ type: "command", command: "keep-me" }] }] }, other: 1 };
  const old = legacyInstall(user);
  assert.equal(hooksInstalled(old), false, "old shape does not count as installed");
  const next = withHooksInstalled(old);
  assert.equal(hooksInstalled(next), true);
  assert.equal(next.other, 1);
  assert.deepEqual(next.hooks.Stop[0], { hooks: [{ type: "command", command: "keep-me" }] }, "user entry kept as it was, in place");
  for (const ev of HOOK_EVENTS) {
    const mine = ours(next.hooks[ev]);
    assert.equal(mine.length, 1, `${ev}: exactly one of ours after migration`);
    assert.equal(mine[0].async, undefined);
    assert.equal(mine[0].hooks[0].async, true);
  }
  assert.deepEqual(withHooksInstalled(next), next, "migration is idempotent");
});

test("hooksNeedMigration: an old or partial install of ours, never the user's own hooks or none", () => {
  assert.equal(hooksNeedMigration({}), false);
  assert.equal(hooksNeedMigration({ hooks: { Stop: [{ hooks: [{ type: "command", command: "keep-me" }] }] } }), false);
  assert.equal(hooksNeedMigration(withHooksInstalled({})), false);
  assert.equal(hooksNeedMigration(legacyInstall()), true);
  const partial = withHooksInstalled({});
  delete partial.hooks.Stop;
  assert.equal(hooksNeedMigration(partial), true);
});

test("installHooks migrates an old install on disk, and uninstall removes the migrated entries", () => {
  const cfg = tmp();
  fs.writeFileSync(path.join(cfg, "settings.json"), JSON.stringify(legacyInstall({ hooks: { Stop: [{ hooks: [{ type: "command", command: "keep-me" }] }] } })));
  assert.equal(installHooks(cfg).changed, true, "old shape is rewritten");
  assert.equal(installHooks(cfg).changed, false);
  assert.ok(hooksInstalled(readSettings(cfg)));
  assert.equal(uninstallHooks(cfg).changed, true);
  const left = readSettings(cfg);
  assert.deepEqual(left.hooks, { Stop: [{ hooks: [{ type: "command", command: "keep-me" }] }] });
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

test("appendEvent rotates by generation: reads see the last two, newest kept", () => {
  const f = eventFile(tmp(), "claude", "work");
  const rotateBytes = 2_000;
  for (let i = 0; i < 200; i++) appendEvent(f, { event: "SessionStart", at: new Date(0).toISOString(), sessionId: `s${i}` }, { rotateBytes });
  const evs = readEvents(f);
  assert.equal(evs[evs.length - 1].sessionId, "s199", "newest kept");
  const ids = evs.map((e) => Number(e.sessionId!.slice(1)));
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b), "order kept across generations");
  assert.ok(evs.length < 200, "old generations are dropped");
  assert.ok(evs.length > (rotateBytes / 100), "at least one full generation is kept");
  assert.ok(fs.statSync(f).size <= rotateBytes + 200, "the live file stays near the rotation size");
  assert.ok(!fs.existsSync(`${f}.lock`), "no lock left behind");
});

test("a malformed line is skipped, the rest of the ring is kept", () => {
  const f = eventFile(tmp(), "claude", "work");
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ event: "Stop", at: new Date(0).toISOString() }) + "\nnot json at all\n{bad");
  appendEvent(f, { event: "SessionEnd", at: new Date(0).toISOString() });
  assert.deepEqual(readEvents(f).map((e) => e.event), ["Stop", "SessionEnd"]);
});

test("rotation keeps a session's last Notification/StopFailure until something newer arrives", () => {
  const f = eventFile(tmp(), "claude", "work");
  const rotateBytes = 1_500;
  // Relative to now: kept lines expire after PIN_MAX_AGE_MS, so a fixed date rots.
  const base = Date.now() - 60_000;
  const t = (n: number) => new Date(base + n * 1000).toISOString();
  appendEvent(f, { event: "Notification", sessionId: "waits", at: t(0) }, { rotateBytes });
  appendEvent(f, { event: "StopFailure", sessionId: "failed", error: "rate_limit", at: t(1) }, { rotateBytes });
  appendEvent(f, { event: "Notification", sessionId: "answered", at: t(2) }, { rotateBytes });
  appendEvent(f, { event: "Stop", sessionId: "answered", at: t(3) }, { rotateBytes });
  // A burst of subagent-scale traffic pushes those lines out of two generations.
  for (let i = 0; i < 300; i++) appendEvent(f, { event: "Stop", sessionId: `noise${i % 7}`, at: t(4) }, { rotateBytes });
  const evs = readEvents(f);
  const lastOf = (id: string) => [...evs].reverse().find((e) => e.sessionId === id);
  assert.equal(lastOf("waits")?.event, "Notification", "still needs you");
  assert.equal(lastOf("failed")?.event, "StopFailure");
  assert.equal(lastOf("failed")?.error, "rate_limit");
  assert.equal(lastOf("answered"), undefined, "an answered prompt is not kept");
  assert.deepEqual([...waitingSessions(evs, () => Date.parse(t(0))).keys()].sort(), ["failed", "waits"]);

  appendEvent(f, { event: "Stop", sessionId: "waits", at: t(5) }, { rotateBytes });
  for (let i = 0; i < 300; i++) appendEvent(f, { event: "Stop", sessionId: `noise${i % 7}`, at: t(6) }, { rotateBytes });
  assert.equal([...readEvents(f)].reverse().find((e) => e.sessionId === "waits"), undefined, "a newer event releases the kept line");
});

test("concurrent writers across rotations leave every line readable and no lock behind", async () => {
  const f = eventFile(tmp(), "claude", "work");
  await concurrentWriters(f, 10, 100, 3_000);
  const raw = [`${f}.pin`, `${f}.1`, f].filter((p) => fs.existsSync(p)).flatMap((p) => fs.readFileSync(p, "utf8").split("\n").filter(Boolean));
  for (const line of raw) assert.doesNotThrow(() => JSON.parse(line), `torn line: ${line.slice(0, 80)}`);
  assert.ok(!fs.existsSync(`${f}.lock`));
  const evs = readEvents(f);
  assert.ok(evs.length > 0);
});

// Real processes, because the race is between hook processes: each child
// imports the compiled module and appends its events as fast as it can.
function concurrentWriters(file: string, writers: number, perWriter: number, rotateBytes?: number): Promise<void> {
  // A file:// URL, not a path: on Windows `import("D:\\…")` reads "d:" as a URL scheme.
  const mod = new URL("../src/hooks.js", import.meta.url).href;
  const script = `const { appendEvent } = await import(${JSON.stringify(mod)});
const [file, w, n, rb] = process.argv.slice(1);
const opts = rb ? { rotateBytes: Number(rb) } : {};
for (let i = 0; i < Number(n); i++) appendEvent(file, { event: "Stop", sessionId: "w" + w + "-" + i, at: new Date(0).toISOString() }, opts);`;
  return Promise.all(
    Array.from({ length: writers }, (_, w) =>
      new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, ["--input-type=module", "-e", script, file, String(w), String(perWriter), ...(rotateBytes ? [String(rotateBytes)] : [])], { stdio: "inherit" });
        child.on("error", reject);
        child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`writer ${w} exited ${code}`))));
      }),
    ),
  ).then(() => undefined);
}

test("appendEvent loses no line under 20 concurrent writers × 50 events", async () => {
  const f = eventFile(tmp(), "claude", "work");
  await concurrentWriters(f, 20, 50);
  const ids = new Set(readEvents(f).map((e) => e.sessionId));
  const missing: string[] = [];
  for (let w = 0; w < 20; w++) for (let i = 0; i < 50; i++) if (!ids.has(`w${w}-${i}`)) missing.push(`w${w}-${i}`);
  assert.deepEqual(missing.length, 0, `lost ${missing.length} of 1000 events, e.g. ${missing.slice(0, 5).join(", ")}`);
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

test("resumeFields: keeps the host's resume numbers and flag, nothing else", () => {
  const r = resumeFields({
    hook_event_name: "SessionStart",
    source: "resume",
    seconds_since_last_response: 5400,
    context_tokens: 182340,
    prompt_cache_likely_expired: true,
    estimated_cache_write_usd: 1.14,
    transcript_path: "/secret/path.jsonl",
  });
  assert.deepEqual(r, { secondsSinceLastResponse: 5400, contextTokens: 182340, cacheLikelyExpired: true });
  assert.equal(resumeFields({ hook_event_name: "SessionStart", source: "startup" }), undefined, "no fields on a fresh start");
  assert.equal(resumeFields({ hook_event_name: "Stop", prompt_cache_likely_expired: true }), undefined);
  assert.deepEqual(resumeFields({ hook_event_name: "SessionStart", prompt_cache_likely_expired: false, context_tokens: "x" }), {
    secondsSinceLastResponse: undefined,
    contextTokens: undefined,
    cacheLikelyExpired: false,
  });
});

test("resumeFactsFor: newest resume of that session, survives the event ring round-trip", () => {
  const f = eventFile(tmp(), "claude", "a");
  appendEvent(f, { event: "SessionStart", source: "resume", sessionId: "s1", resume: { contextTokens: 1, cacheLikelyExpired: true }, at: "2026-11-01T09:00:00.000Z" });
  appendEvent(f, { event: "SessionStart", source: "resume", sessionId: "s2", resume: { contextTokens: 2, cacheLikelyExpired: false }, at: "2026-11-01T09:30:00.000Z" });
  appendEvent(f, { event: "SessionStart", source: "resume", sessionId: "s1", resume: { contextTokens: 3, cacheLikelyExpired: false }, at: "2026-11-01T10:00:00.000Z" });
  appendEvent(f, { event: "Stop", sessionId: "s1", at: "2026-11-01T10:01:00.000Z" });
  const events = readEvents(f);
  assert.deepEqual(resumeFactsFor(events, "s1"), { at: "2026-11-01T10:00:00.000Z", contextTokens: 3, cacheLikelyExpired: false });
  assert.equal(resumeFactsFor(events, "nope"), null);
});

// ---------- subagents (Phase 2) ----------

// Captured live from Claude Code 2.1.316 by scripts/spikes/t11-subagent-hook-capture.sh,
// paths and the subagent's answer anonymised. Read from the source tree.
const SUBAGENT_FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "tests", "fixtures", "claude-subagent-hooks-2.1.316.jsonl");
const subagentPayloads = () => fs.readFileSync(SUBAGENT_FIXTURE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

test("SubagentStart/Stop are installed, and an install without them is migrated", () => {
  for (const ev of ["SubagentStart", "SubagentStop"]) assert.ok((HOOK_EVENTS as readonly string[]).includes(ev));
  const old = withHooksInstalled({});
  delete old.hooks.SubagentStart;
  delete old.hooks.SubagentStop;
  assert.equal(hooksRecordSubagents(old), false);
  assert.equal(hooksNeedMigration(old), true);
  assert.equal(hooksRecordSubagents(withHooksInstalled(old)), true);
  assert.equal(hooksRecordSubagents({}), false);
});

test("recordFromPayload keeps the subagent's id, type, parent and cwd from a live payload — no content, no paths to transcripts", () => {
  const [start, stop] = subagentPayloads().map((o) => recordFromPayload(o, at));
  assert.deepEqual(start, {
    event: "SubagentStart",
    sessionId: "d37f90b5-2201-4065-abbb-9e0cac14474a",
    agentId: "a3731b735e452e7b7",
    agentType: "general-purpose",
    cwd: "/private/tmp/probe",
    at,
  });
  assert.equal(stop.event, "SubagentStop");
  assert.equal(stop.agentId, start.agentId);
  const raw = JSON.stringify(stop);
  for (const banned of ["last_assistant_message", "transcript", "\"ok\"", "prompt_id"]) assert.ok(!raw.includes(banned), `${banned} not recorded`);
});

test("recordFromPayload adds no subagent fields to other events, and keeps the folder of a turn", () => {
  const rec = recordFromPayload({ hook_event_name: "Stop", session_id: "s1", cwd: "/x", agent_id: "nope" }, at);
  assert.deepEqual(rec, { event: "Stop", sessionId: "s1", cwd: "/x", at });
  assert.deepEqual(recordFromPayload({ hook_event_name: "Notification", session_id: "s1", cwd: "/x" }, at), { event: "Notification", sessionId: "s1", at }, "only starts and turn ends carry a folder");
});

test("lastHookCwd: the newest start or turn end of that session; a subagent's folder never counts", () => {
  const ev = [
    { event: "SessionStart", sessionId: "s1", cwd: "/repo", at },
    { event: "Stop", sessionId: "s1", cwd: "/repo/.worktrees/w", at },
    { event: "SubagentStart", sessionId: "s1", cwd: "/elsewhere", agentId: "a", at },
    { event: "Stop", sessionId: "s2", cwd: "/other", at },
  ];
  assert.equal(lastHookCwd(ev, "s1"), "/repo/.worktrees/w");
  assert.equal(lastHookCwd(ev, "s3"), null);
});

test("childrenOf: one entry per subagent of that session, running until its stop or the parent's end", () => {
  const t = (n: number) => new Date(Date.UTC(2026, 10, 2, 10, 0, n)).toISOString();
  const ev = (event: string, sessionId: string, agentId?: string, n = 0) =>
    ({ event, sessionId, at: t(n), ...(agentId ? { agentId, agentType: "general-purpose", cwd: "/repo" } : {}) });
  const events = [
    ev("SubagentStart", "p1", "a1", 1),
    ev("SubagentStart", "p1", "a2", 2),
    ev("SubagentStart", "p2", "b1", 3),
    ev("SubagentStop", "p1", "a1", 4),
    ev("SubagentStop", "p1", "orphan", 5), // its start was rotated away
  ];
  assert.deepEqual(childrenOf(events, "p1"), [
    { agentId: "a1", type: "general-purpose", state: "done", cwd: "/repo" },
    { agentId: "a2", type: "general-purpose", state: "running", cwd: "/repo" },
    { agentId: "orphan", type: "general-purpose", state: "done", cwd: "/repo" },
  ]);
  assert.deepEqual(childrenOf(events, "nobody"), []);
  const ended = [...events, ev("SessionEnd", "p1", undefined, 6)];
  assert.ok(childrenOf(ended, "p1").every((c) => c.state === "done"), "the parent's end ends its children");
  assert.equal(childrenOf(ended, "p2")[0].state, "running", "another session is unaffected");
});

test("childrenOf on the live fixture: one finished general-purpose subagent", () => {
  const events = subagentPayloads().map((o) => recordFromPayload(o, at));
  assert.deepEqual(childrenOf(events, "d37f90b5-2201-4065-abbb-9e0cac14474a"), [
    { agentId: "a3731b735e452e7b7", type: "general-purpose", state: "done", cwd: "/private/tmp/probe" },
  ]);
});
