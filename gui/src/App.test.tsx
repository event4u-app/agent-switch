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
});

describe("App", () => {
  it("loads and renders profiles grouped by provider + the active usage", async () => {
    render(<App />);
    // provider group labels are unambiguous "loaded" anchors
    expect(await screen.findByText("Codex")).toBeTruthy();
    expect(screen.getByText("Claude")).toBeTruthy();
    expect(screen.getByText(/privat/)).toBeTruthy(); // unambiguous profile names
    expect(screen.getByText(/oai/)).toBeTruthy();
    // active usage window rendered
    expect(screen.getByText(/5h: 42%/)).toBeTruthy();
    expect(screen.getByText(/nearest own limit: 42%/)).toBeTruthy();
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

  it("shows 'no usage source' when the active profile has no usage", async () => {
    ipc.activeStatus.mockResolvedValue({ ...status, usage: null });
    render(<App />);
    expect(await screen.findByText(/no usage source/)).toBeTruthy();
  });

  it("surfaces an error when the CLI call fails", async () => {
    ipc.listProfiles.mockRejectedValue(new Error("agent-switch not found"));
    render(<App />);
    expect(await screen.findByText(/agent-switch not found/)).toBeTruthy();
  });
});
