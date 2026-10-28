import { describe, it, expect } from "vitest";
import {
  accountFromProfile,
  agentConfigFromStatus,
  colorFor,
  deriveAttention,
  deriveReadiness,
  noticeFromNotification,
  sessionFromRow,
  toolFromEntry,
} from "./build.js";
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
    expect(accountFromProfile(row(), usage([70, 20]), 80).state).toBe("near-limit");
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

  it("keeps ids, project and unknown context", () => {
    const v = sessionFromRow(s({ summary: "Edge filter" }), NOW);
    expect(v.id).toBe("claude:7f3c2a91-4b1e");
    expect(v.accountId).toBe("claude:work");
    expect(v.project).toBe("agent-config");
    expect(v.title).toBe("Edge filter");
    expect(v.contextPct).toBeNull();
    expect(v.why).toEqual([]);
  });

  it("falls back to the project dir and a handle title", () => {
    const v = sessionFromRow(s({ cwd: null, summary: null }), NOW);
    expect(v.cwd).toBe("/Users/x/.claude/projects/-Users-x-dev-agent-config");
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
    const near = accountFromProfile(row({ name: "side" }), usage([94]));
    const fine = accountFromProfile(row(), usage([20]));
    const items = deriveAttention([near, fine], tools, NOW - 6 * MIN, NOW);
    expect(items.map((i) => i.kind)).toEqual(["near-limit", "update"]);
    expect(items[0].title).toBe("side is at 94 % of its 5h window");
    expect(items[0].detail).toBe("Resets in 1h 18m.");
    expect(items[1].title).toBe("agent-config 18.2.0 is out");
    expect(items[1].detail).toBe("You have 18.1.0. Codex CLI has an update too. Running sessions are not touched.");
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
