import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";

// The IPC layer is Tauri-coupled; mock it so the component logic is testable in
// jsdom. loginArgs/sessionArgs are pure arg builders — kept real so the args
// the terminal receives are asserted for real. vi.hoisted lets the (hoisted)
// vi.mock factory reference `ipc`.
const ipc = vi.hoisted(() => ({
  listProfiles: vi.fn(),
  profileUsage: vi.fn(),
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
  listSessions: vi.fn(),
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
}));
vi.mock("./ipc.js", () => ipc);

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
const store = vi.hoisted(() => ({ globalAuto: true, autoRefresh: true, refreshMin: 10 }));
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
  // Global auto-switch defaults OFF in production; enable it for the auto-switch
  // UI tests. (The dedicated default-off test flips this itself.)
  store.globalAuto = true;
  ipc.listProfiles.mockResolvedValue(rows);
  ipc.profileUsage.mockResolvedValue(usageSnap);
  ipc.getAutoSwitch.mockResolvedValue({
    claude: { enabled: false, threshold: 95 },
    codex: { enabled: false, threshold: 95 },
    gemini: { enabled: false, threshold: 95 },
  });
  ipc.setAutoSwitch.mockResolvedValue(undefined);
  // All providers enabled by default in tests so the gemini tab is present for
  // the auto-switch-dot / footer assertions below.
  ipc.getProviders.mockResolvedValue({
    claude: { cli: true, ui: true, installed: true },
    codex: { cli: true, ui: true, installed: true },
    gemini: { cli: true, ui: true, installed: true },
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
  ipc.quitApp.mockResolvedValue(undefined);
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
    // label badge shown
    expect(screen.getByText("Work")).toBeTruthy();
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

  it("per-tab auto-switch badge colouring shows for Claude + Codex (usage readout); not Gemini", async () => {
    ipc.listProfiles.mockResolvedValue([
      { provider: "claude", name: "a", identity: null, label: null, active: true, liveSessions: 0 },
      { provider: "claude", name: "b", identity: null, label: null, active: false, liveSessions: 0 },
      { provider: "codex", name: "c", identity: null, label: null, active: false, liveSessions: 0 },
      { provider: "codex", name: "d", identity: null, label: null, active: false, liveSessions: 0 },
      { provider: "gemini", name: "e", identity: null, label: null, active: false, liveSessions: 0 },
    ]);
    ipc.getAutoSwitch.mockResolvedValue({
      claude: { enabled: true, threshold: 95 }, // 2 profiles, on → green badge
      codex: { enabled: false, threshold: 95 }, // 2 profiles, off → red badge
      gemini: { enabled: true, threshold: 95 },
    });
    render(<App />);
    expect(await screen.findByLabelText(/auto-switch on for claude/i)).toBeTruthy();
    expect(await screen.findByLabelText(/auto-switch off for codex/i)).toBeTruthy(); // Codex now has a usage readout
    expect(screen.queryByLabelText(/auto-switch.*for gemini/i)).toBeNull(); // no readout → no badge colour
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

  it("opens a Settings view (agent tabs hidden) with General/Design/Uninstall sub-tabs", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /settings/i }));
    // agent provider tabs are gone; settings sub-tabs are present
    expect(screen.queryByRole("tab", { name: /claude/i })).toBeNull();
    expect(screen.getByRole("tab", { name: /general/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /design/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /uninstall/i })).toBeTruthy();
  });

  it("toggles autostart from the General settings tab", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /settings/i }));
    fireEvent.click(await screen.findByRole("button", { name: /start at login/i })); // autostart currently off
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

  it("global auto-switch off hides the badge colouring + footer toggle and deactivates every provider", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /settings/i }));
    fireEvent.click(await screen.findByRole("button", { name: /auto-switch globally/i })); // On → Off
    await waitFor(() => expect(ipc.setAutoSwitch).toHaveBeenCalledWith("claude", false));
    expect(ipc.setAutoSwitch).toHaveBeenCalledWith("codex", false);
    expect(ipc.setAutoSwitch).toHaveBeenCalledWith("gemini", false);
    // back to the profile view: no per-tab dots, no footer toggle
    fireEvent.click(screen.getByRole("button", { name: /close settings/i }));
    await screen.findByRole("tab", { name: /claude/i });
    expect(screen.queryByLabelText(/auto-switch/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /auto-switch ·/i })).toBeNull();
  });

  it("toggles a provider surface from the Providers settings tab", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /settings/i }));
    fireEvent.click(await screen.findByRole("tab", { name: /providers/i }));
    // gemini CLI is on (mock) → clicking it disables that surface
    fireEvent.click(await screen.findByRole("button", { name: /gemini cli enabled/i }));
    expect(ipc.setProvider).toHaveBeenCalledWith("gemini", "cli", false);
  });

  it("hides a disabled provider's tab in the main view", async () => {
    ipc.getProviders.mockResolvedValue({
      claude: { cli: true, ui: true, installed: true },
      codex: { cli: true, ui: true, installed: true },
      gemini: { cli: false, ui: false, installed: true }, // disabled → no tab
    });
    render(<App />);
    await screen.findByRole("tab", { name: /claude/i });
    expect(screen.queryByRole("tab", { name: /gemini/i })).toBeNull();
    expect(screen.getByRole("tab", { name: /codex/i })).toBeTruthy();
  });

  it("shows a not-installed provider in the Providers tab but blocks enabling it", async () => {
    ipc.getProviders.mockResolvedValue({
      claude: { cli: true, ui: true, installed: true },
      codex: { cli: true, ui: true, installed: true },
      gemini: { cli: false, ui: false, installed: false }, // not installed, off
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /settings/i }));
    fireEvent.click(await screen.findByRole("tab", { name: /providers/i }));
    const geminiCli = await screen.findByRole("button", { name: /gemini cli disabled \(not installed\)/i });
    expect((geminiCli as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(geminiCli);
    expect(ipc.setProvider).not.toHaveBeenCalled(); // can't enable a missing provider
  });

  it("changes the theme from the Design settings tab", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /settings/i }));
    fireEvent.click(await screen.findByRole("tab", { name: /design/i }));
    fireEvent.click(await screen.findByRole("radio", { name: "Light" }));
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("hides uninstall behind the Uninstall sub-tab and requires typing to confirm", async () => {
    render(<App />);
    expect(screen.queryByRole("button", { name: /uninstall agent-switch/i })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: /settings/i }));
    fireEvent.click(await screen.findByRole("tab", { name: /uninstall/i }));

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
    ipc.listSessions.mockResolvedValue([
      { provider: "claude", profile: "work", sessionId: "abc12345", projectDir: "p", cwd: "/w", mtimeMs: Date.now() - 60_000, live: false },
    ]);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /sessions/i }));
    fireEvent.click(await screen.findByRole("button", { name: /take over/i }));
    const term = await screen.findByTestId("term");
    expect(term.textContent).toContain("takeover abc12345 --to privat"); // moved to the other claude profile
  });

  it("quits the app from the Quit button", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /quit/i }));
    expect(ipc.quitApp).toHaveBeenCalled();
  });
});
