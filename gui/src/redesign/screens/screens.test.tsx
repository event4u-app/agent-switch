import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { AcRoot } from "../../ui/AcRoot.js";
import type { Actions } from "../../vm/actions.js";
import { emptyViewModel } from "../../vm/load.js";
import { ASProvider, useAS, type Overlay, type Screen } from "../../vm/store.js";
import type { Account, Session, ViewModel } from "../../vm/types.js";
import { OverlayHost, ScreenHost } from "../Hosts.js";
import { startPlan, startPreview, startProblem } from "./start-session.js";
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
  it("lists a session waiting on you under Needs you", () => {
    const vm = fixture();
    vm.sessions = vm.sessions.map((x) => (x.id === "claude:budmigo" ? { ...x, state: "needs-you" as const } : x));
    mount(vm);
    const section = screen.getByRole("region", { name: /Needs you/ });
    expect(within(section).getByText("budmigo")).toBeTruthy();
    expect(within(section).getByText(String(vm.attention.length + 1))).toBeTruthy();
  });

  it("shows needs, running sessions and what is left", () => {
    mount(fixture());
    expect(screen.getByText("2 of 2 accounts ready · 1 session working · 1 needs you")).toBeTruthy();
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

  it("leaves a Claude Desktop session to Desktop: no trash, no move, and says so", () => {
    const vm = fixture();
    vm.sessions = vm.sessions.map((x) => (x.id === "claude:old" ? { ...x, surface: "desktop-app" as const } : x));
    mount(vm, { overlay: { kind: "session", id: "claude:old" }, act: { trashSession: vi.fn() } });
    const trash = screen.getByRole("button", { name: /Move to trash/ }) as HTMLButtonElement;
    expect(trash.disabled).toBe(true);
    expect(trash.title).toBe("Started in Claude Desktop — delete it there.");
    expect(screen.getByText(/Started in Claude Desktop/, { selector: "p" })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "Take over" })).toBeNull();
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
    const preview = document.querySelector('[title^="agent-switch run work --provider claude --cwd "]');
    expect(preview?.textContent).toMatch(/ \$ claude$/);
    expect(screen.queryByText(/Not available here: starting in/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Start Claude/ }));
    expect(screen.getByTestId("where").textContent).toBe("home/terminal");
  });

  it("starts the terminal in the chosen folder via --cwd and previews `<folder> $ claude`", () => {
    const work = acc("work");
    const ready = { ...work, isDefault: true };
    const plan = startPlan(ready, "claude", "terminal", null, "/Users/x/dev/app");
    expect(plan).toEqual({ kind: "terminal", args: ["run", "work", "--provider", "claude", "--cwd", "/Users/x/dev/app"] });
    // Only an absolute folder is passed on: anything else (an unexpanded `~`, an
    // encoded transcript dir) can't be found by the CLI, so Start stays off.
    expect(startPlan(ready, "claude", "terminal", null, "-Users-x-dev-app")).toBeNull();
    expect(startPlan(ready, "claude", "terminal", null, "~/dev/app")).toBeNull();
    expect(startPlan(ready, "claude", "terminal", null, "")).toEqual({ kind: "terminal", args: ["run", "work", "--provider", "claude"] });
    expect(startPlan(ready, "claude", "terminal", null, "C:\\dev\\app")?.kind).toBe("terminal");
    expect(startPlan(ready, "claude", "terminal", null, "\\\\srv\\share")?.kind).toBe("terminal");
  });

  it("won't start on a disabled account, and says how to get it back", () => {
    const off = { ...acc("work"), disabled: true };
    expect(startPlan(off, "claude", "terminal", null, "")).toBeNull();
    expect(startProblem(off, "claude", "terminal", "")).toBe("work is disabled — turn it back on first (Accounts → work → ⋯ → Turn back on).");
  });

  it("says why Start is off instead of a silently disabled button", () => {
    const work = acc("work");
    expect(startProblem({ ...work, state: "signed-out" }, "claude", "terminal", "/x")).toMatch(/work is signed out — sign in again/);
    expect(startProblem(work, "claude", "terminal", "-Users-x-dev-app")).toMatch(/not a full folder path/);
    expect(startProblem(null, "codex", "terminal", "")).toBe("No Codex account to start on.");
    expect(startProblem(work, "claude", "terminal", "/Users/x/dev/app")).toBeNull();
    expect(startProblem(work, "claude", "desktop-app", "-x")).toBeNull();
    expect(startPreview("codex", "terminal", "/tmp/app", null, "work")).toEqual({ prompt: "/tmp/app", command: "codex" });
    expect(startPreview("claude", "terminal", "  ", null, "work").prompt).toBe("~/.agent-switch");
    expect(startPreview("claude", "desktop-app", "/tmp/app", "claude-desktop", "work").command).toBe("agent-switch open claude-desktop work");
  });

  it("Automatic runs with the account the CLI resolves for the folder, and shows its why", async () => {
    const explainFolder = vi.fn(async () => ({ profile: "claude/side", configDir: "/c", why: ["Mapped /Users/x/dev → side"] }));
    mount(fixture({ accounts: [acc("work", { isDefault: true }), acc("side")] }), {
      overlay: { kind: "start", cwd: "/Users/x/dev/app/sub" },
      act: { explainFolder },
    });
    expect(await screen.findByText("Automatic → side")).toBeTruthy();
    expect(explainFolder).toHaveBeenCalledWith("/Users/x/dev/app/sub", "claude");
    expect(screen.getByText("· Mapped /Users/x/dev → side")).toBeTruthy();
    expect(document.querySelector('[title^="agent-switch run side --provider claude --cwd /Users/x/dev/app/sub"]')).toBeTruthy();
  });

  it("falls back to the local match when the CLI doesn't answer", async () => {
    const explainFolder = vi.fn(async () => {
      throw new Error("offline");
    });
    const rule = {
      id: "r",
      match: { kind: "folder" as const, value: "/Users/x/dev/app" },
      tool: "claude" as const,
      target: { kind: "account" as const, accountId: "claude:side" },
      enabled: true,
      hits: null,
    };
    mount(fixture({ accounts: [acc("work", { isDefault: true }), acc("side")], rules: [rule] }), {
      overlay: { kind: "start", cwd: "/Users/x/dev/app/sub" },
      act: { explainFolder },
    });
    expect(await screen.findByText("Automatic → side")).toBeTruthy();
    expect(screen.getByText(/agent-switch didn't answer \(offline\)/)).toBeTruthy();
  });

  it("a typed folder starting with - is refused; Escape in the field does not close the dialog", () => {
    mount(fixture(), { overlay: { kind: "start" } });
    fireEvent.click(screen.getByRole("combobox", { name: "Folder" }));
    fireEvent.click(screen.getByRole("option", { name: "Choose another folder …" }));
    const field = screen.getByRole("textbox", { name: "Folder path" });
    fireEvent.change(field, { target: { value: "-rf" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(screen.getByRole("alert").textContent).toMatch(/can't start with/);
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.getByTestId("where").textContent).toBe("home/start");
    expect((screen.getByRole("textbox", { name: "Folder path" }) as HTMLInputElement).value).toBe("");
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
