import { beforeEach, describe, expect, it } from "vitest";
import { loadUsageCache, saveUsageSnapshot, dropUsageSnapshot, getUsageAttempts, markUsageAttempt, fetchOnCooldown, withStickyResets, isUsageStale } from "./usage-cache.js";
import type { UsageSnapshot } from "./transforms.js";

// jsdom's localStorage is an unreliable stub here; install a minimal in-memory
// Storage so this suite exercises the real persistence logic hermetically.
beforeEach(() => {
  const map = new Map<string, string>();
  const mem: Pick<Storage, "getItem" | "setItem" | "removeItem" | "clear"> = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  };
  Object.defineProperty(globalThis, "localStorage", { value: mem, configurable: true });
});

const snap = (util: number): UsageSnapshot => ({
  windows: [{ key: "seven_day", label: "All", utilization: util, resetsAt: null }],
  routines: null,
  capturedAt: "2026-07-15T00:00:00.000Z",
});

describe("dropUsageSnapshot", () => {
  it("forgets one profile's cached snapshot, leaving the others intact", () => {
    saveUsageSnapshot("claude/old", snap(42));
    saveUsageSnapshot("claude/other", snap(7));

    dropUsageSnapshot("claude/old");

    const cache = loadUsageCache();
    expect(cache["claude/old"]).toBeUndefined(); // dropped…
    expect(cache["claude/other"]?.snap.windows[0].utilization).toBe(7); // …neighbour kept
  });

  it("is a no-op for an absent key", () => {
    saveUsageSnapshot("claude/keep", snap(50));
    dropUsageSnapshot("claude/never-cached");
    expect(loadUsageCache()["claude/keep"]?.snap.windows[0].utilization).toBe(50);
  });
});

describe("usage-fetch attempt cooldown (survives reload; covers failures)", () => {
  const NOW = 1_784_200_000_000;

  it("records an attempt (success OR failure) and round-trips it, keyed by profile", () => {
    markUsageAttempt("claude/work", NOW);
    expect(getUsageAttempts()["claude/work"]).toBe(NOW);
    // A restored attempt (e.g. after a rebuild) reads back the same value.
    expect(getUsageAttempts()["claude/other"]).toBeUndefined();
  });

  it("is on cooldown when the last attempt is within the window (blocks a re-fetch)", () => {
    expect(fetchOnCooldown(NOW - 5 * 60_000, 10 * 60_000, NOW)).toBe(true); // 5 min ago
    expect(fetchOnCooldown(NOW - 20 * 60_000, 10 * 60_000, NOW)).toBe(false); // 20 min ago → allowed
    expect(fetchOnCooldown(undefined, 10 * 60_000, NOW)).toBe(false); // never attempted → allowed
  });

  it("dropUsageSnapshot also clears the attempt so a renamed profile re-fetches", () => {
    saveUsageSnapshot("claude/old", snap(50));
    markUsageAttempt("claude/old", NOW);
    dropUsageSnapshot("claude/old");
    expect(getUsageAttempts()["claude/old"]).toBeUndefined();
    expect(loadUsageCache()["claude/old"]).toBeUndefined();
  });
});

describe("withStickyResets — never lose a reset time once seen", () => {
  const mk = (windows: UsageSnapshot["windows"]): UsageSnapshot => ({ windows, routines: null, capturedAt: "x" });

  it("backfills a dropped resetsAt per window key from the previous snapshot", () => {
    const prev = mk([{ key: "seven_day", label: "All", utilization: 5, resetsAt: "2026-07-20T00:00:00Z" }]);
    const next = mk([{ key: "seven_day", label: "All", utilization: 6, resetsAt: null }]); // API dropped it
    const merged = withStickyResets(prev, next);
    expect(merged.windows[0].resetsAt).toBe("2026-07-20T00:00:00Z");
    expect(merged.windows[0].utilization).toBe(6); // new value kept
  });

  it("keeps the NEW resetsAt when present; no prev → passthrough", () => {
    const prev = mk([{ key: "seven_day", label: "All", utilization: 5, resetsAt: "2026-07-19T00:00:00Z" }]);
    const next = mk([{ key: "seven_day", label: "All", utilization: 6, resetsAt: "2026-07-21T00:00:00Z" }]);
    expect(withStickyResets(prev, next).windows[0].resetsAt).toBe("2026-07-21T00:00:00Z");
    expect(withStickyResets(undefined, next).windows[0].resetsAt).toBe("2026-07-21T00:00:00Z");
  });
});

describe("isUsageStale — age-based, not fetched-this-session", () => {
  const NOW = 1_000_000_000_000;
  const at = (ms: number): UsageSnapshot => ({ windows: [], routines: null, capturedAt: new Date(ms).toISOString() });
  const STALE = 20 * 60_000; // 2× a 10-min interval

  it("recent capture is NOT stale (unchanged/skipped-on-cooldown stays solid)", () => {
    expect(isUsageStale(at(NOW - 5 * 60_000), NOW, STALE)).toBe(false); // 5 min old
  });
  it("old capture IS stale (repeated refresh failures)", () => {
    expect(isUsageStale(at(NOW - 25 * 60_000), NOW, STALE)).toBe(true); // 25 min old
  });
  it("no snapshot is not stale; unparseable capturedAt is stale", () => {
    expect(isUsageStale(null, NOW, STALE)).toBe(false);
    expect(isUsageStale({ windows: [], routines: null, capturedAt: "not-a-date" }, NOW, STALE)).toBe(true);
  });
});
