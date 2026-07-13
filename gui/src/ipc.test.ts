import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Tauri shell plugin so the IPC wrappers are testable without a
// runtime. vi.hoisted lets the (hoisted) vi.mock factory reference these.
const { create, execute, spawn } = vi.hoisted(() => {
  const execute = vi.fn();
  const spawn = vi.fn();
  const create = vi.fn(() => ({ execute, spawn }));
  return { create, execute, spawn };
});
vi.mock("@tauri-apps/plugin-shell", () => ({ Command: { create } }));

import {
  listProfiles,
  activeStatus,
  switchProfile,
  openSession,
  openWeb,
  createProfile,
  deactivateProfile,
  removeProfile,
} from "./ipc.js";

beforeEach(() => vi.clearAllMocks());

describe("ipc", () => {
  it("listProfiles runs `agent-switch list --json` and parses the JSON", async () => {
    execute.mockResolvedValue({ code: 0, stdout: '[{"provider":"claude","name":"work"}]', stderr: "" });
    const rows = await listProfiles();
    expect(create).toHaveBeenCalledWith("agent-switch", ["list", "--json"]);
    expect(rows[0].name).toBe("work");
  });

  it("activeStatus runs `agent-switch status --json`", async () => {
    execute.mockResolvedValue({ code: 0, stdout: '{"provider":"claude","name":"work","identity":null,"usage":null}', stderr: "" });
    const s = await activeStatus();
    expect(create).toHaveBeenCalledWith("agent-switch", ["status", "--json"]);
    expect(s?.name).toBe("work");
  });

  it("activeStatus returns null on a non-zero exit (no active profile — not an error)", async () => {
    execute.mockResolvedValue({ code: 1, stdout: "", stderr: "error: no active claude profile for --json" });
    await expect(activeStatus()).resolves.toBeNull();
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

  it("openSession / openWeb spawn fire-and-forget through the CLI", async () => {
    await openSession("gemini", "g");
    expect(create).toHaveBeenCalledWith("agent-switch", ["run", "g", "--provider", "gemini"]);
    await openWeb("work");
    expect(create).toHaveBeenCalledWith("agent-switch", ["web", "work"]);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it("createProfile opens a terminal via osascript running `agent-switch add`", async () => {
    execute.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    await createProfile("codex", "work");
    expect(create).toHaveBeenCalledWith("osascript", ["-e", expect.stringContaining("agent-switch add work --provider codex")]);
  });

  it("createProfile rejects an unsafe name before touching the shell (injection guard)", async () => {
    await expect(createProfile("claude", 'a" & rm -rf ~ #')).rejects.toThrow(/letters, numbers/);
    expect(create).not.toHaveBeenCalled();
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
});
