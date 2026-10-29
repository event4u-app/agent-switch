import { describe, expect, it, vi } from "vitest";

const ipc = vi.hoisted(() => ({ clearNotifications: vi.fn(async () => {}) }));
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
