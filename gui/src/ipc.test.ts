import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Tauri shell plugin so the IPC wrappers are testable without a
// runtime. vi.hoisted lets the (hoisted) vi.mock factory reference these.
const { create, execute, spawn, invoke, asEnable, asDisable, asIsEnabled } = vi.hoisted(() => {
  const execute = vi.fn();
  const spawn = vi.fn();
  const create = vi.fn(() => ({ execute, spawn }));
  const invoke = vi.fn();
  const asEnable = vi.fn();
  const asDisable = vi.fn();
  const asIsEnabled = vi.fn();
  return { create, execute, spawn, invoke, asEnable, asDisable, asIsEnabled };
});
vi.mock("@tauri-apps/plugin-shell", () => ({ Command: { create } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/plugin-autostart", () => ({ enable: asEnable, disable: asDisable, isEnabled: asIsEnabled }));

import {
  listProfiles,
  activeStatus,
  switchProfile,
  agentConfigVersion,
  installAgentConfig,
  upgradeAgentConfig,
  shareStatus,
  shareOn,
  shareOff,
  shareSync,
  openWeb,
  loginArgs,
  sessionArgs,
  assertValidName,
  deactivateProfile,
  removeProfile,
  quitApp,
  profileUsage,
  setProfileLabel,
  getAutoSwitch,
  setAutoSwitch,
  uninstall,
  getAutostart,
  setAutostart,
  listApps,
  openApp,
  listSessions,
  sessionPreview,
  deleteSessionArgs,
  deleteSession,
  restoreSession,
  extractHandoffBrief,
  handoffSeedArgs,
  takeoverArgs,
  compactArgs,
  getNotifyConfig,
  setNotify,
  setTrayTooltip,
} from "./ipc.js";

beforeEach(() => vi.clearAllMocks());

describe("ipc", () => {
  it("listProfiles runs `agent-switch list --json` and parses the JSON", async () => {
    execute.mockResolvedValue({ code: 0, stdout: '[{"provider":"claude","name":"work"}]', stderr: "" });
    const rows = await listProfiles();
    expect(create).toHaveBeenCalledWith("agent-switch", ["list", "--json"]);
    expect(rows[0].name).toBe("work");
  });

  it("activeStatus runs `agent-switch status --provider <p> --json`", async () => {
    execute.mockResolvedValue({ code: 0, stdout: '{"provider":"codex","name":"work","identity":null,"usage":null}', stderr: "" });
    const s = await activeStatus("codex");
    expect(create).toHaveBeenCalledWith("agent-switch", ["status", "--provider", "codex", "--json"]);
    expect(s?.name).toBe("work");
  });

  it("activeStatus returns null on a non-zero exit (no active profile — not an error)", async () => {
    execute.mockResolvedValue({ code: 1, stdout: "", stderr: "error: no active claude profile for --json" });
    await expect(activeStatus("claude")).resolves.toBeNull();
  });

  it("switchProfile calls `use <name> --provider <p>` (name-first — avoids the flag-leak)", async () => {
    execute.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    await switchProfile("codex", "work");
    expect(create).toHaveBeenCalledWith("agent-switch", ["use", "work", "--provider", "codex"]);
  });

  it("throws with the stderr on a non-zero exit", async () => {
    execute.mockResolvedValue({ code: 1, stdout: "", stderr: "boom" });
    await expect(listProfiles()).rejects.toThrow(/boom/);
  });

  it("openWeb spawns claude.ai fire-and-forget (a browser, not a terminal)", async () => {
    await openWeb("work");
    expect(create).toHaveBeenCalledWith("agent-switch", ["web", "work"]);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("loginArgs / sessionArgs build the args the embedded terminal runs (no external window)", () => {
    expect(loginArgs("codex", "work")).toEqual(["add", "work", "--provider", "codex"]);
    expect(sessionArgs("antigravity", "g")).toEqual(["run", "g", "--provider", "antigravity"]);
  });

  it("loginArgs / assertValidName reject an unsafe profile name (injection guard)", () => {
    expect(() => loginArgs("claude", 'a" & rm -rf ~ #')).toThrow(/letters, numbers/);
    expect(() => assertValidName("ok.name-1_2")).not.toThrow();
    expect(() => assertValidName("bad name")).toThrow(/letters, numbers/);
  });

  it("deactivateProfile clears the active profile for a provider", async () => {
    execute.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    await deactivateProfile("claude");
    expect(create).toHaveBeenCalledWith("agent-switch", ["deactivate", "--provider", "claude"]);
  });

  it("removeProfile deletes with --force (deactivate-then-delete in one step)", async () => {
    execute.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    await removeProfile("codex", "old");
    expect(create).toHaveBeenCalledWith("agent-switch", ["remove", "old", "--provider", "codex", "--force"]);
  });

  it("quitApp invokes the `quit` Tauri command", async () => {
    await quitApp();
    expect(invoke).toHaveBeenCalledWith("quit");
  });

  it("profileUsage reads a named profile's own usage snapshot", async () => {
    execute.mockResolvedValue({ code: 0, stdout: '{"provider":"claude","name":"work","identity":null,"usage":{"windows":[],"routines":null,"capturedAt":"x"}}', stderr: "" });
    const u = await profileUsage("claude", "work");
    expect(create).toHaveBeenCalledWith("agent-switch", ["status", "--provider", "claude", "work", "--json"]);
    expect(u).toEqual({ windows: [], routines: null, capturedAt: "x" });
  });

  it("setProfileLabel sets a label, and clears with `none`", async () => {
    execute.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    await setProfileLabel("claude", "work", "Work");
    expect(create).toHaveBeenCalledWith("agent-switch", ["label", "work", "Work", "--provider", "claude"]);
    await setProfileLabel("claude", "work", null);
    expect(create).toHaveBeenCalledWith("agent-switch", ["label", "work", "none", "--provider", "claude"]);
  });

  it("getAutoSwitch returns the per-provider map; setAutoSwitch targets one provider", async () => {
    execute.mockResolvedValue({
      code: 0,
      stdout: '{"claude":{"enabled":true,"threshold":90},"codex":{"enabled":false,"threshold":95},"antigravity":{"enabled":false,"threshold":95}}',
      stderr: "",
    });
    const map = await getAutoSwitch();
    expect(create).toHaveBeenCalledWith("agent-switch", ["autoswitch", "status", "--json"]);
    expect(map.claude).toEqual({ enabled: true, threshold: 90 });
    expect(map.codex.enabled).toBe(false);

    await setAutoSwitch("codex", true, 80);
    expect(create).toHaveBeenCalledWith("agent-switch", ["autoswitch", "on", "--provider", "codex", "--threshold", "80"]);
    await setAutoSwitch("antigravity", false);
    expect(create).toHaveBeenCalledWith("agent-switch", ["autoswitch", "off", "--provider", "antigravity"]);
  });

  it("listSessions runs `sessions --recent N --json`; takeoverArgs builds the CLI args", async () => {
    execute.mockResolvedValue({
      code: 0,
      stdout: '[{"provider":"claude","profile":"work","sessionId":"abc","projectDir":"p","cwd":"/w","mtimeMs":1,"live":false}]',
      stderr: "",
    });
    const s = await listSessions(undefined, 20);
    expect(create).toHaveBeenCalledWith("agent-switch", ["sessions", "--recent", "20", "--json"]);
    expect(s[0].sessionId).toBe("abc");
    expect(takeoverArgs("abc", "privat")).toEqual(["takeover", "abc", "--to", "privat"]);
    expect(takeoverArgs("abc", "privat", true)).toEqual(["takeover", "abc", "--to", "privat", "--keep-source"]);
  });

  it("listSessions returns [] on failure", async () => {
    execute.mockResolvedValue({ code: 1, stdout: "", stderr: "boom" });
    await expect(listSessions()).resolves.toEqual([]);
  });

  it("sessionPreview runs `sessions preview <id> --provider P --from profile` and parses turns", async () => {
    execute.mockResolvedValue({
      code: 0,
      stdout: '{"provider":"claude","profile":"work","sessionId":"abc","messages":[{"role":"user","text":"hi"}],"truncated":true}',
      stderr: "",
    });
    const p = await sessionPreview("claude", "abc", "work");
    expect(create).toHaveBeenCalledWith("agent-switch", ["sessions", "preview", "abc", "--provider", "claude", "--from", "work"]);
    expect(p.messages).toEqual([{ role: "user", text: "hi" }]);
    expect(p.truncated).toBe(true);
  });

  it("sessionPreview degrades to an empty preview on failure", async () => {
    execute.mockResolvedValue({ code: 1, stdout: "", stderr: "boom" });
    await expect(sessionPreview("claude", "abc", "work")).resolves.toEqual({ messages: [], truncated: false });
  });

  it("listSessions passes --provider when given; deleteSessionArgs carries no live flag", async () => {
    execute.mockResolvedValue({ code: 0, stdout: "[]", stderr: "" });
    await listSessions(undefined, 20, "codex");
    expect(create).toHaveBeenCalledWith("agent-switch", ["sessions", "--recent", "20", "--provider", "codex", "--json"]);
    expect(deleteSessionArgs("claude", "id1", "work")).toEqual([
      "sessions", "rm", "id1", "--provider", "claude", "--from", "work", "--yes",
    ]);
    expect(deleteSessionArgs("claude", "id1", "work", { purge: true })).toEqual([
      "sessions", "rm", "id1", "--provider", "claude", "--from", "work", "--purge", "--yes",
    ]);
  });

  it("extractHandoffBrief prints the brief + reads the 0600 path; handoffSeedArgs is path-only", async () => {
    execute
      .mockResolvedValueOnce({ code: 0, stdout: "# Handoff brief\n- Source session: id1", stderr: "" }) // --print-only
      .mockResolvedValueOnce({ code: 0, stdout: '{"briefPath":"/cfg/.agent-switch/handoff/id1.md"}', stderr: "" }); // --json
    const r = await extractHandoffBrief("claude", "work", "id1", "codex");
    expect(create).toHaveBeenCalledWith("agent-switch", [
      "handoff", "extract", "id1", "--provider", "claude", "--from", "work", "--to", "codex", "--print-only",
    ]);
    expect(r.brief).toMatch(/Handoff brief/);
    expect(r.briefPath).toBe("/cfg/.agent-switch/handoff/id1.md");
    // seed args reference the path only — never brief content
    expect(handoffSeedArgs("codex", "oai", "/cfg/.agent-switch/handoff/id1.md")).toEqual([
      "handoff", "seed", "--to", "oai", "--provider", "codex", "--brief", "/cfg/.agent-switch/handoff/id1.md",
    ]);
  });

  it("deleteSession appends --json and returns the trash handle; restoreSession builds restore", async () => {
    execute.mockResolvedValue({ code: 0, stdout: '{"mode":"trash","trashId":"1000-id1"}', stderr: "" });
    const r = await deleteSession("claude", "id1", "work");
    expect(create).toHaveBeenCalledWith("agent-switch", [
      "sessions", "rm", "id1", "--provider", "claude", "--from", "work", "--yes", "--json",
    ]);
    expect(r).toEqual({ mode: "trash", trashId: "1000-id1" });
    await restoreSession("claude", "1000-id1", "work");
    expect(create).toHaveBeenCalledWith("agent-switch", ["sessions", "restore", "1000-id1", "--provider", "claude", "--from", "work"]);
  });

  it("uninstall runs `uninstall --force`", async () => {
    execute.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    await uninstall();
    expect(create).toHaveBeenCalledWith("agent-switch", ["uninstall", "--force"]);
  });

  it("listApps parses `apps --json`; openApp runs `open <app> <profile>`", async () => {
    execute.mockResolvedValue({
      code: 0,
      stdout: '[{"id":"claude-desktop","displayName":"Claude Desktop","provider":"claude","strategy":"user-data-dir","installed":true}]',
      stderr: "",
    });
    const apps = await listApps();
    expect(create).toHaveBeenCalledWith("agent-switch", ["apps", "--json"]);
    expect(apps[0].id).toBe("claude-desktop");
    await openApp("claude-desktop", "work");
    expect(create).toHaveBeenCalledWith("agent-switch", ["open", "claude-desktop", "work"]);
  });

  it("listApps returns [] on failure (never blanks the UI)", async () => {
    execute.mockResolvedValue({ code: 1, stdout: "", stderr: "boom" });
    await expect(listApps()).resolves.toEqual([]);
  });

  it("getAutostart / setAutostart wrap the autostart plugin", async () => {
    asIsEnabled.mockResolvedValue(true);
    expect(await getAutostart()).toBe(true);
    expect(asIsEnabled).toHaveBeenCalled();
    await setAutostart(true);
    expect(asEnable).toHaveBeenCalled();
    await setAutostart(false);
    expect(asDisable).toHaveBeenCalled();
  });

  it("compactArgs builds `compact <profile>` (embedded-terminal builder, like takeoverArgs)", () => {
    expect(compactArgs("work")).toEqual(["compact", "work"]);
  });

  it("getNotifyConfig parses `alerts status --json`; setNotify toggles + passes thresholds", async () => {
    execute.mockResolvedValue({ code: 0, stdout: '{"notify":true,"contextThresholds":[80,95]}', stderr: "" });
    const cfg = await getNotifyConfig();
    expect(create).toHaveBeenCalledWith("agent-switch", ["alerts", "status", "--json"]);
    expect(cfg).toEqual({ notify: true, contextThresholds: [80, 95] });

    await setNotify(true, [80, 95]);
    expect(create).toHaveBeenCalledWith("agent-switch", ["alerts", "on", "--threshold", "80,95"]);
    await setNotify(false);
    expect(create).toHaveBeenCalledWith("agent-switch", ["alerts", "off"]);
  });

  it("setTrayTooltip invokes the `set_tray_tooltip` Tauri command", async () => {
    await setTrayTooltip("agent-switch — 82% context");
    expect(invoke).toHaveBeenCalledWith("set_tray_tooltip", { text: "agent-switch — 82% context" });
  });
});

describe("agent-config companion CLI", () => {
  it("agentConfigVersion runs the scoped `agent-config --version` and parses the version", async () => {
    execute.mockResolvedValue({ code: 0, stdout: "agent-config 9.2.0\n", stderr: "" });
    expect(await agentConfigVersion()).toBe("9.2.0");
    expect(create).toHaveBeenCalledWith("agent-config-version", ["--version"]);
  });

  it("agentConfigVersion returns null when not installed (non-zero exit or spawn throws)", async () => {
    execute.mockResolvedValue({ code: 127, stdout: "", stderr: "command not found" });
    expect(await agentConfigVersion()).toBeNull();
    execute.mockRejectedValueOnce(new Error("ENOENT"));
    expect(await agentConfigVersion()).toBeNull();
  });

  it("installAgentConfig runs the exact scoped npx installer, throwing on failure", async () => {
    execute.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    await installAgentConfig();
    expect(create).toHaveBeenCalledWith("agent-config-install", ["-y", "@event4u/agent-config", "init"]);
    execute.mockResolvedValue({ code: 1, stdout: "", stderr: "network down" });
    await expect(installAgentConfig()).rejects.toThrow(/network down/);
  });

  it("upgradeAgentConfig runs the scoped `agent-config upgrade`, throwing on failure", async () => {
    execute.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    await upgradeAgentConfig();
    expect(create).toHaveBeenCalledWith("agent-config-upgrade", ["upgrade"]);
    execute.mockResolvedValue({ code: 2, stdout: "", stderr: "boom" });
    await expect(upgradeAgentConfig()).rejects.toThrow(/boom/);
  });
});

describe("share (global-skill linking)", () => {
  it("shareStatus reads real state via `share status --source default --json`", async () => {
    execute.mockResolvedValue({ code: 0, stdout: '{"active":true,"source":"default","profiles":[{"name":"work","shared":true}]}', stderr: "" });
    const s = await shareStatus();
    expect(create).toHaveBeenCalledWith("agent-switch", ["share", "status", "--source", "default", "--json"]);
    expect(s.active).toBe(true);
    expect(s.profiles[0]).toEqual({ name: "work", shared: true });
  });

  it("shareOn / shareOff / shareSync issue the right commands", async () => {
    execute.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    await shareOn();
    expect(create).toHaveBeenCalledWith("agent-switch", ["share", "on", "--source", "default"]);
    await shareOff();
    expect(create).toHaveBeenCalledWith("agent-switch", ["share", "off"]);
    await shareSync();
    expect(create).toHaveBeenCalledWith("agent-switch", ["share", "sync", "--source", "default"]);
  });
});
