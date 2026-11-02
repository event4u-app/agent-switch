import { describe, expect, it, beforeEach } from "vitest";
import { APPEARANCE_KEY, initialAppearance, loadAppearance, parseAppearance, saveAppearance } from "./appearance.js";
import { activeTheme } from "./themes/resolve.js";

// jsdom's localStorage is unreliable here (see settings-store.test.ts): an in-memory one per test.
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

describe("appearance after the update", () => {

  it("a new install gets Darcula", () => {
    expect(activeTheme(initialAppearance(null, null, false), true).id).toBe("darcula");
  });

  it("a 2.11 user keeps the mode and the Agent Switch palette — nothing visible changes", () => {
    expect(initialAppearance(null, "light", true)).toMatchObject({ mode: "light", light: "agent-switch-light", dark: "agent-switch-dark" });
    expect(initialAppearance(null, "dark", true).mode).toBe("dark");
    // 2.11 stored nothing while it followed the system: accounts exist, so it is no new install.
    const silent = initialAppearance(null, null, true);
    expect(silent.mode).toBe("system");
    expect(activeTheme(silent, false).id).toBe("agent-switch-light");
    expect(activeTheme(silent, true).id).toBe("agent-switch-dark");
  });

  it("a stored v3 choice wins over the old key; unknown values are dropped, not trusted", () => {
    const v3 = JSON.stringify({ mode: "dark", dark: "nord", light: "github-light", accent: "agent-switch", terminalFollows: false });
    expect(initialAppearance(v3, "light", true)).toEqual({ mode: "dark", dark: "nord", light: "github-light", accent: "agent-switch", terminalFollows: false });
    expect(parseAppearance(JSON.stringify({ mode: "dark", dark: "<script>", accent: "red" }))).toMatchObject({ dark: "darcula", accent: "theme", terminalFollows: true });
    expect(parseAppearance("{broken")).toBeNull();
    expect(parseAppearance(JSON.stringify({ mode: "neon" }))).toBeNull();
  });

  it("saves and loads through localStorage", () => {
    localStorage.setItem("agent-switch-theme", "light");
    expect(loadAppearance(true).light).toBe("agent-switch-light");
    saveAppearance({ mode: "dark", dark: "dracula", light: "github-light", accent: "theme", terminalFollows: true });
    expect(JSON.parse(localStorage.getItem(APPEARANCE_KEY)!).dark).toBe("dracula");
    expect(loadAppearance(true).dark).toBe("dracula");
  });
});
