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

import { listProfiles, activeStatus, switchProfile, openSession, openWeb } from "./ipc.js";

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
    expect(s.name).toBe("work");
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
});
