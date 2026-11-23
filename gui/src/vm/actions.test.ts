import { describe, expect, it, vi } from "vitest";

const ipc = vi.hoisted(() => ({
  clearNotifications: vi.fn(async () => {}),
  continueSession: vi.fn(async (_key: string) => {}),
  CONTINUE_TEXT: "Continue where you left off.",
  extractHandoffBrief: vi.fn(async () => ({ brief: "b", briefPath: "/p" })),
  deleteSession: vi.fn(async () => ({ trashId: "t1" })),
}));
const desktop = vi.hoisted(() => ({ clearDesktopNotifications: vi.fn(async () => {}), requestDesktopPermission: vi.fn() }));
vi.mock("../ipc.js", () => ipc);
vi.mock("../notifications.js", () => desktop);

import { createActions } from "./actions.js";
import { emptyViewModel } from "./load.js";

describe("clear notifications", () => {
  it("empties the log AND the OS notification centre, like the classic window", async () => {
    const reload = vi.fn(async () => {});
    await createActions(() => emptyViewModel(1), reload).clearNotifications!();
    expect(ipc.clearNotifications).toHaveBeenCalledTimes(1);
    expect(desktop.clearDesktopNotifications).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("carry on after a limit", () => {
  const vm = () => ({
    ...emptyViewModel(1),
    sessions: [{ id: "codex:019a", accountId: "codex:side" }, { id: "claude:s1", accountId: "claude:work" }] as never,
  });

  it("Codex: the takeover that moves the session and resumes it with the continuation", () => {
    expect(createActions(vm, async () => {}).moveAndContinueArgs!("codex:019a", "codex:home")).toEqual([
      "takeover", "019a", "--to", "home", "--provider", "codex", "--from", "side", "--prompt", "Continue where you left off.",
    ]);
  });

  it("continueSession types into the hosted session, and reports false when it is not hosted", async () => {
    const a = createActions(vm, async () => {});
    expect(await a.continueSession!("claude:s1")).toBe(true);
    expect(ipc.continueSession).toHaveBeenCalledWith("claude/work/s1");
    ipc.continueSession.mockRejectedValueOnce(new Error("not hosted"));
    expect(await a.continueSession!("claude:s1")).toBe(false);
  });
});

describe("a session the 2.11 list does not hold (Codex in the v3 window)", () => {
  const codex = { id: "codex:019a", accountId: "codex:side", tool: "codex" } as never;

  it("hand-off and trash act on the session the sheet was given", async () => {
    const a = createActions(() => emptyViewModel(1), async () => {});
    await a.handoffBrief!("codex:019a", "claude:work", codex);
    expect(ipc.extractHandoffBrief).toHaveBeenCalledWith("codex", "side", "019a", "claude");
    await a.trashSession!("codex:019a", codex);
    expect(ipc.deleteSession).toHaveBeenCalledWith("codex", "019a", "side");
    await expect(a.handoffBrief!("codex:019a", "claude:work")).rejects.toThrow(/Unknown session/);
  });
});
