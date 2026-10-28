import { describe, expect, it } from "vitest";
import type { Account, Attention, Binding, Session } from "../../vm/types.js";
import {
  appUnavailableReason,
  canStartOn,
  countSessions,
  filterSessions,
  limitOptions,
  limitSession,
  limitTargets,
  liveSwitch,
  overviewSub,
  recentFolders,
  resolveStart,
  sessionHandle,
  toolCanTakeWork,
} from "./logic.js";

const NOW = 1_800_000_000_000;

function acc(name: string, over: Partial<Account> = {}): Account {
  return {
    id: `claude:${name}`,
    tool: "claude",
    name,
    identity: null,
    plan: null,
    label: null,
    color: "orange",
    isDefault: false,
    state: "ready",
    windows: [{ key: "5h", label: "5h", utilization: 40, resetsAt: null }],
    checkedAt: NOW - 60_000,
    resetCredits: null,
    threshold: 98,
    protection: null,
    auth: null,
    surfaces: [],
    liveSessions: 0,
    pools: [],
    ...over,
  };
}

function ses(id: string, over: Partial<Session> = {}): Session {
  return {
    id: `claude:${id}`,
    tool: "claude",
    accountId: "claude:work",
    project: id,
    cwd: `/Users/x/dev/${id}`,
    branch: null,
    title: id,
    state: "working",
    startedAt: NOW - 3_600_000,
    lastActiveAt: NOW - 1000,
    contextPct: null,
    model: null,
    summary: null,
    why: [],
    protectionNote: null,
    surface: null,
    ...over,
  };
}

describe("session filters", () => {
  const sessions = [
    ses("a", { state: "working", lastActiveAt: NOW - 50 }),
    ses("b", { state: "idle", lastActiveAt: NOW - 10 }),
    ses("c", { state: "done", lastActiveAt: NOW - 5 }),
    ses("d", { state: "waiting", lastActiveAt: NOW - 100, tool: "codex", accountId: "codex:me" }),
    ses("e", { state: "parked" }),
    ses("f", { state: "done", trashed: true }),
  ];

  it("counts each view the way the design does", () => {
    expect(countSessions(sessions, "open")).toBe(4);
    expect(countSessions(sessions, "needs-you")).toBe(1);
    expect(countSessions(sessions, "paused")).toBe(1);
    expect(countSessions(sessions, "done")).toBe(1);
    expect(countSessions(sessions, "all")).toBe(5);
    expect(countSessions(sessions, "trash")).toBe(1);
  });

  it("sorts active first, then by last activity, and filters by tool and account", () => {
    expect(filterSessions(sessions, "open", "all", "all").map((s) => s.project)).toEqual(["a", "d", "b", "e"]);
    expect(filterSessions(sessions, "all", "codex", "all").map((s) => s.project)).toEqual(["d"]);
    expect(filterSessions(sessions, "all", "all", "codex:me").map((s) => s.project)).toEqual(["d"]);
  });

  it("derives recent folders newest first without duplicates", () => {
    const list = [ses("x", { cwd: "/a", lastActiveAt: 1 }), ses("y", { cwd: "/b", lastActiveAt: 3 }), ses("z", { cwd: "/a", lastActiveAt: 2 })];
    expect(recentFolders(list)).toEqual(["/b", "/a"]);
    expect(sessionHandle(ses("abc"))).toBe("abc");
  });
});

describe("live switch availability", () => {
  it("is Claude + terminal + macOS + not ended only", () => {
    expect(liveSwitch(ses("a"), "mac").ok).toBe(true);
    expect(liveSwitch(ses("a", { tool: "codex" }), "mac").reason).toBe("Live switching is only available for Claude today.");
    expect(liveSwitch(ses("a", { surface: "desktop-app" }), "mac").reason).toMatch(/Only sessions in a terminal/);
    expect(liveSwitch(ses("a"), "linux").reason).toBe("Live switching works on macOS only today.");
    expect(liveSwitch(ses("a", { state: "done" }), "mac").reason).toBe("The session has ended.");
  });
});

describe("start resolution", () => {
  const accounts = [acc("work", { isDefault: true }), acc("side")];
  it("falls back to the default account without rules", () => {
    const r = resolveStart("/Users/x/dev/a", "claude", [], accounts, []);
    expect(r.account?.name).toBe("work");
    expect(r.why).toEqual(["No rule matches — default claude account work"]);
    expect(resolveStart("/x", "codex", [], accounts, []).why).toEqual(["No rule matches and no default codex account"]);
  });
  it("honours a matching folder binding", () => {
    const rule: Binding = {
      id: "r",
      match: { kind: "folder", value: "~/dev/*" },
      tool: "any",
      target: { kind: "account", accountId: "claude:side" },
      enabled: true,
      hits: null,
    };
    const r = resolveStart("/Users/x/dev/a", "claude", [rule], accounts, []);
    expect(r.account?.name).toBe("side");
    expect(r.why[0]).toBe("Rule: folder ~/dev/* → side");
  });
  it("only starts on accounts that can take work", () => {
    expect(canStartOn(acc("a", { state: "signed-out" }))).toBe(false);
    expect(canStartOn(acc("a", { state: "limited" }))).toBe(false);
    expect(canStartOn(acc("a", { state: "near-limit" }))).toBe(true);
    expect(canStartOn(null)).toBe(false);
    expect(toolCanTakeWork(accounts, "gemini")).toBe(false);
    expect(toolCanTakeWork(accounts, "claude")).toBe(true);
  });
  it("explains a missing desktop app", () => {
    expect(appUnavailableReason({ surfaces: [] }, "gemini")).toBe("Gemini has no desktop app");
    expect(appUnavailableReason({ surfaces: [] }, "claude")).toBe("No Claude app found on this computer");
    expect(
      appUnavailableReason(
        { surfaces: [{ id: "claude-desktop", tool: "claude", name: "Claude", kind: "desktop", detected: true, capability: null, protection: null, identitySeen: null, launcher: null, checkedAt: null }] },
        "claude",
      ),
    ).toBeNull();
  });
});

describe("near-limit options", () => {
  const side = acc("side", { state: "near-limit", windows: [{ key: "5h", label: "5h", utilization: 94, resetsAt: null }] });
  const work = acc("work");
  const item: Attention = { id: "limit:claude:side", kind: "near-limit", title: "t", detail: "d", accountId: side.id, primary: "Decide", at: NOW };

  it("never offers pause or keep — the protection engine does not exist", () => {
    const opts = limitOptions(side, ses("a", { accountId: side.id }), limitTargets(side, [side, work], NOW), "mac");
    const byId = Object.fromEntries(opts.map((o) => [o.id, o]));
    expect(byId.pause.disabled).toBe(true);
    expect(byId.pause.detail).toBe("Not available here: Pausing needs the protection engine — Agent Switch warns at the threshold today.");
    expect(byId.keep.disabled).toBe(true);
    expect(byId.switch.disabled).toBe(false);
    expect(byId["continue-elsewhere"].disabled).toBe(false);
  });

  it("disables moves without a session or another account, with the reason", () => {
    const noSession = limitOptions(side, null, limitTargets(side, [side, work], NOW), "mac");
    expect(noSession.find((o) => o.id === "switch")?.detail).toBe("Not available here: no running session on side.");
    const alone = limitOptions(side, ses("a", { accountId: side.id }), limitTargets(side, [side], NOW), "mac");
    expect(alone.find((o) => o.id === "continue-elsewhere")?.disabled).toBe(true);
    const linux = limitOptions(side, ses("a", { accountId: side.id }), limitTargets(side, [side, work], NOW), "linux");
    expect(linux.find((o) => o.id === "switch")?.detail).toBe("Not available here: Live switching works on macOS only today.");
  });

  it("finds the account's newest running session when the item names none", () => {
    const list = [
      ses("old", { accountId: side.id, lastActiveAt: 1 }),
      ses("new", { accountId: side.id, lastActiveAt: 5 }),
      ses("gone", { accountId: side.id, lastActiveAt: 9, state: "done" }),
    ];
    expect(limitSession(item, list)?.project).toBe("new");
    expect(limitTargets(side, [side, work, acc("out", { state: "signed-out" })], NOW).map((r) => r.account.name)).toEqual(["work"]);
  });
});

describe("overview subtitle", () => {
  it("counts ready accounts, working sessions and needs", () => {
    expect(overviewSub({ accounts: [acc("a"), acc("b", { state: "signed-out" })], sessions: [ses("x"), ses("y", { state: "idle" })], attention: [] })).toBe(
      "1 of 2 accounts ready · 1 sessions working · nothing needs you",
    );
  });
});
