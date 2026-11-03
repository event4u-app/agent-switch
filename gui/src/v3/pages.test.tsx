import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AccountsPage, AllSessionsPage, LibraryPage, filterSessions, nextDeadline, type LibraryRow, type PageAccount, type TableSession } from "./pages.js";

afterEach(cleanup);
const NOW = Date.UTC(2026, 10, 2, 12);
const acct = (over: Partial<PageAccount>): PageAccount => ({ key: "claude/work", tool: "claude", name: "work", color: "teal", protect: 98, next: false, signIn: false, checkedMs: NOW - 30_000, windows: [{ label: "5h", used: 39, resetsAtMs: null, pace: null }], email: "me@example.com", label: null, isDefault: true, running: 2, ...over });
const actions = () => ({ add: vi.fn(), refresh: vi.fn(), use: vi.fn(), signIn: vi.fn(), terminal: vi.fn(), more: vi.fn() });
const sess = (key: string, over: Partial<TableSession> = {}): TableSession => ({ key, title: `session ${key}`, state: "idle", live: true, tool: "claude", account: { name: "work", color: "teal" }, branch: "main", pr: null, model: "Opus", thinking: "high", contextPct: 40, lastActiveMs: NOW - 60_000, ...over });
const lib = (key: string, over: Partial<LibraryRow> = {}): LibraryRow => ({ key, name: `entry ${key}`, summary: null, tags: [], color: "teal", project: "agent-switch", branch: "main", pr: null, lastMs: NOW - 3_600_000, pinned: false, archived: false, vault: { state: "none", cleanupInDays: 20 }, transcript: true, ...over });

describe("Accounts page (spec §10.1)", () => {
  it("grouped per tool with the plain-command account; Use, Sign in, and the 2.11 views", () => {
    const on = actions();
    const onView = vi.fn();
    const { rerender } = render(<AccountsPage nowMs={NOW} nextRefreshMs={5 * 60_000} view="accounts" onView={onView} history={<p>history view</p>} pools={null} poolCount={4} on={on} accounts={[acct({}), acct({ key: "claude/side", name: "side", isDefault: false, running: 0 }), acct({ key: "codex/x", tool: "codex", name: "x", signIn: true, windows: [] })]} />);
    expect(screen.getByText("Claude")).toBeTruthy();
    expect(screen.getByText("Codex")).toBeTruthy();
    expect(screen.getByText("No usage before the first sign-in")).toBeTruthy();
    expect(screen.getAllByText("checked just now")).toHaveLength(2);
    fireEvent.click(screen.getByText("Use"));
    expect(on.use).toHaveBeenCalledWith("claude/side");
    fireEvent.click(screen.getByText("Sign in"));
    expect(on.signIn).toHaveBeenCalledWith("codex/x");
    fireEvent.click(screen.getByRole("radio", { name: "Usage history" }));
    expect(onView).toHaveBeenCalledWith("history");
    rerender(<AccountsPage nowMs={NOW} nextRefreshMs={null} view="history" onView={onView} history={<p>history view</p>} pools={null} poolCount={4} on={on} accounts={[acct({})]} />);
    expect(screen.getByText("history view")).toBeTruthy();
  });
});

describe("All sessions page (spec §10.2)", () => {
  it("filters by words, state and tool; selecting shows the labelled batch bar", () => {
    const rows = [sess("a", { title: "Event store", branch: "feat/store" }), sess("b", { live: false }), sess("c", { tool: "codex" })];
    expect(filterSessions(rows, "store", "all", "any").map((r) => r.key)).toEqual(["a"]);
    expect(filterSessions(rows, "", "done", "any").map((r) => r.key)).toEqual(["b"]);
    expect(filterSessions(rows, "", "all", "codex").map((r) => r.key)).toEqual(["c"]);
    const onOpen = vi.fn();
    const batch = vi.fn(() => ({ onClear: vi.fn(), onPin: vi.fn(), onArchive: vi.fn(), onClean: vi.fn(), onEnd: vi.fn() }));
    render(<AllSessionsPage sessions={rows} nowMs={NOW} onOpen={onOpen} batch={batch} />);
    expect(screen.getByRole("radio", { name: "Live 2" })).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Select Event store"));
    expect(onOpen).not.toHaveBeenCalled();
    expect(batch).toHaveBeenLastCalledWith(["a"]);
    fireEvent.click(screen.getByText("Event store"));
    expect(onOpen).toHaveBeenCalledWith("a");
    fireEvent.change(screen.getByLabelText("Filter"), { target: { value: "zzz" } });
    expect(screen.getByText("No session matches.")).toBeTruthy();
  });
});

describe("Library page (spec §10.3)", () => {
  it("the deadline banner names the soonest unkept entry; Keep it pins it", () => {
    const rows = [lib("a", { vault: { state: "none", cleanupInDays: 5 } }), lib("b", { name: "Release notes", vault: { state: "none", cleanupInDays: 3 } }), lib("c", { pinned: true, vault: { state: "saved", bytes: 2_097_152 } })];
    expect(nextDeadline(rows)?.key).toBe("b");
    const on = { autoKeep: vi.fn(), pin: vi.fn(), resume: vi.fn(), archive: vi.fn() };
    render(<LibraryPage rows={rows} vaultBytes={12_163_481} autoKeep nowMs={NOW} on={on} />);
    expect(screen.getByText("“Release notes” will be deleted by Claude in 3 days.")).toBeTruthy();
    fireEvent.click(screen.getByText("Keep it"));
    expect(on.pin).toHaveBeenCalledWith("b", true);
    expect(screen.getByText("vault 11.6 MB")).toBeTruthy();
    expect(screen.getByText(/kept · 2.0 MB/)).toBeTruthy();
  });

  it("a gone transcript cannot resume; Pinned and Archived views; archive toggles", () => {
    const on = { autoKeep: vi.fn(), pin: vi.fn(), resume: vi.fn(), archive: vi.fn() };
    const rows = [lib("a", { name: "Gone", pinned: true, transcript: false, vault: { state: "unavailable" } }), lib("b", { name: "Old", archived: true })];
    render(<LibraryPage rows={rows} vaultBytes={0} autoKeep={false} nowMs={NOW} on={on} />);
    expect(screen.getByText("can't resume")).toBeTruthy();
    expect(screen.queryByText("Old")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Archived 1" }));
    expect(screen.getByText("Old")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Restore"));
    expect(on.archive).toHaveBeenCalledWith("b", false);
  });
});
