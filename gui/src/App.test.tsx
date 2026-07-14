import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";

// The IPC layer is Tauri-coupled; mock it so the component logic is testable in
// jsdom. vi.hoisted lets the (hoisted) vi.mock factory reference `ipc`.
const ipc = vi.hoisted(() => ({
  listProfiles: vi.fn(),
  activeStatus: vi.fn(),
  switchProfile: vi.fn(),
  openSession: vi.fn(),
  openWeb: vi.fn(),
  createProfile: vi.fn(),
  deactivateProfile: vi.fn(),
  removeProfile: vi.fn(),
  quitApp: vi.fn(),
}));
vi.mock("./ipc.js", () => ipc);

import App from "./App.js";
import type { ProfileRow, StatusJson } from "./transforms.js";

const rows: ProfileRow[] = [
  { provider: "claude", name: "work", identity: "w@x", active: true, liveSessions: 1 },
  { provider: "claude", name: "privat", identity: "p@x", active: false, liveSessions: 0 },
  { provider: "codex", name: "oai", identity: "acc", active: false, liveSessions: 0 },
];
const status: StatusJson = {
  provider: "claude",
  name: "work",
  identity: "w@x",
  usage: { windows: [{ key: "5h", label: "5h", utilization: 42, resetsAt: null }], routines: null, capturedAt: "x" },
};

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  ipc.listProfiles.mockResolvedValue(rows);
  ipc.activeStatus.mockResolvedValue(status);
  ipc.switchProfile.mockResolvedValue(undefined);
  ipc.createProfile.mockResolvedValue(undefined);
  ipc.deactivateProfile.mockResolvedValue(undefined);
  ipc.removeProfile.mockResolvedValue(undefined);
  ipc.quitApp.mockResolvedValue(undefined);
});

describe("App", () => {
  it("shows the selected provider's profiles + active usage; other providers stay behind their tab", async () => {
    render(<App />);
    // provider tabs are always present
    expect(await screen.findByRole("tab", { name: /claude/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /codex/i })).toBeTruthy();
    // default tab = claude → claude profiles visible, codex's `oai` hidden
    expect(screen.getByText(/privat/)).toBeTruthy();
    expect(screen.queryByText(/oai/)).toBeNull();
    // active usage window for the selected provider
    expect(screen.getByText("5h")).toBeTruthy();
    expect(screen.getByText("42%")).toBeTruthy();
    expect(screen.getByText(/42% used/)).toBeTruthy();
  });

  it("switches the provider tab to reveal that provider's profiles", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: /codex/i }));
    expect(await screen.findByText(/oai/)).toBeTruthy(); // codex profile now shown
    expect(screen.queryByText(/privat/)).toBeNull(); // claude profile now hidden
  });

  it("switches profile via the CLI and refreshes when Use is clicked", async () => {
    render(<App />);
    await screen.findByRole("tab", { name: /claude/i });
    // on the claude tab, only the non-active row (privat) has a Use button
    const useButtons = screen.getAllByRole("button", { name: "Use" });
    expect(useButtons.length).toBe(1);
    fireEvent.click(useButtons[0]);
    expect(ipc.switchProfile).toHaveBeenCalledWith("claude", "privat");
    await waitFor(() => expect(ipc.listProfiles).toHaveBeenCalledTimes(2)); // refreshed
  });

  it("runs a session via the CLI when Run is clicked", async () => {
    render(<App />);
    await screen.findByRole("tab", { name: /claude/i });
    fireEvent.click(screen.getAllByRole("button", { name: "Run" })[0]);
    expect(ipc.openSession).toHaveBeenCalledWith("claude", "work");
  });

  it("shows 'No usage source' when the active profile has no usage", async () => {
    ipc.activeStatus.mockResolvedValue({ ...status, usage: null });
    render(<App />);
    expect(await screen.findByText(/no usage source/i)).toBeTruthy();
  });

  it("surfaces an actionable error when the CLI binary is unreachable", async () => {
    ipc.listProfiles.mockRejectedValue(new Error("program not found"));
    render(<App />);
    expect(await screen.findByText(/not found on PATH.*npm link/)).toBeTruthy();
  });

  it("shows a per-provider empty state with a create action", async () => {
    ipc.listProfiles.mockResolvedValue([]);
    ipc.activeStatus.mockResolvedValue(null);
    render(<App />);
    expect(await screen.findByText(/no claude profiles yet/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /create a profile/i })).toBeTruthy();
  });

  it("creates a profile pre-selected to the open provider tab", async () => {
    ipc.listProfiles.mockResolvedValue([]);
    ipc.activeStatus.mockResolvedValue(null);
    render(<App />);
    // open the Codex tab first → the create form should default to codex
    fireEvent.click(await screen.findByRole("tab", { name: /codex/i }));
    fireEvent.click(screen.getByRole("button", { name: /^New$/ }));
    fireEvent.change(await screen.findByPlaceholderText(/e\.g\. work/), { target: { value: "work" } });
    fireEvent.click(screen.getByRole("button", { name: /create & log in/i }));
    await waitFor(() => expect(ipc.createProfile).toHaveBeenCalledWith("codex", "work"));
    expect(await screen.findByText(/complete the login in the terminal/i)).toBeTruthy();
  });

  it("deactivates the active profile from the Active card", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /deactivate/i }));
    expect(ipc.deactivateProfile).toHaveBeenCalledWith("claude");
    await waitFor(() => expect(ipc.listProfiles).toHaveBeenCalledTimes(2)); // refreshed
  });

  it("deletes a profile only after an explicit confirm (deactivate-then-delete)", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: /codex/i }));
    fireEvent.click(await screen.findByRole("button", { name: /delete oai/i }));
    expect(ipc.removeProfile).not.toHaveBeenCalled(); // trash → confirm, nothing yet
    fireEvent.click(await screen.findByRole("button", { name: /^Yes$/ }));
    await waitFor(() => expect(ipc.removeProfile).toHaveBeenCalledWith("codex", "oai"));
  });

  it("quits the app from the Quit button", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /quit/i }));
    expect(ipc.quitApp).toHaveBeenCalled();
  });
});
