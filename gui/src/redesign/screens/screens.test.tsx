import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AcRoot } from "../../ui/AcRoot.js";
import type { Actions } from "../../vm/actions.js";
import { emptyViewModel } from "../../vm/load.js";
import { ASProvider, useAS, type Overlay, type Screen } from "../../vm/store.js";
import type { Account, Session, ViewModel } from "../../vm/types.js";
import { OverlayHost, ScreenHost } from "../Hosts.js";
import { terminalRun } from "./terminal-sheet.js";

// jsdom has no canvas/matchMedia for xterm and no Tauri pty: stub both.
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
    windows: [{ key: "5h", label: "5h", utilization: 40, resetsAt: null }],
    checkedAt: NOW - 60_000,
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

function ses(id: string, over: Partial<Session> = {}): Session {
  return {
    id: `claude:${id}`,
    tool: "claude",
    accountId: "claude:work",
    project: id,
    cwd: `/Users/x/dev/${id}`,
    branch: null,
    title: `${id} task`,
    state: "working",
    startedAt: NOW - 3_600_000,
    lastActiveAt: NOW - 1000,
    contextPct: 64,
    model: null,
    summary: null,
    why: [],
    protectionNote: null,
    surface: null,
    ...over,
  };
}

function fixture(over: Partial<ViewModel> = {}): ViewModel {
  const work = acc("work", { isDefault: true, liveSessions: 1 });
  const side = acc("side", { state: "near-limit", windows: [{ key: "5h", label: "5h", utilization: 94, resetsAt: null }] });
  return {
    ...emptyViewModel(NOW),
    platform: "mac",
    readiness: "ready",
    accounts: [work, side],
    sessions: [ses("agent-config"), ses("budmigo", { state: "idle", accountId: side.id }), ses("old", { state: "done" })],
    attention: [{ id: "limit:claude:side", kind: "near-limit", title: "side is at 94 % of its 5h window", detail: "Reset time not reported.", accountId: side.id, primary: "Decide", at: NOW - 120_000 }],
    ...over,
  };
}

function Where() {
  const s = useAS();
  return <p data-testid="where">{`${s.screen}/${s.overlay.kind}`}</p>;
}

function mount(vm: ViewModel, opts: { screen?: Screen; overlay?: Overlay; act?: Actions } = {}) {
  return render(
    <AcRoot>
      <ASProvider initial={vm} startScreen={opts.screen} startOverlay={opts.overlay} actions={opts.act ? () => opts.act! : undefined}>
        <ScreenHost />
        <OverlayHost />
        <Where />
      </ASProvider>
    </AcRoot>,
  );
}

afterEach(cleanup);

describe("Overview", () => {
  it("shows needs, running sessions and what is left", () => {
    mount(fixture());
    expect(screen.getByText("2 of 2 accounts ready · 1 sessions working · 1 needs you")).toBeTruthy();
    expect(screen.getByText("side is at 94 % of its 5h window")).toBeTruthy();
    expect(screen.getByText("agent-config")).toBeTruthy();
    expect(screen.queryByText("old")).toBeNull();
    expect(screen.getByText("Near limit")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Decide" }));
    expect(screen.getByTestId("where").textContent).toBe("home/limit");
  });

  it("shows the first-run state once loaded without accounts", () => {
    mount(fixture({ accounts: [], sessions: [], attention: [], providers: [{ id: "claude", installed: true, binaryPath: null, binName: "claude", cli: true, gui: false }] }));
    expect(screen.getByText("Let's add your first account")).toBeTruthy();
    expect(screen.getByText("Claude CLI")).toBeTruthy();
  });

  it("offers agent-config only while it is not installed", () => {
    mount(fixture({ agentConfig: { status: "not-installed", port: null, pid: null, version: null, latest: null, checkedAt: NOW } }));
    fireEvent.click(screen.getByRole("button", { name: /Install/ }));
    expect(screen.getByTestId("where").textContent).toBe("home/terminal");
    cleanup();
    mount(fixture({ agentConfig: { status: "live", port: 1, pid: 1, version: "1", latest: null, checkedAt: NOW } }));
    expect(screen.queryByText(/Supercharge your AI agents/)).toBeNull();
  });
});

describe("Sessions", () => {
  it("lists open sessions with counts and an empty state", () => {
    mount(fixture(), { screen: "sessions" });
    expect(screen.getByRole("radio", { name: "Open 2" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Done 1" })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: /Trash/ })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Paused 0" }));
    expect(screen.getByText("No sessions here.")).toBeTruthy();
  });
});

describe("Session sheet", () => {
  it("renders details, gates trash while running and confirms a live switch", () => {
    const rebind = vi.fn(() => Promise.resolve());
    mount(fixture(), { screen: "sessions", overlay: { kind: "session", id: "claude:agent-config" }, act: { rebind, trashSession: vi.fn() } });
    expect(screen.getByText("agent-config · agent-config task")).toBeTruthy();
    expect(screen.getByText("64 % of the window")).toBeTruthy();
    expect(screen.getByText("No reason recorded for this session.")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Move to trash/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Switch account" }));
    expect(screen.getByText("Switch agent-config to side?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Switch account" }));
    expect(rebind).toHaveBeenCalledWith("claude:agent-config", "claude:side");
  });

  it("disables live switching off macOS with the reason", () => {
    mount(fixture({ platform: "linux" }), { overlay: { kind: "session", id: "claude:agent-config" } });
    const sw = screen.getByRole("radio", { name: "Switch live" });
    expect(sw.getAttribute("aria-disabled")).toBe("true");
    expect(sw.getAttribute("title")).toBe("Live switching works on macOS only today.");
  });

  it("hands take over to the built-in terminal", () => {
    mount(fixture(), { overlay: { kind: "session", id: "claude:agent-config" } });
    fireEvent.click(screen.getByRole("radio", { name: "Take over" }));
    fireEvent.click(screen.getByRole("button", { name: "Take over on side" }));
    expect(screen.getByTestId("where").textContent).toBe("home/terminal");
  });
});

describe("Start session", () => {
  it("resolves the default account and disables tools without accounts", () => {
    mount(fixture(), { overlay: { kind: "start" } });
    expect(screen.getByText("Where and with what?")).toBeTruthy();
    expect(screen.getByText("Automatic → work")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Gemini" }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("radio", { name: "Claude app" }).getAttribute("title")).toBe("No Claude app found on this computer");
    expect(screen.getByText("agent-switch run work --provider claude")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Start Claude/ }));
    expect(screen.getByTestId("where").textContent).toBe("home/terminal");
  });

  it("cannot start without a default account", () => {
    mount(fixture({ accounts: [acc("work")] }), { overlay: { kind: "start" } });
    expect((screen.getByRole("button", { name: /Start Claude/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("Near-limit sheet", () => {
  it("offers only what the backend can do", () => {
    mount(fixture(), { overlay: { kind: "limit", attentionId: "limit:claude:side" }, act: { rebind: vi.fn(), handoffBrief: vi.fn() } });
    const pause = screen.getByRole("radio", { name: /Pause at 98 %/ }) as HTMLButtonElement;
    expect(pause.disabled).toBe(true);
    expect(screen.getByText(/Pausing needs the protection engine/)).toBeTruthy();
    expect((screen.getByRole("radio", { name: /Keep going on side/ }) as HTMLButtonElement).disabled).toBe(true);
    const sw = screen.getByRole("radio", { name: /Switch this session/ });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("button", { name: "Switch to work" })).toBeTruthy();
  });
});

describe("terminal overlay", () => {
  it("maps tool installs and runs to agent-switch args", () => {
    expect(terminalRun({ kind: "terminal", toolId: "rtk", action: "update" }).args).toEqual(["tooling", "upgrade", "rtk"]);
    expect(terminalRun({ kind: "terminal", run: { args: ["run", "work"], title: "t" } }).args).toEqual(["run", "work"]);
  });
});
