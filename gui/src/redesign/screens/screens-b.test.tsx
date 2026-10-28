import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AcRoot } from "../../ui/AcRoot.js";
import type { Actions } from "../../vm/actions.js";
import { emptyViewModel } from "../../vm/load.js";
import { ASProvider, useAS, type Overlay, type Screen } from "../../vm/store.js";
import type { Account, ToolEntry, ViewModel } from "../../vm/types.js";
import { OverlayHost, ScreenHost } from "../Hosts.js";

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
  tauriBackend: { open: () => new Promise(() => {}), write: async () => {}, resize: async () => {}, close: async () => {} },
}));
vi.mock("../../ipc.js", async (orig) => ({
  ...(await orig<typeof import("../../ipc.js")>()),
  shareStatus: vi.fn(async () => ({ active: true, source: "default", profiles: [{ name: "work", shared: true }] })),
  getAutostartPreference: vi.fn(async () => ({ state: "enabled", degradedReason: null })),
}));
vi.mock("../../updates.js", async (orig) => ({
  ...(await orig<typeof import("../../updates.js")>()),
  fetchReleases: vi.fn(async () => []),
}));
vi.mock("@tauri-apps/plugin-shell", async (orig) => ({ ...(await orig<object>()), open: vi.fn(async () => {}) }));
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
    identity: null,
    plan: null,
    label: null,
    color: "blue",
    isDefault: false,
    state: "ready",
    windows: [],
    checkedAt: null,
    resetCredits: null,
    threshold: 98,
    protection: null,
    auth: null,
    surfaces: [],
    liveSessions: 0,
    pools: [],
    ...over,
  };
}

function tool(id: string, over: Partial<ToolEntry> = {}): ToolEntry {
  return { id, name: id, role: `${id} role`, present: true, version: "1.0.0", latest: "1.0.0", healthy: true, command: `agent-switch tooling upgrade ${id}`, ...over };
}

function fixture(over: Partial<ViewModel> = {}): ViewModel {
  return {
    ...emptyViewModel(NOW),
    platform: "mac",
    readiness: "ready",
    accounts: [acc("work", { isDefault: true })],
    tools: [
      tool("agent-config", { name: "agent-config", version: "18.1.0", latest: "18.2.0", notes: [{ version: "18.2.0", items: ["Audit ledger"], url: "https://x" }] }),
      tool("codex", { name: "Codex CLI", version: "0.98.0", latest: "0.99.1" }),
      tool("rtk"),
      tool("agy", { name: "Antigravity CLI", present: false, version: null, latest: null, hint: "No verified install command." }),
    ],
    toolsCheckedAt: NOW - 360_000,
    agentConfig: { status: "live", port: 47821, pid: 1, version: "18.1.0", latest: "18.2.0", checkedAt: NOW },
    ...over,
  };
}

function Where() {
  const s = useAS();
  const o = s.overlay;
  return <p data-testid="where">{`${s.screen}/${o.kind}${o.kind === "terminal" && !("run" in o) ? `:${o.toolId}:${o.action}` : ""}`}</p>;
}

function mount(vm: ViewModel, opts: { screen?: Screen; overlay?: Overlay; act?: Actions; toolsTab?: "tools" | "apps" } = {}) {
  return render(
    <AcRoot>
      <ASProvider initial={vm} startScreen={opts.screen} startOverlay={opts.overlay} startToolsTab={opts.toolsTab} actions={opts.act ? () => opts.act! : undefined}>
        <ScreenHost />
        <OverlayHost />
        <Where />
      </ASProvider>
    </AcRoot>,
  );
}

afterEach(cleanup);

describe("Tools", () => {
  it("shows the agent-config card, sorted tools and opens updates in the terminal", async () => {
    mount(fixture(), { screen: "tools" });
    expect(screen.getByRole("radio", { name: "Tools 4 · 2 updates" })).toBeTruthy();
    expect(screen.getByText("Running · port 47821")).toBeTruthy();
    expect(screen.getByText("18.2.0 available")).toBeTruthy();
    expect(screen.getByText("· Audit ledger")).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/shared across 1/)).toBeTruthy());
    const names = screen.getAllByText(/^(agent-config|Codex CLI|rtk|Antigravity CLI)$/).map((n) => n.textContent);
    expect(names.slice(-4)).toEqual(["agent-config", "Codex CLI", "rtk", "Antigravity CLI"]);
    // agy has no verified installer: no Install button, no copy.
    expect(screen.queryByRole("button", { name: /^Install$/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Update to 18.2.0/ }));
    expect(screen.getByTestId("where").textContent).toBe("tools/terminal:agent-config:update");
    expect(screen.getByText("$ agent-switch tooling upgrade agent-config")).toBeTruthy();
  });

  it("offers agent-config when it is not installed", () => {
    mount(fixture({ agentConfig: { status: "not-installed", port: null, pid: null, version: null, latest: null, checkedAt: NOW } }), { screen: "tools" });
    expect(screen.getByText("What you get with both")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Install agent-config/ }));
    expect(screen.getByTestId("where").textContent).toBe("tools/terminal:agent-config:install");
  });

  it("shows the wedged strip with a confirmed force restart", () => {
    const restartAgentConfig = vi.fn(async () => {});
    mount(fixture({ agentConfig: { status: "wedged", port: 1, pid: 48213, version: null, latest: null, checkedAt: NOW } }), {
      screen: "tools",
      act: { restartAgentConfig },
    });
    expect(screen.getByText("agent-config is not responding (pid 48213) — restart it?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Force restart" }));
    fireEvent.click(screen.getByRole("button", { name: "Force restart" }));
    expect(restartAgentConfig).toHaveBeenCalled();
  });
});

describe("Apps", () => {
  it("lists apps with an honest capability and a disabled launcher", () => {
    mount(
      fixture({
        surfaces: [
          { id: "claude-desktop", tool: "claude", name: "Claude Desktop", kind: "desktop", detected: true, capability: null, protection: null, identitySeen: null, launcher: null, checkedAt: null },
        ],
      }),
      { screen: "tools", toolsTab: "apps" },
    );
    expect(screen.getByText("Found 1 of 1: Claude Desktop.")).toBeTruthy();
    expect(screen.getByText("Unknown")).toBeTruthy();
    const sw = screen.getByRole("switch", { name: "Own launcher for Claude Desktop" }) as HTMLButtonElement;
    expect(sw.disabled).toBe(true);
  });
});

describe("Health + Fix", () => {
  const checks = [
    { id: "shell-integration", title: "Shell integration not found", detail: "Without it …", state: "warn" as const, fix: 'Add `eval "$(agent-switch shellenv)"` to your shell profile.' },
    { id: "autostart", title: "Start at login could not be confirmed", detail: "Not confirmed.", state: "warn" as const, fix: "Open the desktop app → Settings → turn on start at login." },
    { id: "cli-on-path", title: "agent-switch is on PATH", detail: "/usr/bin/agent-switch", state: "ok" as const },
  ];

  it("shows readiness, autostart and checks", async () => {
    mount(fixture({ checks, checksCheckedAt: NOW, autostart: { desired: null, actual: "disabled" } }), { screen: "health" });
    expect(screen.getByText("Runs in the menu bar. Usage is watched in the background.")).toBeTruthy();
    expect(screen.getByText("2 to check")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Couldn't turn it on.")).toBeTruthy());
    expect(screen.getAllByRole("button", { name: /Fix/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Open Tools" }));
    expect(screen.getByTestId("where").textContent).toBe("tools/none");
  });

  it("explains a fix without a repair and offers the command", () => {
    mount(fixture({ checks }), { screen: "health", overlay: { kind: "fix", checkId: "shell-integration" }, act: { setAutostart: async () => {} } });
    expect(screen.getByText("What to do")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Repair/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Copy: eval/ })).toBeTruthy();
  });

  it("repairs start at login and shows before/after", async () => {
    const setAutostart = vi.fn(async () => {});
    mount(fixture({ checks }), { screen: "health", overlay: { kind: "fix", checkId: "autostart" }, act: { setAutostart } });
    expect(screen.getByText("What will change")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Repair/ }));
    });
    expect(setAutostart).toHaveBeenCalledWith(true);
    expect(screen.getByRole("status").textContent).toContain("Before: Needs a look");
  });
});

describe("Activity", () => {
  it("filters events and opens the account", () => {
    mount(
      fixture({
        activity: [
          { id: "1", at: NOW - 60_000, kind: "switch", text: "claude/work: switch", detail: "Most left", accountId: "claude:work", ok: true },
          { id: "2", at: NOW - 120_000, kind: "update", text: "rtk: update", ok: false },
        ],
      }),
      { screen: "activity" },
    );
    expect(screen.getByText("Failed")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "System" }));
    expect(screen.queryByText("claude/work: switch")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Accounts" }));
    fireEvent.click(screen.getByText("claude/work: switch"));
    expect(screen.getByTestId("where").textContent).toBe("activity/account");
  });

  it("has an empty state", () => {
    mount(fixture(), { screen: "activity" });
    expect(screen.getByText("Nothing recorded yet.")).toBeTruthy();
  });
});

describe("Notifications sheet", () => {
  it("groups notices, marks read and clears after confirm", () => {
    const clearNotifications = vi.fn(async () => {});
    mount(
      fixture({
        notices: [
          { id: "a", title: "Switched to work", detail: "", at: NOW - 60_000, unread: true, tone: "ok" },
          { id: "b", title: "Fetch failed", detail: "429", at: NOW - 5 * 3_600_000, unread: false, tone: "warn" },
        ],
      }),
      { overlay: { kind: "notifications" }, act: { clearNotifications } },
    );
    expect(screen.getByText("1 unread")).toBeTruthy();
    expect(screen.getByText("Today")).toBeTruthy();
    expect(screen.getByText("Earlier")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
    expect(screen.getByText("0 unread")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(clearNotifications).toHaveBeenCalled();
  });

  it("shows the empty state", () => {
    mount(fixture(), { overlay: { kind: "notifications" } });
    expect(screen.getByText(/No notifications\./)).toBeTruthy();
  });
});
