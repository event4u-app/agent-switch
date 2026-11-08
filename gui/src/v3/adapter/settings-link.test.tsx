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
  getLinkExecutor: vi.fn(),
  setLinkExecutor: vi.fn(),
  getCodexAutoReset: vi.fn(),
  setCodexAutoReset: vi.fn(),
  getPaceSuggest: vi.fn(),
  setPaceSuggest: vi.fn(),
}));
vi.mock("../../ipc.js", async (orig) => ({ ...(await orig<typeof import("../../ipc.js")>()), ...ipcMock }));

beforeEach(() => {
  ipcMock.getAutoSwitch.mockResolvedValue({});
  ipcMock.getStrategy.mockResolvedValue("balance");
  ipcMock.getCodexAutoReset.mockResolvedValue(false);
  ipcMock.setLinkAutoConnect.mockResolvedValue(undefined);
  ipcMock.getLinkExecutor.mockResolvedValue("app");
  ipcMock.setLinkExecutor.mockResolvedValue(undefined);
  ipcMock.getPaceSuggest.mockResolvedValue(true);
  ipcMock.setPaceSuggest.mockResolvedValue(undefined);
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

describe("v3 settings › Protection: Let the background service carry out moves", () => {
  const executor = () => screen.getByRole("switch", { name: "Let the background service carry out moves" }) as HTMLButtonElement;

  it("is off by default, names what can go wrong, and writes `service` on", async () => {
    ipcMock.getLinkAutoConnect.mockResolvedValue(true);
    mount();
    await waitFor(() => expect(executor().disabled).toBe(false));
    expect(executor().getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText(/can stop/i)).toBeTruthy();
    fireEvent.click(executor());
    await waitFor(() => expect(ipcMock.setLinkExecutor).toHaveBeenCalledWith("service"));
    expect(executor().getAttribute("aria-checked")).toBe("true");
  });

  it("shows on when the service was chosen in a terminal, and writes `app` back", async () => {
    ipcMock.getLinkAutoConnect.mockResolvedValue(true);
    ipcMock.getLinkExecutor.mockResolvedValue("service");
    mount();
    await waitFor(() => expect(executor().getAttribute("aria-checked")).toBe("true"));
    fireEvent.click(executor());
    await waitFor(() => expect(ipcMock.setLinkExecutor).toHaveBeenCalledWith("app"));
  });

  it("stays disabled rather than guessing when the CLI cannot be read", async () => {
    ipcMock.getLinkAutoConnect.mockResolvedValue(true);
    ipcMock.getLinkExecutor.mockRejectedValue(new Error("no cli"));
    mount();
    await waitFor(() => expect(ipcMock.getLinkExecutor).toHaveBeenCalled());
    expect(executor().disabled).toBe(true);
  });
});

describe("v3 settings › Protection: pace suggestions", () => {
  it("shows the CLI's value (on by default) and writes a change back", async () => {
    ipcMock.getLinkAutoConnect.mockResolvedValue(true);
    mount();
    const sw = () => screen.getByRole("switch", { name: "Suggest a switch when accounts run at different paces" }) as HTMLButtonElement;
    await waitFor(() => expect(sw().disabled).toBe(false));
    expect(sw().getAttribute("aria-checked")).toBe("true");
    fireEvent.click(sw());
    await waitFor(() => expect(ipcMock.setPaceSuggest).toHaveBeenCalledWith(false));
    expect(sw().getAttribute("aria-checked")).toBe("false");
  });
});
