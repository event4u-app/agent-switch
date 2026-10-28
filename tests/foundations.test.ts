import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Unit tests for the honest-foundations modules (activity, protection, pools,
// dir resolver, auth status, gui settings, doctor checks). Every store takes an
// explicit file, so these never touch the real ~/.agent-switch.
process.env.AGENT_SWITCH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "asw-found-"));
const A = await import("../src/activity.js");
const PR = await import("../src/protection.js");
const PO = await import("../src/pools.js");
const R = await import("../src/dir-resolve.js");
const AU = await import("../src/auth-status.js");
const G = await import("../src/gui-settings.js");
const DR = await import("../src/doctor.js");

function tmp(name: string): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "asw-f-")), name);
}

const SECRET = "sk-ant-oat01-" + "A".repeat(60);
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlc2lnbmF0dXJl";

// ---------- activity ----------

test("activity: append + read round-trips, newest last, limit keeps the newest", () => {
  const f = tmp("activity.jsonl");
  A.appendActivity({ kind: "switch", target: "claude/a", action: "set as active profile", reason: "user", ok: true }, f);
  A.appendActivity({ kind: "guard", target: null, action: "set warn", reason: "user", ok: true }, f);
  const all = A.readActivity(undefined, f);
  assert.deepEqual(all.map((e) => e.kind), ["switch", "guard"]);
  assert.deepEqual(A.readActivity(1, f).map((e) => e.kind), ["guard"]);
});

test("activity: limit 0 returns nothing (not everything)", () => {
  const f = tmp("activity.jsonl");
  A.appendActivity({ kind: "switch", target: "claude/a", action: "x", reason: "user", ok: true }, f);
  assert.deepEqual(A.readActivity(0, f), []);
});

test("activity: trimActivity keeps the newest entries and leaves a file under the cap untouched", () => {
  const f = tmp("activity.jsonl");
  const line = (i: number) => JSON.stringify({ at: new Date(i).toISOString(), kind: "switch", target: null, action: `#${i}`, reason: "r", ok: true });
  const small = [line(1), line(2)].join("\n") + "\n";
  fs.writeFileSync(f, small);
  const before = fs.statSync(f).mtimeMs;
  A.trimActivity(f);
  assert.equal(fs.readFileSync(f, "utf8"), small);
  assert.equal(fs.statSync(f).mtimeMs, before);
  fs.writeFileSync(f, Array.from({ length: A.ACTIVITY_MAX_LINES + 3 }, (_, i) => line(i)).join("\n") + "\n");
  A.trimActivity(f);
  const kept = A.readActivity(undefined, f);
  assert.equal(kept.length, A.ACTIVITY_MAX_LINES);
  assert.equal(kept[0].action, "#3");
  assert.equal(kept[kept.length - 1].action, `#${A.ACTIVITY_MAX_LINES + 2}`);
});

test("activity: a token in any field never reaches the file", () => {
  const f = tmp("activity.jsonl");
  A.appendActivity({ kind: "rebind", target: `claude/${SECRET}`, action: `failed with ${JWT}`, reason: `token ${SECRET} rejected`, ok: false }, f);
  const raw = fs.readFileSync(f, "utf8");
  assert.doesNotMatch(raw, /sk-ant-oat01/);
  assert.doesNotMatch(raw, /eyJhbGci/);
  assert.match(raw, /\[redacted\]/);
});

test("activity: ordinary paths and names survive redaction", () => {
  assert.equal(A.redactSecrets("Rule: folder /Users/someone/projects/private/agent-switch → pool work"), "Rule: folder /Users/someone/projects/private/agent-switch → pool work");
});

test("activity: the file is capped to the newest ACTIVITY_MAX_LINES entries", () => {
  const f = tmp("activity.jsonl");
  const filler = "x".repeat(250);
  const line = (i: number) => JSON.stringify({ at: new Date(i).toISOString(), kind: "switch", target: null, action: `#${i} ${filler}`, reason: "r", ok: true });
  fs.writeFileSync(f, Array.from({ length: A.ACTIVITY_MAX_LINES + 500 }, (_, i) => line(i)).join("\n") + "\n");
  A.appendActivity({ kind: "update", target: null, action: "last", reason: "r", ok: true }, f);
  const all = A.readActivity(undefined, f);
  assert.equal(all.length, A.ACTIVITY_MAX_LINES);
  assert.equal(all[all.length - 1].action, "last");
});

// ---------- protection ----------

test("protection: default is on at 98% for any profile without a stored entry", () => {
  const f = tmp("protection.json");
  assert.deepEqual(PR.readProtection("claude", "work", f), { enabled: true, thresholdPct: 98 });
  assert.deepEqual(PR.DEFAULT_PROTECTION, { enabled: true, thresholdPct: 98 });
});

test("protection: set / rename / forget, threshold validated", () => {
  const f = tmp("protection.json");
  assert.deepEqual(PR.setProtection("claude", "work", { thresholdPct: 90 }, f), { enabled: true, thresholdPct: 90 });
  assert.deepEqual(PR.setProtection("claude", "work", { enabled: false }, f), { enabled: false, thresholdPct: 90 });
  assert.throws(() => PR.setProtection("claude", "work", { thresholdPct: 0 }, f));
  assert.throws(() => PR.setProtection("claude", "work", { thresholdPct: 101 }, f));
  PR.renameProtection("claude", "work", "job", f);
  assert.deepEqual(PR.readProtection("claude", "job", f), { enabled: false, thresholdPct: 90 });
  assert.deepEqual(PR.readProtection("claude", "work", f), PR.DEFAULT_PROTECTION);
  PR.forgetProtection("claude", "job", f);
  assert.deepEqual(PR.readProtection("claude", "job", f), PR.DEFAULT_PROTECTION);
});

const snap = (util: number, capturedAt = "2026-10-28T12:00:00Z", resetsAt = "2026-10-28T15:00:00Z") => ({
  windows: [{ key: "five_hour", label: "5h", utilization: util, resetsAt }],
  routines: null,
  capturedAt,
});

test("protection notice: warns once per cycle, says warn, never paused", () => {
  const n = PR.protectionNotice("claude/work", snap(98), PR.DEFAULT_PROTECTION, undefined);
  assert.ok(n);
  assert.match(n!.message, /warning only/);
  assert.doesNotMatch(n!.message + n!.title, /paused|pausing/i);
  assert.equal(PR.protectionNotice("claude/work", snap(99), PR.DEFAULT_PROTECTION, n!.cycle), null);
  assert.ok(PR.protectionNotice("claude/work", snap(99, undefined, "2026-10-28T20:00:00Z"), PR.DEFAULT_PROTECTION, n!.cycle));
  assert.equal(PR.protectionNotice("claude/work", snap(97), PR.DEFAULT_PROTECTION, undefined), null);
  assert.equal(PR.protectionNotice("claude/work", snap(100), { enabled: false, thresholdPct: 98 }, undefined), null);
});

// ---------- pools ----------

test("pools: empty store, create/rename/add/remove/delete, ids stay stable", () => {
  const f = tmp("pools.json");
  assert.deepEqual(PO.readPools(f), []);
  const p = PO.createPool("Client Work", f);
  assert.equal(p.id, "client-work");
  assert.throws(() => PO.createPool("client work", f), /already exists/);
  PO.addPoolMember("client-work", "claude/a", f);
  PO.addPoolMember("client-work", "claude/a", f); // idempotent
  PO.addPoolMember("client-work", "codex/b", f);
  assert.throws(() => PO.addPoolMember("client-work", "nope", f));
  assert.equal(PO.renamePool("client-work", "Clients", f).id, "client-work");
  PO.renamePoolMember("claude/a", "claude/a2", f);
  assert.deepEqual(PO.findPool("client-work", f)!.members, ["codex/b", "claude/a2"]);
  PO.removePoolMember("client-work", "codex/b", f);
  PO.renamePoolMember("claude/a2", null, f);
  assert.deepEqual(PO.findPool("client-work", f)!.members, []);
  PO.deletePool("client-work", f);
  assert.deepEqual(PO.readPools(f), []);
});

test("pools: a profile may be in many pools", () => {
  const f = tmp("pools.json");
  PO.createPool("a", f);
  PO.createPool("b", f);
  PO.addPoolMember("a", "claude/x", f);
  PO.addPoolMember("b", "claude/x", f);
  assert.equal(PO.readPools(f).filter((p) => p.members.includes("claude/x")).length, 2);
});

test("pools: suggest-from-labels is a preview and marks existing ids", () => {
  const profiles = [
    { provider: "claude" as const, name: "a" },
    { provider: "codex" as const, name: "b" },
    { provider: "claude" as const, name: "c" },
  ];
  const labels: Record<string, string> = { "claude/a": "Work", "codex/b": "Work", "claude/c": "Personal" };
  const existing = [{ id: "personal", name: "Personal", members: [], createdAt: "" }];
  const s = PO.suggestPoolsFromLabels(profiles, (p, n) => labels[`${p}/${n}`] ?? null, existing);
  assert.deepEqual(s, [
    { id: "work", name: "Work", members: ["claude/a", "codex/b"], exists: false },
    { id: "personal", name: "Personal", members: ["claude/c"], exists: true },
  ]);
});

// ---------- dir resolver ----------

const NOW = Date.parse("2026-10-28T12:00:00Z");
function inputs(over: Partial<Parameters<typeof R.resolveForDir>[0]> = {}): Parameters<typeof R.resolveForDir>[0] {
  const usage: Record<string, { util: number; at: string } | null> = {
    a: { util: 80, at: "2026-10-28T11:59:00Z" },
    b: { util: 30, at: "2026-10-28T11:58:00Z" },
    stale: { util: 0, at: "2026-10-28T11:30:00Z" },
    unknown: null,
    out: { util: 0, at: "2026-10-28T11:59:00Z" },
  };
  return {
    providerId: "claude",
    mapping: { path: "/home/u/x", name: "pool:work" },
    active: "a",
    exists: () => true,
    signedIn: (n) => n !== "out",
    pool: (id) => (id === "work" ? { id, name: "Work", members: ["claude/a", "claude/b", "claude/stale", "claude/unknown", "claude/out", "codex/zz"], createdAt: "" } : null),
    usage: (n) => {
      const u = usage[n];
      return u ? { snapshot: snap(u.util, u.at), capturedMs: Date.parse(u.at) } : { snapshot: null, capturedMs: null };
    },
    now: NOW,
    displayPath: (p) => p.replace("/home/u", "~"),
    ...over,
  };
}

test("dir: a pool rule picks the member with the most FRESH headroom and explains why", () => {
  const r = R.resolveForDir(inputs());
  assert.equal(r.name, "b");
  assert.equal(r.why[0], "Rule: folder ~/x → pool work");
  assert.ok(r.why.includes("Skipped claude/stale: usage checked 30 min ago (too old to trust)"));
  assert.ok(r.why.includes("Skipped claude/unknown: usage unknown"));
  assert.ok(r.why.includes("Skipped claude/out: signed out"));
  assert.match(r.why[r.why.length - 1], /^Most left in pool work · claude\/b at 30% · usage checked 2 min ago$/);
});

test("dir: unknown usage is never free — no fresh member falls back to the active profile", () => {
  const r = R.resolveForDir(inputs({ pool: () => ({ id: "work", name: "Work", members: ["claude/stale", "claude/unknown"], createdAt: "" }) }));
  assert.equal(r.name, "a");
  assert.ok(r.why.includes("No member of pool work has fresh usage"));
  assert.equal(r.why[r.why.length - 1], "Using the active profile claude/a");
});

test("dir: with guard block, a pool member that already holds a live session is skipped", () => {
  const r = R.resolveForDir(inputs({ live: (n: string) => n === "b", guard: "block" }));
  assert.equal(r.name, "a");
  assert.ok(r.why.includes("Skipped claude/b: already has a live session (guard: block would refuse it)"));
});

test("dir: with guard warn, a live member is still eligible but a free one wins a tie", () => {
  const tie = () => ({ snapshot: snap(30, "2026-10-28T11:59:00Z"), capturedMs: Date.parse("2026-10-28T11:59:00Z") });
  const pool = () => ({ id: "work", name: "Work", members: ["claude/a", "claude/b"], createdAt: "" });
  const r = R.resolveForDir(inputs({ pool, usage: tie, live: (n: string) => n === "a", guard: "warn" }));
  assert.equal(r.name, "b");
  assert.ok(r.why.includes("Preferred claude/b over claude/a: same headroom, claude/a already has a live session"));
  // A live member with strictly more headroom still wins under warn, and says so.
  const live = R.resolveForDir(inputs({ live: (n: string) => n === "b", guard: "warn" }));
  assert.equal(live.name, "b");
  assert.ok(live.why.includes("Note: claude/b already has a live session (guard: warn)"));
});

test("dir: the no-fresh-usage fallback names the background service", () => {
  const r = R.resolveForDir(inputs({ pool: () => ({ id: "work", name: "Work", members: ["claude/stale"], createdAt: "" }) }));
  assert.ok(r.why.some((l: string) => /agent-switch service/.test(l)), r.why.join("\n"));
});

test("dir: a deleted pool and a plain profile rule", () => {
  assert.equal(R.resolveForDir(inputs({ pool: () => null })).name, "a");
  const plain = R.resolveForDir(inputs({ mapping: { path: "/home/u/y", name: "b" } }));
  assert.deepEqual(plain, { name: "b", why: ["Rule: folder ~/y → claude/b"] });
  const none = R.resolveForDir(inputs({ mapping: null, active: null }));
  assert.equal(none.name, null);
});

// ---------- auth status ----------

test("auth-status: claude states from store metadata, never a token value", () => {
  const now = Date.parse("2026-10-28T12:00:00Z");
  const cred = (extra: Record<string, unknown>) => JSON.stringify({ claudeAiOauth: { accessToken: SECRET, refreshToken: "rt-" + "B".repeat(50), expiresAt: now + 3600e3, ...extra } });
  const ok = AU.claudeAuthStatus("w", cred({}), now - 60e3, now);
  assert.equal(ok.state, "connected");
  assert.equal(ok.expiresAt, null, "the access-token expiry is not a sign-in deadline");
  assert.equal(ok.lastRefreshAt, new Date(now - 60e3).toISOString());
  assert.equal(AU.claudeAuthStatus("w", cred({ refreshTokenExpiresAt: now + 86400e3 }), null, now).state, "expiring");
  assert.equal(AU.claudeAuthStatus("w", cred({ refreshTokenExpiresAt: now - 1 }), null, now).state, "sign-in-needed");
  assert.equal(AU.claudeAuthStatus("w", null, null, now).state, "sign-in-needed");
  assert.equal(AU.claudeAuthStatus("w", "{}", null, now).state, "unknown");
  const all = JSON.stringify([ok, AU.claudeAuthStatus("w", cred({ refreshTokenExpiresAt: now + 86400e3 }), null, now)]);
  assert.doesNotMatch(all, /sk-ant|rt-BBBB/);
});

test("auth-status: codex and antigravity", () => {
  const now = Date.now();
  const auth = JSON.stringify({ tokens: { id_token: JWT, access_token: SECRET, refresh_token: "r".repeat(40) }, last_refresh: "2026-10-27T10:00:00Z" });
  const c = AU.codexAuthStatus("w", auth, now);
  assert.equal(c.state, "connected");
  assert.equal(c.lastRefreshAt, "2026-10-27T10:00:00.000Z");
  assert.doesNotMatch(JSON.stringify(c), /eyJhbGci|sk-ant|rrrrrrrr/);
  assert.equal(AU.codexAuthStatus("w", JSON.stringify({ tokens: {} }), now).state, "sign-in-needed");
  assert.equal(AU.codexAuthStatus("w", null, now).state, "sign-in-needed");
  assert.equal(AU.antigravityAuthStatus("w", true).state, "unknown");
  assert.equal(AU.antigravityAuthStatus("w", false).state, "sign-in-needed");
});

// ---------- gui settings ----------

test("gui-settings: nothing decided on a fresh file; pet flag only goes false → true", () => {
  const f = tmp("gui-settings.json");
  const s0 = G.readGuiSettings(f);
  assert.deepEqual(s0, { petWelcomed: false, autostart: { state: "unset" }, autostartDegraded: null });
  const s1 = G.applyGuiSetting(s0, { key: "pet-welcomed" });
  G.writeGuiSettings(s1, f);
  assert.equal(G.readGuiSettings(f).petWelcomed, true);
});

test("gui-settings: a first-run default never overwrites a stored choice; only the user may turn it off", () => {
  const now = new Date("2026-10-28T12:00:00Z");
  const base = { petWelcomed: false, autostart: { state: "unset" as const }, autostartDegraded: { at: "", reason: "x" } };
  const on = G.applyGuiSetting(base, { key: "autostart", state: "enabled", by: "first-run" }, now);
  assert.deepEqual(on.autostart, { state: "enabled", by: "first-run", at: now.toISOString() });
  assert.equal(on.autostartDegraded, null, "a confirmed enable clears degraded");
  const off = G.applyGuiSetting(on, { key: "autostart", state: "disabled", by: "user" }, now);
  assert.equal(off.autostart.state, "disabled");
  assert.deepEqual(G.applyGuiSetting(off, { key: "autostart", state: "enabled", by: "first-run" }, now), off, "user off survives the first-run default");
  assert.throws(() => G.applyGuiSetting(base, { key: "autostart", state: "disabled", by: "first-run" }));
});

// ---------- doctor checks ----------

test("doctor: API-key overrides are reported by NAME only (D5)", () => {
  assert.equal(DR.apiKeyOverrideCheck({}).status, "ok");
  const c = DR.apiKeyOverrideCheck({ ANTHROPIC_API_KEY: SECRET, OPENAI_API_KEY: "sk-" + "C".repeat(40) });
  assert.equal(c.status, "warn");
  assert.match(c.detail, /ANTHROPIC_API_KEY \(claude\)/);
  assert.match(c.detail, /OPENAI_API_KEY \(codex\)/);
  assert.doesNotMatch(JSON.stringify(c), /sk-ant|CCCC/);
});

test("doctor: shell integration, CLI on PATH, autostart, antigravity OS, isolation", () => {
  const rc: Record<string, string> = { [path.join("/h", ".zshrc")]: 'eval "$(agent-switch shellenv)"' };
  assert.equal(DR.shellIntegrationCheck("/h", (p) => rc[p] ?? null).status, "ok");
  assert.equal(DR.shellIntegrationCheck("/h", () => null).status, "warn");
  assert.equal(DR.cliOnPathCheck({ PATH: "/a:/b" }, "darwin", (p) => p === path.join("/b", "agent-switch")).status, "ok");
  assert.equal(DR.cliOnPathCheck({ PATH: "/a" }, "darwin", () => false).status, "warn");
  assert.equal(DR.autostartCheck({ petWelcomed: false, autostart: { state: "unset" }, autostartDegraded: { at: "", reason: "os said no" } }).status, "warn");
  assert.equal(DR.autostartCheck({ petWelcomed: false, autostart: { state: "disabled", by: "user", at: "" }, autostartDegraded: null }).status, "info");
  assert.equal(DR.antigravityOsCheck("darwin").status, "ok");
  assert.equal(DR.antigravityOsCheck("linux").status, "warn");
  const iso = DR.signInIsolationCheck([
    { provider: "claude", name: "a", identity: "x@y.z" },
    { provider: "claude", name: "b", identity: "X@y.z" },
    { provider: "codex", name: "c", identity: "x@y.z" },
  ]);
  assert.equal(iso.status, "warn");
  assert.match(iso.detail, /claude\/a \+ claude\/b/);
});
