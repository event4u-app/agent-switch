import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_REFRESH_MINUTES, getRefreshMinutes, setRefreshMinutes } from "./settings-store.js";

const KEY = "agent-switch-refresh-interval-min";

// jsdom's localStorage is an unreliable stub in this env (the App tests mock the
// store to sidestep it). Install a minimal in-memory Storage so this suite can
// exercise the real persistence + clamping logic hermetically.
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

describe("getRefreshMinutes", () => {
  it("defaults to 10 when unset", () => {
    expect(getRefreshMinutes()).toBe(DEFAULT_REFRESH_MINUTES);
    expect(DEFAULT_REFRESH_MINUTES).toBe(10);
  });

  it("round-trips a valid on-step value", () => {
    setRefreshMinutes(30);
    expect(getRefreshMinutes()).toBe(30);
  });

  it("clamps an off-step legacy value to the nearest allowed step", () => {
    localStorage.setItem(KEY, "7"); // → 5
    expect(getRefreshMinutes()).toBe(5);
    localStorage.setItem(KEY, "13"); // → 15
    expect(getRefreshMinutes()).toBe(15);
    localStorage.setItem(KEY, "1000"); // above range → 60
    expect(getRefreshMinutes()).toBe(60);
  });

  it("falls back to the default for garbage or non-positive values", () => {
    localStorage.setItem(KEY, "not-a-number");
    expect(getRefreshMinutes()).toBe(DEFAULT_REFRESH_MINUTES);
    localStorage.setItem(KEY, "0");
    expect(getRefreshMinutes()).toBe(DEFAULT_REFRESH_MINUTES);
    localStorage.setItem(KEY, "-15");
    expect(getRefreshMinutes()).toBe(DEFAULT_REFRESH_MINUTES);
  });
});
