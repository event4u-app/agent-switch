import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AcRoot } from "../../ui/AcRoot.js";
import { emptyViewModel } from "../../vm/load.js";
import { ASProvider, useAS } from "../../vm/store.js";
import type { Account, ViewModel } from "../../vm/types.js";
import { forwardable, forwardToMain, TRAY_OPEN_EVENT } from "./bridge.js";
import { Tray } from "./Tray.js";

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
    fireEvent.click(screen.getByText("side is at 94 %"));
    expect(onOpenApp).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Quit Agent Switch" }));
    expect(onQuit).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Start session/ }));
    expect(screen.getByTestId("overlay").textContent).toBe("start");
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

  it("emits to the main window, shows it and hides the popover", async () => {
    await forwardToMain({ kind: "start" });
    expect(tauri.emitTo).toHaveBeenCalledWith("main", TRAY_OPEN_EVENT, { kind: "start" });
    await waitFor(() => expect(tauri.invoke).toHaveBeenCalledWith("tray_hide"));
    expect(tauri.invoke).toHaveBeenCalledWith("show_window");
  });
});
