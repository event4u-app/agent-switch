import { describe, it, expect, vi, beforeEach } from "vitest";

const { create, execute, label } = vi.hoisted(() => {
  const execute = vi.fn(async () => ({ code: 0, stdout: "", stderr: "" }));
  const create = vi.fn(() => ({ execute }));
  return { create, execute, label: { value: "main" } };
});
vi.mock("@tauri-apps/plugin-shell", () => ({ Command: { create } }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ getCurrentWebviewWindow: () => ({ label: label.value }) }));

import { reportVisibility } from "./ipc.js";

describe("reportVisibility", () => {
  beforeEach(() => {
    create.mockClear();
    execute.mockClear();
  });

  it("reports the main window's visibility to the CLI", async () => {
    label.value = "main";
    await reportVisibility(false);
    expect(create).toHaveBeenCalledWith("agent-switch", ["app-visibility", "hidden"]);
  });

  it.each(["tray", "pet"])("stays silent in the %s window, whose capability has no agent-switch entry", async (w) => {
    label.value = w;
    await reportVisibility(true);
    expect(create).not.toHaveBeenCalled();
  });
});
