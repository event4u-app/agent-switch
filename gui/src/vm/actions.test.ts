import { describe, expect, it, vi } from "vitest";

const ipc = vi.hoisted(() => ({
  clearNotifications: vi.fn(async () => {}),
  CONTINUE_TEXT: "Continue where you left off.",
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

});
