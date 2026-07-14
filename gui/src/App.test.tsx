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
  setProfileLabel: vi.fn(),
  switchProfile: vi.fn(),
  openWeb: vi.fn(),
  loginArgs: (p: string, n: string) => ["add", n, "--provider", p],
  sessionArgs: (p: string, n: string) => ["run", n, "--provider", p],
  assertValidName: () => {},
  deactivateProfile: vi.fn(),
  removeProfile: vi.fn(),
  uninstall: vi.fn(),
  getAutostart: vi.fn(),
  setAutostart: vi.fn(),
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
  ipc.listProfiles.mockResolvedValue(rows);
  ipc.profileUsage.mockResolvedValue(usageSnap);
  ipc.getAutoSwitch.mockResolvedValue({
    claude: { enabled: false, threshold: 95 },
    codex: { enabled: false, threshold: 95 },
    gemini: { enabled: false, threshold: 95 },
  });
  ipc.setAutoSwitch.mockResolvedValue(undefined);
  ipc.setProfileLabel.mockResolvedValue(undefined);
  ipc.switchProfile.mockResolvedValue(undefined);
  ipc.deactivateProfile.mockResolvedValue(undefined);
  ipc.removeProfile.mockResolvedValue(undefined);
  ipc.uninstall.mockResolvedValue(undefined);
  ipc.getAutostart.mockResolvedValue(false);
  ipc.setAutostart.mockResolvedValue(undefined);
  ipc.listApps.mockResolvedValue([]);
  ipc.openApp.mockResolvedValue(undefined);
  ipc.quitApp.mockResolvedValue(undefined);
});

describe("App", () => {
  it("shows the selected provider's profiles with per-profile usage; labels render", async () => {
    render(<App />);
    expect(await screen.findByRole("tab", { name: /claude/i })).toBeTruthy();
    expect(screen.getByText(/privat/)).toBeTruthy();
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
    const useButtons = screen.getAllByRole("button", { name: "Use" });
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

  it("runs a session in the embedded terminal (no external window) when Run is clicked", async () => {
    render(<App />);
    await screen.findByRole("tab", { name: /claude/i });
    fireEvent.click(screen.getAllByRole("button", { name: "Run" })[0]);
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
    fireEvent.click(screen.getByRole("button", { name: /create & log in/i }));
    const term = await screen.findByTestId("term");
    expect(term.textContent).toContain("add work --provider codex"); // loginArgs, no osascript/Terminal.app
    expect(term.textContent).toMatch(/Login — Codex \/ work/);
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

  it("per-tab auto-switch dot: green=on, red=off, grey=unavailable (<2 profiles)", async () => {
    ipc.listProfiles.mockResolvedValue([
      { provider: "claude", name: "a", identity: null, label: null, active: true, liveSessions: 0 },
      { provider: "claude", name: "b", identity: null, label: null, active: false, liveSessions: 0 },
      { provider: "codex", name: "c", identity: null, label: null, active: false, liveSessions: 0 },
      { provider: "codex", name: "d", identity: null, label: null, active: false, liveSessions: 0 },
      { provider: "gemini", name: "e", identity: null, label: null, active: false, liveSessions: 0 },
    ]);
    ipc.getAutoSwitch.mockResolvedValue({
      claude: { enabled: true, threshold: 95 }, // 2 profiles, on  → green
      codex: { enabled: false, threshold: 95 }, // 2 profiles, off → red
      gemini: { enabled: true, threshold: 95 }, // 1 profile → unavailable (grey), despite enabled
    });
    render(<App />);
    expect(await screen.findByLabelText(/auto-switch on for claude/i)).toBeTruthy(); // green
    expect(screen.getByLabelText(/auto-switch off for codex/i)).toBeTruthy(); // red
    expect(screen.getByLabelText(/auto-switch unavailable for gemini/i)).toBeTruthy(); // grey
    expect(screen.queryByLabelText(/auto-switch on for gemini/i)).toBeNull(); // enabled flag ignored when <2
  });

  it("footer marks auto-switch not available for a provider with <2 profiles", async () => {
    render(<App />); // default rows: gemini has 0 profiles
    fireEvent.click(await screen.findByRole("tab", { name: /gemini/i }));
    expect(await screen.findByText(/not available/i)).toBeTruthy();
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

  it("global auto-switch off hides the dots + footer toggle and deactivates every provider", async () => {
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

  it("quits the app from the Quit button", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /quit/i }));
    expect(ipc.quitApp).toHaveBeenCalled();
  });
});
