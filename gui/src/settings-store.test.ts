import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_REFRESH_MINUTES,
  getRefreshMinutes,
  setRefreshMinutes,
  getDevMode,
  setDevModeFlag,
  getAgentConfigNotifiedVersion,
  setAgentConfigNotifiedVersion,
  getNextUsageRefreshAt,
  setNextUsageRefreshAt,
  getMutedKinds,
  setMutedKinds,
  getShareGlobal,
  setShareGlobalFlag,
  getAutoUpdateCheck,
  setAutoUpdateCheckFlag,
  getUpdateNotifiedVersion,
  setUpdateNotifiedVersion,
} from "./settings-store.js";

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

describe("getDevMode / setDevModeFlag", () => {
  it("defaults to off and round-trips only the literal on/off", () => {
    expect(getDevMode()).toBe(false);
    setDevModeFlag(true);
    expect(getDevMode()).toBe(true);
    setDevModeFlag(false);
    expect(getDevMode()).toBe(false);
  });
});

describe("getAutoUpdateCheck / setAutoUpdateCheckFlag", () => {
  it("defaults to ON when unset (fresh install gets update checks)", () => {
    expect(getAutoUpdateCheck()).toBe(true);
  });
  it("only the literal 'off' disables it", () => {
    setAutoUpdateCheckFlag(false);
    expect(getAutoUpdateCheck()).toBe(false);
    setAutoUpdateCheckFlag(true);
    expect(getAutoUpdateCheck()).toBe(true);
  });
});

describe("getUpdateNotifiedVersion / setUpdateNotifiedVersion", () => {
  it("defaults to empty and round-trips a version", () => {
    expect(getUpdateNotifiedVersion()).toBe("");
    setUpdateNotifiedVersion("v1.1.0");
    expect(getUpdateNotifiedVersion()).toBe("v1.1.0");
  });
});

describe("getAgentConfigNotifiedVersion / setAgentConfigNotifiedVersion", () => {
  it("defaults to empty and round-trips the notified version", () => {
    expect(getAgentConfigNotifiedVersion()).toBe("");
    setAgentConfigNotifiedVersion("9.2.0");
    expect(getAgentConfigNotifiedVersion()).toBe("9.2.0");
  });
});

describe("getNextUsageRefreshAt / setNextUsageRefreshAt", () => {
  it("defaults to 0 and round-trips a positive timestamp (survives reload via localStorage)", () => {
    expect(getNextUsageRefreshAt()).toBe(0);
    setNextUsageRefreshAt(1_784_000_000_000);
    expect(getNextUsageRefreshAt()).toBe(1_784_000_000_000);
  });
  it("ignores a garbage / non-positive stored value", () => {
    localStorage.setItem("agent-switch-next-usage-refresh-at", "nope");
    expect(getNextUsageRefreshAt()).toBe(0);
  });
});

describe("getMutedKinds default", () => {
  it("mutes `warning` (fetch failures) when never set; an explicit value wins", () => {
    expect(getMutedKinds()).toEqual(["warning"]); // unset → default-muted
    setMutedKinds([]); // user explicitly unmutes everything
    expect(getMutedKinds()).toEqual([]);
    setMutedKinds(["error"]);
    expect(getMutedKinds()).toEqual(["error"]);
  });
});

describe("getShareGlobal / setShareGlobalFlag", () => {
  it("defaults ON and only the literal off disables it", () => {
    expect(getShareGlobal()).toBe(true); // unset → on
    setShareGlobalFlag(false);
    expect(getShareGlobal()).toBe(false);
    setShareGlobalFlag(true);
    expect(getShareGlobal()).toBe(true);
  });
});
