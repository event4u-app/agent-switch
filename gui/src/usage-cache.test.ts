import { beforeEach, describe, expect, it } from "vitest";
import { loadUsageCache, saveUsageSnapshot, dropUsageSnapshot } from "./usage-cache.js";
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
