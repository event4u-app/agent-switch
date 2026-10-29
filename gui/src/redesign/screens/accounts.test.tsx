vi.mock("@tauri-apps/api/path", () => ({ homeDir: async () => "/Users/x" }));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AcRoot } from "../../ui/AcRoot.js";
import type { Actions } from "../../vm/actions.js";
import { emptyViewModel } from "../../vm/load.js";
import { ASProvider, useAS, type AccountsTab, type Overlay, type Screen, type Store } from "../../vm/store.js";
import type { Account, ViewModel } from "../../vm/types.js";
import { OverlayHost, ScreenHost } from "../Hosts.js";
import { accountMenu } from "./account-actions.js";
import { setLoginBrowser } from "../../settings-store.js";
import { installMemoryStorage } from "../engines/test-storage.js";

// xterm needs a canvas; the pty is Tauri. The fake terminal exits with
// `exitCode` right away and records what it was asked to run.
const term = vi.hoisted(() => ({ ran: [] as string[][], exitCode: 0 as number | null }));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    rows = 24;
    cols = 80;
    loadAddon() {}
    open() {}
    focus() {}
    onData() {}
    write() {}
    dispose() {}
  },
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
vi.mock("../../terminal.js", async (orig) => ({
  ...(await orig<typeof import("../../terminal.js")>()),
  attachTerminal: (_t: unknown, _b: unknown, args: string[], onExit: (c: number | null) => void) => {
    term.ran.push(args);
    setTimeout(() => onExit(term.exitCode), 0);
    return { resize() {}, dispose: async () => {} };
  },
}));
const ipcMock = vi.hoisted(() => ({
  profiles: [] as { provider: string; name: string; identity: string | null; label: null; active: boolean; liveSessions: number }[],
  history: [] as { profile: string; samples: { at: string; windows: { key: string; utilization: number }[] }[] }[],
  browsers: [] as { id: string; name: string }[],
  plain: null as null | { profile: string | null; configDir: string | null; why: string[] },
}));
vi.mock("../../ipc.js", async (orig) => ({
  ...(await orig<typeof import("../../ipc.js")>()),
  listProfiles: async () => ipcMock.profiles,
  usageHistory: async () => ipcMock.history,
  listBrowsers: async () => ipcMock.browsers,
  resolvePlainStart: async () => {
    if (!ipcMock.plain) throw new Error("no answer");
    return ipcMock.plain;
  },
}));
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
  },
);

const NOW = 1_800_000_000_000;

function acc(name: string, over: Partial<Account> = {}): Account {
  return {
    id: `claude:${name}`,
    tool: "claude",
    name,
    identity: `${name}@example.test`,
    plan: null,
    label: null,
    color: "blue",
    isDefault: false,
    state: "ready",
    windows: [{ key: "seven_day", label: "Week", utilization: 40, resetsAt: null }],
    checkedAt: NOW - 60_000,
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
    accounts: [
      acc("work", { isDefault: true, liveSessions: 1, label: "Work", pools: ["clients"] }),
      acc("side", { windows: [{ key: "seven_day", label: "Week", utilization: 10, resetsAt: null }], protection: null }),
      acc("personal", { identity: null, state: "signed-out", windows: [] }),
    ],
    pools: [{ id: "clients", label: "Clients", accountIds: ["claude:work"] }],
    providers: [
      { id: "claude", installed: true, binaryPath: null, binName: "claude", cli: true, gui: false },
      { id: "codex", installed: true, binaryPath: null, binName: "codex", cli: true, gui: false },
    ],
    ...over,
  };
}

let store: Store | null = null;
function Spy() {
  store = useAS();
  return <p data-testid="where">{`${store.screen}/${store.overlay.kind}`}</p>;
}

function mount(vm: ViewModel, opts: { screen?: Screen; overlay?: Overlay; act?: Actions; tab?: AccountsTab } = {}) {
  return render(
    <AcRoot>
      <ASProvider
        initial={vm}
        startScreen={opts.screen ?? "accounts"}
        startOverlay={opts.overlay}
        startAccountsTab={opts.tab}
        actions={opts.act ? () => opts.act! : undefined}
      >
        <ScreenHost />
        <OverlayHost />
        <Spy />
      </ASProvider>
    </AcRoot>,
  );
}

beforeEach(() => {
  term.ran = [];
  term.exitCode = 0;
  ipcMock.profiles = [];
  ipcMock.history = [];
  ipcMock.browsers = [];
  ipcMock.plain = null;
  installMemoryStorage();
  document.body.style.pointerEvents = ""; // a stuck lock must not leak into the next test
});
afterEach(cleanup);

describe("Accounts", () => {
  it("ranks accounts per provider with their badges and states", () => {
    mount(fixture());
    expect(screen.getByText("Who is signed in where?")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Accounts 3" })).toBeTruthy();
    expect(screen.getByText("#1")).toBeTruthy();
    expect(screen.getByText("Default")).toBeTruthy();
    expect(screen.getByText("Next in Clients")).toBeTruthy();
    expect(screen.getByText("Not signed in yet")).toBeTruthy();
    expect(screen.getByText("No usage before the first sign-in")).toBeTruthy();
    expect(screen.getByTitle("Session protection not read").textContent).toBe("—");
    expect(screen.getByText("No Codex accounts yet.")).toBeTruthy();
    expect(screen.queryByText(/No Gemini accounts/)).toBeNull();
  });

  it("uses an account for plain starts and signs a signed-out one in", () => {
    const setDefault = vi.fn(() => Promise.resolve());
    mount(fixture(), { act: { setDefault } });
    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    expect(setDefault).toHaveBeenCalledWith("claude:side");
    expect(store!.accounts.find((a) => a.id === "claude:side")!.isDefault).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Sign in/ }));
    expect(screen.getByTestId("where").textContent).toBe("accounts/reauth");
  });

  it("shows the account agent-switch would balance a plain start onto, and why", async () => {
    ipcMock.plain = {
      profile: "claude/side",
      configDir: "/x",
      why: ["No folder rule — balancing across 3 claude accounts by what each would lose at its reset", "Picked claude/side: 60% of the week left, resets in 10 h (6.0 %/h to use it up) · usage checked 1 min ago"],
    };
    mount(fixture());
    const box = await screen.findByRole("note", { name: /^A plain `claude` outside a folder rule starts on side/ });
    expect(within(box).getByText("side")).toBeTruthy();
    expect(within(box).getByText("60% of the week left, resets in 10 h")).toBeTruthy();
    expect(box.getAttribute("title")).toContain("Picked claude/side");
  });

  it("says per tool which account a plain start uses outside folder rules", () => {
    mount(fixture());
    const def = store!.accounts.find((a) => a.tool === "claude" && a.isDefault);
    const box = screen.getByRole("note", { name: /^A plain `claude` outside a folder rule starts on/ });
    expect(within(box).getByText(def ? def.name : "your original Claude login")).toBeTruthy();
  });

  it("lists the accounts A–Z (ignoring case) when asked, without ranks", () => {
    const vm = fixture();
    vm.accounts = vm.accounts.map((a) => (a.name === "side" ? { ...a, name: "Side" } : a));
    mount(vm);
    fireEvent.click(screen.getByRole("radio", { name: "A–Z" }));
    expect(screen.queryByText("#1")).toBeNull();
    const rows = Array.from(document.querySelectorAll("[data-account-row]"));
    const names = rows.map((r) => within(r as HTMLElement).getByText(/^(work|Side|personal)$/).textContent);
    expect(names).toEqual(["personal", "Side", "work"]);
  });

  it("builds the row menu from what the account and backend allow", () => {
    mount(fixture());
    const work = accountMenu(store!.accounts[0], store!);
    expect(work.map((i) => i.id)).toEqual(["term", "off", "reset", "refresh", "details", "signin", "rename", "disable", "remove"]);
    expect(work.find((i) => i.id === "reset")!.disabled).toBe(true);
    const out = accountMenu(store!.accounts[2], store!);
    expect(out.find((i) => i.id === "term")!.disabled).toBe(true);
    expect(out.find((i) => i.id === "signin")!.label).toBe("Sign in");
    const codex = accountMenu(acc("c", { tool: "codex", id: "codex:c", resetCredits: 2 }), store!);
    expect(codex.find((i) => i.id === "reset")).toMatchObject({ label: "Redeem a reset credit", hint: "2 left", disabled: false });
  });

  it("refreshes one account's usage from its row menu, and not a signed-out one", async () => {
    const refreshAccountUsage = vi.fn(() => Promise.resolve());
    mount(fixture(), { act: { refreshAccountUsage } });
    const item = accountMenu(store!.accounts[0], store!).find((i) => i.id === "refresh")!;
    expect(item).toMatchObject({ label: "Refresh usage", disabled: false });
    await act(async () => item.onSelect!());
    expect(refreshAccountUsage).toHaveBeenCalledWith("claude:work");
    expect(screen.getByTestId("where").textContent).toBe("accounts/none"); // no flyout
    await waitFor(() => expect(store!.toasts.map((t) => t.text)).toContain("work: usage refreshed."));
    const out = accountMenu(store!.accounts[2], store!).find((i) => i.id === "refresh")!;
    expect(out.disabled).toBe(true);
    expect(out.hint).toBe("sign in first");
  });

  it("a click on Refresh usage in the row menu refreshes that account without opening its flyout", async () => {
    const refreshAccountUsage = vi.fn(() => Promise.resolve());
    mount(fixture(), { act: { refreshAccountUsage } });
    fireEvent.keyDown(screen.getByRole("button", { name: "More for work" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Refresh usage/ }));
    await waitFor(() => expect(refreshAccountUsage).toHaveBeenCalledWith("claude:work"));
    expect(screen.getByTestId("where").textContent).toBe("accounts/none");
  });

  it("confirms before removing or redeeming", () => {
    const removeAccount = vi.fn(() => Promise.resolve());
    const redeemReset = vi.fn(() => Promise.resolve());
    mount(fixture(), { act: { removeAccount, redeemReset } });
    act(() => accountMenu(store!.accounts[1], store!).find((i) => i.id === "remove")!.onSelect!());
    expect(screen.getByText("Remove Claude · side?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove account" }));
    expect(removeAccount).toHaveBeenCalledWith("claude:side");
    act(() => accountMenu(acc("c", { tool: "codex", id: "codex:c", resetCredits: 1 }), store!).find((i) => i.id === "reset")!.onSelect!());
    expect(screen.getByText(/Credits can't be given back/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Redeem one" }));
    expect(redeemReset).toHaveBeenCalledWith("codex:c");
  });
});

describe("Accounts — every usage window", () => {
  it("shows each window of an account (5 h, week, model) under each other, not only the fullest", () => {
    const windows = [
      { key: "five_hour", label: "5h", utilization: 72, resetsAt: new Date(NOW + 2 * 3_600_000).toISOString() },
      { key: "seven_day", label: "Week", utilization: 31, resetsAt: new Date(NOW + 3 * 86_400_000).toISOString() },
      { key: "seven_day_opus", label: "Opus", utilization: 5, resetsAt: null },
    ];
    mount(fixture({ accounts: [acc("work", { windows, checkedAt: NOW })] }));
    const row = document.querySelector("[data-account-row]") as HTMLElement;
    expect(within(row).getByText("checked just now")).toBeTruthy();
    const meters = within(row).getAllByRole("meter");
    expect(meters.map((m) => m.getAttribute("aria-label"))).toEqual(["5h window used", "Week window used", "Opus window used"]);
    expect(meters.map((m) => m.getAttribute("aria-valuenow"))).toEqual(["72", "31", "5"]);
    expect(within(row).getByText("↻ 2h 0m")).toBeTruthy();
  });
});

describe("Usage history", () => {
  it("charts accounts with a readout and names the ones without", async () => {
    ipcMock.history = [{ profile: "work", samples: [{ at: new Date(NOW - 3_600_000).toISOString(), windows: [{ key: "seven_day", utilization: 62 }] }] }];
    mount(fixture(), { tab: "history" });
    expect(screen.getByText("side")).toBeTruthy();
    await screen.findByRole("img", { name: "Week window, peak use per day, last 30 days" });
    expect(screen.getByText("62%")).toBeTruthy();
    expect(screen.getByText(/No readout for side, personal/)).toBeTruthy();
    expect(screen.getByText(/refreshed 1 min ago/)).toBeTruthy();
  });

  it("shows the empty state without history", () => {
    mount(fixture(), { tab: "history" });
    expect(screen.getByText(/No history yet/)).toBeTruthy();
  });
});

describe("Projects & pools", () => {
  it("explains a folder through the CLI and lists bindings and pools", async () => {
    const explainFolder = vi.fn(async () => ({ profile: "claude/side", configDir: null, why: ["mapped: ~/dev/a → side"] }));
    mount(
      fixture({
        sessions: [],
        rules: [{ id: "r1", match: { kind: "folder", value: "~/dev/a" }, tool: "claude", target: { kind: "account", accountId: "claude:side" }, enabled: true, hits: null }],
      }),
      { tab: "projects", act: { explainFolder } },
    );
    expect(screen.getByText(/No folder to try yet/)).toBeTruthy();
    expect(screen.getByText("~/dev/a")).toBeTruthy();
    expect(screen.getByText("(Claude only)")).toBeTruthy();
    expect(screen.getByText("Clients")).toBeTruthy();
    cleanup();
    mount(fixture({ sessions: [{ ...sessionAt("/Users/x/dev/a") }] }), { tab: "projects", act: { explainFolder } });
    await screen.findByText("mapped: ~/dev/a → side", { exact: false });
    expect(explainFolder).toHaveBeenCalledWith("/Users/x/dev/a", "claude");
    expect(screen.getByText(/^Starts on/).textContent).toBe("Starts on Claude · side");
  });
});

describe("Projects & pools — pools", () => {
  const quiet = { explainFolder: vi.fn(async () => ({ profile: null, configDir: null, why: [] })) };

  it("starts from an empty state that creates a pool with its accounts", async () => {
    const createPool = vi.fn(async () => "work-accounts");
    const setPoolMembership = vi.fn(async () => {});
    mount(fixture({ sessions: [], pools: [] }), { tab: "projects", act: { ...quiet, createPool, setPoolMembership } });
    expect(screen.getByText(/No pools yet/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: /New pool/ })[0]);
    fireEvent.change(screen.getByLabelText("Pool name"), { target: { value: "Work accounts" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Claude · work" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Claude · side" }));
    fireEvent.click(screen.getByRole("button", { name: "Create pool" }));
    await waitFor(() => expect(setPoolMembership).toHaveBeenCalledTimes(2));
    expect(createPool).toHaveBeenCalledWith("Work accounts");
    expect(setPoolMembership).toHaveBeenCalledWith("work-accounts", "claude:work", true);
    expect(setPoolMembership).toHaveBeenCalledWith("work-accounts", "claude:side", true);
  });

  it("adds and removes members on the pool card", async () => {
    const setPoolMembership = vi.fn(async () => {});
    mount(fixture({ sessions: [] }), { tab: "projects", act: { ...quiet, setPoolMembership } });
    fireEvent.click(screen.getByRole("button", { name: "Remove Claude · work from Clients" }));
    await waitFor(() => expect(setPoolMembership).toHaveBeenCalledWith("clients", "claude:work", false));
    fireEvent.click(screen.getByRole("button", { name: "Add Claude · side to Clients" }));
    await waitFor(() => expect(setPoolMembership).toHaveBeenCalledWith("clients", "claude:side", true));
  });

  it("renames and deletes a pool, and shows the CLI's reason when deleting is refused", async () => {
    const renamePool = vi.fn(async () => {});
    const deletePool = vi.fn(async () => {
      throw new Error('pool "clients" is used by folder rules: /x/a (claude). Remove them first');
    });
    mount(fixture({ sessions: [] }), { tab: "projects", act: { ...quiet, renamePool, deletePool } });
    fireEvent.keyDown(screen.getByRole("button", { name: "More for pool Clients" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Rename/ }));
    const name = screen.getByLabelText("Pool name");
    fireEvent.change(name, { target: { value: "Customers" } });
    fireEvent.keyDown(name, { key: "Enter" });
    await waitFor(() => expect(renamePool).toHaveBeenCalledWith("clients", "Customers"));
    fireEvent.keyDown(screen.getByRole("button", { name: "More for pool Clients" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Delete/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete pool" }));
    await waitFor(() => expect(store!.toasts.map((t) => t.text).join("\n")).toMatch(/used by folder rules/));
  });

  it("tries any typed folder, not only ones a session ran in", async () => {
    const explainFolder = vi.fn(async () => ({ profile: "claude/side", configDir: null, why: ["typed"] }));
    mount(fixture({ sessions: [] }), { tab: "projects", act: { explainFolder } });
    fireEvent.change(screen.getByLabelText("Or type a folder"), { target: { value: "/x/typed" } });
    await waitFor(() => expect(explainFolder).toHaveBeenCalledWith("/x/typed", "claude"));
  });
});

describe("Projects & pools — bindings", () => {
  const rule = { id: "claude:/x/a", match: { kind: "folder" as const, value: "/x/a" }, tool: "claude" as const, target: { kind: "account" as const, accountId: "claude:side" }, enabled: true, hits: null };

  it("adds a binding through an inline form (folder + tool + account or pool)", async () => {
    const mapFolder = vi.fn(async () => {});
    mount(fixture({ sessions: [] }), { tab: "projects", act: { mapFolder, explainFolder: vi.fn(async () => ({ profile: null, configDir: null, why: [] })) } });
    fireEvent.click(screen.getByRole("button", { name: /Add binding/ }));
    fireEvent.change(screen.getByLabelText("Folder to bind"), { target: { value: " /x/new " } });
    const buttons = screen.getAllByRole("button", { name: "Add binding" });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(mapFolder).toHaveBeenCalledWith("/x/new", { accountId: "claude:work" }));
    await waitFor(() => expect(screen.queryByLabelText("Folder to bind")).toBeNull());
  });

  it("expands ~ in a typed folder, refuses a flag-shaped one, and Escape clears before it closes", async () => {
    const mapFolder = vi.fn(async () => {});
    mount(fixture({ sessions: [] }), { tab: "projects", act: { mapFolder, explainFolder: vi.fn(async () => ({ profile: null, configDir: null, why: [] })) } });
    fireEvent.click(screen.getByRole("button", { name: /Add binding/ }));
    const field = screen.getByLabelText("Folder to bind");
    const submit = () => {
      const buttons = screen.getAllByRole("button", { name: "Add binding" });
      return buttons[buttons.length - 1] as HTMLButtonElement;
    };
    fireEvent.change(field, { target: { value: "--help" } });
    expect(screen.getByRole("alert").textContent).toMatch(/can't start with/);
    expect(submit().disabled).toBe(true);
    fireEvent.keyDown(field, { key: "Escape" });
    expect((screen.getByLabelText("Folder to bind") as HTMLInputElement).value).toBe("");
    fireEvent.change(field, { target: { value: "~/dev/new" } });
    await waitFor(() => expect(submit().disabled).toBe(false));
    // home dir resolves asynchronously (mocked below as /Users/x)
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.click(submit());
    await waitFor(() => expect(mapFolder).toHaveBeenCalledWith("/Users/x/dev/new", { accountId: "claude:work" }));
    fireEvent.click(screen.getByRole("button", { name: /Add binding/ }));
    fireEvent.keyDown(screen.getByLabelText("Folder to bind"), { key: "Escape" });
    expect(screen.queryByLabelText("Folder to bind")).toBeNull();
  });

  it("lists pools as targets and maps a pool for the chosen tool", async () => {
    const { bindingTargets, bindingTarget } = await import("./projects-pools.js");
    const vm = fixture();
    expect(bindingTargets(vm.accounts, vm.pools, "codex")).toEqual([{ value: "pool:clients", label: "Pool · Clients" }]);
    expect(bindingTargets(vm.accounts, vm.pools, "claude").map((t) => t.value)).toEqual([
      "account:claude:work",
      "account:claude:side",
      "account:claude:personal",
      "pool:clients",
    ]);
    expect(bindingTarget("pool:clients", "codex")).toEqual({ pool: "clients", tool: "codex" });
    expect(bindingTarget("account:claude:side", "claude")).toEqual({ accountId: "claude:side" });
    expect(bindingTarget("", "claude")).toBeNull();
  });

  it("removes a binding from its row menu after a confirm", async () => {
    const unmapFolder = vi.fn(async () => {});
    mount(fixture({ rules: [rule] }), { tab: "projects", act: { unmapFolder } });
    const trigger = screen.getByRole("button", { name: "Binding menu for /x/a" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Remove binding/ }));
    expect(screen.getByText("Remove this binding?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove binding" }));
    await waitFor(() => expect(unmapFolder).toHaveBeenCalledWith("/x/a", "claude"));
  });

  it("pauses and resumes a binding with its switch", async () => {
    const setBindingPaused = vi.fn(async () => {});
    mount(fixture({ rules: [rule, { ...rule, id: "claude:/x/b", match: { kind: "folder" as const, value: "/x/b" }, enabled: false }] }), {
      tab: "projects",
      act: { setBindingPaused },
    });
    const on = screen.getByRole("switch", { name: "Binding /x/a" });
    expect(on.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(on);
    await waitFor(() => expect(setBindingPaused).toHaveBeenCalledWith("/x/a", "claude", true));
    const off = screen.getByRole("switch", { name: "Binding /x/b" });
    expect(off.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(off);
    await waitFor(() => expect(setBindingPaused).toHaveBeenCalledWith("/x/b", "claude", false));
  });

  it("edits a binding's target in place — the same folder is simply re-mapped", async () => {
    const mapFolder = vi.fn(async () => {});
    const unmapFolder = vi.fn(async () => {});
    mount(fixture({ rules: [rule] }), { tab: "projects", act: { mapFolder, unmapFolder } });
    fireEvent.keyDown(screen.getByRole("button", { name: "Binding menu for /x/a" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Edit/ }));
    expect((screen.getByLabelText("Folder to bind") as HTMLInputElement).value).toBe("/x/a");
    fireEvent.click(screen.getByRole("button", { name: "Save binding" }));
    await waitFor(() => expect(mapFolder).toHaveBeenCalledWith("/x/a", { accountId: "claude:side" }));
    expect(unmapFolder).not.toHaveBeenCalled();
  });

  it("moving a binding to another folder maps the new one, drops the old one, and keeps it paused", async () => {
    const calls: string[] = [];
    const mapFolder = vi.fn(async (dir: string) => void calls.push(`map ${dir}`));
    const unmapFolder = vi.fn(async (dir: string) => void calls.push(`unmap ${dir}`));
    const setBindingPaused = vi.fn(async (dir: string, _t: string, p: boolean) => void calls.push(`pause ${dir} ${p}`));
    mount(fixture({ rules: [{ ...rule, enabled: false }] }), { tab: "projects", act: { mapFolder, unmapFolder, setBindingPaused } });
    fireEvent.keyDown(screen.getByRole("button", { name: "Binding menu for /x/a" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Edit/ }));
    fireEvent.change(screen.getByLabelText("Folder to bind"), { target: { value: "/x/moved" } });
    fireEvent.click(screen.getByRole("button", { name: "Save binding" }));
    await waitFor(() => expect(calls).toEqual(["map /x/moved", "unmap /x/a", "pause /x/moved true"]));
  });
});

function sessionAt(cwd: string): ViewModel["sessions"][number] {
  return {
    id: "claude:s1",
    tool: "claude",
    accountId: "claude:work",
    project: "a",
    cwd,
    branch: null,
    title: "t",
    state: "idle",
    startedAt: NOW,
    lastActiveAt: NOW,
    contextPct: null,
    model: null,
    summary: null,
    why: [],
    protectionNote: null,
    surface: null,
  };
}

describe("Account sheet", () => {
  it("shows plain starts as one star toggle: filled while set, a click takes it back", async () => {
    const deactivate = vi.fn(() => Promise.resolve());
    const setDefault = vi.fn(() => Promise.resolve());
    mount(fixture(), { overlay: { kind: "account", id: "claude:work" }, act: { deactivate, setDefault } });
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText(/Turn off/)).toBeNull();
    const on = within(dialog).getByRole("button", { name: /Use for plain starts/ });
    expect(on.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(on);
    await waitFor(() => expect(deactivate).toHaveBeenCalledWith("claude"));
    expect(within(dialog).getByRole("button", { name: /Use for plain starts/ }).getAttribute("aria-pressed")).toBe("false");
    const menu = accountMenu({ ...store!.accounts.find((a) => a.id === "claude:work")!, isDefault: true }, store!);
    expect(menu.find((i) => i.id === "off")?.label).toBe("Use for plain starts");
  });

  it("shows the account and saves only what changed", async () => {
    const setProtection = vi.fn(() => Promise.resolve());
    const setPoolMembership = vi.fn(() => Promise.resolve());
    const updateAccount = vi.fn(() => Promise.resolve());
    mount(fixture(), { overlay: { kind: "account", id: "claude:work" }, act: { setProtection, setPoolMembership, updateAccount } });
    expect(screen.getByText("Claude account")).toBeTruthy();
    expect(screen.getByText("Not reported by the provider")).toBeTruthy();
    expect(screen.getByText("Unknown")).toBeTruthy();
    expect(screen.getByText(/warns you — it doesn't pause sessions yet/)).toBeTruthy();
    expect(screen.getByText(/Claude sometimes offers a free reset/)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Personal" }));
    fireEvent.click(screen.getByRole("button", { name: /Clients/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateAccount).toHaveBeenCalledWith("claude:work", { label: "Personal" }));
    expect(setPoolMembership).toHaveBeenCalledWith("clients", "claude:work", false);
    expect(setProtection).not.toHaveBeenCalled();
    expect(screen.getByTestId("where").textContent).toBe("accounts/none");
  });

  it("refreshes the account's usage from the flyout, also when no usage is known yet", async () => {
    const refreshAccountUsage = vi.fn(() => Promise.resolve());
    mount(fixture({ accounts: [acc("work", { windows: [], checkedAt: null })] }), {
      overlay: { kind: "account", id: "claude:work" },
      act: { refreshAccountUsage },
    });
    expect(screen.getByText("No usage read yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Refresh usage" }));
    await waitFor(() => expect(refreshAccountUsage).toHaveBeenCalledWith("claude:work"));
    await waitFor(() => expect(store!.toasts.map((t) => t.text)).toContain("work: usage refreshed."));
    expect(screen.getByTestId("where").textContent).toBe("accounts/account"); // the flyout stays open
  });

  it("keeps the flyout refresh off for a signed-out account, with the reason", () => {
    mount(fixture(), { overlay: { kind: "account", id: "claude:personal" }, act: { refreshAccountUsage: vi.fn() } });
    const btn = screen.getByRole("button", { name: "Refresh usage" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe("Sign in first");
  });

  it("keeps capitals while renaming and explains a space", () => {
    mount(fixture(), { overlay: { kind: "account", id: "claude:work" } });
    const field = screen.getByLabelText("Name") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "MatneX" } });
    expect(field.value).toBe("MatneX");
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(field, { target: { value: "Matne X" } });
    expect(screen.getByText("No spaces — use - or _ instead.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("refuses an invalid new name", () => {
    mount(fixture(), { overlay: { kind: "account", id: "claude:work" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "-x" } });
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("Add account", () => {
  it("opens as a flyout on the right, like the account itself", () => {
    mount(fixture(), { overlay: { kind: "add-account" } });
    expect(screen.getByRole("dialog").className).toContain("ac-sheet");
  });

  it("walks provider → name → sign-in → use in and applies tag and pools", async () => {
    ipcMock.profiles = [{ provider: "claude", name: "acme", identity: "me@acme.test", label: null, active: false, liveSessions: 0 }];
    const updateAccount = vi.fn(() => Promise.resolve());
    const setPoolMembership = vi.fn(() => Promise.resolve());
    mount(fixture(), { overlay: { kind: "add-account" }, act: { updateAccount, setPoolMembership } });
    expect(screen.getByText("Add account · step 1 of 4")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Gemini/ }));
    expect(screen.getByText(/Gemini has no backend yet/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: /Claude/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Work" } });
    expect(screen.getByText("There is already a Claude account named work.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Acme Corp" } });
    expect(screen.getByText("No spaces — use - or _ instead.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "acme" } });
    expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Work" }));
    fireEvent.click(screen.getByRole("button", { name: /Clients/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByText("Sign in with the provider")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Open sign-in/ }));
    await screen.findByText(/Verified:/);
    expect(within(screen.getByRole("dialog")).getByText("me@acme.test")).toBeTruthy();
    expect(term.ran).toEqual([["add", "acme", "--provider", "claude"]]);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Claude CLI")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Done/ }));
    await waitFor(() => expect(updateAccount).toHaveBeenCalledWith("claude:acme", { label: "Work" }));
    expect(setPoolMembership).toHaveBeenCalledWith("clients", "claude:acme", true);
  });

  it("starts at the name step for a preset provider and stays put when the sign-in didn't finish", async () => {
    mount(fixture(), { overlay: { kind: "add-account", tool: "codex" } });
    expect(screen.getByText("Add account · step 2 of 4")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "side" } });
    fireEvent.click(screen.getByRole("radio", { name: "Other" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: /Open sign-in/ }));
    await waitFor(() => expect(store!.toasts.map((t) => t.text)).toContain("The sign-in didn't finish — try again."));
    expect(screen.getByText("Not started")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("Add account — sign-in", () => {
  function toSignIn(tool = "claude", name = "acme") {
    mount(fixture(), { overlay: { kind: "add-account", tool } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: name } });
    fireEvent.click(screen.getByRole("radio", { name: "Work" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  }

  it("opens the first Claude sign-in in the browser picked last time", async () => {
    ipcMock.profiles = [{ provider: "claude", name: "acme", identity: "me@acme.test", label: null, active: false, liveSessions: 0 }];
    ipcMock.browsers = [{ id: "safari", name: "Safari" }, { id: "arc", name: "Arc" }];
    setLoginBrowser("arc");
    toSignIn();
    await screen.findByText("Open the sign-in in");
    fireEvent.click(screen.getByRole("button", { name: /Open sign-in/ }));
    await screen.findByText(/Verified:/);
    expect(term.ran).toEqual([["add", "acme", "--provider", "claude", "--browser", "arc"]]);
  });

  it("retries a created but unfinished sign-in with login, not a second add", async () => {
    ipcMock.profiles = [{ provider: "claude", name: "acme", identity: null, label: null, active: false, liveSessions: 0 }];
    toSignIn();
    fireEvent.click(screen.getByRole("button", { name: /Open sign-in/ }));
    await waitFor(() => expect(store!.toasts.map((t) => t.text)).toContain("The sign-in didn't finish — try again."));
    expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
    ipcMock.profiles = [{ provider: "claude", name: "acme", identity: "me@acme.test", label: null, active: false, liveSessions: 0 }];
    fireEvent.click(screen.getByRole("button", { name: /Open sign-in/ }));
    await screen.findByText(/Verified:/);
    expect(term.ran).toEqual([
      ["add", "acme", "--provider", "claude"],
      ["login", "acme", "--provider", "claude"],
    ]);
  });
});

describe("Account colour", () => {
  it("lets a new account pick its colour and stores it on Done", async () => {
    ipcMock.profiles = [{ provider: "claude", name: "acme", identity: "me@acme.test", label: null, active: false, liveSessions: 0 }];
    const updateAccount = vi.fn(() => Promise.resolve());
    mount(fixture(), { overlay: { kind: "add-account", tool: "claude" }, act: { updateAccount } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "acme" } });
    fireEvent.click(screen.getByRole("radio", { name: "Work" }));
    fireEvent.click(screen.getByRole("radio", { name: "teal" }));
    expect(screen.getByRole("radio", { name: "teal" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: /Open sign-in/ }));
    await screen.findByText(/Verified:/);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: /Done/ }));
    await waitFor(() => expect(updateAccount).toHaveBeenCalledWith("claude:acme", { label: "Work", color: "teal" }));
  });

  it("changes an account's colour from the flyout", async () => {
    const updateAccount = vi.fn(() => Promise.resolve());
    mount(fixture(), { overlay: { kind: "account", id: "claude:work" }, act: { updateAccount } });
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: "teal" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateAccount).toHaveBeenCalledWith("claude:work", { color: "teal" }));
    expect(store!.accounts.find((a) => a.id === "claude:work")?.color).toBe("teal");
  });
});

describe("Sign in again", () => {
  it("verifies the same account", async () => {
    ipcMock.profiles = [{ provider: "claude", name: "work", identity: "work@example.test", label: null, active: true, liveSessions: 1 }];
    mount(fixture(), { overlay: { kind: "reauth", accountId: "claude:work" } });
    expect(screen.getByText("Sign in again")).toBeTruthy();
    expect(within(screen.getByRole("dialog")).getByText("work@example.test")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Sign in with Claude/ }));
    await screen.findByText("Connected");
    expect(term.ran).toEqual([["login", "work", "--provider", "claude"]]);
    expect(screen.getByText(/Same account as before/)).toBeTruthy();
  });

  it("flags a different account", async () => {
    ipcMock.profiles = [{ provider: "claude", name: "work", identity: "other@example.test", label: null, active: true, liveSessions: 1 }];
    mount(fixture(), { overlay: { kind: "reauth", accountId: "claude:work" } });
    fireEvent.click(screen.getByRole("button", { name: /Sign in with Claude/ }));
    await screen.findByText("Wrong account");
    expect(screen.getByText("other@example.test")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Try again/ })).toBeTruthy();
  });

  it("opens the Claude sign-in in the browser picked last time", async () => {
    ipcMock.profiles = [{ provider: "claude", name: "work", identity: "work@example.test", label: null, active: true, liveSessions: 1 }];
    ipcMock.browsers = [{ id: "safari", name: "Safari" }, { id: "arc", name: "Arc" }];
    setLoginBrowser("arc");
    mount(fixture(), { overlay: { kind: "reauth", accountId: "claude:work" } });
    await screen.findByText("Open the sign-in in");
    fireEvent.click(screen.getByRole("button", { name: /Sign in with Claude/ }));
    await screen.findByText("Connected");
    expect(term.ran).toEqual([["login", "work", "--provider", "claude", "--browser", "arc"]]);
  });

  it("falls back to the default browser when the remembered one is gone", async () => {
    ipcMock.profiles = [{ provider: "claude", name: "work", identity: "work@example.test", label: null, active: true, liveSessions: 1 }];
    ipcMock.browsers = [{ id: "safari", name: "Safari" }];
    setLoginBrowser("arc");
    mount(fixture(), { overlay: { kind: "reauth", accountId: "claude:work" } });
    await screen.findByText("Open the sign-in in");
    fireEvent.click(screen.getByRole("button", { name: /Sign in with Claude/ }));
    await screen.findByText("Connected");
    expect(term.ran).toEqual([["login", "work", "--provider", "claude"]]);
  });

  it("tells a Codex sign-in that Codex picks the default browser itself", async () => {
    ipcMock.browsers = [{ id: "arc", name: "Arc" }];
    mount(fixture({ accounts: [acc("side", { tool: "codex", id: "codex:side" })] }), { overlay: { kind: "reauth", accountId: "codex:side" } });
    expect(await screen.findByText(/Codex opens your default browser itself/)).toBeTruthy();
    expect(screen.queryByText("Open the sign-in in")).toBeNull();
  });

  it("says Sign in for a first sign-in", () => {
    mount(fixture(), { overlay: { kind: "reauth", accountId: "claude:personal" } });
    expect(screen.getAllByText("Sign in").length).toBeGreaterThan(0);
    expect(screen.getByText("any — first sign-in")).toBeTruthy();
  });
});

describe("Copy email", () => {
  let copied: string[] = [];
  beforeEach(() => {
    copied = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (t: string) => void copied.push(t) },
    });
  });

  it("copies the email from the account row without opening the flyout", async () => {
    mount(fixture());
    fireEvent.click(screen.getByRole("button", { name: "Copy work@example.test" }));
    await waitFor(() => expect(copied).toEqual(["work@example.test"]));
    expect(screen.getByTestId("where").textContent).toBe("accounts/none");
  });

  it("copies by keyboard from the row too", async () => {
    mount(fixture());
    fireEvent.keyDown(screen.getByRole("button", { name: "Copy work@example.test" }), { key: "Enter" });
    await waitFor(() => expect(copied).toEqual(["work@example.test"]));
    expect(screen.getByTestId("where").textContent).toBe("accounts/none");
  });

  it("copies the email from the flyout and from the sign-in", async () => {
    mount(fixture(), { overlay: { kind: "account", id: "claude:work" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Copy work@example.test" }));
    await waitFor(() => expect(copied).toEqual(["work@example.test"]));
    cleanup();
    ipcMock.profiles = [{ provider: "claude", name: "work", identity: "work@example.test", label: null, active: true, liveSessions: 1 }];
    mount(fixture(), { overlay: { kind: "reauth", accountId: "claude:work" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Copy work@example.test" }));
    await waitFor(() => expect(copied).toEqual(["work@example.test", "work@example.test"]));
  });
});

describe("After a rename", () => {
  it("leaves the window clickable when the flyout was opened from the row menu", async () => {
    const updateAccount = vi.fn(() => Promise.resolve());
    mount(fixture(), { act: { updateAccount } });
    fireEvent.keyDown(screen.getByRole("button", { name: "More for work" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Rename/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByDisplayValue("work"), { target: { value: "Work2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateAccount).toHaveBeenCalledWith("claude:work", { name: "Work2" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.body.style.pointerEvents).not.toBe("none"));
  });

  it("leaves the window clickable after a rename from the row click", async () => {
    const updateAccount = vi.fn(() => Promise.resolve());
    mount(fixture(), { overlay: { kind: "account", id: "claude:work" }, act: { updateAccount } });
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByDisplayValue("work"), { target: { value: "Work2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.body.style.pointerEvents).not.toBe("none"));
  });
});

describe("Row menu → flyout section", () => {
  let scrolled: string[] = [];
  beforeEach(() => {
    scrolled = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.id);
    };
  });

  it("Rename jumps to the name and focuses it", async () => {
    mount(fixture());
    fireEvent.keyDown(screen.getByRole("button", { name: "More for work" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Rename/ }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(scrolled).toContain("account-edit"));
    expect(document.activeElement).toBe(within(dialog).getByDisplayValue("work"));
  });

  it("Usage jumps to the capacity section", async () => {
    mount(fixture());
    fireEvent.keyDown(screen.getByRole("button", { name: "More for work" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Usage, protection/ }));
    await screen.findByRole("dialog");
    await waitFor(() => expect(scrolled).toContain("account-usage"));
  });

  it("a plain row click opens the flyout at the top", async () => {
    mount(fixture(), { overlay: { kind: "account", id: "claude:work" } });
    await screen.findByRole("dialog");
    await new Promise((r) => setTimeout(r, 50));
    expect(scrolled).toEqual([]);
  });
});

describe("Disabled accounts", () => {
  it("disables from the row menu without a confirm", async () => {
    const setAccountDisabled = vi.fn(() => Promise.resolve());
    mount(fixture(), { act: { setAccountDisabled } });
    fireEvent.keyDown(screen.getByRole("button", { name: "More for work" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Disable account/ }));
    await waitFor(() => expect(setAccountDisabled).toHaveBeenCalledWith("claude:work", true));
    expect(store!.accounts.find((a) => a.id === "claude:work")?.disabled).toBe(true);
  });

  it("shows a disabled account greyed with its badge, and only lets you turn it back on", () => {
    const vm = fixture();
    vm.accounts = vm.accounts.map((a) => (a.id === "claude:work" ? { ...a, disabled: true, isDefault: false } : a));
    mount(vm);
    const row = screen.getByRole("button", { name: "More for work" }).closest("[data-account-row]") as HTMLElement;
    expect(row.getAttribute("data-disabled")).toBe("true");
    expect(within(row).getByText("Disabled")).toBeTruthy();
    const menu = accountMenu(store!.accounts.find((a) => a.id === "claude:work")!, store!);
    expect(menu.find((i) => i.id === "enable")?.label).toBe("Turn back on");
    expect(menu.find((i) => i.id === "term")?.disabled).toBe(true);
    expect(menu.find((i) => i.id === "default")?.disabled).toBe(true);
    expect(menu.find((i) => i.id === "disable")).toBeUndefined();
  });

  it("still refreshes a disabled account by hand, from its flyout and its row menu", async () => {
    const vm = fixture();
    vm.accounts = vm.accounts.map((a) => (a.id === "claude:work" ? { ...a, disabled: true } : a));
    const refreshAccountUsage = vi.fn(() => Promise.resolve());
    mount(vm, { overlay: { kind: "account", id: "claude:work" }, act: { refreshAccountUsage } });
    const dialog = await screen.findByRole("dialog");
    const btn = within(dialog).getByRole("button", { name: "Refresh usage" }) as HTMLButtonElement;
    expect(btn.title).toBe("Refresh usage — disabled accounts are only checked when you ask");
    fireEvent.click(btn);
    await waitFor(() => expect(refreshAccountUsage).toHaveBeenCalledWith("claude:work"));
    expect(accountMenu(store!.accounts.find((a) => a.id === "claude:work")!, store!).find((i) => i.id === "refresh")?.disabled).toBe(false);
  });
});

describe("Claude Desktop sign-in", () => {
  it("warns on the row and in the flyout when an account's Desktop window runs on another account", async () => {
    const vm = fixture();
    vm.accounts = vm.accounts.map((a) => (a.id === "claude:work" ? { ...a, desktopForeign: ["side"] } : a));
    mount(vm);
    const row = screen.getByRole("button", { name: "More for work" }).closest("[data-account-row]") as HTMLElement;
    expect(within(row).getByText("Desktop: side")).toBeTruthy();
    act(() => store!.open({ kind: "account", id: "claude:work" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Its Claude Desktop window is signed in as side/)).toBeTruthy();
  });
});
