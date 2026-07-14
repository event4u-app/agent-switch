import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Tauri shell plugin so the IPC wrappers are testable without a
// runtime. vi.hoisted lets the (hoisted) vi.mock factory reference these.
const { create, execute, spawn, invoke } = vi.hoisted(() => {
  const execute = vi.fn();
  const spawn = vi.fn();
  const create = vi.fn(() => ({ execute, spawn }));
  const invoke = vi.fn();
  return { create, execute, spawn, invoke };
});
vi.mock("@tauri-apps/plugin-shell", () => ({ Command: { create } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import {
  listProfiles,
  activeStatus,
  switchProfile,
  openWeb,
  loginArgs,
  sessionArgs,
  assertValidName,
  deactivateProfile,
  removeProfile,
  quitApp,
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
    expect(sessionArgs("gemini", "g")).toEqual(["run", "g", "--provider", "gemini"]);
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
});
