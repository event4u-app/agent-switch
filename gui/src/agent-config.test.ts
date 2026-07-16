import { describe, it, expect } from "vitest";
import { deriveAgentConfigView, parseAgentConfigVersion, type AgentConfigStatus } from "./agent-config.js";

const status = (over: Partial<AgentConfigStatus>): AgentConfigStatus => ({
  installed: true,
  current: "9.2.0",
  latest: "9.2.0",
  ...over,
});

describe("deriveAgentConfigView", () => {
  it("is hidden while status is unknown (not yet detected)", () => {
    expect(deriveAgentConfigView(null, false)).toEqual({ visible: false });
    expect(deriveAgentConfigView(null, true)).toEqual({ visible: false });
  });

  it("shows the install promo when not installed (regardless of dev mode)", () => {
    const s = status({ installed: false, current: null });
    expect(deriveAgentConfigView(s, false)).toEqual({ visible: true, mode: "install" });
    expect(deriveAgentConfigView(s, true)).toEqual({ visible: true, mode: "install" });
  });

  it("shows the update banner with versions when a newer release exists", () => {
    const s = status({ current: "9.1.0", latest: "9.2.0" });
    expect(deriveAgentConfigView(s, false)).toEqual({ visible: true, mode: "update", current: "9.1.0", latest: "9.2.0" });
  });

  it("hides when installed + up to date, EXCEPT in dev mode (shows both versions)", () => {
    const s = status({ current: "9.2.0", latest: "9.2.0" });
    expect(deriveAgentConfigView(s, false)).toEqual({ visible: false });
    expect(deriveAgentConfigView(s, true)).toEqual({ visible: true, mode: "installed", current: "9.2.0", latest: "9.2.0" });
  });

  it("does not claim an update when the latest is unknown (offline), but still carries latest=null", () => {
    const s = status({ current: "9.2.0", latest: null });
    expect(deriveAgentConfigView(s, false)).toEqual({ visible: false });
    expect(deriveAgentConfigView(s, true)).toEqual({ visible: true, mode: "installed", current: "9.2.0", latest: null });
  });
});

describe("parseAgentConfigVersion", () => {
  it("extracts the version from common --version outputs", () => {
    expect(parseAgentConfigVersion("agent-config 9.2.0")).toBe("9.2.0");
    expect(parseAgentConfigVersion("9.2.0\n")).toBe("9.2.0");
    expect(parseAgentConfigVersion("v9.2.0")).toBe("9.2.0");
    expect(parseAgentConfigVersion("agent-config/9.2 (node)")).toBe("9.2");
  });
  it("returns null when nothing version-like is present", () => {
    expect(parseAgentConfigVersion("command not found")).toBeNull();
    expect(parseAgentConfigVersion("")).toBeNull();
  });
});
