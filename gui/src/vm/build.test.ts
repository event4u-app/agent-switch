import { describe, it, expect } from "vitest";
import {
  accountFromProfile,
  accountIdFromMember,
  activityFromEntries,
  agentConfigFromStatus,
  authFromStatus,
  bindingsFromMappings,
  checksFromDoctor,
  colorFor,
  deriveAttention,
  desktopForeign,
  deriveReadiness,
  guardFromStatus,
  noticeFromNotification,
  poolMembership,
  poolsFromRows,
  readinessFromDoctor,
  sessionFromRow,
  toolFromEntry,
} from "./build.js";
import { nextInPools } from "./rules.js";
import type { AuthStatusRow } from "../ipc.js";
import type { ProfileRow, SessionRow, UsageSnapshot } from "../transforms.js";

const NOW = Date.parse("2026-10-28T10:00:00Z");
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

const row = (over: Partial<ProfileRow> = {}): ProfileRow => ({
  provider: "claude",
  name: "work",
  identity: "a@b.example",
  label: "Work",
  active: true,
  liveSessions: 2,
  ...over,
});

const usage = (utils: (number | null)[], capturedAt = NOW - 2 * MIN): UsageSnapshot => ({
  windows: utils.map((u, i) => ({ key: `w${i}`, label: i ? "Week" : "5h", utilization: u, resetsAt: iso(NOW + 78 * MIN) })),
  routines: null,
  capturedAt: iso(capturedAt),
});

describe("accountFromProfile", () => {
  it("maps the CLI row and keeps unreported fields null, never 0", () => {
    const a = accountFromProfile(row(), null);
    expect(a.id).toBe("claude:work");
    expect(a.isDefault).toBe(true);
    expect(a.windows).toEqual([]);
    expect(a.checkedAt).toBeNull();
    expect(a.resetCredits).toBeNull();
    expect(a.plan).toBeNull();
    expect(a.protection).toBeNull();
    expect(a.auth).toBeNull();
    expect(a.state).toBe("ready");
  });

  it("derives near-limit and limited from the binding window against the threshold", () => {
    expect(accountFromProfile(row(), usage([42, 61])).state).toBe("ready");
    expect(accountFromProfile(row(), usage([94, 70])).state).toBe("near-limit");
    expect(accountFromProfile(row(), usage([100, 77])).state).toBe("limited");
    expect(accountFromProfile(row(), usage([70, 20]), { protection: { enabled: true, thresholdPct: 80 } }).state).toBe("near-limit");
  });

  it("carries capture time and unknown windows through", () => {
    const a = accountFromProfile(row(), usage([null, 30]));
    expect(a.checkedAt).toBe(NOW - 2 * MIN);
    expect(a.windows[0].utilization).toBeNull();
  });

  it("gives an account a stable colour", () => {
    expect(colorFor("claude:work")).toBe(colorFor("claude:work"));
    expect(accountFromProfile(row(), null).color).toBe(colorFor("claude:work"));
  });
});

describe("sessionFromRow", () => {
  const s = (over: Partial<SessionRow> = {}): SessionRow => ({
    provider: "claude",
    profile: "work",
    sessionId: "7f3c2a91-4b1e",
    projectDir: "/Users/x/.claude/projects/-Users-x-dev-agent-config",
    cwd: "/Users/x/dev/agent-config",
    mtimeMs: NOW - 10_000,
    live: true,
    ...over,
  });

  it("maps a fresh live session to working, a quiet one to idle, a dead one to done", () => {
    expect(sessionFromRow(s(), NOW).state).toBe("working");
    expect(sessionFromRow(s({ mtimeMs: NOW - 5 * MIN }), NOW).state).toBe("idle");
    expect(sessionFromRow(s({ live: false }), NOW).state).toBe("done");
  });

  it("a live session waiting on a prompt needs you; a dead one is done", () => {
    expect(sessionFromRow(s({ waiting: true }), NOW).state).toBe("needs-you");
    expect(sessionFromRow(s({ waiting: true, live: false }), NOW).state).toBe("done");
  });

  it("marks a session started in Claude Desktop as such", () => {
    expect(sessionFromRow(s({ surface: "desktop-app" }), NOW).surface).toBe("desktop-app");
    expect(sessionFromRow(s(), NOW).surface).toBeNull();
  });

  it("keeps ids, project and unknown context", () => {
    const v = sessionFromRow(s({ summary: "Edge filter" }), NOW);
    expect(v.id).toBe("claude:7f3c2a91-4b1e");
    expect(v.accountId).toBe("claude:work");
    expect(v.project).toBe("agent-config");
    expect(v.title).toBe("Edge filter");
    expect(v.contextPct).toBeNull();
    expect(v.why).toEqual([]);
  });

  it("never turns the encoded project dir into a folder when the cwd is unknown", () => {
    // What the CLI really sends: the encoded transcript dir name. `-` stands for
    // every non-alphanumeric, so it cannot be decoded back into a path — a start
    // in it ran `run … --cwd -Users-x-dev-agent-config`.
    const v = sessionFromRow(s({ cwd: null, summary: null, projectDir: "-Users-x-dev-agent-config" }), NOW);
    expect(v.cwd).toBeNull();
    expect(v.project).toBe("Unknown folder");
    expect(v.title).toBe("Session 7f3c2a91");
  });
});

describe("deriveAttention", () => {
  const tools = [
    toolFromEntry({ id: "agent-config", present: true, version: "18.1.0", path: null, healthy: true, hint: "" }, "18.2.0"),
    toolFromEntry({ id: "codex", present: true, version: "0.98.0", path: null, healthy: true, hint: "" }, "0.99.1"),
    toolFromEntry({ id: "rtk", present: true, version: "0.9.4", path: null, healthy: true, hint: "" }, "0.9.4"),
  ];

  it("raises near-limit for fresh readouts and one update item", () => {
    const near = accountFromProfile(row({ name: "side", liveSessions: 1 }), usage([94]));
    const fine = accountFromProfile(row(), usage([20]));
    const items = deriveAttention([near, fine], tools, NOW - 6 * MIN, NOW);
    expect(items.map((i) => i.kind)).toEqual(["near-limit", "update"]);
    expect(items[0].title).toBe("side is at 94 % of its 5h window");
    expect(items[0].detail).toBe("Resets in 1h 18m.");
    expect(items[1].title).toBe("agent-config 18.2.0 is out");
    expect(items[1].detail).toBe("You have 18.1.0. Codex CLI has an update too. Running sessions are not touched.");
  });

  it("asks for a decision only when there is one: a running session and another account to go to", () => {
    const fine = accountFromProfile(row(), usage([20]));
    const idle = accountFromProfile(row({ name: "side", liveSessions: 0 }), usage([94]));
    expect(deriveAttention([idle, fine], [], null, NOW)).toEqual([]);
    const alone = accountFromProfile(row({ name: "side", liveSessions: 1 }), usage([94]));
    const off = accountFromProfile(row({ disabled: true }), usage([20]));
    expect(deriveAttention([alone, off], [], null, NOW)).toEqual([]);
  });

  it("stays quiet on stale usage and on unchecked tools", () => {
    const stale = accountFromProfile(row(), usage([99], NOW - 30 * MIN));
    expect(deriveAttention([stale], tools, null, NOW)).toEqual([]);
  });
});

describe("agentConfigFromStatus", () => {
  it("maps each discovery state and unknown", () => {
    expect(agentConfigFromStatus(null, null, null).status).toBe("unknown");
    expect(agentConfigFromStatus({ status: "notInstalled" }, null, NOW).status).toBe("not-installed");
    expect(agentConfigFromStatus({ status: "notRunning" }, null, NOW).status).toBe("not-running");
    expect(agentConfigFromStatus({ status: "wedged", pid: 7, port: 1 }, null, NOW)).toMatchObject({ status: "wedged", pid: 7 });
    expect(agentConfigFromStatus({ status: "live", port: 47821, pid: 9, version: "18.1.0" }, "18.2.0", NOW)).toMatchObject({
      status: "live",
      port: 47821,
      version: "18.1.0",
      latest: "18.2.0",
    });
  });
});

describe("noticeFromNotification / deriveReadiness", () => {
  it("marks notices newer than the read marker as unread", () => {
    const n = { id: "1", ts: NOW, kind: "warning" as const, title: "t", message: "m" };
    expect(noticeFromNotification(n, NOW - 1)).toMatchObject({ unread: true, tone: "warn", detail: "m" });
    expect(noticeFromNotification(n, NOW).unread).toBe(false);
  });
  it("walks the readiness states", () => {
    expect(deriveReadiness(false, false, false)).toBe("starting");
    expect(deriveReadiness(true, false, true)).toBe("needs-action");
    expect(deriveReadiness(true, true, true)).toBe("degraded");
    expect(deriveReadiness(true, true, false)).toBe("ready");
  });
});

describe("protection and auth on an account", () => {
  const authRow = (over: Partial<AuthStatusRow> = {}): AuthStatusRow => ({
    provider: "claude",
    name: "work",
    state: "connected",
    expiresAt: iso(NOW + 5 * 24 * 60 * MIN),
    lastRefreshAt: iso(NOW - 60 * MIN),
    keptFreshBy: "claude (refreshes the login when it runs)",
    detail: "",
    ...over,
  });

  it("takes the meter threshold from protection, else the CLI default 98", () => {
    expect(accountFromProfile(row(), null).threshold).toBe(98);
    const a = accountFromProfile(row(), usage([85]), { protection: { enabled: false, thresholdPct: 90 } });
    expect(a.threshold).toBe(90);
    expect(a.protection).toEqual({ enabled: false, thresholdPct: 90 });
    expect(a.state).toBe("near-limit");
  });

  it("maps auth-status times and keeps what the store does not say unknown", () => {
    const h = authFromStatus(authRow({ lastRefreshAt: null, detail: "" }), NOW);
    expect(h).toMatchObject({ state: "connected", expiresAt: NOW + 5 * 24 * 60 * MIN, lastRefreshAt: null, checkedAt: NOW });
    expect(h.method).toBeNull();
    expect(h.autoRefresh).toBeNull();
    expect(h.keptFreshBy).toBe("claude (refreshes the login when it runs)");
    expect(h.reason).toBeUndefined();
  });

  it("derives signed-out only from sign-in-needed — expiring and unknown never demote", () => {
    const at = (state: AuthStatusRow["state"]) => accountFromProfile(row(), usage([20]), { auth: authFromStatus(authRow({ state }), NOW) }).state;
    expect(at("sign-in-needed")).toBe("signed-out");
    expect(at("expiring")).toBe("ready");
    expect(at("unknown")).toBe("ready");
    expect(accountFromProfile(row(), usage([100]), { auth: authFromStatus(authRow({ state: "sign-in-needed" }), NOW) }).state).toBe("signed-out");
  });

  it("raises a sign-in attention item for a signed-out account", () => {
    const a = accountFromProfile(row(), null, { auth: authFromStatus(authRow({ state: "sign-in-needed", detail: "Login ended." }), NOW) });
    const [item] = deriveAttention([a], [], null, NOW);
    expect(item).toMatchObject({ kind: "signed-out", title: "Claude · work needs a new sign-in", accountId: "claude:work", detail: "Login ended.", at: NOW });
  });
});

describe("pools and folder rules", () => {
  const pools = poolsFromRows([
    { id: "work", name: "Work", members: ["claude/work", "claude/side", "nonsense"], createdAt: "x", rules: ["/a (claude)"] },
    { id: "solo", name: "Solo", members: ["codex/w"], createdAt: "x", rules: [] },
  ]);

  it("turns CLI member keys into account ids and drops unparseable ones", () => {
    expect(accountIdFromMember("claude/work")).toBe("claude:work");
    expect(accountIdFromMember("pool-id")).toBeNull();
    expect(accountIdFromMember(null)).toBeNull();
    expect(pools[0]).toEqual({ id: "work", label: "Work", accountIds: ["claude:work", "claude:side"], rules: ["/a (claude)"] });
    expect(poolMembership(pools).get("claude:side")).toEqual(["work"]);
  });

  it("feeds Next in <pool> from the CLI-shaped pools", () => {
    const accounts = [
      accountFromProfile(row({ name: "work" }), usage([60])),
      accountFromProfile(row({ name: "side", active: false }), usage([10])),
    ];
    expect([...nextInPools(accounts, "claude", pools, NOW).entries()]).toEqual([["claude:side", "Work"]]);
  });

  it("maps directory mappings to folder bindings with an account or a pool target", () => {
    const b = bindingsFromMappings([
      { path: "/x/repo", provider: "claude", target: "work" },
      { path: "/x/repo", provider: "codex", target: "pool:solo" },
    ]);
    expect(b[0]).toEqual({
      id: "claude:/x/repo",
      match: { kind: "folder", value: "/x/repo" },
      tool: "claude",
      target: { kind: "account", accountId: "claude:work" },
      enabled: true,
      hits: null,
    });
    expect(b[1].target).toEqual({ kind: "pool", pool: "solo" });
    expect(b[1].id).not.toBe(b[0].id);
  });
});

describe("activity, health and guard", () => {
  it("orders activity newest first, maps kinds, and drops undated entries", () => {
    const ev = activityFromEntries([
      { at: iso(NOW - 2 * MIN), kind: "redeem", target: "codex/w", action: "redeemed", reason: "user ran reset", ok: true },
      { at: "garbage", kind: "switch", target: null, action: "x", reason: "", ok: true },
      { at: iso(NOW - MIN), kind: "pool", target: "work", action: "created", reason: "", ok: false },
    ]);
    expect(ev.map((e) => e.kind)).toEqual(["pool", "reset"]);
    expect(ev[0]).toMatchObject({ text: "work: created", ok: false });
    expect(ev[0].accountId).toBeUndefined();
    expect(ev[0].detail).toBeUndefined();
    expect(ev[1]).toMatchObject({ accountId: "codex:w", detail: "user ran reset", at: NOW - 2 * MIN });
  });

  it("maps doctor checks and readiness onto the design's vocabulary", () => {
    const checks = checksFromDoctor({
      readiness: "attention",
      platform: "darwin",
      checks: [
        { id: "a", status: "error", title: "A", detail: "d", fix: "do x" },
        { id: "b", status: "info", title: "B", detail: "" },
      ],
    });
    expect(checks.map((c) => c.state)).toEqual(["fail", "info"]);
    expect(checks[0].fix).toBe("do x");
    expect(readinessFromDoctor("ready")).toBe("ready");
    expect(readinessFromDoctor("attention")).toBe("degraded");
    expect(readinessFromDoctor("blocked")).toBe("needs-action");
  });

  it("lets doctor worsen readiness but never improve it", () => {
    expect(deriveReadiness(true, true, false, "blocked")).toBe("needs-action");
    expect(deriveReadiness(true, true, false, "attention")).toBe("degraded");
    expect(deriveReadiness(true, true, true, "ready")).toBe("degraded");
    expect(deriveReadiness(true, false, false, "ready")).toBe("needs-action");
    expect(deriveReadiness(false, true, false, "blocked")).toBe("starting");
  });

  it("keeps the guard policy unknown when not read", () => {
    expect(guardFromStatus(null)).toEqual({ policy: null, loaded: [] });
    expect(guardFromStatus({ policy: "warn", loaded: [{ provider: "claude", name: "work", sessions: 2 }] })).toEqual({
      policy: "warn",
      loaded: [{ accountId: "claude:work", sessions: 2 }],
    });
  });
});

describe("desktopForeign", () => {
  it("names the other accounts a profile's own Desktop window is signed in with", () => {
    const m = desktopForeign([
      { profile: null, dir: "/app", accounts: [{ accountUuid: "a", profile: "side" }], mismatch: false },
      { profile: "work", dir: "/w", accounts: [{ accountUuid: "b", profile: "work" }, { accountUuid: "c", profile: "side" }, { accountUuid: "d", profile: null }], mismatch: true },
      { profile: "side", dir: "/s", accounts: [{ accountUuid: "c", profile: "side" }], mismatch: false },
    ]);
    expect([...m.entries()]).toEqual([["claude:work", ["side", "an account without a profile"]]]);
  });
});


describe("bindingsFromMappings — paused", () => {
  it("a paused rule is a switched-off binding; an older CLI without the field stays on", async () => {
    const { bindingsFromMappings } = await import("./build.js");
    const [paused, plain] = bindingsFromMappings([
      { path: "/a", provider: "claude", target: "work", paused: true },
      { path: "/b", provider: "claude", target: "work" },
    ]);
    expect(paused.enabled).toBe(false);
    expect(plain.enabled).toBe(true);
  });
});
