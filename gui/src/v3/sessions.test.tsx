import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SessionRow, SessionsZone, childNoun, childrenFromCli, liveOrder, sortLive, type RowSession } from "./sessions.js";

afterEach(cleanup);
const s = (key: string, over: Partial<RowSession> = {}): RowSession => ({ key, title: `title ${key}`, state: "idle", account: { name: "work", nearLimit: false }, branch: "main", pr: null, children: [], needsYou: false, ...over });
const batch = { onClear: vi.fn(), onPin: vi.fn(), onArchive: vi.fn(), onClean: vi.fn(), onEnd: vi.fn() };
const zone = (sessions: RowSession[], extra: Partial<Parameters<typeof SessionsZone>[0]> = {}) => (
  <SessionsZone sessions={sessions} activeKey={null} selection={null} openKeys={new Set()} onSelect={vi.fn()} onToggleChildren={vi.fn()} onCheck={vi.fn()} onCleanUp={vi.fn()} onDoneToday={vi.fn()} batch={batch} {...extra} />
);

describe("children from the CLI", () => {
  it("subagents, helpers and a count become rows with their source", () => {
    const kids = childrenFromCli({
      children: [
        { kind: "subagent", agentId: "a1", type: "Explore", state: "running", source: "hook" },
        { kind: "council", sessionKey: "claude/side/x", label: "seat 1", state: "done", source: "lineage" },
        { kind: "started_by", sessionKey: "claude/w/y", state: "running", source: "host" },
      ],
      childCount: 5,
      childSource: "hook+lineage+counted",
    });
    expect(kids.map((k) => [k.label, k.state, k.source, k.count ?? 1])).toEqual([
      ["Explore", "working", "hook", 1],
      ["seat 1", "done", "lineage", 1],
      ["started_by", "working", "host", 1],
      ["subagents", "done", "counted", 2],
    ]);
    expect(childrenFromCli({})).toEqual([]);
  });

  it("nouns: subagents, helper sessions, related sessions", () => {
    expect(childNoun(s("a", { children: [{ id: "1", label: "x", kind: "subagent", state: "working", source: "hook" }] }))).toBe("1 subagent");
    expect(childNoun(s("a", { children: [1, 2, 3].map((i) => ({ id: String(i), label: "seat", kind: "council", state: "done" as const, source: "lineage" as const })) }))).toBe("3 helper sessions");
    expect(childNoun(s("a", { children: [{ id: "1", label: "x", kind: "subagent", state: "done", source: "hook" }, { id: "2", label: "y", kind: "started_by", state: "done", source: "host" }] }))).toBe("2 related sessions");
  });
});

describe("Sessions zone (spec §5.2)", () => {
  it("one order: needs you, CI failing, working, the rest; done sessions are not listed", () => {
    const order = liveOrder([s("rest"), s("working", { state: "working" }), s("ci", { pr: { number: 1, ci: "FAILURE", mergeable: "MERGEABLE" } }), s("needs", { needsYou: true }), s("done", { state: "done" })]);
    expect(order.map((x) => x.key)).toEqual(["needs", "ci", "working", "rest"]);
  });

  it("one trailing slot by priority: near limit beats CI beats conflict beats needs-you beats children", () => {
    render(zone([s("a", { account: { name: "side", nearLimit: true }, pr: { number: 1, ci: "FAILURE", mergeable: "CONFLICTING" } }), s("b", { pr: { number: 2, ci: "SUCCESS", mergeable: "CONFLICTING" } })]));
    expect(screen.getByTitle("side is near its limit")).toBeTruthy();
    expect(screen.queryByLabelText("CI failing")).toBeNull();
    expect(screen.getByLabelText("merge conflict")).toBeTruthy();
  });

  it("the active row has the Marker and its second line; children unfold under it, unknown said inline", () => {
    const onToggle = vi.fn();
    const kids = [{ id: "c", label: "seat 1", kind: "council", state: "done" as const, source: "unknown" as const }];
    const { rerender } = render(zone([s("a", { children: kids })], { activeKey: "a", onToggleChildren: onToggle }));
    expect(screen.getByText("title a").className).toMatch(/font-medium/);
    expect(screen.getByText("main")).toBeTruthy();
    expect(screen.queryByText("seat 1"), "folded by default (C2)").toBeNull();
    fireEvent.click(screen.getByLabelText("Show 1 helper session"));
    expect(onToggle).toHaveBeenCalledWith("a");
    rerender(zone([s("a", { children: kids })], { activeKey: "a", openKeys: new Set(["a"]) }));
    expect(screen.getByText("seat 1")).toBeTruthy();
    expect(screen.getByText("relation unknown ⓘ")).toBeTruthy();
  });

  it("multi-select shows the compact batch bar and checks rows instead of opening them", () => {
    const onCheck = vi.fn();
    const onSelect = vi.fn();
    render(zone([s("a"), s("b")], { selection: new Set(["a"]), onCheck, onSelect }));
    expect(screen.getByText("1 selected")).toBeTruthy();
    fireEvent.click(screen.getByText("title b"));
    expect(onCheck).toHaveBeenCalledWith("b");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("'Done today' is one row with Clean up", () => {
    const onCleanUp = vi.fn();
    render(zone([s("a"), s("d1", { state: "done", doneToday: true }), s("d2", { state: "done", doneToday: true })], { onCleanUp }));
    expect(screen.getByText(/Done today 2/)).toBeTruthy();
    fireEvent.click(screen.getByText("Clean up"));
    expect(onCleanUp).toHaveBeenCalledOnce();
  });
});

describe("SessionRow title", () => {
  it("is a new node when selection changes its weight, so the browser decides the ellipsis again", () => {
    const s: RowSession = { key: "k", title: "Knowledge map: edge filter for stale links", state: "idle", account: { name: "work", nearLimit: false }, branch: null, pr: null, children: [], needsYou: false };
    const on = { onSelect: () => {}, onToggleChildren: () => {}, onCheck: () => {} };
    const { rerender } = render(<SessionRow s={s} {...on} />);
    const before = screen.getByTitle(s.title);
    rerender(<SessionRow s={s} active {...on} />);
    const after = screen.getByTitle(s.title);
    expect(after).not.toBe(before);
    expect(after.className).toContain("font-medium");
  });
});

describe("sort and group the list", () => {
  const rows = [s("a", { title: "Bravo", state: "working" }), s("b", { title: "Alpha", state: "needs-you" }), s("c", { title: "Charlie" }), s("d", { title: "Delta", state: "done" })];
  const at: Record<string, number> = { a: 10, b: 30, c: 20 };
  it("activity puts the most recent first, unknown times last; name and status as named; done stays out", () => {
    expect(sortLive(rows, "activity", (k) => at[k] ?? null).map((x) => x.key)).toEqual(["b", "c", "a"]);
    expect(sortLive(rows, "activity", (k) => (k === "a" ? 5 : null)).map((x) => x.key)).toEqual(["a", "b", "c"]);
    expect(sortLive(rows, "name", () => null).map((x) => x.title)).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(sortLive(rows, "status", () => null).map((x) => x.key)).toEqual(liveOrder(rows).map((x) => x.key));
  });

  it("groups get a header with their count, fold away, and keep the sort inside", () => {
    const onView = vi.fn();
    render(zone(rows, { sort: "activity", group: "account", lastActiveOf: (k) => at[k] ?? null, groupOf: (k) => (k === "c" ? "side" : "work"), onView }));
    const head = screen.getByTitle("Sort and group");
    expect(head.textContent).toBe("Account · Activity");
    fireEvent.click(head);
    expect(onView).toHaveBeenCalledOnce();
    const work = screen.getByRole("button", { name: /^work\s*2$/ });
    expect(screen.getAllByText(/^(Alpha|Bravo|Charlie)$/).map((e) => e.textContent)).toEqual(["Alpha", "Bravo", "Charlie"]);
    fireEvent.click(work);
    expect(work.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Alpha")).toBeNull();
    expect(screen.getByText("Charlie")).toBeTruthy();
  });
});
