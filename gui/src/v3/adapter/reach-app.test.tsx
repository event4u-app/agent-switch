/**
 * Spec §11 against the mounted app: `V3App` with the 2.11 store, the v3 feeds
 * and the adapter, fed by fixture CLI output instead of raw `V3Data` props.
 * `reach.test.tsx` proves the window's click paths; this proves the adapter
 * fills them from what the CLI actually prints.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const NOW = Date.now();

const { create, calls } = vi.hoisted(() => {
  const calls: { name: string; args: string[] }[] = [];
  const create = vi.fn((name: string, args: string[]) => {
    calls.push({ name, args });
    const out = (globalThis as { __cli?: (line: string) => unknown }).__cli?.(args.join(" "));
    return {
      execute: async () => (out === undefined ? { code: 1, stdout: "", stderr: "not in fixture" } : { code: 0, stdout: JSON.stringify(out), stderr: "" }),
      spawn: async () => ({}),
    };
  });
  return { create, calls };
});
vi.mock("@tauri-apps/plugin-shell", () => ({ Command: { create }, open: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ getCurrentWebviewWindow: () => ({ label: "main", onFocusChanged: async () => () => {} }) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emit: vi.fn() }));
vi.mock("@tauri-apps/plugin-autostart", () => ({ enable: vi.fn(), disable: vi.fn(), isEnabled: vi.fn(async () => false) }));
vi.mock("@tauri-apps/plugin-notification", () => ({ isPermissionGranted: vi.fn(async () => false), requestPermission: vi.fn(), sendNotification: vi.fn(), onAction: vi.fn(async () => ({ unregister() {} })) }));

import V3App from "./V3App.js";

const session = {
  provider: "claude",
  sessionId: "0f1e2d3c-aaaa-bbbb-cccc-000000000001",
  projectDir: "-code-store",
  cwd: "/code/store",
  summary: "Event store",
  mtimeMs: NOW - 60_000,
  birthtimeMs: NOW - 3_600_000,
  live: true,
  file: "/x/0f1e.jsonl",
  liveSource: "process",
  pid: 4242,
  hostStatus: "idle",
  profile: "work",
  armed: null,
  context: { pct: 40, contextTokens: 80_000, windowTokens: 200_000, model: "claude-opus", effort: "high", confidence: "exact", source: "transcript" },
  cache: null,
  git: { toplevel: "/code/store", branch: "feat/store", headSha: "abc1234", dirty: true, changed: 2, ahead: null, behind: null, upstream: null, remote: null, worktree: false, cwd: "/code/store", cwdSource: "process" },
  prs: [],
  library: null,
  kept: null,
  vault: null,
  canResume: true,
};

function fixture(engineRunning: boolean) {
  const lines: Record<string, unknown> = {
    "list --json": [{ provider: "claude", name: "work", identity: "me@example.com", label: "work", color: null, disabled: false, active: true, liveSessions: 1 }],
    "sessions --recent 50 --json": [session],
    "sessions --recent 20 --json": [session],
    "sessions --recent 20 --provider codex --json": [],
    "needs --json": {
      items: [{ id: "l", kind: "limit", subject: "claude/work", who: "work", what: "94% of 5h", verb: "Decide", since: new Date(NOW).toISOString(), version: "1" }],
      away: null,
      history: [{ id: "h", kind: "ask", who: "Checkout flow", what: "asked you", doneAt: new Date(NOW - 600_000).toISOString() }],
    },
    "engine status --json": engineRunning
      ? { running: true, address: "/tmp/engine.sock", protocol: 1, pid: 1, driver: "node:sqlite", hostedRunning: 0 }
      : { running: false, reason: "not running", hostedRunning: 0 },
    "host list --json": { mode: "persistent", hosted: [], legacy: [] },
    // A limit need is only raised with usage known, so the fixture carries it.
    "status --provider claude work --json": {
      provider: "claude",
      name: "work",
      identity: "me@example.com",
      usage: { windows: [{ key: "five_hour", label: "5h", utilization: 94, resetsAt: new Date(NOW + 3_600_000).toISOString() }], routines: null, capturedAt: new Date(NOW).toISOString() },
      context: null,
    },
    "sessions library --json": { autoKeep: true, vaultBytes: 0, entries: [] },
    "open-targets --json": { default: "vscode", perRepo: {}, lastUsed: null, targets: [{ target: "vscode", label: "VS Code", kind: "editor", installed: true }] },
  };
  return (line: string) => lines[line];
}

async function mount({ engineRunning = true } = {}) {
  (globalThis as { __cli?: unknown }).__cli = fixture(engineRunning);
  calls.length = 0;
  render(<V3App />);
  await screen.findAllByText("Event store", {}, { timeout: 3000 });
}

let clicks = 0;
const click = (el: Element) => (clicks++, fireEvent.click(el));

afterEach(() => {
  cleanup();
  clicks = 0;
});

describe("V3App on fixture CLI output (spec §11)", () => {
  it("Overview: the needs item and the running session come from the CLI", async () => {
    await mount();
    expect(await screen.findByText("94% of 5h")).toBeTruthy();
    expect(within(screen.getByLabelText("Sessions window")).getByText("Event store")).toBeTruthy();
    expect(screen.getByText("Limits")).toBeTruthy();
  });

  it("Library: one click on the stripe", async () => {
    await mount();
    click(screen.getByLabelText("Library"));
    expect(await screen.findByText(/Pinned sessions are kept in the vault/)).toBeTruthy();
    expect(clicks).toBe(1);
  });

  it("Session sheet actions: session row, then ⋯", async () => {
    await mount();
    click(within(screen.getByLabelText("Sessions window")).getByText("Event store"));
    click(await screen.findByLabelText("Session actions: rename, pin, move, detach, end"));
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(clicks).toBe(2);
  });

  it("Near-limit decision: Decide opens the sheet and changes nothing", async () => {
    await mount();
    const before = calls.length;
    click(await screen.findByText("Decide"));
    expect(await screen.findByText(/Nothing changes until you choose/)).toBeTruthy();
    // Nothing moves or switches until a choice is made. Background engines (the
    // updater, the usage refresh) may run meanwhile; they are not the sheet's doing.
    const MOVES = new Set(["rebind", "takeover", "use", "handoff", "host", "compact"]);
    expect(calls.slice(before).filter((c) => MOVES.has(c.args[0]))).toEqual([]);
    expect(clicks).toBe(1);
  });

  it("Settings › Open in lists the targets the CLI reported", async () => {
    await mount();
    click(screen.getByLabelText("Settings ⌘,"));
    click(screen.getByRole("button", { name: "Open in" }));
    expect((await screen.findAllByText("VS Code")).length).toBeGreaterThan(0);
    expect(clicks).toBe(2);
  });

  it("Activity: today's history from needs --json behind the pill", async () => {
    await mount();
    click(screen.getByLabelText("Sessions ⌘B"));
    click(await screen.findByTitle("Needs you · ⌘J jumps to the next one"));
    expect(await screen.findByText("Earlier today")).toBeTruthy();
    expect(clicks).toBe(2);
  });

  it("Health: a stopped engine shows in the title bar", async () => {
    await mount({ engineRunning: false });
    expect(await screen.findByText("Engine stopped")).toBeTruthy();
  });

  it("Health: a running engine does not", async () => {
    await mount();
    await screen.findByText("94% of 5h");
    expect(screen.queryByText("Engine stopped")).toBeNull();
  });

  it("Start session: Start, then Why?", async () => {
    await mount();
    click(screen.getByText("Start session"));
    click(await screen.findByText("Why? ›"));
    expect(clicks).toBe(2);
  });
});
