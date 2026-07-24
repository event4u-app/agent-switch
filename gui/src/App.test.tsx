import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { render, screen, waitFor, fireEvent, cleanup, act, within } from "@testing-library/react";

// The IPC layer is Tauri-coupled; mock it so the component logic is testable in
// jsdom. loginArgs/sessionArgs are pure arg builders — kept real so the args
// the terminal receives are asserted for real. vi.hoisted lets the (hoisted)
// vi.mock factory reference `ipc`.
const ipc = vi.hoisted(() => ({
  listProfiles: vi.fn(),
  profileUsage: vi.fn(),
  usageHistory: vi.fn(),
  getAutoSwitch: vi.fn(),
  setAutoSwitch: vi.fn(),
  getProviders: vi.fn(),
  setProvider: vi.fn(),
  setProfileLabel: vi.fn(),
  switchProfile: vi.fn(),
  openWeb: vi.fn(),
  loginArgs: (p: string, n: string) => ["add", n, "--provider", p],
  sessionArgs: (p: string, n: string) => ["run", n, "--provider", p],
  takeoverArgs: (id: string, to: string, keep?: boolean) => ["takeover", id, "--to", to, ...(keep ? ["--keep-source"] : [])],
  compactArgs: (profile: string) => ["compact", profile],
  listSessions: vi.fn(),
  sessionPreview: vi.fn(),
  deleteSession: vi.fn(),
  restoreSession: vi.fn(),
  extractHandoffBrief: vi.fn(),
  handoffSeedArgs: (tp: string, tprof: string, bp: string) => ["handoff", "seed", "--to", tprof, "--provider", tp, "--brief", bp],
  getNotifyConfig: vi.fn(),
  setNotify: vi.fn(),
  setTrayTooltip: vi.fn(),
  assertValidName: () => {},
  deactivateProfile: vi.fn(),
  removeProfile: vi.fn(),
  renameProfile: vi.fn(),
  uninstall: vi.fn(),
  getAutostart: vi.fn(),
  setAutostart: vi.fn(),
  getSwitchStrategy: vi.fn(),
  setSwitchStrategy: vi.fn(),
  redeemReset: vi.fn(),
  listApps: vi.fn(),
  openApp: vi.fn(),
  quitApp: vi.fn(),
  setMinimizeToDock: vi.fn(),
  selfUpdate: vi.fn(),
  linkProviderBinary: vi.fn(),
  unlinkProviderBinary: vi.fn(),
  listNotifications: vi.fn(),
  recordNotification: vi.fn(),
  clearNotifications: vi.fn(),
  getOsNotify: vi.fn(),
  setOsNotify: vi.fn(),
  agentConfigVersion: vi.fn(),
  runToolingAction: vi.fn(),
  acOpenSettingsWindow: vi.fn(),
  acOpenInBrowser: vi.fn(),
  acForceRestart: vi.fn(),
  acDiscover: vi.fn(),
  acEnsure: vi.fn(),
  acApi: vi.fn(),
  acRelease: vi.fn(),
  toolingStatus: vi.fn(),
  shareStatus: vi.fn(),
  shareOn: vi.fn(),
  shareOff: vi.fn(),
  shareSync: vi.fn(),
}));
vi.mock("./ipc.js", () => ipc);

// Desktop notifications go through the Tauri plugin, which isn't available in
// jsdom — mock the wrappers so the in-window logic is testable without it.
const desktopNotify = vi.hoisted(() => vi.fn().mockResolvedValue(false));
const clearDesktopNotify = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const showAppWindow = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
// Capture the click callback the app registers, so a test can fire it.
const notifClick = vi.hoisted(() => ({ cb: null as null | (() => void) }));
vi.mock("./notifications.js", () => ({
  sendDesktopNotification: desktopNotify,
  clearDesktopNotifications: clearDesktopNotify,
  showAppWindow,
  onNotificationClick: (cb: () => void) => {
    notifClick.cb = cb;
    return Promise.resolve(() => {});
  },
  desktopPermission: vi.fn().mockResolvedValue("default"),
  requestDesktopPermission: vi.fn().mockResolvedValue("granted"),
}));

// The embedded terminal renders real xterm/pty — stub it so tests assert the
// terminal OPENED (title + args) without a DOM canvas or a Tauri backend.
vi.mock("./EmbeddedTerminal.js", () => ({
  EmbeddedTerminal: (props: { args: string[]; title: string; onClose: () => void }) =>
    React.createElement("div", { "data-testid": "term" }, [
      React.createElement("span", { key: "t" }, props.title),
      React.createElement("span", { key: "a" }, props.args.join(" ")),
      React.createElement("button", { key: "c", onClick: props.onClose }, "close-term"),
    ]),
}));

// The global auto-switch master lives in localStorage, which isn't reliably
// available in this jsdom/node env — mock the store so the flag is controllable.
const store = vi.hoisted(() => ({ globalAuto: true, autoRefresh: true, refreshMin: 10, notifLastRead: 0, mutedKinds: [] as string[], devMode: false, autoUpdateCheck: true, updateNotifiedVersion: "", agentConfigNotifiedVersion: "", nextUsageRefreshAt: 0, acCardDismissed: false, shareGlobal: true, shareSource: "default", hideSummaries: false, minimizeToDock: false, autoUpdateKinds: ["major", "minor", "patch"], providerFilter: "claude" }));
// Keep the update-check path inert in the App tests: uptodate → no toast, no
// network. The update logic itself is covered by updates.test.ts.
// Keep the real pure helpers (isNewer/compareVersions — used by agent-config.js)
// but stub the two outward-facing calls so tests never hit the network.
const fetchLatest = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ tag: "9.2.0", name: "", url: "", notes: "", publishedAt: "" }),
);
vi.mock("./updates.js", async (importActual) => ({
  ...(await importActual<typeof import("./updates.js")>()),
  checkForUpdate: () => Promise.resolve({ kind: "uptodate", current: "1.0.0", latest: "1.0.0" }),
  fetchLatestRelease: fetchLatest,
}));
// Tooling latest-version lookups (rtk/claude/codex) stay off the network too.
// Default: latest unknown → the Tooling section renders no Update buttons.
const latestToolVersion = vi.hoisted(() => vi.fn());
vi.mock("./tool-updates.js", async (importActual) => ({
  ...(await importActual<typeof import("./tool-updates.js")>()),
  latestToolVersion,
}));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));
// The settings-window lifecycle event comes from the Tauri event system,
// unavailable in jsdom — a resolved unlisten keeps the effect inert.
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("./settings-store.js", () => ({
  getAutoSwitchGlobal: () => store.globalAuto,
  setAutoSwitchGlobalFlag: (on: boolean) => {
    store.globalAuto = on;
  },
  getAutoRefreshLimits: () => store.autoRefresh,
  setAutoRefreshLimitsFlag: (on: boolean) => {
    store.autoRefresh = on;
  },
  getRefreshMinutes: () => store.refreshMin,
  setRefreshMinutes: (min: number) => {
    store.refreshMin = min;
  },
  REFRESH_INTERVAL_CHOICES: [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60],
  getNotifLastRead: () => store.notifLastRead,
  setNotifLastRead: (ts: number) => {
    store.notifLastRead = ts;
  },
  getShareGlobal: () => store.shareGlobal,
  setShareGlobalFlag: (on: boolean) => {
    store.shareGlobal = on;
  },
  getShareSource: () => store.shareSource,
  setShareSourceFlag: (source: string) => {
    store.shareSource = source;
  },
  getHideSummaries: () => store.hideSummaries,
  setHideSummariesFlag: (on: boolean) => {
    store.hideSummaries = on;
  },
  getMutedKinds: () => store.mutedKinds,
  setMutedKinds: (kinds: string[]) => {
    store.mutedKinds = kinds;
  },
  getDevMode: () => store.devMode,
  setDevModeFlag: (on: boolean) => {
    store.devMode = on;
  },
  getAutoUpdateCheck: () => store.autoUpdateCheck,
  setAutoUpdateCheckFlag: (on: boolean) => {
    store.autoUpdateCheck = on;
  },
  getMinimizeToDock: () => store.minimizeToDock,
  setMinimizeToDockFlag: (on: boolean) => {
    store.minimizeToDock = on;
  },
  getAutoUpdateKinds: () => store.autoUpdateKinds,
  setAutoUpdateKinds: (kinds: string[]) => {
    store.autoUpdateKinds = kinds;
  },
  getUpdateNotifiedVersion: () => store.updateNotifiedVersion,
  setUpdateNotifiedVersion: (v: string) => {
    store.updateNotifiedVersion = v;
  },
  getAgentConfigNotifiedVersion: () => store.agentConfigNotifiedVersion,
  setAgentConfigNotifiedVersion: (v: string) => {
    store.agentConfigNotifiedVersion = v;
  },
  getNextUsageRefreshAt: () => store.nextUsageRefreshAt,
  setNextUsageRefreshAt: (ts: number) => {
    store.nextUsageRefreshAt = ts;
  },
  getAgentConfigCardDismissed: () => store.acCardDismissed,
  setAgentConfigCardDismissed: () => {
    store.acCardDismissed = true;
  },
  getProviderFilter: () => store.providerFilter,
  setProviderFilter: (id: string) => {
    store.providerFilter = id;
  },
}));

import App from "./App.js";
import type { ProfileRow, UsageSnapshot } from "./transforms.js";

const rows: ProfileRow[] = [
  { provider: "claude", name: "work", identity: "w@x", label: "Work", active: true, liveSessions: 1 },
  { provider: "claude", name: "privat", identity: "p@x", label: "Personal", active: false, liveSessions: 0 },
  { provider: "codex", name: "oai", identity: "acc", label: null, active: false, liveSessions: 0 },
];
const usageSnap: UsageSnapshot = {
  windows: [{ key: "5h", label: "5h", utilization: 42, resetsAt: null }],
  routines: null,
  capturedAt: "x",
};

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  // usage-cache uses real localStorage — clear it so a prior test's fetch-attempt
  // cooldown doesn't suppress the usage fetch in the next test.
  try {
    localStorage.clear();
  } catch {
    /* jsdom may not provide it */
  }
  // Global auto-switch defaults OFF in production; enable it for the auto-switch
  // UI tests. (The dedicated default-off test flips this itself.)
  store.globalAuto = true;
  store.notifLastRead = 0;
  store.mutedKinds = [];
  store.shareGlobal = true;
  store.shareSource = "default";
  store.agentConfigNotifiedVersion = "";
  store.acCardDismissed = false;
  store.providerFilter = "claude";
  ipc.listProfiles.mockResolvedValue(rows);
  ipc.profileUsage.mockResolvedValue(usageSnap);
  ipc.usageHistory.mockResolvedValue([]);
  ipc.getAutoSwitch.mockResolvedValue({
    claude: { enabled: false, threshold: 95, tag: "all" },
    codex: { enabled: false, threshold: 95, tag: "all" },
    antigravity: { enabled: false, threshold: 95, tag: "all" },
  });
  ipc.setAutoSwitch.mockResolvedValue(undefined);
  // All providers enabled by default in tests so the antigravity tab is present for
  // the auto-switch-dot / footer assertions below.
  ipc.getProviders.mockResolvedValue({
    claude: { cli: true, ui: true, installed: true },
    codex: { cli: true, ui: true, installed: true },
    antigravity: { cli: true, ui: true, installed: true },
  });
  ipc.setProvider.mockResolvedValue(undefined);
  ipc.setProfileLabel.mockResolvedValue(undefined);
  ipc.switchProfile.mockResolvedValue(undefined);
  ipc.deactivateProfile.mockResolvedValue(undefined);
  ipc.removeProfile.mockResolvedValue(undefined);
  ipc.renameProfile.mockResolvedValue(undefined);
  ipc.uninstall.mockResolvedValue(undefined);
  ipc.getAutostart.mockResolvedValue(false);
  ipc.setAutostart.mockResolvedValue(undefined);
  ipc.getSwitchStrategy.mockResolvedValue("reset-first");
  ipc.setSwitchStrategy.mockResolvedValue(undefined);
  ipc.redeemReset.mockResolvedValue(undefined);
  ipc.listApps.mockResolvedValue([]);
  ipc.openApp.mockResolvedValue(undefined);
  ipc.listSessions.mockResolvedValue([]);
  ipc.sessionPreview.mockResolvedValue({ messages: [], truncated: false });
  ipc.deleteSession.mockResolvedValue({ mode: "trash", trashId: null });
  ipc.restoreSession.mockResolvedValue(undefined);
  ipc.extractHandoffBrief.mockResolvedValue({ brief: "# Handoff brief\n\n- Source session: abc", briefPath: "/cfg/.agent-switch/handoff/abc.md" });
  ipc.getNotifyConfig.mockResolvedValue({ notify: false, contextThresholds: [80, 95] });
  ipc.setNotify.mockResolvedValue(undefined);
  ipc.setTrayTooltip.mockResolvedValue(undefined);
  ipc.quitApp.mockResolvedValue(undefined);
  ipc.selfUpdate.mockResolvedValue({ ok: true, output: "" });
  ipc.listNotifications.mockResolvedValue([]);
  ipc.recordNotification.mockResolvedValue(undefined);
  ipc.clearNotifications.mockResolvedValue(undefined);
  ipc.getOsNotify.mockResolvedValue(false);
  ipc.setOsNotify.mockResolvedValue(undefined);
  // agent-config detected as installed + up to date → the first-run card is
  // hidden by default, so it never interferes with the existing assertions.
  ipc.agentConfigVersion.mockResolvedValue("9.2.0");
  ipc.runToolingAction.mockResolvedValue(undefined);
  ipc.acOpenSettingsWindow.mockResolvedValue({ status: "live", port: 41066, pid: 4242, version: "9.7.0" });
  ipc.acOpenInBrowser.mockResolvedValue(undefined);
  ipc.acForceRestart.mockResolvedValue({ status: "live", port: 41066, pid: 4243, version: "9.7.0" });
  ipc.acApi.mockResolvedValue({ status: 200, body: "{}" });
  ipc.acEnsure.mockResolvedValue({ status: "live", port: 41066, pid: 4242, version: "9.7.0" });
  // Tooling readout defaults to all-healthy so the section renders quietly and
  // never interferes with the existing assertions.
  ipc.toolingStatus.mockResolvedValue([
    { id: "agent-config", present: true, version: "9.7.0", path: "/usr/local/bin/agent-config", healthy: true, hint: "" },
    { id: "rtk", present: true, version: "1.4.2", path: "/usr/local/bin/rtk", healthy: true, identity: "token-killer", hint: "" },
    { id: "claude", present: true, version: "2.0.0", path: "/usr/local/bin/claude", healthy: true, hint: "" },
    { id: "codex", present: true, version: "0.5.0", path: "/usr/local/bin/codex", healthy: true, hint: "" },
    { id: "agy", present: true, version: "1.0.0", path: "/usr/local/bin/agy", healthy: true, hint: "" },
  ]);
  ipc.shareStatus.mockResolvedValue({ active: false, source: "default", profiles: [] });
  ipc.shareOn.mockResolvedValue(undefined);
  ipc.shareOff.mockResolvedValue(undefined);
  ipc.shareSync.mockResolvedValue(undefined);
  fetchLatest.mockResolvedValue({ tag: "9.2.0", name: "", url: "", notes: "", publishedAt: "" });
  latestToolVersion.mockResolvedValue(null);
  desktopNotify.mockClear();
  desktopNotify.mockResolvedValue(false);
  clearDesktopNotify.mockClear();
  showAppWindow.mockClear();
  notifClick.cb = null;
});

describe("App", () => {
  it("shows the selected provider's profiles with per-profile usage; labels render", async () => {
    render(<App />);
    expect(await screen.findByRole("tab", { name: /claude/i })).toBeTruthy();
    expect(await screen.findByText(/privat/)).toBeTruthy();
    expect(screen.queryByText(/oai/)).toBeNull(); // codex hidden behind its tab
    // per-profile usage bar rendered for the claude profiles
    expect(await screen.findAllByText("5h")).not.toHaveLength(0);
    expect(screen.getAllByText("42%").length).toBeGreaterThan(0);
    // label badge shown (scope past the always-visible auto-switch tag <option>Work</option>)
    expect(screen.getByText("Work", { selector: ":not(option)" })).toBeTruthy();
  });

  it("switches the provider tab to reveal that provider's profiles", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: /codex/i }));
    expect(await screen.findByText(/oai/)).toBeTruthy();
    expect(screen.queryByText(/privat/)).toBeNull();
  });

  it("uses a non-active profile and refreshes", async () => {
    render(<App />);
    await screen.findByRole("tab", { name: /claude/i });
    const useButtons = await screen.findAllByRole("button", { name: "Use" });
    expect(useButtons.length).toBe(1); // only privat (work is active)
    fireEvent.click(useButtons[0]);
    expect(ipc.switchProfile).toHaveBeenCalledWith("claude", "privat");
    await waitFor(() => expect(ipc.listProfiles).toHaveBeenCalledTimes(2));
  });

  it("deactivates the active profile via its Off button", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Off" }));
    expect(ipc.deactivateProfile).toHaveBeenCalledWith("claude");
  });

  it("runs a session in the embedded terminal (no external window) when Term is clicked", async () => {
    render(<App />);
    await screen.findByRole("tab", { name: /claude/i });
    fireEvent.click((await screen.findAllByRole("button", { name: "Term" }))[0]);
    const term = await screen.findByTestId("term");
    expect(term.textContent).toContain("run work --provider claude"); // sessionArgs
    expect(term.textContent).toMatch(/Session — Claude \/ work/);
  });

  it("surfaces an actionable error when the CLI binary is unreachable", async () => {
    ipc.listProfiles.mockRejectedValue(new Error("program not found"));
    render(<App />);
    expect(await screen.findByText(/not found on PATH.*npm link/)).toBeTruthy();
  });

  it("shows a per-provider empty state with a create action", async () => {
    ipc.listProfiles.mockResolvedValue([]);
    render(<App />);
    expect(await screen.findByText(/no claude profiles yet/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /create a profile/i })).toBeTruthy();
  });

  it("creates a profile by opening the login in the embedded terminal, pre-selected to the open tab", async () => {
    ipc.listProfiles.mockResolvedValue([]);
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: /codex/i }));
    fireEvent.click(screen.getByRole("button", { name: /^New$/ }));
    fireEvent.change(await screen.findByPlaceholderText(/e\.g\. work/), { target: { value: "work" } });
    fireEvent.click(screen.getByRole("button", { name: "Work" })); // tag is required
    fireEvent.click(screen.getByRole("button", { name: /create & log in/i }));
    const term = await screen.findByTestId("term");
    expect(term.textContent).toContain("add work --provider codex"); // loginArgs, no osascript/Terminal.app
    expect(term.textContent).toMatch(/Login — Codex \/ work/);
    expect(ipc.setProfileLabel).toHaveBeenCalledWith("codex", "work", "Work"); // required tag persisted on create
  });

  it("edits a profile's name via the pencil → renameProfile", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: /codex/i }));
    fireEvent.click(await screen.findByRole("button", { name: /edit oai/i }));
    const nameInput = await screen.findByLabelText("Profile name");
    fireEvent.change(nameInput, { target: { value: "renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Work" })); // tag stays required on edit
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(ipc.renameProfile).toHaveBeenCalledWith("codex", "oai", "renamed"));
  });

  it("deletes a profile only after an explicit confirm", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: /codex/i }));
    fireEvent.click(await screen.findByRole("button", { name: /delete oai/i }));
    expect(ipc.removeProfile).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: /^Yes$/ }));
    await waitFor(() => expect(ipc.removeProfile).toHaveBeenCalledWith("codex", "oai"));
  });

  it("toggles auto-switch for the SELECTED provider from the footer", async () => {
    render(<App />);
    // default tab is claude, and it was off → clicking turns claude on
    fireEvent.click(await screen.findByRole("button", { name: /auto-switch/i }));
    expect(ipc.setAutoSwitch).toHaveBeenCalledWith("claude", true);
  });

  it("per-tab auto-switch badge colouring shows for Claude + Codex (usage readout); not Antigravity", async () => {
    ipc.listProfiles.mockResolvedValue([
      { provider: "claude", name: "a", identity: null, label: null, active: true, liveSessions: 0 },
      { provider: "claude", name: "b", identity: null, label: null, active: false, liveSessions: 0 },
      { provider: "codex", name: "c", identity: null, label: null, active: false, liveSessions: 0 },
      { provider: "codex", name: "d", identity: null, label: null, active: false, liveSessions: 0 },
      { provider: "antigravity", name: "e", identity: null, label: null, active: false, liveSessions: 0 },
    ]);
    ipc.getAutoSwitch.mockResolvedValue({
      claude: { enabled: true, threshold: 95, tag: "all" }, // 2 profiles, on → green badge
      codex: { enabled: false, threshold: 95, tag: "all" }, // 2 profiles, off → red badge
      antigravity: { enabled: true, threshold: 95, tag: "all" },
    });
    render(<App />);
    expect(await screen.findByLabelText(/auto-switch on for claude/i)).toBeTruthy();
    expect(await screen.findByLabelText(/auto-switch off for codex/i)).toBeTruthy(); // Codex now has a usage readout
    expect(screen.queryByLabelText(/auto-switch.*for antigravity/i)).toBeNull(); // no readout → no badge colour
  });

  it("shows an auto-switch tag filter (Settings › Auto-switch) with only existing tags and applies the choice", async () => {
    // Default rows: claude work=Work, claude privat=Personal (no "Other").
    ipc.getAutoSwitch.mockResolvedValue({
      claude: { enabled: true, threshold: 95, tag: "all" },
      codex: { enabled: false, threshold: 95, tag: "all" },
      antigravity: { enabled: false, threshold: 95, tag: "all" },
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /settings/i }));
    fireEvent.click(await screen.findByRole("tab", { name: /auto-switch/i }));
    const select = (await screen.findByLabelText(/auto-switch accounts for claude/i)) as HTMLSelectElement;
    const opts = Array.from(select.options).map((o) => o.textContent);
    expect(opts).toContain("All accounts");
    expect(opts).toContain("Work");
    expect(opts).toContain("Personal");
    expect(opts).not.toContain("Other"); // no Claude profile carries "Other" → not offered
    fireEvent.change(select, { target: { value: "Work" } });
    await waitFor(() => expect(ipc.setAutoSwitch).toHaveBeenCalledWith("claude", true, 95, "Work"));
  });

  it("footer marks auto-switch not available for Claude with <2 profiles", async () => {
    ipc.listProfiles.mockResolvedValue([
      { provider: "claude", name: "solo", identity: null, label: null, active: true, liveSessions: 0 },
    ]);
    render(<App />); // Claude is the default tab and has only 1 profile
    await screen.findByRole("tab", { name: /claude/i });
    expect(await screen.findByText(/not available/i)).toBeTruthy();
  });

  it("Codex now shows the footer auto-switch toggle (it has a usage readout)", async () => {
    ipc.listProfiles.mockResolvedValue([
      { provider: "codex", name: "c", identity: null, label: null, active: true, liveSessions: 0 },
      { provider: "codex", name: "d", identity: null, label: null, active: false, liveSessions: 0 },
    ]);
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: /codex/i }));
    expect(await screen.findByText(/auto-switch ·/i)).toBeTruthy();
  });

  it("auto-switch UI is hidden by default (global master off)", async () => {
    store.globalAuto = false; // production default
    render(<App />);
    await screen.findByRole("tab", { name: /claude/i });
    expect(screen.queryByLabelText(/auto-switch/i)).toBeNull(); // no per-tab dots
    expect(screen.queryByText(/auto-switch ·/i)).toBeNull(); // no footer toggle
  });

  it("opens the Settings section (provider filter hidden) with its five groups", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /settings/i }));
    // the provider filter is gone; the settings groups are present
    expect(screen.queryByRole("tab", { name: /claude/i })).toBeNull();
    expect(screen.getByRole("tab", { name: /general/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /notifications/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /auto-switch/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /updates/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /advanced/i })).toBeTruthy();
  });

  it("toggles autostart from the General settings tab (pill switch)", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /settings/i }));
    const sw = await screen.findByRole("switch", { name: /start at login/i });
    expect(sw.getAttribute("aria-checked")).toBe("false"); // autostart currently off
    fireEvent.click(sw);
    expect(ipc.setAutostart).toHaveBeenCalledWith(true);
  });

  it("changes the refresh interval from the General settings dropdown", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /settings/i }));
    const select = (await screen.findByLabelText(/refresh interval/i)) as HTMLSelectElement;
    expect(select.value).toBe("10"); // default
    fireEvent.change(select, { target: { value: "30" } });
    expect(store.refreshMin).toBe(30); // persisted via setRefreshMinutes
    expect(select.value).toBe("30");
  });

  it("shows an unread badge and lists notifications in the bell flyout", async () => {
    ipc.listNotifications.mockResolvedValue([
      { id: "1", ts: 2000, kind: "success", title: "Auto-switched account", message: "claude/work → claude/privat." },
      { id: "2", ts: 1000, kind: "warning", title: "Usage fetch failed", message: "Could not fetch usage limits for codex/oai." },
    ]);
    render(<App />);
    const bell = await screen.findByRole("button", { name: /notifications/i });
    // unread badge = both (lastRead defaults to 0)
    await waitFor(() => expect(bell.textContent).toContain("2"));
    fireEvent.click(bell);
    expect(await screen.findByText("Auto-switched account")).toBeTruthy();
    expect(screen.getByText(/Could not fetch usage limits for codex\/oai/)).toBeTruthy();
    // opening marked them read → badge cleared
    await waitFor(() => expect(store.notifLastRead).toBe(2000));
  });

  it("records a warning notification when a usage fetch fails", async () => {
    ipc.profileUsage.mockResolvedValue(null); // fetch failure
    render(<App />);
    await waitFor(() =>
      expect(ipc.recordNotification).toHaveBeenCalledWith(
        "warning",
        "Usage fetch failed",
        expect.stringContaining("Could not fetch usage limits for claude/"),
      ),
    );
  });

  it("clears notifications from the flyout", async () => {
    ipc.listNotifications.mockResolvedValue([
      { id: "1", ts: 3000, kind: "info", title: "Hello", message: "world" },
    ]);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /notifications/i }));
    fireEvent.click(await screen.findByRole("button", { name: /clear notifications/i }));
    expect(ipc.clearNotifications).toHaveBeenCalled(); // clears the in-app log…
    expect(clearDesktopNotify).toHaveBeenCalled(); // …AND the GUI-sent OS notifications
    await waitFor(() => expect(screen.queryByText("Hello")).toBeNull());
  });

  it("clicking a desktop notification shows the window and opens the bell flyout", async () => {
    ipc.listNotifications.mockResolvedValue([
      { id: "1", ts: 2000, kind: "success", title: "Auto-switched account", message: "claude/work → claude/privat." },
    ]);
    render(<App />);
    await waitFor(() => expect(notifClick.cb).toBeTypeOf("function")); // listener registered
    // The flyout is closed until the notification is clicked.
    expect(screen.queryByText("Auto-switched account")).toBeNull();
    act(() => notifClick.cb!()); // simulate the OS notification click
    await waitFor(() => expect(showAppWindow).toHaveBeenCalled());
    expect(await screen.findByText("Auto-switched account")).toBeTruthy(); // flyout opened
  });

  it("the manual Refresh button forces a usage fetch even within the interval cooldown", async () => {
    // jsdom's default localStorage is a no-op stub here, which would disable the
    // cooldown entirely — install a working in-memory one so the cooldown is real.
    const map = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => void map.set(k, String(v)),
        removeItem: (k: string) => void map.delete(k),
        clear: () => map.clear(),
      },
      configurable: true,
    });
    // Seed a recent fetch attempt for every claude profile so the AUTOMATIC
    // (mount) refresh is on cooldown and skips fetching.
    localStorage.setItem(
      "agent-switch.usage.attempts.v1",
      JSON.stringify({ "claude/work": Date.now(), "claude/privat": Date.now() }),
    );
    render(<App />);
    // Wait for the mount refresh to finish (listNotifications is its last step).
    await waitFor(() => expect(ipc.listNotifications).toHaveBeenCalled());
    expect(ipc.profileUsage).not.toHaveBeenCalled(); // cooldown respected on the automatic path
    fireEvent.click(await screen.findByRole("button", { name: /^refresh$/i }));
    await waitFor(() => expect(ipc.profileUsage).toHaveBeenCalled()); // manual click bypassed the cooldown
  });

  it("shows the agent-config first-run card with a one-click Install (no copy commands) when it is not installed", async () => {
    ipc.agentConfigVersion.mockResolvedValue(null); // not installed
    render(<App />);
    expect(await screen.findByText(/supercharge your ai agents/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^install$/i })).toBeTruthy();
    // One-click only — the copy-command affordance is gone.
    expect(screen.queryByRole("button", { name: /copy install command/i })).toBeNull();
    expect(screen.queryByText(/EACCES/)).toBeNull();
  });

  it("hides the first-run card on other sections — Profiles only (Ecosystem has the primary card)", async () => {
    ipc.agentConfigVersion.mockResolvedValue(null); // card shows on Profiles
    render(<App />);
    expect(await screen.findByText(/supercharge your ai agents/i)).toBeTruthy(); // Profiles
    fireEvent.click(screen.getByRole("button", { name: /^usage$/i }));
    await waitFor(() => expect(screen.queryByText(/supercharge your ai agents/i)).toBeNull()); // gone
    fireEvent.click(screen.getByRole("button", { name: /^ecosystem$/i }));
    // The Ecosystem primary card renders the install state (one-click button).
    expect(await screen.findByText(/not installed/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^install$/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /dismiss agent-config recommendation/i })).toBeNull();
  });

  it("dismissing the first-run card is permanent — survives a remount", async () => {
    ipc.agentConfigVersion.mockResolvedValue(null);
    const first = render(<App />);
    expect(await screen.findByText(/supercharge your ai agents/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /dismiss agent-config recommendation/i }));
    await waitFor(() => expect(screen.queryByText(/supercharge your ai agents/i)).toBeNull());
    first.unmount();
    render(<App />); // fresh mount, same storage
    await screen.findByRole("button", { name: /^ecosystem$/i }); // app settled
    expect(screen.queryByText(/supercharge your ai agents/i)).toBeNull(); // still dismissed on Profiles
  });

  it("the Ecosystem primary card shows the current-version pill, active profile and shared chip", async () => {
    ipc.agentConfigVersion.mockResolvedValue("9.2.0"); // installed + current → no first-run card
    fetchLatest.mockResolvedValue({ tag: "9.2.0", name: "", url: "", notes: "", publishedAt: "" });
    ipc.shareStatus.mockResolvedValue({
      active: true,
      source: "default",
      profiles: [
        { name: "work", shared: true },
        { name: "privat", shared: true },
      ],
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /^ecosystem$/i }));
    expect(await screen.findByText(/v9\.2\.0 · current/i)).toBeTruthy(); // status pill
    expect(screen.getByText(/active in this profile/i)).toBeTruthy();
    expect(await screen.findByText(/shared across 2/i)).toBeTruthy(); // backed by shareStatus
    expect(screen.getByText(/shared setup/i)).toBeTruthy();
    expect(screen.getByText(/^Profile: work$/)).toBeTruthy(); // section footer
    expect(screen.getByText(/1 companion tool/i)).toBeTruthy();
  });

  it("the Ecosystem primary card shows the update pill + one-click Update for an older install", async () => {
    ipc.agentConfigVersion.mockResolvedValue("9.1.0"); // installed, older
    fetchLatest.mockResolvedValue({ tag: "9.2.0", name: "", url: "", notes: "", publishedAt: "" });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /^ecosystem$/i }));
    expect(await screen.findByText(/v9\.1\.0 → v9\.2\.0 available/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Update to v9.2.0" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /copy update command/i })).toBeNull();
    // Installed → the settings entry point is still there alongside the update hint.
    expect(screen.getByRole("button", { name: /open agent-config settings/i })).toBeTruthy();
  });

  it("Settings no longer hosts sharing or providers — they live in Ecosystem", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /settings/i }));
    await screen.findByRole("tab", { name: /general/i });
    expect(screen.queryByText(/share global skills/i)).toBeNull(); // moved to Ecosystem
    fireEvent.click(screen.getByRole("tab", { name: /advanced/i }));
    expect(await screen.findByRole("button", { name: /uninstall agent-switch/i })).toBeTruthy(); // uninstall stays
    expect(screen.queryByRole("switch", { name: /codex cli/i })).toBeNull(); // providers moved to Ecosystem
  });

  it("opens the embedded settings window via Rust (token never enters this webview) and shows provenance", async () => {
    ipc.agentConfigVersion.mockResolvedValue("9.2.0");
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /^ecosystem$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /open agent-config settings/i }));
    await waitFor(() => expect(ipc.acOpenSettingsWindow).toHaveBeenCalledWith("dark"));
    // Provenance: version, port, target — the user always sees whose settings they edit.
    expect(await screen.findByText(/v9\.7\.0 · port 41066 · target: global/i)).toBeTruthy();
  });

  it("wedged server → consent UI; Force restart is user-initiated, never silent", async () => {
    ipc.agentConfigVersion.mockResolvedValue("9.2.0");
    ipc.acOpenSettingsWindow.mockRejectedValueOnce({ kind: "wedged", pid: 777 });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /^ecosystem$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /open agent-config settings/i }));
    expect(await screen.findByText(/not responding \(pid 777\)/i)).toBeTruthy();
    expect(ipc.acForceRestart).not.toHaveBeenCalled(); // nothing killed without consent
    fireEvent.click(screen.getByRole("button", { name: /force restart/i }));
    await waitFor(() => expect(ipc.acForceRestart).toHaveBeenCalled());
  });

  it("spawn failure surfaces the exit code, stderr and the manual command — actionable, never vague", async () => {
    ipc.agentConfigVersion.mockResolvedValue("9.2.0");
    ipc.acOpenSettingsWindow.mockRejectedValueOnce({ kind: "spawnFailed", exitCode: 1, stderr: "EADDRINUSE" });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /^ecosystem$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /open agent-config settings/i }));
    expect(await screen.findByText(/exit 1.*EADDRINUSE.*agent-config ui:serve/i)).toBeTruthy();
  });

  it("the permanent Open-in-browser escape hatch goes through Rust", async () => {
    ipc.agentConfigVersion.mockResolvedValue("9.2.0");
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /^ecosystem$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /open in browser/i }));
    await waitFor(() => expect(ipc.acOpenInBrowser).toHaveBeenCalled());
  });

  it("fires an update notification only when agent-config is installed AND newer exists", async () => {
    ipc.agentConfigVersion.mockResolvedValue("9.1.0"); // installed, older
    fetchLatest.mockResolvedValue({ tag: "9.2.0", name: "", url: "", notes: "", publishedAt: "" });
    render(<App />);
    await waitFor(() =>
      expect(ipc.recordNotification).toHaveBeenCalledWith(
        "info",
        "agent-config update available",
        expect.stringContaining("v9.1.0 → v9.2.0"),
      ),
    );
  });

  it("does NOT notify about an agent-config update when it is not installed", async () => {
    ipc.agentConfigVersion.mockResolvedValue(null); // not installed
    fetchLatest.mockResolvedValue({ tag: "9.2.0", name: "", url: "", notes: "", publishedAt: "" });
    render(<App />);
    await screen.findByText(/supercharge your ai agents/i); // first-run card rendered → detect ran
    expect(ipc.recordNotification).not.toHaveBeenCalledWith(
      "info",
      "agent-config update available",
      expect.anything(),
    );
  });

  it("shows an in-window toast when a fresh event cannot be delivered to the desktop", async () => {
    desktopNotify.mockResolvedValue(false); // permission denied / unavailable
    ipc.listNotifications.mockResolvedValue([
      { id: "t1", ts: Date.now() + 1_000_000, kind: "warning", title: "Usage fetch failed", message: "codex/oai" },
    ]);
    render(<App />);
    const toast = await screen.findByRole("status");
    expect(toast.textContent).toContain("Usage fetch failed");
    expect(desktopNotify).toHaveBeenCalled();
  });

  it("does not show a toast when the desktop notification was delivered", async () => {
    desktopNotify.mockResolvedValue(true); // desktop delivered it
    ipc.listNotifications.mockResolvedValue([
      { id: "t2", ts: Date.now() + 1_000_000, kind: "success", title: "Auto-switched account", message: "→ privat" },
    ]);
    render(<App />);
    await waitFor(() => expect(desktopNotify).toHaveBeenCalled());
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("skips the GUI notification for an event the daemon already showed (osNotified)", async () => {
    desktopNotify.mockResolvedValue(false);
    ipc.listNotifications.mockResolvedValue([
      { id: "t3", ts: Date.now() + 1_000_000, kind: "success", title: "Auto-switched account", message: "→ privat", osNotified: true },
    ]);
    render(<App />);
    // it still lands in the flyout, but the GUI neither desktop-notifies nor toasts
    const bell = await screen.findByRole("button", { name: /notifications/i });
    fireEvent.click(bell);
    expect(await screen.findByText("Auto-switched account")).toBeTruthy();
    expect(desktopNotify).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("hides a muted kind from the flyout and the unread badge", async () => {
    store.mutedKinds = ["warning"];
    desktopNotify.mockResolvedValue(true); // avoid toasts in this assertion
    const ts = Date.now() + 1_000_000;
    ipc.listNotifications.mockResolvedValue([
      { id: "s", ts, kind: "success", title: "Switched account", message: "→ privat" },
      { id: "w", ts, kind: "warning", title: "Fetch failed", message: "codex/oai" },
    ]);
    render(<App />);
    const bell = await screen.findByRole("button", { name: /notifications/i });
    await waitFor(() => expect(bell.textContent).toContain("1")); // only the visible (success) counts
    fireEvent.click(bell);
    expect(await screen.findByText("Switched account")).toBeTruthy();
    expect(screen.queryByText("Fetch failed")).toBeNull(); // muted → not listed
  });

  it("toggles a per-kind mute from the Notifications settings group", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /settings/i }));
    fireEvent.click(await screen.findByRole("tab", { name: /notifications/i }));
    expect(await screen.findByText(/desktop notifications/i)).toBeTruthy();
    fireEvent.click(await screen.findByRole("switch", { name: /toggle fetch failures/i }));
    expect(store.mutedKinds).toContain("warning");
  });

  it("global auto-switch off hides the badge colouring + footer toggle and deactivates every provider", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /settings/i }));
    fireEvent.click(await screen.findByRole("tab", { name: /auto-switch/i }));
    fireEvent.click(await screen.findByRole("switch", { name: /auto-switch globally/i })); // On → Off
    await waitFor(() => expect(ipc.setAutoSwitch).toHaveBeenCalledWith("claude", false));
    expect(ipc.setAutoSwitch).toHaveBeenCalledWith("codex", false);
    expect(ipc.setAutoSwitch).toHaveBeenCalledWith("antigravity", false);
    // back to the profile view: no per-tab dots, no footer toggle
    fireEvent.click(screen.getByRole("button", { name: /profiles/i }));
    await screen.findByRole("tab", { name: /claude/i });
    expect(screen.queryByLabelText(/auto-switch/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /auto-switch ·/i })).toBeNull();
  });

  it("toggles a provider surface from the Ecosystem providers card (moved out of Settings)", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /^ecosystem$/i }));
    // codex CLI is on (mock) → flipping its switch disables that surface
    const sw = await screen.findByRole("switch", { name: /^codex cli$/i });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(sw);
    expect(ipc.setProvider).toHaveBeenCalledWith("codex", "cli", false);
  });

  it("offers the GUI surface only for providers with a registered desktop app", async () => {
    // Only claude + antigravity have an app in this mock (codex has none here).
    ipc.listApps.mockResolvedValue([
      { id: "claude-desktop", displayName: "Claude Desktop", provider: "claude", strategy: "env", installed: true },
      { id: "antigravity", displayName: "Antigravity", provider: "antigravity", strategy: "user-data-dir", installed: true },
    ]);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /^ecosystem$/i }));
    // Every provider offers a CLI surface (all three have a working CLI).
    expect(await screen.findByRole("switch", { name: /claude cli/i })).toBeTruthy();
    expect(screen.getByRole("switch", { name: /codex cli/i })).toBeTruthy();
    expect(screen.getByRole("switch", { name: /antigravity cli/i })).toBeTruthy();
    // GUI surface only where a desktop app is registered: claude + antigravity yes, codex no.
    expect(screen.getByRole("switch", { name: /claude gui/i })).toBeTruthy();
    expect(screen.getByRole("switch", { name: /antigravity gui/i })).toBeTruthy();
    expect(screen.queryByRole("switch", { name: /codex gui/i })).toBeNull();
  });

  it("shows an added provider's profile in its tab (antigravity/MatneX regression)", async () => {
    ipc.listProfiles.mockResolvedValue([
      ...rows,
      { provider: "antigravity", name: "MatneX", identity: "mathias@matnex.com", label: "Personal", active: false, liveSessions: 0 },
    ]);
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: /antigravity/i }));
    expect(await screen.findByText(/MatneX/)).toBeTruthy();
    expect(screen.getByText("mathias@matnex.com")).toBeTruthy(); // email identity surfaced
  });

  it("hides a disabled provider's tab in the main view", async () => {
    ipc.getProviders.mockResolvedValue({
      claude: { cli: true, ui: true, installed: true },
      codex: { cli: true, ui: true, installed: true },
      antigravity: { cli: false, ui: false, installed: true }, // disabled → no tab
    });
    render(<App />);
    await screen.findByRole("tab", { name: /claude/i });
    expect(screen.queryByRole("tab", { name: /antigravity/i })).toBeNull();
    expect(screen.getByRole("tab", { name: /codex/i })).toBeTruthy();
  });

  it("shows a not-installed provider in the Ecosystem providers card but blocks enabling it", async () => {
    ipc.getProviders.mockResolvedValue({
      claude: { cli: true, ui: true, installed: true },
      codex: { cli: true, ui: true, installed: true },
      antigravity: { cli: false, ui: false, installed: false }, // not installed, off
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /^ecosystem$/i }));
    const antigravityCli = await screen.findByRole("switch", { name: /antigravity cli \(not installed\)/i });
    expect((antigravityCli as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(antigravityCli);
    expect(ipc.setProvider).not.toHaveBeenCalled(); // can't enable a missing provider
  });

  it("the Shared-setup switch (Ecosystem) links the source tree into every profile", async () => {
    store.shareGlobal = false; // pref off so the mount reconcile doesn't auto-link
    ipc.shareStatus.mockResolvedValue({
      active: false,
      source: "default",
      profiles: [
        { name: "work", shared: false },
        { name: "privat", shared: false },
      ],
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /^ecosystem$/i }));
    const sw = await screen.findByRole("switch", { name: /shared setup/i });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(sw);
    await waitFor(() => expect(ipc.shareOn).toHaveBeenCalledWith("default")); // `share on --source default`
  });

  it("turning the Shared-setup switch off removes the managed links", async () => {
    ipc.shareStatus.mockResolvedValue({
      active: true,
      source: "default",
      profiles: [
        { name: "work", shared: true },
        { name: "privat", shared: true },
      ],
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /^ecosystem$/i }));
    const sw = await screen.findByRole("switch", { name: /shared setup/i });
    await waitFor(() => expect(sw.getAttribute("aria-checked")).toBe("true"));
    fireEvent.click(sw);
    await waitFor(() => expect(ipc.shareOff).toHaveBeenCalled());
  });

  it("switching the share source asks inline first, then relinks with the chosen profile", async () => {
    ipc.shareStatus.mockResolvedValue({
      active: true,
      source: "default",
      profiles: [
        { name: "work", shared: true },
        { name: "privat", shared: true },
      ],
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /^ecosystem$/i }));
    const select = (await screen.findByLabelText(/shared setup source/i)) as HTMLSelectElement;
    expect(await screen.findByText("~/.claude")).toBeTruthy(); // default source path shown
    fireEvent.change(select, { target: { value: "work" } });
    expect(ipc.shareOn).not.toHaveBeenCalled(); // inline confirm gates the relink
    fireEvent.click(await screen.findByRole("button", { name: /^relink$/i }));
    await waitFor(() => expect(ipc.shareOn).toHaveBeenCalledWith("work"));
    expect(store.shareSource).toBe("work"); // persisted GUI-side (the CLI keeps no source)
    expect(await screen.findByText("~/.agent-switch/claude/work/config")).toBeTruthy(); // path follows
    // Source ≠ default → the reset affordance appears and goes straight back.
    fireEvent.click(await screen.findByRole("button", { name: /reset to default/i }));
    await waitFor(() => expect(ipc.shareOn).toHaveBeenCalledWith("default"));
    expect(store.shareSource).toBe("default");
  });

  it("cancelling the share-source confirm changes nothing", async () => {
    ipc.shareStatus.mockResolvedValue({
      active: true,
      source: "default",
      profiles: [{ name: "work", shared: true }],
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /^ecosystem$/i }));
    const select = (await screen.findByLabelText(/shared setup source/i)) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "privat" } });
    fireEvent.click(await screen.findByRole("button", { name: /^cancel$/i }));
    expect(ipc.shareOn).not.toHaveBeenCalled();
    expect(store.shareSource).toBe("default");
  });

  it("changes the theme from the General settings group (Appearance)", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /settings/i }));
    fireEvent.click(await screen.findByRole("radio", { name: "Light" })); // Appearance lives in General now
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("hides uninstall behind the Advanced settings group and requires typing to confirm", async () => {
    render(<App />);
    expect(screen.queryByRole("button", { name: /uninstall agent-switch/i })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: /settings/i }));
    fireEvent.click(await screen.findByRole("tab", { name: /advanced/i }));

    const uninstallBtn = await screen.findByRole("button", { name: /uninstall agent-switch/i });
    expect((uninstallBtn as HTMLButtonElement).disabled).toBe(true); // disabled until the user actively types
    fireEvent.click(uninstallBtn);
    expect(ipc.uninstall).not.toHaveBeenCalled(); // a stray click does nothing

    fireEvent.change(await screen.findByPlaceholderText("uninstall"), { target: { value: "uninstall" } });
    fireEvent.click(screen.getByRole("button", { name: /uninstall agent-switch/i }));
    await waitFor(() => expect(ipc.uninstall).toHaveBeenCalled());
  });

  it("shows an Open-in-app affordance for installed apps and launches on click", async () => {
    ipc.listApps.mockResolvedValue([
      { id: "claude-desktop", displayName: "Claude Desktop", provider: "claude", strategy: "user-data-dir", installed: true },
    ]);
    render(<App />);
    const btns = await screen.findAllByRole("button", { name: /claude desktop/i });
    fireEvent.click(btns[0]); // first claude row (work)
    expect(ipc.openApp).toHaveBeenCalledWith("claude-desktop", "work");
  });

  it("takes over a session from the Sessions view into the embedded terminal", async () => {
    ipc.listSessions.mockImplementation((_p?: string, _r?: number, provider?: string) =>
      Promise.resolve(
        provider === "claude"
          ? [{ provider: "claude", profile: "work", sessionId: "abc12345", projectDir: "p", cwd: "/w", mtimeMs: Date.now() - 60_000, live: false }]
          : [],
      ),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /^sessions$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /take over/i })); // actions live on the tile, always visible
    const term = await screen.findByTestId("term");
    expect(term.textContent).toContain("takeover abc12345 --to privat"); // moved to the other claude profile
  });

  it("deletes a session after an inline confirm and offers Undo", async () => {
    ipc.listSessions.mockImplementation((_p?: string, _r?: number, provider?: string) =>
      Promise.resolve(
        provider === "claude"
          ? [{ provider: "claude", profile: "work", sessionId: "abc12345", projectDir: "p", cwd: "/w", mtimeMs: Date.now() - 60_000, live: false }]
          : [],
      ),
    );
    ipc.deleteSession.mockResolvedValue({ mode: "trash", trashId: "1000-abc12345" });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /^sessions$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /delete session abc12345/i }));
    expect(ipc.deleteSession).not.toHaveBeenCalled(); // first click only arms the confirm
    fireEvent.click(await screen.findByRole("button", { name: /^Delete$/i }));
    await waitFor(() => expect(ipc.deleteSession).toHaveBeenCalledWith("claude", "abc12345", "work"));
    expect(await screen.findByRole("button", { name: /undo/i })).toBeTruthy();
  });

  it("suppresses the session summary in the list when hideSummaries is on", async () => {
    store.hideSummaries = true;
    ipc.listSessions.mockImplementation((_p?: string, _r?: number, provider?: string) =>
      Promise.resolve(
        provider === "claude"
          ? [{ provider: "claude", profile: "work", sessionId: "abc12345", projectDir: "p", cwd: "/w", summary: "secret summary text", mtimeMs: Date.now() - 60_000, live: false }]
          : [],
      ),
    );
    try {
      render(<App />);
      fireEvent.click(await screen.findByRole("button", { name: /^sessions$/i }));
      await screen.findByRole("button", { name: /delete session abc12345/i }); // tile rendered
      expect(screen.queryByText("secret summary text")).toBeNull(); // summary suppressed on the tile
      expect(screen.queryByRole("button", { name: /show preview abc12345/i })).toBeNull(); // no preview affordance when hidden
    } finally {
      store.hideSummaries = false;
    }
  });

  it("hands off a claude session to codex: lossy banner, vendor named, seed opens the terminal", async () => {
    ipc.listSessions.mockImplementation((_p?: string, _r?: number, provider?: string) =>
      Promise.resolve(
        provider === "claude"
          ? [{ provider: "claude", profile: "work", sessionId: "abc12345", projectDir: "p", cwd: "/w", mtimeMs: Date.now() - 60_000, live: false }]
          : [],
      ),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /^sessions$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /hand off session abc12345/i }));
    // modal: brief extracted for the OTHER provider (codex), lossy banner names the vendor
    await waitFor(() => expect(ipc.extractHandoffBrief).toHaveBeenCalledWith("claude", "work", "abc12345", "codex"));
    expect(await screen.findByText(/history, tool state/i)).toBeTruthy(); // lossy banner
    // Seed opens the embedded terminal with the path-only seed args
    fireEvent.click(await screen.findByRole("button", { name: /seed codex session/i }));
    const term = await screen.findByTestId("term");
    expect(term.textContent).toContain("handoff seed --to oai --provider codex --brief /cfg/.agent-switch/handoff/abc.md");
  });

  it("disables delete on a live session row", async () => {
    ipc.listSessions.mockImplementation((_p?: string, _r?: number, provider?: string) =>
      Promise.resolve(
        provider === "claude"
          ? [{ provider: "claude", profile: "work", sessionId: "abc12345", projectDir: "p", cwd: "/w", mtimeMs: Date.now(), live: true }]
          : [],
      ),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /^sessions$/i }));
    const del = await screen.findByRole("button", { name: /delete session abc12345/i });
    expect((del as HTMLButtonElement).disabled).toBe(true);
  });

  it("hides the New button on a subpage — only shown on the main page", async () => {
    render(<App />);
    expect(await screen.findByRole("button", { name: /new/i })).toBeTruthy(); // main page
    fireEvent.click(screen.getByRole("button", { name: /^usage$/i }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /new/i })).toBeNull()); // subpage
  });

  it("quits the app from the Quit button", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /quit/i }));
    expect(ipc.quitApp).toHaveBeenCalled();
  });

  it("shows the context badge and runs Compact in the embedded terminal for a live session", async () => {
    ipc.listSessions.mockImplementation((_p?: string, _r?: number, provider?: string) =>
      Promise.resolve(
        provider === "claude"
          ? [
              {
                provider: "claude",
                profile: "work",
                sessionId: "abc12345",
                projectDir: "p",
                cwd: "/w",
                mtimeMs: Date.now() - 60_000,
                live: true,
                context: { pct: 67, contextTokens: 134_000, windowTokens: 1_000_000, model: "sonnet", confidence: "high" },
              },
            ]
          : [],
      ),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /^sessions$/i }));
    expect(await screen.findByText("67% · 134k/1000k")).toBeTruthy(); // context badge on the tile
    fireEvent.click(await screen.findByRole("button", { name: /compact/i }));
    const term = await screen.findByTestId("term");
    expect(term.textContent).toContain("compact work"); // compactArgs
    expect(term.textContent).toMatch(/Compact — work/);
  });

  it("lazily fetches and renders a content preview when a claude session is expanded", async () => {
    ipc.listSessions.mockImplementation((_p?: string, _r?: number, provider?: string) =>
      Promise.resolve(
        provider === "claude"
          ? [{ provider: "claude", profile: "work", sessionId: "abc12345", projectDir: "p", cwd: "/w", mtimeMs: Date.now() - 60_000, live: false }]
          : [],
      ),
    );
    ipc.sessionPreview.mockResolvedValue({
      messages: [
        { role: "user", text: "hello there" },
        { role: "assistant", text: "hi back" },
      ],
      truncated: false,
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /^sessions$/i }));
    expect(ipc.sessionPreview).not.toHaveBeenCalled(); // not fetched until the preview is opened
    fireEvent.click(await screen.findByRole("button", { name: /show preview abc12345/i }));
    await waitFor(() => expect(ipc.sessionPreview).toHaveBeenCalledWith("claude", "abc12345", "work"));
    expect(await screen.findByText("hello there")).toBeTruthy();
    expect(await screen.findByText("hi back")).toBeTruthy();
  });

  it("hides the preview and never fetches it when hideSummaries is on (privacy gate)", async () => {
    store.hideSummaries = true;
    ipc.listSessions.mockImplementation((_p?: string, _r?: number, provider?: string) =>
      Promise.resolve(
        provider === "claude"
          ? [{ provider: "claude", profile: "work", sessionId: "abc12345", projectDir: "p", cwd: "/w", summary: "s", mtimeMs: Date.now() - 60_000, live: false }]
          : [],
      ),
    );
    try {
      render(<App />);
      fireEvent.click(await screen.findByRole("button", { name: /^sessions$/i }));
      await screen.findByRole("button", { name: /delete session abc12345/i }); // tile rendered
      expect(screen.queryByRole("button", { name: /show preview abc12345/i })).toBeNull(); // no preview affordance
      expect(ipc.sessionPreview).not.toHaveBeenCalled(); // gated: never read the transcript body
    } finally {
      store.hideSummaries = false;
    }
  });

  it("toggles context alerts from the Notifications settings group", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /settings/i }));
    fireEvent.click(await screen.findByRole("tab", { name: /notifications/i }));
    fireEvent.click(await screen.findByRole("switch", { name: /^context alerts$/i })); // currently off
    await waitFor(() => expect(ipc.setNotify).toHaveBeenCalledWith(true, [80, 95]));
  });
});

describe("sidebar sections", () => {
  it("routes between the six sections from the sidebar nav", async () => {
    render(<App />);
    await screen.findByRole("tab", { name: /claude/i }); // Profiles is the default section
    const nav = screen.getByRole("navigation", { name: /sections/i });
    expect(within(nav).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Profiles",
      "Sessions",
      "Usage",
      "Tooling",
      "Ecosystem",
      "Settings",
    ]);
    // Sessions = the (correctly named) sessions inventory; Usage = the new
    // cross-account comparison view.
    fireEvent.click(within(nav).getByRole("button", { name: "Sessions" }));
    expect(await screen.findByText(/no claude sessions yet/i)).toBeTruthy();
    fireEvent.click(within(nav).getByRole("button", { name: "Usage" }));
    expect(await screen.findByText(/most headroom right now/i)).toBeTruthy();
    expect(screen.getByText(/by account/i)).toBeTruthy();
    fireEvent.click(within(nav).getByRole("button", { name: "Tooling" }));
    // The Tooling section renders the CLI's `tooling --json` readout (never its
    // own detection) — the all-healthy default resolves into five OK rows.
    expect(await screen.findByText(/can never disagree/i)).toBeTruthy(); // the doctor-parity caption
    await waitFor(() => expect(ipc.toolingStatus).toHaveBeenCalled());
    expect((await screen.findAllByTestId("tooling-row")).length).toBe(5);
    fireEvent.click(within(nav).getByRole("button", { name: "Ecosystem" }));
    expect(await screen.findByText(/shared setup/i)).toBeTruthy();
    fireEvent.click(within(nav).getByRole("button", { name: "Settings" }));
    expect(await screen.findByRole("tab", { name: /general/i })).toBeTruthy();
    fireEvent.click(within(nav).getByRole("button", { name: "Profiles" }));
    expect(await screen.findByRole("tab", { name: /claude/i })).toBeTruthy(); // back on the profile list
  });

  it("marks the active section and moves focus with the arrow keys (wrapping)", async () => {
    render(<App />);
    await screen.findByRole("tab", { name: /claude/i });
    const nav = screen.getByRole("navigation", { name: /sections/i });
    const items = within(nav).getAllByRole("button");
    expect(items[0].getAttribute("aria-current")).toBe("page"); // Profiles active by default
    items[0].focus();
    fireEvent.keyDown(items[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1], { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: "ArrowUp" }); // wraps to the last item (Settings, index 5 of 6)
    expect(document.activeElement).toBe(items[5]);
    fireEvent.keyDown(items[5], { key: "ArrowDown" }); // wraps back to the first
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: "End" });
    expect(document.activeElement).toBe(items[5]);
    fireEvent.keyDown(items[5], { key: "Home" });
    expect(document.activeElement).toBe(items[0]);
  });

  it("persists the provider filter and restores it on the next mount", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: /codex/i }));
    expect(store.providerFilter).toBe("codex"); // persisted like the other UI prefs
    cleanup();
    render(<App />);
    expect(await screen.findByText(/oai/)).toBeTruthy(); // reopens filtered to codex
    expect(screen.queryByText(/privat/)).toBeNull();
  });
});

describe("tooling actions (owner amendment: visible runs in the embedded terminal)", () => {
  async function openTooling() {
    render(<App />);
    await screen.findByRole("tab", { name: /claude/i });
    fireEvent.click(within(screen.getByRole("navigation", { name: /sections/i })).getByRole("button", { name: "Tooling" }));
  }

  it("Install runs `agent-switch tooling install <id>` in the embedded terminal and re-sweeps on close", async () => {
    ipc.toolingStatus.mockResolvedValue([
      { id: "rtk", present: false, version: null, path: null, healthy: false, hint: "not installed — install: `brew install rtk`" },
    ]);
    await openTooling();
    fireEvent.click(await screen.findByRole("button", { name: /install/i }));
    // The stubbed terminal shows the exact CLI invocation it was opened on.
    const term = await screen.findByTestId("term");
    expect(term.textContent).toContain("Install — rtk");
    expect(term.textContent).toContain("tooling install rtk");
    expect(ipc.toolingStatus).toHaveBeenCalledTimes(1);
    // Closing the run invalidates the tooling cache → the remounted section re-sweeps.
    fireEvent.click(screen.getByRole("button", { name: "close-term" }));
    await waitFor(() => expect(ipc.toolingStatus).toHaveBeenCalledTimes(2));
  });

  it("Update renders ONLY when a newer latest exists, and runs `tooling upgrade <id>` in the embedded terminal", async () => {
    // rtk (installed 1.4.2) has a newer release; claude/codex latest unknown →
    // exactly one Update button, on the rtk row, naming the version.
    latestToolVersion.mockImplementation(async (id: string) => (id === "rtk" ? "9.9.9" : null));
    await openTooling();
    const updates = await screen.findAllByRole("button", { name: /update/i });
    expect(updates).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Update to v9.9.9" }));
    const term = await screen.findByTestId("term");
    expect(term.textContent).toContain("Update — rtk");
    expect(term.textContent).toContain("tooling upgrade rtk");
  });

  it("shows NO Update buttons on the all-healthy readout when no newer latest is known", async () => {
    await openTooling(); // default: latestToolVersion → null, agent-config detection up to date
    await screen.findAllByTestId("tooling-row");
    expect(screen.queryByRole("button", { name: /update/i })).toBeNull();
  });

  it("labels the agent-config Update with the newer version App's detection found", async () => {
    fetchLatest.mockResolvedValue({ tag: "9.9.0", name: "", url: "", notes: "", publishedAt: "" });
    await openTooling();
    fireEvent.click(await screen.findByRole("button", { name: "Update to v9.9.0" }));
    const term = await screen.findByTestId("term");
    expect(term.textContent).toContain("tooling upgrade agent-config");
  });
});

describe("agent-config one-click install/update (owner requirement: fully in the background, no terminal)", () => {
  it("first-run Install: busy state, exact args, no terminal, card retires after re-detection", async () => {
    ipc.agentConfigVersion.mockResolvedValueOnce(null); // not installed at mount; 9.2.0 after the install
    let finish!: () => void;
    ipc.runToolingAction.mockImplementation(() => new Promise<void>((r) => (finish = r)));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /^install$/i }));
    expect(ipc.runToolingAction).toHaveBeenCalledWith("install", "agent-config");
    // Background run: disabled busy button, and NO embedded terminal anywhere.
    const busy = await screen.findByRole("button", { name: "Installing…" });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId("term")).toBeNull();
    expect(ipc.agentConfigVersion).toHaveBeenCalledTimes(1); // mount detection only, so far
    finish();
    // Success → detection re-ran and the card retired (installed + current).
    await waitFor(() => expect(ipc.agentConfigVersion).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText(/supercharge your ai agents/i)).toBeNull());
  });

  it("Ecosystem Install runs `tooling install agent-config` in the background and the pill flips to current", async () => {
    ipc.agentConfigVersion.mockResolvedValueOnce(null); // not installed at mount
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /^ecosystem$/i }));
    expect(await screen.findByText(/not installed/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^install$/i }));
    await waitFor(() => expect(ipc.runToolingAction).toHaveBeenCalledWith("install", "agent-config"));
    expect(screen.queryByTestId("term")).toBeNull(); // no terminal opened
    expect(await screen.findByText(/v9\.2\.0 · current/i)).toBeTruthy(); // re-detected on success
  });

  it("Ecosystem Update runs `tooling upgrade agent-config` and re-detects to current", async () => {
    ipc.agentConfigVersion.mockResolvedValueOnce("9.1.0"); // older at mount; 9.2.0 after the upgrade
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /^ecosystem$/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Update to v9.2.0" }));
    await waitFor(() => expect(ipc.runToolingAction).toHaveBeenCalledWith("upgrade", "agent-config"));
    expect(screen.queryByTestId("term")).toBeNull(); // no terminal opened
    expect(await screen.findByText(/v9\.2\.0 · current/i)).toBeTruthy(); // pill flipped
  });

  it("a failed run routes the error through the notification system only — never inline", async () => {
    ipc.agentConfigVersion.mockResolvedValue(null); // stays not installed
    ipc.runToolingAction.mockRejectedValue(new Error("npm ERR! EACCES"));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /^install$/i }));
    await waitFor(() =>
      expect(ipc.recordNotification).toHaveBeenCalledWith("error", "agent-config setup failed", "npm ERR! EACCES"),
    );
    expect(screen.queryByText(/EACCES/)).toBeNull(); // nothing inline
    expect(await screen.findByRole("button", { name: /^install$/i })).toBeTruthy(); // busy cleared, retry possible
  });
});
