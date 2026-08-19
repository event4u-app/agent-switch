import { describe, it, expect } from "vitest";
import {
  agentConfigNotes,
  deriveAgentConfigView,
  parseAgentConfigVersion,
  type AgentConfigStatus,
} from "./agent-config.js";
import type { ReleaseInfo } from "./updates.js";

const release = (tag: string, notes = `notes for ${tag}`): ReleaseInfo => ({
  tag,
  name: tag,
  url: `https://example.test/${tag}`,
  notes,
  publishedAt: "2026-08-18T16:47:49Z",
});

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
    expect(deriveAgentConfigView(s, false)).toEqual({
      visible: true,
      mode: "update",
      current: "9.1.0",
      latest: "9.2.0",
      releases: [],
    });
  });

  it("carries the unread release bodies on the update view, newest first", () => {
    const s = status({ current: "9.0.0", latest: "9.2.0", newer: [release("9.2.0"), release("9.1.0")] });
    const v = deriveAgentConfigView(s, false);
    expect(v.visible && v.mode === "update" && v.releases.map((r) => r.tag)).toEqual(["9.2.0", "9.1.0"]);
  });

  it("still shows the update banner with an empty notes list when the bodies are unfetchable", () => {
    // Rate-limited / offline: `latest` came from the single-release fallback and
    // no list was retrieved. The banner must still appear, the panel must not.
    const v = deriveAgentConfigView(status({ current: "9.1.0", latest: "9.2.0", newer: [] }), false);
    expect(v.visible && v.mode === "update" && v.releases).toEqual([]);
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

describe("agentConfigNotes", () => {
  it("is empty while undetected, when not installed, and when up to date", () => {
    expect(agentConfigNotes(null)).toEqual([]);
    expect(agentConfigNotes(status({ installed: false, current: null, newer: [release("9.2.0")] }))).toEqual([]);
    expect(agentConfigNotes(status({ current: "9.2.0", newer: [] }))).toEqual([]);
  });

  it("returns the releases newer than the installed version, newest first", () => {
    const s = status({ current: "9.0.0", latest: "9.2.0", newer: [release("9.2.0"), release("9.1.0")] });
    expect(agentConfigNotes(s).map((r) => r.tag)).toEqual(["9.2.0", "9.1.0"]);
  });

  it("re-filters a stale list against the installed version (post-upgrade sweep)", () => {
    // After an in-app upgrade the version re-detects before a fresh list lands;
    // the panel must not keep offering notes for a version now installed.
    const s = status({ current: "9.2.0", latest: "9.2.0", newer: [release("9.2.0"), release("9.1.0")] });
    expect(agentConfigNotes(s)).toEqual([]);
  });
});
