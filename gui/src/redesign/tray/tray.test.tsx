import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AcRoot } from "../../ui/AcRoot.js";
import { emptyViewModel } from "../../vm/load.js";
import { ASProvider, useAS } from "../../vm/store.js";
import type { Account, Surface, ViewModel } from "../../vm/types.js";
import { appRequest, forwardable, forwardedOverlay, forwardedScreen, forwardToMain, openAppFromTray, TRAY_APP_EVENT, TRAY_OPEN_EVENT } from "./bridge.js";
import { attentionTarget, Tray } from "./Tray.js";

const tauri = vi.hoisted(() => ({ emitTo: vi.fn(() => Promise.resolve()), invoke: vi.fn(() => Promise.resolve()) }));
vi.mock("@tauri-apps/api/event", () => ({ emitTo: tauri.emitTo, listen: vi.fn(() => Promise.resolve(() => {})) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));

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

function fixture(over: Partial<ViewModel> = {}): ViewModel {
  return {
    ...emptyViewModel(NOW),
    readiness: "ready",
    accounts: [acc("work"), acc("side")],
    sessions: [
      {
        id: "claude:a",
        tool: "claude",
        accountId: "claude:work",
        project: "a",
        cwd: "/x/a",
        branch: null,
        title: "a",
        state: "working",
        startedAt: NOW,
        lastActiveAt: NOW,
        contextPct: 81,
        model: null,
        summary: null,
        why: [],
        protectionNote: null,
        surface: null,
      },
    ],
    attention: [{ id: "x", kind: "near-limit", title: "side is at 94 %", detail: "", accountId: "claude:side", primary: "Decide", at: NOW }],
    ...over,
  };
}

const desktop: Surface = {
  id: "claude-desktop",
  tool: "claude",
  name: "Claude Desktop",
  kind: "desktop",
  detected: true,
  copiesSettings: true,
  identitySeen: null,
  checkedAt: null,
};

function Where() {
  return <p data-testid="overlay">{useAS().overlay.kind}</p>;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Tray popover", () => {
  it("renders readiness, attention, accounts per tool and the status bar", () => {
    const onOpenApp = vi.fn();
    const onQuit = vi.fn();
    render(
      <AcRoot>
        <ASProvider initial={fixture()}>
          <Tray onOpenApp={onOpenApp} onQuit={onQuit} />
          <Where />
        </ASProvider>
      </AcRoot>,
    );
    expect(screen.getByText("AGENT SWITCH")).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.getByText("work")).toBeTruthy();
    expect(screen.getByText("side")).toBeTruthy();
    expect(screen.getByText("ctx 81%")).toBeTruthy();
    // A near-limit item opens its decision (forwarded to the main window).
    fireEvent.click(screen.getByText("side is at 94 %"));
    expect(screen.getByTestId("overlay").textContent).toBe("limit");
    expect(onOpenApp).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Quit Agent Switch" }));
    expect(onQuit).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Start session/ }));
    expect(screen.getByTestId("overlay").textContent).toBe("start");
  });

  it("offers each account's desktop app and starts it without opening the account", () => {
    const onOpenAccountApp = vi.fn();
    const vm = fixture({
      attention: [],
      surfaces: [desktop],
      accounts: [acc("work"), acc("off", { disabled: true }), acc("out", { state: "signed-out" }), acc("cx", { id: "codex:cx", tool: "codex" })],
    });
    render(
      <AcRoot>
        <ASProvider initial={vm}>
          <Tray onOpenAccountApp={onOpenAccountApp} />
          <Where />
        </ASProvider>
      </AcRoot>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open Claude Desktop as work" }));
    expect(onOpenAccountApp).toHaveBeenCalledWith("claude-desktop", "claude:work");
    expect(screen.getByTestId("overlay").textContent).toBe("none");
    // No app for a disabled or signed-out account, nor for a tool without one.
    expect(screen.queryByRole("button", { name: /as off$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /as out$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /as cx$/ })).toBeNull();
  });

  it("says Check health when not ready", () => {
    render(
      <AcRoot>
        <ASProvider initial={fixture({ readiness: "degraded", attention: [] })}>
          <Tray />
        </ASProvider>
      </AcRoot>,
    );
    expect(screen.getByText("Check health")).toBeTruthy();
  });
});

describe("tray bridge", () => {
  it("forwards data overlays only", () => {
    expect(forwardable({ kind: "start" })).toBe(true);
    expect(forwardable({ kind: "account", id: "claude:work" })).toBe(true);
    expect(forwardable({ kind: "none" })).toBe(false);
    expect(forwardable({ kind: "confirm", title: "t", body: "b", confirm: "c", onConfirm: () => {} })).toBe(false);
  });

  it("whitelists the overlay kinds and validates their shape", () => {
    expect(forwardable({ kind: "session", id: "claude:a" })).toBe(true);
    expect(forwardable({ kind: "limit", attentionId: "x" })).toBe(true);
    expect(forwardable({ kind: "notifications" })).toBe(true);
    expect(forwardable({ kind: "start", cwd: "/x", tool: "claude" })).toBe(true);
    // Never a terminal (it would run a command) or anything else.
    expect(forwardable({ kind: "terminal", run: { args: ["uninstall"], title: "x" } })).toBe(false);
    expect(forwardable({ kind: "terminal", toolId: "rtk", action: "install" })).toBe(false);
    expect(forwardable({ kind: "reauth", accountId: "claude:work" })).toBe(false);
    expect(forwardable({ kind: "fix", checkId: "a" })).toBe(false);
    // Wrong shapes.
    expect(forwardedOverlay({ kind: "account" })).toBeNull();
    expect(forwardedOverlay({ kind: "account", id: 5 })).toBeNull();
    expect(forwardedOverlay({ kind: "start", cwd: ["x"] })).toBeNull();
    expect(forwardedOverlay(null)).toBeNull();
    expect(forwardedOverlay("start")).toBeNull();
    // Extra keys are dropped.
    expect(forwardedOverlay({ kind: "account", id: "claude:work", run: { args: ["x"] } })).toEqual({ kind: "account", id: "claude:work" });
    expect(forwardedScreen("tools")).toBe("tools");
    expect(forwardedScreen("settings")).toBeNull();
  });

  it("an attention item leads to its overlay or screen", () => {
    const base = { title: "t", detail: "", primary: "p", at: NOW };
    expect(attentionTarget({ ...base, id: "l", kind: "near-limit", accountId: "claude:side" })).toEqual({ overlay: { kind: "limit", attentionId: "l" } });
    expect(attentionTarget({ ...base, id: "s", kind: "signed-out", accountId: "claude:side" })).toEqual({ overlay: { kind: "account", id: "claude:side" } });
    expect(attentionTarget({ ...base, id: "r", kind: "reauth", accountId: "claude:side" })).toEqual({ overlay: { kind: "account", id: "claude:side" } });
    expect(attentionTarget({ ...base, id: "u", kind: "update" })).toEqual({ screen: "tools" });
    expect(attentionTarget({ ...base, id: "h", kind: "health" })).toEqual({ screen: "health" });
    expect(attentionTarget({ ...base, id: "s2", kind: "signed-out" })).toBeNull();
  });

  it("accepts an app request only for a usable account whose tool has that app", () => {
    const vm = fixture({ surfaces: [desktop], accounts: [acc("work"), acc("off", { disabled: true })] });
    expect(appRequest(vm, { appId: "claude-desktop", accountId: "claude:work" })).toEqual({ appId: "claude-desktop", accountId: "claude:work" });
    expect(appRequest(vm, { appId: "claude-desktop", accountId: "claude:off" })).toBeNull();
    expect(appRequest(vm, { appId: "claude-desktop", accountId: "claude:nobody" })).toBeNull();
    expect(appRequest(vm, { appId: "codex-desktop", accountId: "claude:work" })).toBeNull();
    expect(appRequest(vm, { appId: "claude-desktop" })).toBeNull();
    expect(appRequest(vm, "claude-desktop")).toBeNull();
  });

  it("sends an app request to the main window and only hides the popover", async () => {
    await openAppFromTray("claude-desktop", "claude:work");
    expect(tauri.emitTo).toHaveBeenCalledWith("main", TRAY_APP_EVENT, { appId: "claude-desktop", accountId: "claude:work" });
    await waitFor(() => expect(tauri.invoke).toHaveBeenCalledWith("tray_hide"));
    expect(tauri.invoke).not.toHaveBeenCalledWith("show_window");
  });

  it("emits to the main window, shows it and hides the popover", async () => {
    await forwardToMain({ kind: "start" });
    expect(tauri.emitTo).toHaveBeenCalledWith("main", TRAY_OPEN_EVENT, { kind: "start" });
    await waitFor(() => expect(tauri.invoke).toHaveBeenCalledWith("tray_hide"));
    expect(tauri.invoke).toHaveBeenCalledWith("show_window");
  });
});
