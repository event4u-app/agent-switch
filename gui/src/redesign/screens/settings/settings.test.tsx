import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PET_WELCOME } from "../../../pet/model.js";
import { AcRoot } from "../../../ui/AcRoot.js";
import type { Actions } from "../../../vm/actions.js";
import { emptyViewModel } from "../../../vm/load.js";
import { ASProvider, useAS, type SettingsTab } from "../../../vm/store.js";
import type { Account, ViewModel } from "../../../vm/types.js";
import {
  protectionThresholds,
  providersToDisable,
  scopeTags,
  suggestedPoolTags,
  uninstallArmed,
} from "./prefs.js";
import { readStarAsk, REDDIT_POST_URL, REPO_URL } from "../../../star-ask.js";
import { providerRows } from "./providers.js";
import { Settings, SETTINGS_GROUPS } from "./Settings.js";

const nearLimit = vi.hoisted(() => ({ fireNearLimitIfCrossed: vi.fn(async () => false) }));
vi.mock("../../engines/near-limit.js", () => nearLimit);
const shell = vi.hoisted(() => ({ open: vi.fn((_url: string) => Promise.resolve()) }));
vi.mock("@tauri-apps/plugin-shell", () => shell);

const ipcMock = vi.hoisted(() => ({
  getAutoSwitch: vi.fn(),
  setAutoSwitch: vi.fn(),
  getOsNotify: vi.fn(),
  setOsNotify: vi.fn(),
  getKeepSignedIn: vi.fn(),
  setKeepSignedIn: vi.fn(),
  getNotifyConfig: vi.fn(),
  setNotify: vi.fn(),
  installSessionHooks: vi.fn(),
  uninstallSessionHooks: vi.fn(),
  setMinimizeToDock: vi.fn(),
  petShow: vi.fn(),
  petHide: vi.fn(),
  createPool: vi.fn(),
  addPoolMember: vi.fn(),
}));

vi.mock("../../../ipc.js", async (orig) => ({ ...(await orig<typeof import("../../../ipc.js")>()), ...ipcMock }));
vi.mock("../../../notifications.js", async (orig) => ({
  ...(await orig<typeof import("../../../notifications.js")>()),
  desktopPermission: () => Promise.resolve("granted"),
  requestDesktopPermission: () => Promise.resolve("granted"),
}));

const NOW = 1_800_000_000_000;

function acc(name: string, over: Partial<Account> = {}): Account {
  return {
    id: `claude:${name}`,
    tool: "claude",
    name,
    identity: null,
    plan: null,
    label: null,
    color: "blue",
    isDefault: false,
    state: "ready",
    windows: [],
    checkedAt: NOW,
    resetCredits: null,
    threshold: 98,
    protection: { enabled: true, thresholdPct: 98 },
    auth: null,
    surfaces: [],
    liveSessions: 0,
    pools: [],
    ...over,
  };
}

function fixture(over: Partial<ViewModel> = {}): ViewModel {
  return {
    ...emptyViewModel(NOW),
    platform: "mac",
    readiness: "ready",
    accounts: [acc("work", { label: "Work" }), acc("side", { label: "Work" })],
    guard: { policy: "warn", loaded: [] },
    autostart: { desired: null, actual: "enabled" },
    providers: [
      { id: "claude", installed: true, binaryPath: null, binName: "claude", cli: true, gui: false },
      { id: "antigravity", installed: false, binaryPath: null, binName: "agy", cli: false, gui: false },
    ],
    ...over,
  };
}

function Where() {
  const s = useAS();
  return <p data-testid="where">{`${s.screen}/${s.settingsTab}/${s.accountsTab}`}</p>;
}

function mount(tab: SettingsTab, act: Actions = {}, vm: ViewModel = fixture()) {
  return render(
    <AcRoot>
      <ASProvider initial={vm} startScreen="settings" startSettingsTab={tab} actions={() => act}>
        <Settings />
        <Where />
      </ASProvider>
    </AcRoot>,
  );
}

// jsdom's localStorage is an unreliable stub here (see settings-store.test.ts):
// install a hermetic in-memory Storage per test.
beforeEach(() => {
  const map = new Map<string, string>();
  const mem: Pick<Storage, "getItem" | "setItem" | "removeItem" | "clear"> = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  };
  Object.defineProperty(globalThis, "localStorage", { value: mem, configurable: true });
  ipcMock.getAutoSwitch.mockResolvedValue({
    claude: { enabled: true, threshold: 90, tag: "all" },
    codex: { enabled: false, threshold: 90, tag: "all" },
    antigravity: { enabled: false, threshold: 90, tag: "all" },
  });
  ipcMock.setAutoSwitch.mockResolvedValue(undefined);
  ipcMock.getOsNotify.mockResolvedValue(false);
  ipcMock.setOsNotify.mockResolvedValue(undefined);
  ipcMock.getKeepSignedIn.mockResolvedValue(true);
  ipcMock.setKeepSignedIn.mockResolvedValue(undefined);
  ipcMock.getNotifyConfig.mockResolvedValue({ notify: true, contextThresholds: [80, 95] });
  ipcMock.installSessionHooks.mockResolvedValue(undefined);
  ipcMock.uninstallSessionHooks.mockResolvedValue(undefined);
  ipcMock.setMinimizeToDock.mockResolvedValue(undefined);
  ipcMock.petShow.mockResolvedValue(false);
  ipcMock.petHide.mockResolvedValue(undefined);
  ipcMock.createPool.mockResolvedValue({ id: "work", label: "Work", members: [] });
  ipcMock.addPoolMember.mockResolvedValue({ id: "work", label: "Work", members: [] });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("settings logic", () => {
  it("offers the design thresholds plus a custom current one", () => {
    expect(protectionThresholds(98)).toEqual([95, 98, 99]);
    expect(protectionThresholds(90)).toEqual([90, 95, 98, 99]);
    expect(protectionThresholds(null)).toEqual([95, 98, 99]);
  });

  it("scopes suggestions only with 2+ accounts and a tag", () => {
    expect(scopeTags([acc("a", { label: "Work" }), acc("b")], "claude")).toEqual(["all", "Work"]);
    expect(scopeTags([acc("a", { label: "Work" })], "claude")).toBeNull();
    expect(scopeTags([acc("a"), acc("b")], "claude")).toBeNull();
  });

  it("turns off only the providers that are on", () => {
    expect(
      providersToDisable({
        claude: { enabled: true, threshold: 90, tag: "all" },
        codex: { enabled: false, threshold: 90, tag: "all" },
        antigravity: { enabled: true, threshold: 90, tag: "all" },
      }),
    ).toEqual(["claude", "antigravity"]);
    expect(providersToDisable(null)).toEqual([]);
  });

  it("suggests a pool per tag with 2+ accounts and no pool of that name", () => {
    const accounts = [acc("a", { label: "Work" }), acc("b", { label: "Work" }), acc("c", { label: "Personal" })];
    expect(suggestedPoolTags(accounts, [])).toEqual(["Work"]);
    expect(suggestedPoolTags(accounts, [{ id: "w", label: "work", accountIds: [] }])).toEqual([]);
  });

  it("arms uninstall only on the typed word", () => {
    expect(uninstallArmed(" Uninstall ")).toBe(true);
    expect(uninstallArmed("uninstal")).toBe(false);
  });

  it("lists Gemini as planned when the backend lacks it", () => {
    const rows = providerRows([{ id: "claude", installed: true, binaryPath: null, binName: "claude", cli: true, gui: false }]);
    expect(rows.map((r) => [r.id, !!r.planned])).toEqual([
      ["claude", false],
      ["gemini", true],
    ]);
  });
});

describe("Settings shell", () => {
  it("shows the title and the nine groups and switches between them", () => {
    mount("general");
    expect(screen.getByRole("heading", { name: "How should it behave?" })).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "Settings groups" });
    expect(nav.querySelectorAll("button")).toHaveLength(9);
    expect(SETTINGS_GROUPS.map((g) => g.label)).toEqual([
      "General",
      "Sign-ins",
      "Protection",
      "Distribution",
      "Notifications",
      "Desktop pet",
      "Providers",
      "Updates",
      "Advanced",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    expect(screen.getByTestId("where").textContent).toBe("settings/advanced/accounts");
    expect(screen.getByText("Same account in two places")).toBeTruthy();
  });
});

describe("General", () => {
  it("persists hide summaries and marks a confirmed login item", () => {
    const setAutostart = vi.fn(() => Promise.resolve());
    mount("general", { setAutostart });
    expect(screen.getByText("Checked")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Hide session summaries" }));
    expect(screen.getByRole("switch", { name: "Hide session summaries" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("switch", { name: "Start at login" }));
    expect(setAutostart).toHaveBeenCalledWith(false);
    expect((screen.getByRole("switch", { name: "Open the window on start" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("the Start at login switch follows the system state when the store updates", () => {
    let store: ReturnType<typeof useAS> | null = null;
    function Grab() {
      store = useAS();
      return null;
    }
    render(
      <AcRoot>
        <ASProvider initial={fixture()} startScreen="settings" startSettingsTab="general">
          <Settings />
          <Grab />
        </ASProvider>
      </AcRoot>,
    );
    const sw = () => screen.getByRole("switch", { name: "Start at login" });
    expect(sw().getAttribute("aria-checked")).toBe("true");
    act(() => store!.update({ autostart: { desired: null, actual: "disabled" } }));
    expect(sw().getAttribute("aria-checked")).toBe("false");
    act(() => store!.update({ autostart: { desired: null, actual: "enabled" } }));
    expect(sw().getAttribute("aria-checked")).toBe("true");
  });

  it("offers star, Reddit vote and sharing; a star there also stops the Overview ask", () => {
    shell.open.mockClear();
    mount("general");
    fireEvent.click(screen.getByRole("button", { name: "Open the Reddit post" }));
    expect(shell.open).toHaveBeenCalledWith(REDDIT_POST_URL);
    fireEvent.click(screen.getByRole("button", { name: "LinkedIn" }));
    expect(shell.open.mock.calls.at(-1)?.[0]).toContain("linkedin.com");
    expect(readStarAsk(Date.now()).stopped).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Star" }));
    expect(shell.open).toHaveBeenCalledWith(REPO_URL);
    expect(readStarAsk(Date.now()).stopped).toBe("starred");
  });

  it("pushes minimize-into-Dock to Rust", () => {
    mount("general");
    fireEvent.click(screen.getByRole("switch", { name: "Minimize into Dock" }));
    expect(ipcMock.setMinimizeToDock).toHaveBeenCalledWith(true);
  });
});

describe("Sign-ins", () => {
  it("reads Keep accounts signed in from the CLI and writes a change back", async () => {
    mount("sign-ins");
    const sw = () => screen.getByRole("switch", { name: "Keep accounts signed in" }) as HTMLButtonElement;
    await waitFor(() => expect(sw().getAttribute("aria-checked")).toBe("true"));
    expect(sw().disabled).toBe(false);
    fireEvent.click(sw());
    await waitFor(() => expect(ipcMock.setKeepSignedIn).toHaveBeenCalledWith(false));
    expect(sw().getAttribute("aria-checked")).toBe("false");
    // Only the reminder is still unavailable; Codex and Antigravity are named as not covered.
    expect(screen.getAllByTestId("unavailable-reason")).toHaveLength(1);
    expect(screen.getByText(/Codex and Antigravity/)).toBeTruthy();
    expect(screen.getByText("What Agent Switch can't prevent")).toBeTruthy();
  });

  it("turns the switch back when the write fails", async () => {
    ipcMock.setKeepSignedIn.mockRejectedValueOnce(new Error("cli failed"));
    mount("sign-ins");
    const sw = () => screen.getByRole("switch", { name: "Keep accounts signed in" }) as HTMLButtonElement;
    await waitFor(() => expect(sw().getAttribute("aria-checked")).toBe("true"));
    fireEvent.click(sw());
    await waitFor(() => expect(sw().getAttribute("aria-checked")).toBe("true"));
    expect(ipcMock.setKeepSignedIn).toHaveBeenCalledWith(false);
  });
});

describe("Protection", () => {
  it("writes per-account protection and near-limit notifications", async () => {
    localStorage.setItem("agent-switch-autoswitch-global", "on");
    const setProtection = vi.fn(() => Promise.resolve());
    mount("protection", { setProtection });
    fireEvent.click(screen.getByRole("switch", { name: "Protect Claude · work" }));
    await waitFor(() => expect(setProtection).toHaveBeenCalledWith("claude:work", { enabled: false }));
    expect((screen.getByRole("switch", { name: "Protect new accounts" }) as HTMLButtonElement).disabled).toBe(true);
    const perTool = await screen.findByRole("switch", { name: "Notify near limit for Claude" });
    expect(perTool.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("switch", { name: "Notify near limit" }));
    await waitFor(() => expect(ipcMock.setAutoSwitch).toHaveBeenCalledWith("claude", false));
    expect(localStorage.getItem("agent-switch-autoswitch-global")).toBe("off");
  });

  it("fires the near-limit test notice only when the threshold write succeeded", async () => {
    localStorage.setItem("agent-switch-autoswitch-global", "on");
    mount("protection");
    const pick = async (value: string) => {
      fireEvent.click(await screen.findByRole("combobox", { name: "Near-limit notify threshold for Claude" }));
      fireEvent.click(screen.getByRole("option", { name: value }));
    };
    ipcMock.setAutoSwitch.mockRejectedValueOnce(new Error("nope"));
    await pick("80%");
    await waitFor(() => expect(ipcMock.setAutoSwitch).toHaveBeenCalledWith("claude", true, 80, "all"));
    await new Promise((r) => setTimeout(r, 0));
    expect(nearLimit.fireNearLimitIfCrossed).not.toHaveBeenCalled();
    ipcMock.setAutoSwitch.mockResolvedValueOnce(undefined);
    await pick("80%");
    await waitFor(() => expect(nearLimit.fireNearLimitIfCrossed).toHaveBeenCalledTimes(1));
  });

  it("describes Protect new accounts as the warning it is, not a pause", () => {
    mount("protection");
    expect(screen.queryByText(/Sessions pause at a safe point/)).toBeNull();
  });

  it("shows the values in force on its disabled controls", () => {
    mount("protection");
    // New accounts are protected by default (DEFAULT_PROTECTION, 98 %).
    expect(screen.getByRole("switch", { name: "Protect new accounts" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByText(/the CLI has no default for new accounts/)).toBeNull();
    // Unknown usage: no option is in force today, and the text says what happens instead.
    expect(screen.getAllByText(/no warning is sent while usage is unknown/).length).toBeGreaterThan(0);
    // No choice offered while no option is in force.
    expect(screen.queryByRole("radiogroup", { name: "When usage is unknown" })).toBeNull();
  });
});

describe("Distribution", () => {
  it("creates a suggested pool from tagged accounts", async () => {
    mount("distribution");
    fireEvent.click(screen.getByRole("button", { name: "Create pool" }));
    await waitFor(() => expect(ipcMock.addPoolMember).toHaveBeenCalledTimes(2));
    expect(ipcMock.createPool).toHaveBeenCalledWith("Work");
    fireEvent.click(screen.getByRole("button", { name: "Projects & pools" }));
    expect(screen.getByTestId("where").textContent).toBe("accounts/distribution/projects");
  });
});

describe("Notifications", () => {
  it("installs session hooks and reads context thresholds", async () => {
    mount("notifications");
    expect(await screen.findByText("A session's context window passing a threshold (80 %, 95 %).")).toBeTruthy();
    const mon = screen.getByRole("switch", { name: "Monitor Claude sessions" });
    fireEvent.click(mon);
    expect(ipcMock[mon.getAttribute("aria-checked") === "true" ? "installSessionHooks" : "uninstallSessionHooks"]).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("switch", { name: "Desktop notifications" }));
    await waitFor(() => expect(ipcMock.setOsNotify).toHaveBeenCalledWith(true));
  });
});

describe("Desktop pet", () => {
  it("shows the intro text verbatim and the pet grid", () => {
    mount("pet");
    expect(screen.getByText(PET_WELCOME)).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Pet" }).querySelectorAll('[role="radio"]')).toHaveLength(8);
    expect(screen.getByTitle("Agent 007 Switch")).toBeTruthy();
    fireEvent.click(screen.getByTitle("The CEO"));
    expect(screen.getByTitle("The CEO").getAttribute("aria-checked")).toBe("true");
  });
});

describe("Advanced", () => {
  it("sets the guard and gates uninstall behind the typed word", async () => {
    const setGuard = vi.fn(() => Promise.resolve());
    const uninstall = vi.fn(() => Promise.resolve());
    const quit = vi.fn(() => Promise.resolve());
    mount("advanced", { setGuard, uninstall, quit });
    fireEvent.click(screen.getByRole("radio", { name: "Block" }));
    await waitFor(() => expect(setGuard).toHaveBeenCalledWith("block"));
    expect((screen.getByRole("button", { name: "Export" }) as HTMLButtonElement).disabled).toBe(true);
    const go = screen.getByRole("button", { name: /Uninstall Agent Switch/ }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("uninstall"), { target: { value: "uninstall" } });
    expect(go.disabled).toBe(false);
    fireEvent.click(go);
    await waitFor(() => expect(quit).toHaveBeenCalled());
    expect(uninstall).toHaveBeenCalled();
  });
});
