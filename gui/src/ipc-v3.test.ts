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
    [() => ipc.setOpenTerminal("iterm"), ["open-terminal", "iterm"]],
    [() => ipc.openSessionIn("claude/w/1"), ["open", "claude/w/1"]],
    [() => ipc.openSessionIn("claude/w/1", "cursor"), ["open", "claude/w/1", "--with", "cursor"]],
    [() => ipc.focusSessionTerminal("claude/w/1"), ["focus", "claude/w/1"]],
    [() => ipc.libraryList(), ["sessions", "library", "--json"]],
    [() => ipc.setLibraryFlag("k", "pin", true), ["sessions", "pin", "k"]],
    [() => ipc.setLibraryFlag("k", "archive", false), ["sessions", "unarchive", "k"]],
    [() => ipc.setAutoKeep(false), ["sessions", "keep", "auto", "off"]],
    [() => ipc.sessionChanges("k"), ["changes", "k", "--json"]],
    [() => ipc.hostStart("claude", "/r", "work"), ["host", "start", "work", "--provider", "claude", "--cwd", "/r", "--json"]],
    [() => ipc.hostStart("claude", "/r", "work", { model: "opus", effort: "high", worktree: true }), ["host", "start", "work", "--provider", "claude", "--cwd", "/r", "--model", "opus", "--effort", "high", "--worktree", "--json"]],
    [() => ipc.hostStart("codex", "/r", undefined, { effort: "low" }), ["host", "start", "--provider", "codex", "--cwd", "/r", "--effort", "low", "--json"]],
    [() => ipc.hostEnd("k"), ["host", "end", "k", "--yes"]],
    [() => ipc.hostRespawn("k", { effort: "high" }), ["host", "respawn", "k", "--effort", "high"]],
    [() => ipc.cleanupMerged(), ["sessions", "cleanup", "--yes"]],
    [() => ipc.reviewAct("k", "stage", "a b.ts", "h1"), ["diff", "k", "stage", "--file", "a b.ts", "--hunk", "h1", "--json"]],
    [() => ipc.reviewAct("k", "discard", "img.png", undefined, "f1"), ["diff", "k", "discard", "--file", "img.png", "--file-hash", "f1", "--json"]],
    [() => ipc.continueSession("k"), ["continue", "k"]],
    [() => ipc.continueSession("k", "fix lint"), ["continue", "k", "--text", "fix lint"]],
  ] as const)("%# runs the exact CLI line", async (call, args) => {
    await call();
    expect(create).toHaveBeenCalledWith("agent-switch", [...args]);
  });

  it("Create PR sends everything the confirm bound, push URL and PR repository included", async () => {
    execute.mockResolvedValue({ code: 0, stdout: JSON.stringify({ ok: true, url: "https://github.com/o/r/pull/1" }), stderr: "" });
    await ipc.prCreate("k", { branch: "feat", head: "abc", remote: "origin", ref: "refs/heads/feat", pushUrl: "git@github.com:o/r.git", repo: "o/r", base: "main", title: "T" });
    expect(create).toHaveBeenCalledWith("agent-switch", ["pr", "create", "k", "--base", "main", "--title", "T", "--expect-branch", "feat", "--expect-head", "abc", "--expect-remote", "origin", "--expect-ref", "refs/heads/feat", "--expect-push-url", "git@github.com:o/r.git", "--expect-repo", "o/r", "--yes", "--json"]);
  });

  it("a failing engine call reads as a stopped engine", async () => {
    execute.mockResolvedValue({ code: 1, stdout: "", stderr: "boom" });
    expect(await ipc.engineStatus()).toEqual({ running: false, reason: "boom", hostedRunning: 0 });
  });

  it("changes and the review carry the count of files past the cap", async () => {
    execute.mockResolvedValue({ code: 0, stdout: JSON.stringify({ files: [{ status: "M", path: "a b.ts", added: 1, removed: 0 }], more: 4 }), stderr: "" });
    expect(await ipc.sessionChanges("k")).toEqual({ files: [{ status: "M", path: "a b.ts", added: 1, removed: 0 }], more: 4 });
    execute.mockResolvedValue({ code: 0, stdout: JSON.stringify({ files: [], shared: [], base: null, baseRef: "HEAD", note: null, omitted: 0, more: 4, fingerprint: "f" }), stderr: "" });
    expect(await ipc.sessionReview("k", "uncommitted")).toMatchObject({ more: 4 });
  });

  it("needs carries its history", async () => {
    execute.mockResolvedValue({ code: 0, stdout: JSON.stringify({ items: [], away: null, history: [{ id: "1", kind: "ci", who: "w", what: "x", doneAt: "t" }] }), stderr: "" });
    expect((await ipc.listNeeds()).history).toHaveLength(1);
  });
});
