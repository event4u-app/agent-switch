import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { AccountsPage, AllSessionsPage, LibraryPage, byProject, filterSessions, inListOrder, nextDeadline, type LibraryRow, type PageAccount, type TableSession } from "./pages.js";

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

describe("Accounts page › routines", () => {
  const page = (a: PageAccount) => render(<AccountsPage nowMs={NOW} nextRefreshMs={null} view="accounts" onView={vi.fn()} history={null} pools={null} poolCount={0} on={actions()} accounts={[a]} />);

  it("shows the routines the readout carries, used of limit, a used count of 0 included", () => {
    page(acct({ routines: { used: 3, limit: 15 } }));
    expect(screen.getByText("Routines 3/15 today")).toBeTruthy();
    cleanup();
    page(acct({ routines: { used: 0, limit: 5 } }));
    expect(screen.getByText("Routines 0/5 today")).toBeTruthy();
  });

  it("a readout without routines draws no row, never a zero", () => {
    page(acct({ routines: null }));
    expect(screen.queryByText(/Routines/)).toBeNull();
    cleanup();
    page(acct({}));
    expect(screen.queryByText(/Routines/)).toBeNull();
  });
});

describe("All sessions page (spec §10.2)", () => {
  it("filters by words, state and tool; selecting shows the labelled batch bar", () => {
    const rows = [sess("a", { title: "Event store", branch: "feat/store" }), sess("b", { live: false }), sess("c", { tool: "codex" })];
    expect(filterSessions(rows, "store", "all", "any").map((r) => r.key)).toEqual(["a"]);
    expect(filterSessions(rows, "", "done", "any").map((r) => r.key)).toEqual(["b"]);
    expect(filterSessions(rows, "", "all", "codex").map((r) => r.key)).toEqual(["c"]);
    expect(filterSessions(rows, "", "all", new Set(["codex"] as const)).map((r) => r.key)).toEqual(["c"]);
    expect(filterSessions(rows, "", "all", new Set()).length, "nothing ticked = every tool").toBe(3);
    const onOpen = vi.fn();
    const batch = vi.fn(() => ({ onClear: vi.fn(), onPin: vi.fn(), onArchive: vi.fn(), onClean: vi.fn(), onEnd: vi.fn() }));
    render(<AllSessionsPage sessions={rows} nowMs={NOW} onOpen={onOpen} batch={batch} />);
    // Status tabs with counts; a tab with nothing behind it is hidden (proposal E).
    expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual(["All 3", "Idle 2", "Done 1", "List", "Projects"]);
    // Tools: a multi-select dropdown (owner, 2026-11-24); nothing ticked reads "All tools".
    expect(screen.getByRole("button", { name: "Tool: All tools" })).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Select Event store"));
    expect(onOpen).not.toHaveBeenCalled();
    expect(batch).toHaveBeenLastCalledWith(["a"]);
    fireEvent.click(screen.getByText("Event store"));
    expect(onOpen).toHaveBeenCalledWith("a");
    fireEvent.change(screen.getByLabelText("Filter"), { target: { value: "zzz" } });
    expect(screen.getByText("No session matches.")).toBeTruthy();
  });
});

describe("All sessions follows the sidebar's order (8.6)", () => {
  it("rows in the sidebar's order first, then the rest newest first", () => {
    const rows = [sess("a", { lastActiveMs: NOW - 1_000 }), sess("b"), sess("done-old", { live: false, lastActiveMs: NOW - 9_000_000 }), sess("done-new", { live: false, lastActiveMs: NOW - 5_000 }), sess("c")];
    expect(inListOrder(rows, ["c", "b", "a"]).map((r) => r.key)).toEqual(["c", "b", "a", "done-new", "done-old"]);
  });

  it("the page lists the rows in the order it is given", () => {
    const rows = [sess("a", { title: "Newest" }), sess("b", { title: "Needs you" })];
    render(<AllSessionsPage sessions={rows} order={["b", "a"]} nowMs={NOW} onOpen={vi.fn()} batch={() => ({}) as never} />);
    const titles = screen.getAllByText(/Newest|Needs you/).map((e) => e.textContent);
    expect(titles).toEqual(["Needs you", "Newest"]);
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

  it("a gone transcript cannot resume; All shows archived rows with their chip (G1); Pinned and Archived views; archive toggles", () => {
    const on = { autoKeep: vi.fn(), pin: vi.fn(), resume: vi.fn(), archive: vi.fn() };
    const rows = [lib("a", { name: "Gone", pinned: true, transcript: false, vault: { state: "unavailable" } }), lib("b", { name: "Old", archived: true })];
    render(<LibraryPage rows={rows} vaultBytes={0} autoKeep={false} nowMs={NOW} on={on} />);
    expect(screen.getByText("can't resume")).toBeTruthy();
    // As on the boards: All is everything, an archived row carries its chip.
    expect(screen.getByText("Old")).toBeTruthy();
    expect(screen.getByText("archived")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Pinned 1" }));
    expect(screen.queryByText("Old")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Archived 1" }));
    expect(screen.getByText("Old")).toBeTruthy();
    expect(screen.queryByText("Gone")).toBeNull();
    fireEvent.click(screen.getByLabelText("Restore"));
    expect(on.archive).toHaveBeenCalledWith("b", false);
  });

  // A fresh vault is the common case. A header row in its own box with a
  // footnote under it read as a broken table; the message sits in the table.
  it("an empty library says how sessions get there, inside the table", () => {
    const on = { autoKeep: vi.fn(), pin: vi.fn(), resume: vi.fn(), archive: vi.fn() };
    const { rerender } = render(<LibraryPage rows={[]} vaultBytes={0} autoKeep nowMs={NOW} on={on} />);
    const empty = screen.getByRole("status");
    expect(empty.textContent).toMatch(/pin a session/i);
    expect(empty.textContent).toMatch(/merged sessions/i);
    expect(empty.closest(".rounded-\\[10px\\]")).not.toBeNull();
    rerender(<LibraryPage rows={[lib("a", { name: "Kept" })]} vaultBytes={0} autoKeep nowMs={NOW} on={on} />);
    fireEvent.change(screen.getByPlaceholderText(/Name, summary/), { target: { value: "zzz" } });
    expect(screen.getByRole("status").textContent).toBe("No entry matches “zzz”.");
  });
});

describe("All sessions › Projects", () => {
  it("groups by project, most recently active first, no project last; List is the default", () => {
    const rows = [
      sess("a", { title: "A", project: "agent-switch", lastActiveMs: NOW - 9_000 }),
      sess("b", { title: "B", project: null, lastActiveMs: NOW }),
      sess("c", { title: "C", project: "web", lastActiveMs: NOW - 1_000 }),
      sess("d", { title: "D", project: "agent-switch", lastActiveMs: NOW - 2_000 }),
    ];
    expect(byProject(rows).map((g) => [g.project, g.rows.map((r) => r.key)])).toEqual([
      ["web", ["c"]],
      ["agent-switch", ["a", "d"]],
      [null, ["b"]],
    ]);
    // List or Projects is the page's own switch (owner, 2026-11-24); it starts from the sidebar's grouping.
    render(<AllSessionsPage sessions={rows} nowMs={NOW} onOpen={vi.fn()} batch={() => ({}) as never} />);
    expect(screen.queryByText("No project")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Projects" }));
    expect(screen.getByText("agent-switch")).toBeTruthy();
    cleanup();
    render(<AllSessionsPage sessions={rows} group="project" nowMs={NOW} onOpen={vi.fn()} batch={() => ({}) as never} />);
    expect(screen.getByText("No project")).toBeTruthy();
  });
});

describe("All sessions, fewer columns (proposal E)", () => {
  it("Needs you counts waiting and CI-failing sessions; one tool hides the tool filter", () => {
    const rows = [sess("a", { state: "needs-you" }), sess("b", { pr: { number: 1, ci: "FAILURE" } }), sess("c", { state: "working" }), sess("d")];
    expect(filterSessions(rows, "", "needs", "any").map((r) => r.key)).toEqual(["a", "b"]);
    render(<AllSessionsPage sessions={rows} nowMs={NOW} onOpen={vi.fn()} batch={() => ({}) as never} />);
    expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual(["All 4", "Needs you 2", "Running 1", "Idle 1", "List", "Projects"]);
    fireEvent.click(screen.getByRole("radio", { name: "Needs you 2" }));
    expect(screen.getAllByLabelText(/^Select /)).toHaveLength(2);
  });

  it("a value every row shares is said once above the table, not in every row; the tool is named only where it is not Claude", () => {
    const same = [sess("a", { model: "Opus 5.5", thinking: "High" }), sess("b", { model: "Opus 5.5", thinking: "High" })];
    const { rerender } = render(<AllSessionsPage sessions={same} nowMs={NOW} onOpen={vi.fn()} batch={() => ({}) as never} />);
    expect(screen.getByText(/^Every session here runs on .+ · Opus 5.5 · High\.$/)).toBeTruthy();
    expect(screen.queryByText("Account")).toBeNull();
    expect(screen.queryByText("Model")).toBeNull();
    rerender(<AllSessionsPage sessions={[...same, sess("c", { tool: "codex", model: "default", thinking: "medium" })]} nowMs={NOW} onOpen={vi.fn()} batch={() => ({}) as never} />);
    expect(screen.getByText("Account")).toBeTruthy();
    expect(screen.getAllByText(/ · Codex$/)).toHaveLength(1);
  });
});
