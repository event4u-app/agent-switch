import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";

// The IPC layer is Tauri-coupled; mock it so the component logic is testable in
// jsdom. vi.hoisted lets the (hoisted) vi.mock factory reference `ipc`.
const ipc = vi.hoisted(() => ({
  listProfiles: vi.fn(),
  profileUsage: vi.fn(),
  getAutoSwitch: vi.fn(),
  setAutoSwitch: vi.fn(),
  setProfileLabel: vi.fn(),
  switchProfile: vi.fn(),
  deactivateProfile: vi.fn(),
  openSession: vi.fn(),
  createProfile: vi.fn(),
  removeProfile: vi.fn(),
  uninstall: vi.fn(),
  quitApp: vi.fn(),
}));
vi.mock("./ipc.js", () => ipc);

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
  ipc.getAutoSwitch.mockResolvedValue({ enabled: false, threshold: 95 });
  ipc.setAutoSwitch.mockResolvedValue(undefined);
  ipc.setProfileLabel.mockResolvedValue(undefined);
  ipc.switchProfile.mockResolvedValue(undefined);
  ipc.deactivateProfile.mockResolvedValue(undefined);
  ipc.createProfile.mockResolvedValue(undefined);
  ipc.removeProfile.mockResolvedValue(undefined);
  ipc.uninstall.mockResolvedValue(undefined);
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

  it("runs a session via the CLI when Run is clicked", async () => {
    render(<App />);
    await screen.findByRole("tab", { name: /claude/i });
    fireEvent.click(screen.getAllByRole("button", { name: "Run" })[0]);
    expect(ipc.openSession).toHaveBeenCalledWith("claude", "work");
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

  it("creates a profile pre-selected to the open provider tab", async () => {
    ipc.listProfiles.mockResolvedValue([]);
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: /codex/i }));
    fireEvent.click(screen.getByRole("button", { name: /^New$/ }));
    fireEvent.change(await screen.findByPlaceholderText(/e\.g\. work/), { target: { value: "work" } });
    fireEvent.click(screen.getByRole("button", { name: /create & log in/i }));
    await waitFor(() => expect(ipc.createProfile).toHaveBeenCalledWith("codex", "work"));
  });

  it("deletes a profile only after an explicit confirm", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: /codex/i }));
    fireEvent.click(await screen.findByRole("button", { name: /delete oai/i }));
    expect(ipc.removeProfile).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: /^Yes$/ }));
    await waitFor(() => expect(ipc.removeProfile).toHaveBeenCalledWith("codex", "oai"));
  });

  it("toggles auto-switch from the footer", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /auto-switch/i }));
    expect(ipc.setAutoSwitch).toHaveBeenCalledWith(true); // was off → turned on
  });

  it("uninstalls only after an explicit confirm, then quits", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /uninstall/i }));
    expect(ipc.uninstall).not.toHaveBeenCalled(); // first click → confirm
    fireEvent.click(await screen.findByRole("button", { name: /^Uninstall$/ }));
    await waitFor(() => expect(ipc.uninstall).toHaveBeenCalled());
  });

  it("quits the app from the Quit button", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /quit/i }));
    expect(ipc.quitApp).toHaveBeenCalled();
  });
});
