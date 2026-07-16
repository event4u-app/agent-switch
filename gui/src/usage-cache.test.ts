import { beforeEach, describe, expect, it } from "vitest";
import { loadUsageCache, saveUsageSnapshot, dropUsageSnapshot, getUsageAttempts, markUsageAttempt, fetchOnCooldown } from "./usage-cache.js";
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
