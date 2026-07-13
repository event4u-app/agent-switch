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
});

describe("App", () => {
  it("loads and renders profiles grouped by provider + the active usage", async () => {
    render(<App />);
    // provider group labels are unambiguous "loaded" anchors
    expect(await screen.findByText("Codex")).toBeTruthy();
    expect(screen.getAllByText("Claude").length).toBeGreaterThan(0);
    expect(screen.getByText(/privat/)).toBeTruthy(); // unambiguous profile names
    expect(screen.getByText(/oai/)).toBeTruthy();
    // active usage window rendered (label + utilization)
    expect(screen.getByText("5h")).toBeTruthy();
    expect(screen.getByText("42%")).toBeTruthy();
    expect(screen.getByText(/42% used/)).toBeTruthy(); // nearest own limit badge
  });

  it("switches profile via the CLI and refreshes when Use is clicked", async () => {
    render(<App />);
    await screen.findByText("Codex");
    // only non-active rows have a Use button (privat, oai) — DOM order: privat first
    const useButtons = screen.getAllByRole("button", { name: "Use" });
    expect(useButtons.length).toBe(2);
    fireEvent.click(useButtons[0]); // privat
    expect(ipc.switchProfile).toHaveBeenCalledWith("claude", "privat");
    await waitFor(() => expect(ipc.listProfiles).toHaveBeenCalledTimes(2)); // refreshed
  });

  it("runs a session via the CLI when Run is clicked", async () => {
    render(<App />);
    await screen.findByText("Codex");
    fireEvent.click(screen.getAllByRole("button", { name: "Run" })[0]);
    expect(ipc.openSession).toHaveBeenCalled();
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

  it("shows an empty state with a create action when there are no profiles", async () => {
    ipc.listProfiles.mockResolvedValue([]);
    ipc.activeStatus.mockResolvedValue(null);
    render(<App />);
    expect(await screen.findByText(/no profiles yet/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /create a profile/i })).toBeTruthy();
  });

  it("creates a profile + triggers login via the CLI from the New form", async () => {
    ipc.listProfiles.mockResolvedValue([]);
    ipc.activeStatus.mockResolvedValue(null);
    render(<App />);
    await screen.findByText(/no profiles yet/i);
    fireEvent.click(screen.getByRole("button", { name: /^New$/ }));
    fireEvent.change(await screen.findByPlaceholderText(/e\.g\. work/), { target: { value: "work" } });
    fireEvent.click(screen.getByRole("button", { name: /create & log in/i }));
    await waitFor(() => expect(ipc.createProfile).toHaveBeenCalledWith("claude", "work"));
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
    await screen.findByText("Codex");
    fireEvent.click(screen.getByRole("button", { name: /delete oai/i }));
    // trash → inline confirm, nothing deleted yet
    expect(ipc.removeProfile).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: /^Yes$/ }));
    expect(ipc.removeProfile).toHaveBeenCalledWith("codex", "oai");
    await waitFor(() => expect(ipc.listProfiles).toHaveBeenCalledTimes(2)); // refreshed
  });
});
