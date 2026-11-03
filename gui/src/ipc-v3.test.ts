import { describe, it, expect, vi, beforeEach } from "vitest";

const { create, execute } = vi.hoisted(() => {
  const execute = vi.fn(async () => ({ code: 0, stdout: "{}", stderr: "" }));
  const create = vi.fn(() => ({ execute }));
  return { create, execute };
});
vi.mock("@tauri-apps/plugin-shell", () => ({ Command: { create } }));

import * as ipc from "./ipc.js";

describe("v3 IPC calls", () => {
  beforeEach(() => {
    create.mockClear();
    execute.mockReset();
    execute.mockResolvedValue({ code: 0, stdout: "{}", stderr: "" });
  });

  it.each([
    [() => ipc.engineStatus(), ["engine", "status", "--json"]],
    [() => ipc.engineRestart(), ["engine", "restart"]],
    [() => ipc.hostList(), ["host", "list", "--json"]],
    [() => ipc.prStatus(), ["pr", "status", "--json"]],
    [() => ipc.openTargetsGlobal(), ["open-targets", "--json"]],
    [() => ipc.setOpenDefault("finder", "/r"), ["open-default", "finder", "--repo", "/r"]],
    [() => ipc.setOpenDefault("vscode"), ["open-default", "vscode"]],
    [() => ipc.openSessionIn("claude/w/1"), ["open", "claude/w/1"]],
    [() => ipc.openSessionIn("claude/w/1", "cursor"), ["open", "claude/w/1", "--with", "cursor"]],
    [() => ipc.focusSessionTerminal("claude/w/1"), ["focus", "claude/w/1"]],
    [() => ipc.libraryList(), ["sessions", "library", "--json"]],
    [() => ipc.setLibraryFlag("k", "pin", true), ["sessions", "pin", "k"]],
    [() => ipc.setLibraryFlag("k", "archive", false), ["sessions", "unarchive", "k"]],
    [() => ipc.setAutoKeep(false), ["sessions", "keep", "auto", "off"]],
    [() => ipc.sessionChanges("k"), ["changes", "k", "--json"]],
    [() => ipc.hostStart("claude", "/r", "work"), ["host", "start", "work", "--provider", "claude", "--cwd", "/r", "--json"]],
    [() => ipc.hostEnd("k"), ["host", "end", "k", "--yes"]],
    [() => ipc.hostRespawn("k", { effort: "high" }), ["host", "respawn", "k", "--effort", "high"]],
    [() => ipc.cleanupMerged(), ["sessions", "cleanup", "--yes"]],
  ] as const)("%# runs the exact CLI line", async (call, args) => {
    await call();
    expect(create).toHaveBeenCalledWith("agent-switch", [...args]);
  });

  it("a failing engine call reads as a stopped engine", async () => {
    execute.mockResolvedValue({ code: 1, stdout: "", stderr: "boom" });
    expect(await ipc.engineStatus()).toEqual({ running: false, reason: "boom", hostedRunning: 0 });
  });

  it("needs carries its history", async () => {
    execute.mockResolvedValue({ code: 0, stdout: JSON.stringify({ items: [], away: null, history: [{ id: "1", kind: "ci", who: "w", what: "x", doneAt: "t" }] }), stderr: "" });
    expect((await ipc.listNeeds()).history).toHaveLength(1);
  });
});
