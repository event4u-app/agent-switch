import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Tauri plugin so the wrapper is testable without a Tauri backend.
const plugin = vi.hoisted(() => ({
  removeAllActive: vi.fn().mockResolvedValue(undefined),
  isPermissionGranted: vi.fn().mockResolvedValue(true),
  requestPermission: vi.fn().mockResolvedValue("granted"),
  sendNotification: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-notification", () => plugin);

import { clearDesktopNotifications } from "./notifications.js";

beforeEach(() => {
  plugin.removeAllActive.mockClear();
  plugin.removeAllActive.mockResolvedValue(undefined);
});

describe("clearDesktopNotifications", () => {
  it("removes the app's delivered OS notifications via the plugin", async () => {
    await clearDesktopNotifications();
    expect(plugin.removeAllActive).toHaveBeenCalledTimes(1);
  });

  it("is best-effort: swallows a plugin error (non-Tauri env / no permission)", async () => {
    plugin.removeAllActive.mockRejectedValueOnce(new Error("plugin unavailable"));
    await expect(clearDesktopNotifications()).resolves.toBeUndefined();
  });
});
