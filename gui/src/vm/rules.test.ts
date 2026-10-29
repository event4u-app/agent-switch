import { describe, it, expect } from "vitest";
import {
  bindingWindow,
  headroom,
  isStale,
  nextInPools,
  rankAccounts,
  STALE_MS,
  toneFor,
  toolStatus,
  updateCount,
} from "./rules.js";
import type { Account, ToolEntry, UsageWindow } from "./types.js";

const NOW = Date.parse("2026-10-28T10:00:00Z");
const MIN = 60_000;

const win = (utilization: number | null, label = "5h"): UsageWindow => ({ key: label, label, utilization, resetsAt: null });

function account(over: Partial<Account> & Pick<Account, "id">): Account {
  return {
    tool: "claude",
    name: over.id.split(":")[1],
    identity: null,
    plan: null,
    label: null,
    color: "orange",
    isDefault: false,
    state: "ready",
    windows: [],
    checkedAt: NOW - MIN,
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

describe("toneFor", () => {
  it("is alert at/over the threshold, warn in the 10-point band below it, ok otherwise", () => {
    expect(toneFor(98, 98)).toBe("alert");
    expect(toneFor(100, 98)).toBe("alert");
    expect(toneFor(97, 98)).toBe("warn");
    expect(toneFor(88, 98)).toBe("warn");
    expect(toneFor(87, 98)).toBe("ok");
    expect(toneFor(0, 98)).toBe("ok");
  });
  it("follows a different threshold", () => {
    expect(toneFor(80, 80)).toBe("alert");
    expect(toneFor(70, 80)).toBe("warn");
    expect(toneFor(69, 80)).toBe("ok");
  });
  it("keeps unknown usage neutral — never free", () => {
    expect(toneFor(null, 98)).toBe("neutral");
    expect(toneFor(undefined, 98)).toBe("neutral");
  });
});

describe("isStale", () => {
  it("treats a readout older than 10 minutes, or none at all, as stale", () => {
    expect(isStale(NOW - STALE_MS, NOW)).toBe(false);
    expect(isStale(NOW - STALE_MS - 1, NOW)).toBe(true);
    expect(isStale(NOW - 2 * MIN, NOW)).toBe(false);
    expect(isStale(null, NOW)).toBe(true);
  });
});

describe("bindingWindow / headroom", () => {
  it("picks the fullest known window and keeps unknown as null", () => {
    expect(bindingWindow([win(42), win(61, "Week")])?.label).toBe("Week");
    expect(bindingWindow([win(null), win(null, "Week")])).toBeNull();
    expect(headroom({ windows: [win(42), win(61, "Week")] })).toBe(39);
    expect(headroom({ windows: [] })).toBeNull();
    expect(headroom({ windows: [win(120)] })).toBe(0);
  });
});

describe("rankAccounts", () => {
  it("never ranks a disabled account and lists it last", () => {
    const ranked = rankAccounts(
      [account({ id: "claude:off", disabled: true, windows: [win(1)] }), account({ id: "claude:on", windows: [win(60)] }), account({ id: "claude:out", state: "signed-out" })],
      "claude",
      NOW,
    );
    expect(ranked.map((r) => [r.account.id, r.rank])).toEqual([
      ["claude:on", 1],
      ["claude:out", null],
      ["claude:off", null],
    ]);
    expect(ranked[2].reason).toBe("Disabled — turn it back on to use it");
  });

  it("orders by state, then fresh before stale, then headroom; ranks only usable accounts", () => {
    const accounts = [
      account({ id: "claude:signed", state: "signed-out", windows: [win(1)] }),
      account({ id: "claude:stale", windows: [win(5)], checkedAt: NOW - 30 * MIN }),
      account({ id: "claude:busy", windows: [win(70)] }),
      account({ id: "claude:free", windows: [win(20)] }),
      account({ id: "claude:near", state: "near-limit", windows: [win(94)] }),
      account({ id: "claude:limited", state: "limited", windows: [win(100)] }),
      account({ id: "codex:other", tool: "codex", windows: [win(1)] }),
    ];
    const ranked = rankAccounts(accounts, "claude", NOW);
    expect(ranked.map((r) => r.account.id)).toEqual([
      "claude:free",
      "claude:busy",
      "claude:stale",
      "claude:near",
      "claude:limited",
      "claude:signed",
    ]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3, 4, null, null]);
    expect(ranked[0].reason).toBe("80% left in its binding window");
    expect(ranked[2].reason).toBe("95% left · usage is stale");
    expect(ranked[4].reason).toBe("At its limit");
    expect(ranked[5].reason).toBe("Sign-in needed");
  });

  it("puts unknown usage behind known headroom and says so", () => {
    const ranked = rankAccounts(
      [account({ id: "claude:unknown", windows: [] }), account({ id: "claude:known", windows: [win(90)] })],
      "claude",
      NOW,
    );
    expect(ranked.map((r) => r.account.id)).toEqual(["claude:known", "claude:unknown"]);
    expect(ranked[1].headroom).toBeNull();
    expect(ranked[1].reason).toBe("Usage unknown — not counted as free");
  });

  it("skips the freshness judgement without a clock", () => {
    const ranked = rankAccounts(
      [account({ id: "claude:a", windows: [win(10)], checkedAt: null }), account({ id: "claude:b", windows: [win(50)] })],
      "claude",
    );
    expect(ranked[0].account.id).toBe("claude:a");
    expect(ranked[0].reason).toBe("90% left in its binding window");
  });
});

describe("nextInPools", () => {
  it("marks each pool's rank-1 account with the pool label", () => {
    const accounts = [
      account({ id: "claude:work", windows: [win(40)] }),
      account({ id: "claude:side", windows: [win(10)] }),
      account({ id: "claude:home", windows: [win(50)] }),
      account({ id: "claude:out", state: "signed-out" }),
    ];
    const pools = [
      { id: "work", label: "Work", accountIds: ["claude:work", "claude:side"] },
      { id: "personal", label: "Personal", accountIds: ["claude:home"] },
      { id: "dead", label: "Dead", accountIds: ["claude:out"] },
    ];
    const next = nextInPools(accounts, "claude", pools, NOW);
    expect([...next.entries()]).toEqual([
      ["claude:side", "Work"],
      ["claude:home", "Personal"],
    ]);
  });
});

describe("toolStatus / updateCount", () => {
  const tool = (over: Partial<ToolEntry>): ToolEntry => ({
    id: "x",
    name: "x",
    role: "",
    present: true,
    version: "1.0.0",
    latest: "1.0.0",
    healthy: true,
    ...over,
  });
  it("classifies every case", () => {
    expect(toolStatus(tool({ present: false }))).toBe("missing");
    expect(toolStatus(tool({ healthy: false }))).toBe("attention");
    expect(toolStatus(tool({ latest: null }))).toBe("unknown");
    expect(toolStatus(tool({ latest: "1.1.0" }))).toBe("update");
    expect(toolStatus(tool({}))).toBe("ok");
  });
  it("counts only updates", () => {
    expect(updateCount([tool({ latest: "2" }), tool({ latest: null }), tool({ latest: "3" }), tool({})])).toBe(2);
  });
});
