import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";

// The section's only data channel is the CLI's `tooling --json` readout — mock
// the IPC wrapper so the component logic is testable without a Tauri runtime.
const toolingStatus = vi.hoisted(() => vi.fn());
vi.mock("./ipc.js", () => ({ toolingStatus }));

import {
  ToolingSection,
  sortByAttention,
  rowState,
  commandFromHint,
  FOCUS_REFRESH_AFTER_MS,
  type ToolingCache,
} from "./ToolingSection.js";
import type { ToolingEntry } from "./ipc.js";

const ok = (id: ToolingEntry["id"], over: Partial<ToolingEntry> = {}): ToolingEntry => ({
  id,
  present: true,
  version: "1.2.3",
  path: `/usr/local/bin/${id}`,
  healthy: true,
  hint: "",
  ...over,
});

const missing = (id: ToolingEntry["id"], hint: string): ToolingEntry => ({
  id,
  present: false,
  version: null,
  path: null,
  healthy: false,
  hint,
});

const wrongRtk: ToolingEntry = {
  id: "rtk",
  present: true,
  version: null,
  path: "/usr/local/bin/rtk",
  healthy: false,
  identity: "unknown-rtk",
  hint: "the `rtk` on PATH is not Token Killer (name collision) — install: `brew install rtk`",
};

const unverifiedRtk: ToolingEntry = {
  id: "rtk",
  present: true,
  version: null,
  path: "/usr/local/bin/rtk",
  healthy: false,
  identity: "unverified",
  hint: "could not verify `rtk` (probe timed out or crashed) — run `rtk gain` manually to check",
};

const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);

/** Stateful harness — the real parent (App) owns the cache the same way. */
function Harness({
  initial = null,
  isWindows = false,
  onNotifyError = () => {},
}: {
  initial?: ToolingCache | null;
  isWindows?: boolean;
  onNotifyError?: (message: string) => void;
}) {
  const [cache, setCache] = React.useState<ToolingCache | null>(initial);
  return <ToolingSection cache={cache} onCache={setCache} isWindows={isWindows} onNotifyError={onNotifyError} />;
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  writeText.mockClear().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  toolingStatus.mockResolvedValue([ok("agent-config"), ok("rtk", { identity: "token-killer" })]);
});
afterEach(() => vi.useRealTimers());

describe("pure helpers", () => {
  it("rowState classifies the three classes; sortByAttention leads with attention, keeps input order within groups", () => {
    const entries = [ok("agent-config"), missing("claude", "not installed — install the claude CLI"), wrongRtk, ok("codex"), missing("agy", "not installed — install the agy CLI")];
    expect(entries.map(rowState)).toEqual(["ok", "missing", "attention", "ok", "missing"]);
    expect(sortByAttention(entries).map((t) => t.id)).toEqual(["rtk", "claude", "agy", "agent-config", "codex"]);
  });

  it("commandFromHint extracts the LAST backticked span (the first can be a bare tool name)", () => {
    expect(commandFromHint(wrongRtk.hint)).toBe("brew install rtk");
    expect(commandFromHint(unverifiedRtk.hint)).toBe("rtk gain");
    expect(commandFromHint("not installed — install: `npm install -g @event4u/agent-config`")).toBe(
      "npm install -g @event4u/agent-config",
    );
    expect(commandFromHint("no command here")).toBeNull();
  });
});

describe("ToolingSection", () => {
  it("renders all four state classes with paired icon + text labels, attention-first", async () => {
    toolingStatus.mockResolvedValue([
      ok("agent-config", { version: "9.7.0" }),
      wrongRtk,
      missing("claude", "not installed — install the claude CLI, or link it: `agent-switch providers link --provider claude --path <path-to-binary>`"),
      ok("codex"),
    ]);
    render(<Harness />);
    await screen.findByText("agent-config");
    const rows = screen.getAllByTestId("tooling-row");
    // Sort order: wrong-binary (attention) → missing → healthy (input order kept)
    expect(rows.map((r) => r.dataset.state)).toEqual(["attention", "missing", "ok", "ok"]);
    expect(rows[0].textContent).toContain("rtk");
    expect(rows[0].textContent).toContain("Wrong binary");
    expect(rows[0].textContent).toContain("Rust Type Kit"); // the collision is named
    expect(rows[1].textContent).toContain("claude");
    expect(rows[1].textContent).toContain("Not installed");
    expect(rows[2].textContent).toContain("agent-config");
    expect(rows[2].textContent).toContain("OK");
    expect(rows[2].textContent).toContain("v9.7.0");
    expect(rows[2].textContent).toContain("/usr/local/bin/agent-config"); // path shown on healthy rows
  });

  it("renders the unverified state with the manual `rtk gain` check", async () => {
    toolingStatus.mockResolvedValue([unverifiedRtk]);
    render(<Harness />);
    const row = await screen.findByTestId("tooling-row");
    expect(row.dataset.state).toBe("attention");
    expect(row.textContent).toContain("Unverified");
    expect(row.textContent).toContain("identity check failed");
    fireEvent.click(screen.getByRole("button", { name: /copy command/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("rtk gain"));
  });

  it("copies the hint's command on a missing row and shows a transient Copied state", async () => {
    toolingStatus.mockResolvedValue([
      missing("agent-config", "not installed — install: `npm install -g @event4u/agent-config`"),
    ]);
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: /copy command/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("npm install -g @event4u/agent-config"));
    expect(await screen.findByRole("button", { name: /copied/i })).toBeTruthy();
  });

  it("shows the EACCES note for npm commands on macOS/Linux and hides it on Windows", async () => {
    toolingStatus.mockResolvedValue([
      missing("agent-config", "not installed — install: `npm install -g @event4u/agent-config`"),
      missing("rtk", "not installed — install: `brew install rtk`"),
    ]);
    render(<Harness isWindows={false} />);
    expect(await screen.findAllByTestId("tooling-row")).toHaveLength(2);
    expect(screen.getAllByText(/EACCES/)).toHaveLength(1); // npm row only, never the brew row
    cleanup();
    render(<Harness isWindows={true} />);
    expect(await screen.findAllByTestId("tooling-row")).toHaveLength(2);
    expect(screen.queryByText(/EACCES/)).toBeNull();
  });

  it("shows fixed-height skeleton rows while the first sweep runs (nothing cached), then the readout", async () => {
    let resolve!: (v: ToolingEntry[]) => void;
    toolingStatus.mockReturnValue(new Promise<ToolingEntry[]>((r) => (resolve = r)));
    render(<Harness />);
    expect(screen.getAllByTestId("tooling-skeleton")).toHaveLength(5); // layout reserved
    expect(screen.queryAllByTestId("tooling-row")).toHaveLength(0);
    await act(async () => resolve([ok("agent-config")]));
    expect(await screen.findByTestId("tooling-row")).toBeTruthy();
    expect(screen.queryAllByTestId("tooling-skeleton")).toHaveLength(0);
  });

  it("serves a cached readout without re-sweeping, and shows its age", async () => {
    render(<Harness initial={{ entries: [ok("agent-config")], at: Date.now() - 30_000 }} />);
    expect(await screen.findByTestId("tooling-row")).toBeTruthy();
    expect(toolingStatus).not.toHaveBeenCalled(); // cache is the point — no sweep per open
    expect(screen.getByText(/checked 30s ago/)).toBeTruthy();
  });

  it("the manual Refresh button re-runs the sweep", async () => {
    render(<Harness initial={{ entries: [ok("agent-config")], at: Date.now() }} />);
    expect(toolingStatus).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /refresh tooling/i }));
    await waitFor(() => expect(toolingStatus).toHaveBeenCalledTimes(1));
  });

  it("re-sweeps on window focus only when the cache is older than 60s", async () => {
    render(<Harness initial={{ entries: [ok("agent-config")], at: Date.now() - 5_000 }} />);
    fireEvent(window, new Event("focus"));
    await Promise.resolve();
    expect(toolingStatus).not.toHaveBeenCalled(); // fresh cache → no sweep
    cleanup();
    render(<Harness initial={{ entries: [ok("agent-config")], at: Date.now() - FOCUS_REFRESH_AFTER_MS - 1_000 }} />);
    fireEvent(window, new Event("focus"));
    await waitFor(() => expect(toolingStatus).toHaveBeenCalledTimes(1)); // stale cache → sweep
  });

  it("routes a sweep failure to the notification system only (never inline)", async () => {
    toolingStatus.mockRejectedValue(new Error("agent-switch tooling --json failed"));
    const onNotifyError = vi.fn();
    render(<Harness onNotifyError={onNotifyError} />);
    await waitFor(() => expect(onNotifyError).toHaveBeenCalledWith("agent-switch tooling --json failed"));
    expect(screen.queryByText(/tooling --json failed/)).toBeNull();
    expect(screen.getAllByTestId("tooling-skeleton")).toHaveLength(5); // still nothing cached
  });

  it("a clipboard failure routes to the notification system only", async () => {
    writeText.mockRejectedValue(new Error("clipboard blocked"));
    toolingStatus.mockResolvedValue([missing("rtk", "not installed — install: `brew install rtk`")]);
    const onNotifyError = vi.fn();
    render(<Harness onNotifyError={onNotifyError} />);
    fireEvent.click(await screen.findByRole("button", { name: /copy command/i }));
    await waitFor(() => expect(onNotifyError).toHaveBeenCalledWith("clipboard blocked"));
    expect(screen.queryByText(/clipboard blocked/)).toBeNull();
  });
});
