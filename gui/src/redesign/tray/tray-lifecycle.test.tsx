import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

// The CLI's stored readouts (`limits --json`) as the tray reads them; every other call fails.
const shell = vi.hoisted(() => {
  const state = { utilization: 70, capturedAt: "", calls: [] as string[] };
  const create = vi.fn((_name: string, args: string[]) => {
    state.calls.push(args.join(" "));
    return {
      execute: async () =>
        args.join(" ") === "limits --json"
          ? {
              code: 0,
              stdout: JSON.stringify({
                v: 1,
                accounts: [{ id: "claude/work", snapshot: { capturedAt: state.capturedAt, routines: null, windows: [{ key: "five_hour", label: "5h", utilization: state.utilization, resetsAt: null }] } }],
              }),
              stderr: "",
            }
          : { code: 1, stdout: "", stderr: "fake" },
    };
  });
  return { state, create };
});
vi.mock("@tauri-apps/plugin-shell", () => ({ Command: { create: shell.create }, open: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ getCurrentWebviewWindow: () => ({ label: "tray", onFocusChanged: async () => () => {} }) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }));

import { emptyViewModel } from "../../vm/load.js";
import { ASProvider, useAS } from "../../vm/store.js";
import type { Account } from "../../vm/types.js";
import { STORED_USAGE_MS, TrayLifecycle } from "./TrayApp.js";

const NOW = Date.now();

const account: Account = {
  id: "claude:work",
  tool: "claude",
  name: "work",
  identity: null,
  plan: null,
  label: null,
  color: "blue",
  isDefault: true,
  state: "ready",
  windows: [{ key: "five_hour", label: "5h", utilization: 10, resetsAt: null }],
  checkedAt: NOW - 3_600_000,
  resetCredits: null,
  threshold: 98,
  protection: null,
  auth: null,
  surfaces: [],
  liveSessions: 0,
  pools: [],
};

function Bar() {
  const { accounts } = useAS();
  return <span data-testid="fill">{accounts[0]?.windows[0]?.utilization ?? "-"}</span>;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("TrayLifecycle", () => {
  it("shows the CLI's stored readout at once, before any full reload, and takes newer ones every minute", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    shell.state.capturedAt = new Date(NOW - 60_000).toISOString();
    shell.state.utilization = 70;
    // The full reload never finishes here: what shows comes from the stored readouts alone.
    render(
      <ASProvider initial={{ ...emptyViewModel(NOW), accounts: [account] }} load={() => new Promise(() => {})}>
        <TrayLifecycle />
        <Bar />
      </ASProvider>,
    );
    expect(screen.getByTestId("fill").textContent).toBe("10");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(screen.getByTestId("fill").textContent).toBe("70");

    shell.state.capturedAt = new Date(NOW).toISOString();
    shell.state.utilization = 85;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STORED_USAGE_MS);
    });
    expect(screen.getByTestId("fill").textContent).toBe("85");
    expect(shell.state.calls.filter((c) => c === "limits --json").length).toBeGreaterThanOrEqual(2);
  });
});
