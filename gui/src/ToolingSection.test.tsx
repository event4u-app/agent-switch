import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";

// The section's only data channel is the CLI's `tooling --json` readout — mock
// the IPC wrapper so the component logic is testable without a Tauri runtime.
const toolingStatus = vi.hoisted(() => vi.fn());
vi.mock("./ipc.js", () => ({ toolingStatus }));

// Stub only the outward-facing latest-version lookup (network); the pure
// helpers (toolUpdateAvailable & co) stay real so the button gating is
// exercised for real. Default: latest unknown → no Update buttons.
const latestToolVersion = vi.hoisted(() => vi.fn());
vi.mock("./tool-updates.js", async (importActual) => ({
  ...(await importActual<typeof import("./tool-updates.js")>()),
  latestToolVersion,
}));

import {
  ToolingSection,
  sortByAttention,
  rowState,
  commandFromHint,
  attentionSummary,
  platformLabel,
  FOCUS_REFRESH_AFTER_MS,
  type ToolingCache,
} from "./ToolingSection.js";
import type { ToolingEntry, ToolingId } from "./ipc.js";

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

const missingAgy = missing(
  "agy",
  "not installed — install the agy CLI, or link it: `agent-switch providers link --provider antigravity --path <path-to-binary>`",
);

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

// Present-but-broken (generic attention row, no identity) — keeps the
// copy-command fallback with an npm command, for the EACCES-note tests.
const unhealthyAc: ToolingEntry = {
  id: "agent-config",
  present: true,
  version: null,
  path: "/usr/local/bin/agent-config",
  healthy: false,
  hint: "`agent-config --version` failed to run — reinstall it (install: `npm install -g @event4u/agent-config`)",
};

const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);

/** Stateful harness — the real parent (App) owns the cache the same way. */
function Harness({
  initial = null,
  isWindows = false,
  profileCounts = {},
  agentConfigUpdateTo = null,
  onRunTool = () => {},
  onNotifyError = () => {},
}: {
  initial?: ToolingCache | null;
  isWindows?: boolean;
  profileCounts?: Partial<Record<ToolingId, number>>;
  agentConfigUpdateTo?: string | null;
  onRunTool?: (action: "install" | "upgrade", id: ToolingId) => void;
  onNotifyError?: (message: string) => void;
}) {
  const [cache, setCache] = React.useState<ToolingCache | null>(initial);
  return (
    <ToolingSection
      cache={cache}
      onCache={setCache}
      isWindows={isWindows}
      profileCounts={profileCounts}
      agentConfigUpdateTo={agentConfigUpdateTo}
      onRunTool={onRunTool}
      onNotifyError={onNotifyError}
    />
  );
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  writeText.mockClear().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  toolingStatus.mockResolvedValue([ok("agent-config"), ok("rtk", { identity: "token-killer" })]);
  latestToolVersion.mockResolvedValue(null); // latest unknown by default → honest: no Update buttons
});
afterEach(() => vi.useRealTimers());

describe("pure helpers", () => {
  it("rowState classifies the three classes; sortByAttention leads with attention, keeps input order within groups", () => {
    const entries = [ok("agent-config"), missing("claude", "not installed — install the claude CLI"), wrongRtk, ok("codex"), missingAgy];
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

  it("attentionSummary counts non-ok rows, with an all-healthy variant and singular grammar", () => {
    expect(attentionSummary([ok("agent-config"), wrongRtk, missingAgy, ok("codex"), ok("claude")])).toBe(
      "2 of 5 need attention",
    );
    expect(attentionSummary([ok("agent-config"), wrongRtk])).toBe("1 of 2 needs attention");
    expect(attentionSummary([ok("agent-config"), ok("rtk")])).toBe("All 2 healthy");
  });

  it("platformLabel maps the webview UA to an OS name and omits what it cannot know", () => {
    expect(platformLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit")).toBe("macOS");
    expect(platformLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("Windows");
    expect(platformLabel("Mozilla/5.0 (X11; Linux x86_64)")).toBe("Linux");
    expect(platformLabel("SomethingElse/1.0")).toBeNull();
  });
});

describe("ToolingSection", () => {
  it("renders the state classes with paired icon + text labels, descriptions, attention-first", async () => {
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
    expect(rows[1].textContent).toContain("Not found"); // the missing pill
    expect(rows[2].textContent).toContain("agent-config");
    expect(rows[2].textContent).toContain("OK");
    // Description line: what the tool does · version (per the design contract)
    expect(rows[2].textContent).toContain("Governance rules and skills for your agents · v9.7.0");
    expect(rows[2].textContent).toContain("/usr/local/bin/agent-config"); // path shown on healthy rows
    expect(rows[0].textContent).toContain("Shrinks verbose tool output"); // rtk description on every state
  });

  it("appends the isolated-profile count to provider rows (with singular grammar), never to others", async () => {
    toolingStatus.mockResolvedValue([ok("agent-config", { version: "9.7.0" }), ok("claude", { version: "2.4.1" }), ok("codex")]);
    render(<Harness profileCounts={{ claude: 4, codex: 1, agy: 0 }} />);
    await screen.findByText("claude");
    const rows = screen.getAllByTestId("tooling-row");
    const byId = (id: string) => rows.find((r) => r.textContent?.includes(id))!;
    expect(byId("claude").textContent).toContain("Claude Code CLI · v2.4.1 · 4 profiles isolated");
    expect(byId("codex").textContent).toContain("Codex CLI · v1.2.3 · 1 profile isolated");
    expect(byId("agent-config").textContent).not.toContain("isolated"); // not a provider row
  });

  it("shows the attention count in the header, or the all-healthy variant", async () => {
    toolingStatus.mockResolvedValue([ok("agent-config"), wrongRtk, missingAgy, ok("codex"), ok("claude")]);
    render(<Harness />);
    expect(await screen.findByText("2 of 5 need attention")).toBeTruthy();
    cleanup();
    toolingStatus.mockResolvedValue([ok("agent-config"), ok("rtk")]);
    render(<Harness />);
    expect(await screen.findByText("All 2 healthy")).toBeTruthy();
  });

  it("a missing tool with a verified command gets an Install button that runs `tooling install <id>`", async () => {
    toolingStatus.mockResolvedValue([missing("rtk", "not installed — install: `brew install rtk`")]);
    const onRunTool = vi.fn();
    render(<Harness onRunTool={onRunTool} />);
    fireEvent.click(await screen.findByRole("button", { name: /install/i }));
    expect(onRunTool).toHaveBeenCalledWith("install", "rtk");
    // The terminal run replaces the copy fallback — nothing to copy here.
    expect(screen.queryByRole("button", { name: /copy command/i })).toBeNull();
  });

  it("a healthy tool with a newer latest gets an Update button naming the version, running `tooling upgrade <id>`", async () => {
    toolingStatus.mockResolvedValue([ok("codex", { version: "1.2.3" })]);
    latestToolVersion.mockResolvedValue("1.3.0");
    const onRunTool = vi.fn();
    render(<Harness onRunTool={onRunTool} />);
    fireEvent.click(await screen.findByRole("button", { name: "Update to v1.3.0" }));
    expect(onRunTool).toHaveBeenCalledWith("upgrade", "codex");
    expect(latestToolVersion).toHaveBeenCalledWith("codex");
  });

  it("a healthy tool shows NO Update button when the latest is equal or unknown (honest, never speculative)", async () => {
    toolingStatus.mockResolvedValue([ok("codex", { version: "1.2.3" }), ok("claude", { version: "2.0.0" })]);
    // codex: up to date · claude: latest unfetchable (offline/rate-limited)
    latestToolVersion.mockImplementation(async (id: string) => (id === "codex" ? "1.2.3" : null));
    render(<Harness />);
    await screen.findByText("codex");
    await waitFor(() => expect(latestToolVersion).toHaveBeenCalledWith("claude"));
    expect(screen.queryByRole("button", { name: /update/i })).toBeNull();
  });

  it("fetches latest versions only for present+healthy rtk/claude/codex during the sweep", async () => {
    toolingStatus.mockResolvedValue([
      ok("rtk", { identity: "token-killer" }),
      ok("codex"),
      missing("claude", "not installed — install: `npm install -g @anthropic-ai/claude-code`"),
      ok("agent-config"),
      ok("agy"),
    ]);
    render(<Harness />);
    await screen.findByText("codex");
    await waitFor(() => expect(latestToolVersion).toHaveBeenCalledTimes(2));
    expect(latestToolVersion).toHaveBeenCalledWith("rtk");
    expect(latestToolVersion).toHaveBeenCalledWith("codex");
    expect(latestToolVersion).not.toHaveBeenCalledWith("claude"); // missing → nothing to update
    expect(latestToolVersion).not.toHaveBeenCalledWith("agent-config"); // App's detection is the single source
  });

  it("the agent-config Update button renders only when App's detection knows a newer version", async () => {
    toolingStatus.mockResolvedValue([ok("agent-config", { version: "9.7.0" })]);
    const onRunTool = vi.fn();
    render(<Harness agentConfigUpdateTo="9.8.0" onRunTool={onRunTool} />);
    fireEvent.click(await screen.findByRole("button", { name: "Update to v9.8.0" }));
    expect(onRunTool).toHaveBeenCalledWith("upgrade", "agent-config");
    expect(latestToolVersion).not.toHaveBeenCalledWith("agent-config"); // single source: App's detection
    cleanup();
    // No newer version known → no button (previously it always showed).
    render(<Harness agentConfigUpdateTo={null} />);
    await screen.findByText("agent-config");
    expect(screen.queryByRole("button", { name: /update/i })).toBeNull();
  });

  it("caches the latest versions WITH the sweep — a fresh cache renders the button without any refetch", async () => {
    render(
      <Harness
        initial={{ entries: [ok("rtk", { version: "0.34.3" })], at: Date.now(), latest: { rtk: "0.43.0" } }}
      />,
    );
    expect(await screen.findByRole("button", { name: "Update to v0.43.0" })).toBeTruthy();
    expect(toolingStatus).not.toHaveBeenCalled();
    expect(latestToolVersion).not.toHaveBeenCalled();
  });

  it("agy never gets a run button — missing keeps the copy-command fallback, healthy has no action", async () => {
    toolingStatus.mockResolvedValue([missingAgy]);
    render(<Harness />);
    const row = await screen.findByTestId("tooling-row");
    expect(screen.queryByRole("button", { name: /install/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /update/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /copy command/i }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("agent-switch providers link --provider antigravity --path <path-to-binary>"),
    );
    expect(row.textContent).toContain("Antigravity CLI");
    cleanup();
    toolingStatus.mockResolvedValue([ok("agy")]);
    render(<Harness />);
    await screen.findByTestId("tooling-row");
    expect(screen.queryByRole("button", { name: /install|update|copy/i })).toBeNull();
  });

  it("attention states keep the copy-command fallback (no automatic replacement of a foreign binary)", async () => {
    toolingStatus.mockResolvedValue([wrongRtk]);
    render(<Harness />);
    const row = await screen.findByTestId("tooling-row");
    expect(row.dataset.state).toBe("attention");
    expect(screen.queryByRole("button", { name: /install|update/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /copy command/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("brew install rtk"));
    expect(await screen.findByRole("button", { name: /copied/i })).toBeTruthy();
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

  it("shows the EACCES note only on COPY rows with npm commands (mac/linux), never on Windows or Install rows", async () => {
    toolingStatus.mockResolvedValue([
      unhealthyAc, // copy row with an npm command → note
      wrongRtk, // copy row with a brew command → no note
      missing("codex", "not installed — install: `npm install -g @openai/codex`"), // Install row → run is visible, no note
    ]);
    render(<Harness isWindows={false} />);
    expect(await screen.findAllByTestId("tooling-row")).toHaveLength(3);
    expect(screen.getAllByText(/EACCES/)).toHaveLength(1); // the npm COPY row only
    cleanup();
    render(<Harness isWindows={true} />);
    expect(await screen.findAllByTestId("tooling-row")).toHaveLength(3);
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

  it("serves a cached readout without re-sweeping, and shows its age in the footer", async () => {
    render(<Harness initial={{ entries: [ok("agent-config")], at: Date.now() - 30_000 }} />);
    expect(await screen.findByTestId("tooling-row")).toBeTruthy();
    expect(toolingStatus).not.toHaveBeenCalled(); // cache is the point — no sweep per open
    expect(screen.getByText(/Last checked 30s ago/)).toBeTruthy();
  });

  it("shows the platform tag in the footer, derived from the user agent (no invented arch)", async () => {
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      configurable: true,
    });
    render(<Harness initial={{ entries: [ok("agent-config")], at: Date.now() }} />);
    expect(await screen.findByText("macOS")).toBeTruthy();
    expect(screen.queryByText(/arm64|x86/)).toBeNull();
  });

  it("shows the doctor-parity caption (one source of truth, two renderers)", async () => {
    render(<Harness initial={{ entries: [ok("agent-config")], at: Date.now() }} />);
    expect(await screen.findByText(/can never disagree/)).toBeTruthy();
    expect(screen.getByText("agent-switch doctor")).toBeTruthy();
  });

  it("the Re-check button re-runs the sweep", async () => {
    render(<Harness initial={{ entries: [ok("agent-config")], at: Date.now() }} />);
    expect(toolingStatus).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /re-check tooling/i }));
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
    toolingStatus.mockResolvedValue([wrongRtk]);
    const onNotifyError = vi.fn();
    render(<Harness onNotifyError={onNotifyError} />);
    fireEvent.click(await screen.findByRole("button", { name: /copy command/i }));
    await waitFor(() => expect(onNotifyError).toHaveBeenCalledWith("clipboard blocked"));
    expect(screen.queryByText(/clipboard blocked/)).toBeNull();
  });
});
