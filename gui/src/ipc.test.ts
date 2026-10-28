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
  rebindArgs,
  rebindTo,
  agentConfigVersion,
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
  toolingStatus,
  acDiscover,
  acEnsure,
  acApi,
  acForceRestart,
  acRelease,
} from "./ipc.js";
import {
  listProtection,
  setProtection,
  listPools,
  createPool,
  renamePool,
  deletePool,
  addPoolMember,
  removePoolMember,
  suggestPools,
  confirmPoolSuggestions,
  parseMappings,
  listMappings,
  mapFolder,
  unmapFolder,
  resolveDir,
  authStatus,
  doctor,
  listActivity,
  getGuard,
  setGuard,
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

  it("rebindArgs builds `rebind <account> --profile <running>` (pure); rebindTo runs it", async () => {
    expect(rebindArgs("privat", "work")).toEqual(["rebind", "privat", "--profile", "work"]);
    execute.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    await rebindTo("privat", "work");
    expect(create).toHaveBeenCalledWith("agent-switch", ["rebind", "privat", "--profile", "work"]);
  });

  it("rebindTo throws with the stderr on a non-zero exit (the caller surfaces it)", async () => {
    execute.mockResolvedValue({ code: 1, stdout: "", stderr: "rebind is macOS-only for now" });
    await expect(rebindTo("privat", "work")).rejects.toThrow(/macOS-only/);
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
    expect(sessionArgs("claude", "w", "/a b")).toEqual(["run", "w", "--provider", "claude", "--cwd", "/a b"]);
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

  it("getAutostart / setAutostart wrap the autostart plugin and record the user's choice", async () => {
    execute.mockResolvedValue({ code: 0, stdout: "{}", stderr: "" });
    asIsEnabled.mockResolvedValue(true);
    expect(await getAutostart()).toBe(true);
    expect(asIsEnabled).toHaveBeenCalled();
    await setAutostart(true);
    expect(asEnable).toHaveBeenCalled();
    expect(create).toHaveBeenLastCalledWith("agent-switch", ["gui-settings", "set", "autostart", "enabled", "--by", "user"]);
    await setAutostart(false);
    expect(asDisable).toHaveBeenCalled();
    expect(create).toHaveBeenLastCalledWith("agent-switch", ["gui-settings", "set", "autostart", "disabled", "--by", "user"]);
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

  it("toolingStatus runs `agent-switch tooling --json` and parses the readout", async () => {
    execute.mockResolvedValue({
      code: 0,
      stdout:
        '[{"id":"agent-config","present":true,"version":"9.7.0","path":"/usr/local/bin/agent-config","healthy":true,"hint":""},' +
        '{"id":"rtk","present":true,"version":null,"path":"/usr/local/bin/rtk","healthy":false,"identity":"unknown-rtk","hint":"the `rtk` on PATH is not Token Killer (name collision) — install: `brew install rtk`"}]',
      stderr: "",
    });
    const tools = await toolingStatus();
    expect(create).toHaveBeenCalledWith("agent-switch", ["tooling", "--json"]);
    expect(tools).toHaveLength(2);
    expect(tools[0]).toEqual({
      id: "agent-config",
      present: true,
      version: "9.7.0",
      path: "/usr/local/bin/agent-config",
      healthy: true,
      hint: "",
    });
    expect(tools[1].identity).toBe("unknown-rtk");
  });

  it("toolingStatus throws with the stderr on a non-zero exit (the caller surfaces it)", async () => {
    execute.mockResolvedValue({ code: 1, stdout: "", stderr: "tooling sweep failed" });
    await expect(toolingStatus()).rejects.toThrow(/tooling sweep failed/);
  });
});

describe("agent-config local server (ac_* Tauri commands)", () => {
  it("acDiscover invokes ac_discover and returns the typed status", async () => {
    invoke.mockResolvedValue({ status: "live", port: 41234, pid: 4321, version: "9.7.0" });
    await expect(acDiscover()).resolves.toEqual({ status: "live", port: 41234, pid: 4321, version: "9.7.0" });
    expect(invoke).toHaveBeenCalledWith("ac_discover");
  });

  it("acEnsure invokes ac_ensure; rejects with the typed error (spawn stderr surfaced)", async () => {
    invoke.mockResolvedValueOnce({ status: "live", port: 41234, pid: 4321, version: null });
    await expect(acEnsure()).resolves.toEqual({ status: "live", port: 41234, pid: 4321, version: null });
    expect(invoke).toHaveBeenCalledWith("ac_ensure");
    invoke.mockRejectedValueOnce({ kind: "startTimeout", waitedMs: 15000, exitCode: 1, stderr: "EADDRINUSE" });
    await expect(acEnsure()).rejects.toEqual(expect.objectContaining({ kind: "startTimeout", stderr: "EADDRINUSE" }));
  });

  it("acApi passes method/path/body through (body null when omitted)", async () => {
    invoke.mockResolvedValue({ status: 200, body: "{}" });
    await expect(acApi("GET", "/api/v1/ping")).resolves.toEqual({ status: 200, body: "{}" });
    expect(invoke).toHaveBeenCalledWith("ac_api", { method: "GET", path: "/api/v1/ping", body: null });
    await acApi("POST", "/api/v1/settings", '{"a":1}');
    expect(invoke).toHaveBeenCalledWith("ac_api", { method: "POST", path: "/api/v1/settings", body: '{"a":1}' });
  });

  it("acApi surfaces the tokenRotated rejection (401 after the built-in recovery)", async () => {
    invoke.mockRejectedValue({ kind: "tokenRotated" });
    await expect(acApi("GET", "/api/v1/ping")).rejects.toEqual({ kind: "tokenRotated" });
  });

  it("acForceRestart / acRelease invoke their commands", async () => {
    invoke.mockResolvedValue({ status: "live", port: 41234, pid: 99, version: null });
    await acForceRestart();
    expect(invoke).toHaveBeenCalledWith("ac_force_restart");
    invoke.mockResolvedValue(undefined);
    await acRelease();
    expect(invoke).toHaveBeenCalledWith("ac_release");
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

  // install/upgrade spawns were retired with the footer banner (copy-command
  // only, per the setup-hub roadmap's S0.3 decision) — no scoped entries left.
});

describe("share (global-skill linking)", () => {
  it("shareStatus reads real state via `share status --json` (no --source: the CLI only echoes it)", async () => {
    execute.mockResolvedValue({ code: 0, stdout: '{"active":true,"source":"default","profiles":[{"name":"work","shared":true}]}', stderr: "" });
    const s = await shareStatus();
    expect(create).toHaveBeenCalledWith("agent-switch", ["share", "status", "--json"]);
    expect(s.active).toBe(true);
    expect(s.profiles[0]).toEqual({ name: "work", shared: true });
  });

  it("shareOn / shareOff / shareSync issue the right commands (default source)", async () => {
    execute.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    await shareOn();
    expect(create).toHaveBeenCalledWith("agent-switch", ["share", "on", "--source", "default"]);
    await shareOff();
    expect(create).toHaveBeenCalledWith("agent-switch", ["share", "off"]);
    await shareSync();
    expect(create).toHaveBeenCalledWith("agent-switch", ["share", "sync", "--source", "default"]);
  });

  it("shareOn / shareSync pass a profile source through as --source <profile>", async () => {
    execute.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    await shareOn("work");
    expect(create).toHaveBeenCalledWith("agent-switch", ["share", "on", "--source", "work"]);
    await shareSync("work");
    expect(create).toHaveBeenCalledWith("agent-switch", ["share", "sync", "--source", "work"]);
  });
});

describe("foundations (protection, pools, folder rules, auth, doctor, activity, guard)", () => {
  const ok = (stdout: string) => execute.mockResolvedValue({ code: 0, stdout, stderr: "" });

  it("listProtection reads `protection --json`; setProtection sends only the changed fields", async () => {
    ok('[{"profile":"claude/work","enabled":true,"thresholdPct":98}]');
    expect((await listProtection())[0]).toEqual({ profile: "claude/work", enabled: true, thresholdPct: 98 });
    expect(create).toHaveBeenCalledWith("agent-switch", ["protection", "--json"]);

    ok('{"profile":"codex/w","enabled":false,"thresholdPct":90}');
    const row = await setProtection("codex", "w", { enabled: false, thresholdPct: 90 });
    expect(create).toHaveBeenLastCalledWith("agent-switch", ["protection", "set", "codex/w", "--off", "--threshold", "90", "--json"]);
    expect(row.enabled).toBe(false);
    await setProtection("claude", "work", { enabled: true });
    expect(create).toHaveBeenLastCalledWith("agent-switch", ["protection", "set", "claude/work", "--on", "--json"]);
  });

  it("setProtection rejects an empty patch and an out-of-range threshold before spawning", async () => {
    await expect(setProtection("claude", "work", {})).rejects.toThrow(/Nothing to change/);
    await expect(setProtection("claude", "work", { thresholdPct: 0 })).rejects.toThrow(/between 1 and 100/);
    await expect(setProtection("claude", "work", { thresholdPct: 50.5 })).rejects.toThrow(/between 1 and 100/);
    expect(create).not.toHaveBeenCalled();
  });

  it("pool commands map to `pool <sub> … --json` with provider/name member keys", async () => {
    ok('[{"id":"work","name":"Work","members":["claude/a"],"createdAt":"x","rules":[]}]');
    expect((await listPools())[0].members).toEqual(["claude/a"]);
    expect(create).toHaveBeenLastCalledWith("agent-switch", ["pool", "list", "--json"]);

    ok('{"id":"team-a","name":"Team A","members":[],"createdAt":"x"}');
    await createPool("Team A");
    expect(create).toHaveBeenLastCalledWith("agent-switch", ["pool", "create", "Team A", "--json"]);
    await renamePool("team-a", "Team B");
    expect(create).toHaveBeenLastCalledWith("agent-switch", ["pool", "rename", "team-a", "Team B", "--json"]);
    await addPoolMember("team-a", "codex", "w");
    expect(create).toHaveBeenLastCalledWith("agent-switch", ["pool", "add", "team-a", "codex/w", "--json"]);
    await removePoolMember("team-a", "codex", "w");
    expect(create).toHaveBeenLastCalledWith("agent-switch", ["pool", "remove", "team-a", "codex/w", "--json"]);
    ok('{"deleted":"team-a"}');
    await deletePool("team-a");
    expect(create).toHaveBeenLastCalledWith("agent-switch", ["pool", "delete", "team-a", "--json"]);
  });

  it("deletePool surfaces the CLI refusal while a folder rule still uses the pool", async () => {
    execute.mockResolvedValue({ code: 1, stdout: "", stderr: 'error: pool "work" is used by folder rules: /x (claude).' });
    await expect(deletePool("work")).rejects.toThrow(/used by folder rules/);
  });

  it("suggestPools previews without --confirm; confirmPoolSuggestions creates", async () => {
    ok('{"preview":true,"proposals":[{"id":"work","name":"Work","members":["claude/a"],"exists":false}]}');
    expect((await suggestPools())[0].id).toBe("work");
    expect(create).toHaveBeenLastCalledWith("agent-switch", ["pool", "suggest", "--json"]);
    ok('{"created":["work"]}');
    expect(await confirmPoolSuggestions()).toEqual(["work"]);
    expect(create).toHaveBeenLastCalledWith("agent-switch", ["pool", "suggest", "--confirm", "--json"]);
  });

  it("parseMappings reads the text rows, splits on the last arrow, and skips noise", () => {
    expect(parseMappings("No directory mappings. Create one with: agent-switch map <profile> [dir]")).toEqual([]);
    expect(
      parseMappings("/a/b -> claude/work\n/odd -> name -> codex/pool:team\ngarbage\n/c -> gemini/x\n"),
    ).toEqual([
      { path: "/a/b", provider: "claude", target: "work" },
      { path: "/odd -> name", provider: "codex", target: "pool:team" },
    ]);
  });

  it("listMappings runs `mappings --json` (text fallback); mapFolder / unmapFolder build the rule commands", async () => {
    ok('[{"path":"/a","provider":"claude","target":"work"},{"path":"/g","provider":"gemini","target":"x"}]');
    expect(await listMappings()).toEqual([{ path: "/a", provider: "claude", target: "work" }]);
    expect(create).toHaveBeenLastCalledWith("agent-switch", ["mappings", "--json"]);
    // An older CLI ignores --json and prints the text rows.
    ok("/a -> claude/work\n");
    expect(await listMappings()).toEqual([{ path: "/a", provider: "claude", target: "work" }]);
    ok("No directory mappings. Create one with: agent-switch map <profile> [dir]\n");
    expect(await listMappings()).toEqual([]);

    ok("");
    await mapFolder("claude", { profile: "work" }, "/a");
    expect(create).toHaveBeenLastCalledWith("agent-switch", ["map", "work", "/a", "--provider", "claude"]);
    await mapFolder("codex", { pool: "team" }, "/b");
    expect(create).toHaveBeenLastCalledWith("agent-switch", ["map", "pool:team", "/b", "--provider", "codex"]);
    await unmapFolder("/a");
    expect(create).toHaveBeenLastCalledWith("agent-switch", ["unmap", "/a"]);
    await unmapFolder("/a", "claude");
    expect(create).toHaveBeenLastCalledWith("agent-switch", ["unmap", "/a", "--provider", "claude"]);
    await expect(mapFolder("claude", { profile: "bad name" }, "/a")).rejects.toThrow(/letters, numbers/);
  });

  it("resolveDir runs `dir --json` in the given folder", async () => {
    ok('{"profile":"claude/work","configDir":"/p","why":["folder rule /a"]}');
    const r = await resolveDir("claude", "/a/b");
    expect(create).toHaveBeenLastCalledWith("agent-switch", ["dir", "--provider", "claude", "--json"], { cwd: "/a/b" });
    expect(r.why).toEqual(["folder rule /a"]);
  });

  it("authStatus reads `auth-status --json`, optionally per provider", async () => {
    ok('[{"provider":"claude","name":"w","state":"expiring","expiresAt":null,"lastRefreshAt":null,"keptFreshBy":"claude","detail":""}]');
    expect((await authStatus())[0].state).toBe("expiring");
    expect(create).toHaveBeenLastCalledWith("agent-switch", ["auth-status", "--json"]);
    await authStatus("codex");
    expect(create).toHaveBeenLastCalledWith("agent-switch", ["auth-status", "--provider", "codex", "--json"]);
  });

  it("doctor keeps the report on exit 1 (blocked) and throws only when stdout is not a report", async () => {
    execute.mockResolvedValue({ code: 1, stdout: '{"readiness":"blocked","platform":"darwin","checks":[]}', stderr: "" });
    expect((await doctor()).readiness).toBe("blocked");
    expect(create).toHaveBeenLastCalledWith("agent-switch", ["doctor", "--json"]);
    execute.mockResolvedValue({ code: 1, stdout: "", stderr: "unknown command" });
    await expect(doctor()).rejects.toThrow(/unknown command/);
  });

  it("listActivity unwraps `entries` and passes --limit", async () => {
    ok('{"entries":[{"at":"2026-10-28T10:00:00Z","kind":"switch","target":"claude/w","action":"activated","reason":"r","ok":true}],"capacity":2000}');
    expect((await listActivity(5))[0].kind).toBe("switch");
    expect(create).toHaveBeenLastCalledWith("agent-switch", ["activity", "--limit", "5", "--json"]);
    ok("{}");
    expect(await listActivity()).toEqual([]);
    expect(create).toHaveBeenLastCalledWith("agent-switch", ["activity", "--json"]);
  });

  it("getGuard / setGuard read and set the single-load policy as JSON", async () => {
    ok('{"policy":"warn","loaded":[]}');
    expect((await getGuard()).policy).toBe("warn");
    expect(create).toHaveBeenLastCalledWith("agent-switch", ["guard", "--json"]);
    await setGuard("block");
    expect(create).toHaveBeenLastCalledWith("agent-switch", ["guard", "block", "--json"]);
  });
});
