import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AcRoot } from "../../ui/AcRoot.js";
import { emptyViewModel } from "../../vm/load.js";
import { ASProvider } from "../../vm/store.js";
import { settingsSection } from "./slots.js";

const ipcMock = vi.hoisted(() => ({
  getAutoSwitch: vi.fn(),
  setAutoSwitch: vi.fn(),
  getStrategy: vi.fn(),
  setStrategy: vi.fn(),
  getLinkAutoConnect: vi.fn(),
  setLinkAutoConnect: vi.fn(),
  getCodexAutoReset: vi.fn(),
  setCodexAutoReset: vi.fn(),
}));
vi.mock("../../ipc.js", async (orig) => ({ ...(await orig<typeof import("../../ipc.js")>()), ...ipcMock }));

beforeEach(() => {
  ipcMock.getAutoSwitch.mockResolvedValue({});
  ipcMock.getStrategy.mockResolvedValue("balance");
  ipcMock.getCodexAutoReset.mockResolvedValue(false);
  ipcMock.setLinkAutoConnect.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function mount() {
  render(
    <AcRoot>
      <ASProvider initial={emptyViewModel()} actions={() => ({})}>
        {settingsSection("Protection")}
      </ASProvider>
    </AcRoot>,
  );
  return () => screen.getByRole("switch", { name: "Let agent-config connect" }) as HTMLButtonElement;
}

describe("v3 settings › Protection: Let agent-config connect", () => {
  it("shows the CLI's value and writes a change back", async () => {
    ipcMock.getLinkAutoConnect.mockResolvedValue(true);
    const sw = mount();
    await waitFor(() => expect(sw().disabled).toBe(false));
    expect(sw().getAttribute("aria-checked")).toBe("true");
    fireEvent.click(sw());
    await waitFor(() => expect(ipcMock.setLinkAutoConnect).toHaveBeenCalledWith(false));
    expect(sw().getAttribute("aria-checked")).toBe("false");
  });

  it("shows off when the link was turned off in a terminal", async () => {
    ipcMock.getLinkAutoConnect.mockResolvedValue(false);
    const sw = mount();
    await waitFor(() => expect(sw().disabled).toBe(false));
    expect(sw().getAttribute("aria-checked")).toBe("false");
  });

  it("stays disabled rather than guessing when the CLI cannot be read", async () => {
    ipcMock.getLinkAutoConnect.mockRejectedValue(new Error("no cli"));
    const sw = mount();
    await waitFor(() => expect(ipcMock.getLinkAutoConnect).toHaveBeenCalled());
    expect(sw().disabled).toBe(true);
  });
});
