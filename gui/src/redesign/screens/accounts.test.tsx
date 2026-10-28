import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AcRoot } from "../../ui/AcRoot.js";
import type { Actions } from "../../vm/actions.js";
import { emptyViewModel } from "../../vm/load.js";
import { ASProvider, useAS, type AccountsTab, type Overlay, type Screen, type Store } from "../../vm/store.js";
import type { Account, ViewModel } from "../../vm/types.js";
import { OverlayHost, ScreenHost } from "../Hosts.js";
import { accountMenu } from "./account-actions.js";

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
}));
vi.mock("../../ipc.js", async (orig) => ({
  ...(await orig<typeof import("../../ipc.js")>()),
  listProfiles: async () => ipcMock.profiles,
  usageHistory: async () => ipcMock.history,
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

  it("keeps your order when asked", () => {
    mount(fixture());
    fireEvent.click(screen.getByRole("radio", { name: "Your order" }));
    expect(screen.queryByText("#1")).toBeNull();
    const names = screen.getAllByText(/^(work|side|personal)$/).map((n) => n.textContent);
    expect(names).toEqual(["work", "side", "personal"]);
  });

  it("builds the row menu from what the account and backend allow", () => {
    mount(fixture());
    const work = accountMenu(store!.accounts[0], store!);
    expect(work.map((i) => i.id)).toEqual(["term", "off", "reset", "details", "signin", "rename", "remove"]);
    expect(work.find((i) => i.id === "reset")!.disabled).toBe(true);
    const out = accountMenu(store!.accounts[2], store!);
    expect(out.find((i) => i.id === "term")!.disabled).toBe(true);
    expect(out.find((i) => i.id === "signin")!.label).toBe("Sign in");
    const codex = accountMenu(acc("c", { tool: "codex", id: "codex:c", resetCredits: 2 }), store!);
    expect(codex.find((i) => i.id === "reset")).toMatchObject({ label: "Redeem a reset credit", hint: "2 left", disabled: false });
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
    expect(screen.getByText("Claude · side")).toBeTruthy();
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

  it("keeps the per-binding switch disabled with its reason", () => {
    mount(fixture({ rules: [rule] }), { tab: "projects" });
    const sw = screen.getByRole("switch", { name: "Binding /x/a" });
    expect(sw.hasAttribute("disabled") || sw.getAttribute("aria-disabled") === "true").toBe(true);
    expect(sw.closest("[title]")?.getAttribute("title")).toBe("Pausing a binding isn't supported yet.");
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

  it("refuses an invalid new name", () => {
    mount(fixture(), { overlay: { kind: "account", id: "claude:work" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "-x" } });
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("Add account", () => {
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
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "acme" } });
    expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Work" }));
    fireEvent.click(screen.getByRole("button", { name: /Clients/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByText("Sign in with the provider")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Open sign-in/ }));
    await screen.findByText("Verified: me@acme.test");
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

describe("Sign in again", () => {
  it("verifies the same account", async () => {
    ipcMock.profiles = [{ provider: "claude", name: "work", identity: "work@example.test", label: null, active: true, liveSessions: 1 }];
    mount(fixture(), { overlay: { kind: "reauth", accountId: "claude:work" } });
    expect(screen.getByText("Sign in again")).toBeTruthy();
    expect(screen.getByText("work@example.test")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Sign in with Claude/ }));
    await screen.findByText("Connected");
    expect(term.ran).toEqual([["run", "work", "--provider", "claude"]]);
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

  it("says Sign in for a first sign-in", () => {
    mount(fixture(), { overlay: { kind: "reauth", accountId: "claude:personal" } });
    expect(screen.getAllByText("Sign in").length).toBeGreaterThan(0);
    expect(screen.getByText("any — first sign-in")).toBeTruthy();
  });
});
