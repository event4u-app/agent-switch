import { describe, it, expect, vi, beforeEach } from "vitest";

const ipc = vi.hoisted(() => ({
  setProtection: vi.fn(async () => ({})),
  createPool: vi.fn(async () => ({ id: "team-a" })),
  renamePool: vi.fn(async () => ({})),
  deletePool: vi.fn(async () => {}),
  addPoolMember: vi.fn(async () => ({})),
  removePoolMember: vi.fn(async () => ({})),
  suggestPools: vi.fn(async () => []),
  confirmPoolSuggestions: vi.fn(async () => ["work"]),
  mapFolder: vi.fn(async () => {}),
  unmapFolder: vi.fn(async () => {}),
  setMappingPaused: vi.fn(async () => {}),
  resolveDir: vi.fn(async () => ({ profile: null, configDir: null, why: [] })),
  setGuard: vi.fn(async () => ({})),
  listActivity: vi.fn(async () => [{ at: "2026-10-28T10:00:00Z", kind: "guard", target: null, action: "set warn", reason: "r", ok: true }]),
  doctor: vi.fn(async () => ({ readiness: "blocked", platform: "darwin", checks: [{ id: "x", status: "error", title: "X", detail: "" }] })),
}));
vi.mock("../ipc.js", () => ipc);

import { createFoundationActions } from "./actions-foundations.js";
import { emptyViewModel } from "./load.js";

const reload = vi.fn(async () => {});
const act = () => createFoundationActions(() => emptyViewModel(), reload);

beforeEach(() => vi.clearAllMocks());

describe("createFoundationActions", () => {
  it("writes go through one ipc call each and reload afterwards", async () => {
    await act().setProtection("codex:w", { thresholdPct: 90 });
    expect(ipc.setProtection).toHaveBeenCalledWith("codex", "w", { thresholdPct: 90 });
    expect(await act().createPool("Team A")).toBe("team-a");
    await act().setPoolMembership("team-a", "claude:work", true);
    expect(ipc.addPoolMember).toHaveBeenCalledWith("team-a", "claude", "work");
    await act().setPoolMembership("team-a", "claude:work", false);
    expect(ipc.removePoolMember).toHaveBeenCalledWith("team-a", "claude", "work");
    expect(await act().confirmPoolSuggestion()).toEqual(["work"]);
    await act().setGuard("block");
    expect(ipc.setGuard).toHaveBeenCalledWith("block");
    expect(reload).toHaveBeenCalledTimes(6);
  });

  it("does not reload when the write fails", async () => {
    ipc.deletePool.mockRejectedValueOnce(new Error("used by folder rules"));
    await expect(act().deletePool("work")).rejects.toThrow(/folder rules/);
    expect(reload).not.toHaveBeenCalled();
  });

  it("pauses and resumes a folder rule for its tool", async () => {
    await act().setBindingPaused("/a", "claude", true);
    expect(ipc.setMappingPaused).toHaveBeenCalledWith("claude", "/a", true);
    await act().setBindingPaused("/a", "codex", false);
    expect(ipc.setMappingPaused).toHaveBeenCalledWith("codex", "/a", false);
  });

  it("maps a folder to an account or a tool's pool, and refuses gemini", async () => {
    await act().mapFolder("/a", { accountId: "claude:work" });
    expect(ipc.mapFolder).toHaveBeenCalledWith("claude", { profile: "work" }, "/a");
    await act().mapFolder("/b", { pool: "team-a", tool: "codex" });
    expect(ipc.mapFolder).toHaveBeenCalledWith("codex", { pool: "team-a" }, "/b");
    await act().unmapFolder("/a");
    expect(ipc.unmapFolder).toHaveBeenCalledWith("/a", undefined);
    await expect(act().mapFolder("/c", { pool: "p", tool: "gemini" })).rejects.toThrow(/no backend/);
  });

  it("reads activity and health without a reload", async () => {
    const ev = await act().refreshActivity();
    expect(ipc.listActivity).toHaveBeenCalledWith(200);
    expect(ev[0].kind).toBe("guard");
    expect(await act().runHealthCheck()).toEqual({ readiness: "needs-action", checks: [{ id: "x", title: "X", detail: "", state: "fail", fix: undefined }] });
    expect(reload).not.toHaveBeenCalled();
  });
});
