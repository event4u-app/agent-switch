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
    expect(screen.queryByText("CI failing")).toBeNull();
    expect(screen.getByText("merge conflict")).toBeTruthy();
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

  it("'Done today' is one row that opens All sessions; Clean up lives there (owner, 2026-11-24)", () => {
    const onDoneToday = vi.fn();
    render(zone([s("a"), s("d1", { state: "done", doneToday: true }), s("d2", { state: "done", doneToday: true })], { onDoneToday }));
    fireEvent.click(screen.getByText(/Done today 2/));
    expect(onDoneToday).toHaveBeenCalledOnce();
    expect(screen.queryByText("Clean up")).toBeNull();
  });
});

describe("state dot source and quiet work (D1, D3)", () => {
  const on = { onSelect: () => {}, onToggleChildren: () => {}, onCheck: () => {} };
  it("names who reported the state in the dot's tooltip", () => {
    render(<SessionRow s={s("a", { state: "working", stateSource: "host" })} {...on} />);
    expect(screen.getByTitle("Working · from Claude Code")).toBeTruthy();
    cleanup();
    render(<SessionRow s={s("b", { state: "idle", stateSource: "transcript" })} {...on} />);
    expect(screen.getByTitle(/from the transcript time$/)).toBeTruthy();
  });
  it("draws quiet work as the working dot without its pulse, plus the words", () => {
    const { container } = render(<SessionRow s={s("q", { state: "working", stateSource: "host", quiet: "no update in 34m" })} {...on} />);
    expect(screen.getByText("no update in 34m")).toBeTruthy();
    expect(container.querySelector(".ac-pulse")).toBeNull();
    cleanup();
    const busy = render(<SessionRow s={s("w", { state: "working", stateSource: "host" })} {...on} />);
    expect(busy.container.querySelector(".ac-pulse")).not.toBeNull();
    expect(screen.queryByText(/no update/)).toBeNull();
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
  it("worktree sub-headers (D8): none for one worktree; branch, a worktree chip for a linked one and the count for two", () => {
    const wt: Record<string, { id: string; branch: string | null; linked: boolean }> = {
      a: { id: "/code/shop-wt/feature", branch: "feature", linked: true },
      b: { id: "/code/shop", branch: "trunk", linked: false },
      c: { id: "/code/shop", branch: "trunk", linked: false },
    };
    const one = render(zone(rows, { sort: "name", group: "project", groupOf: () => "/code/shop", worktreeOf: () => wt.b }));
    expect(screen.queryByRole("heading", { level: 4 })).toBeNull();
    expect(screen.queryByText("worktree")).toBeNull();
    one.unmount();

    render(zone(rows, { sort: "name", group: "project", groupOf: () => "/code/shop", worktreeOf: (k) => wt[k] ?? null }));
    const heads = screen.getAllByRole("heading", { level: 4 });
    expect(heads.map((h) => h.textContent)).toEqual(["trunk2", "featureworktree1"]);
    // Rows sit under their worktree, the sort kept inside each.
    expect(screen.getAllByText(/^(Alpha|Bravo|Charlie|trunk|feature)$/).map((e) => e.textContent)).toEqual(["trunk", "Alpha", "Charlie", "feature", "Bravo"]);

    cleanup();
    render(zone(rows, { sort: "name", group: "account", groupOf: () => "work", worktreeOf: (k) => wt[k] ?? null }));
    expect(screen.queryByRole("heading", { level: 4 })).toBeNull();
  });
});

describe("order hold (D9)", () => {
  const rows = [s("a"), s("b"), s("c")];
  const times = (t: Record<string, number>) => (k: string) => t[k] ?? null;
  const order = (c: HTMLElement) => ["a", "b", "c", "x"].map((k) => [k, c.textContent!.indexOf(`title ${k}`)] as const).filter(([, i]) => i >= 0).sort((p, q) => p[1] - q[1]).map(([k]) => k);

  it("holds the rows in place while the pointer is on the list, and applies the new order after it leaves", () => {
    const { container, rerender } = render(zone(rows, { lastActiveOf: times({ a: 3, b: 2, c: 1 }) }));
    expect(order(container)).toEqual(["a", "b", "c"]);
    const list = container.querySelector("[data-session-list]")!;
    fireEvent.mouseEnter(list);
    rerender(zone(rows, { lastActiveOf: times({ a: 3, b: 2, c: 4 }) }));
    expect(order(container), "row 3 stays in place").toEqual(["a", "b", "c"]);
    rerender(zone([...rows, s("x")], { lastActiveOf: times({ a: 3, b: 2, c: 4, x: 5 }) }));
    expect(order(container), "an arrival goes where the new order puts it").toEqual(["x", "a", "b", "c"]);
    rerender(zone([s("a"), s("c"), s("x")], { lastActiveOf: times({ a: 3, c: 4, x: 5 }) }));
    expect(order(container), "a row that left disappears").toEqual(["x", "a", "c"]);
    fireEvent.mouseLeave(list);
    expect(order(container)).toEqual(["x", "c", "a"]);
  });

  it("holds while a row has keyboard focus, and releases when focus leaves the list", () => {
    const { container, rerender } = render(zone(rows, { lastActiveOf: times({ a: 3, b: 2, c: 1 }) }));
    const row = container.querySelector("[data-session-list] [role=button]") as HTMLElement;
    const visible = vi.spyOn(row, "matches").mockImplementation((q) => q === ":focus-visible");
    fireEvent.focus(row);
    rerender(zone(rows, { lastActiveOf: times({ a: 3, b: 2, c: 4 }) }));
    expect(order(container), "held under keyboard focus").toEqual(["a", "b", "c"]);
    fireEvent.blur(row, { relatedTarget: document.body });
    expect(order(container)).toEqual(["c", "a", "b"]);
    visible.mockRestore();
  });

  it("holds the flat order, then groups", () => {
    const groupOf = (k: string) => (k === "b" ? "two" : "one");
    const { container, rerender } = render(zone(rows, { group: "project", groupOf, lastActiveOf: times({ a: 3, b: 2, c: 1 }) }));
    fireEvent.mouseEnter(container.querySelector("[data-session-list]")!);
    rerender(zone(rows, { group: "project", groupOf, lastActiveOf: times({ a: 1, b: 2, c: 3 }) }));
    expect(order(container)).toEqual(["a", "c", "b"]);
  });
});

describe("one status vocabulary (5.1)", () => {
  const on = { onSelect: () => {}, onToggleChildren: () => {}, onCheck: () => {} };
  const failing = (over: Partial<RowSession> = {}) => s("ci", { state: "needs-you", pr: { number: 12, ci: "FAILURE", mergeable: "MERGEABLE" }, ...over });

  it("a row carries one status mark: CI failing is words on its own attention line, never a ⊗ beside the state dot", () => {
    const { container } = render(<SessionRow s={failing()} comfortable {...on} />);
    expect(container.querySelectorAll("svg")).toHaveLength(0);
    const ci = screen.getAllByText(/CI failing/);
    expect(ci, "said once").toHaveLength(1);
    expect(ci[0].textContent).toMatch(/#12 CI failing$/);
    // Between the title and the account line (owner, 2026-11-24), on the red bar.
    expect(ci[0].closest("[data-attention]")!.className).toMatch(/text-ac-alert-text/);
  });

  it("the attention line: needs you, a waiting child, the PR problem, a near limit — highlighted, in that order", () => {
    const row = s("x", { state: "idle", needsYou: true, pr: { number: 5, ci: "SUCCESS", mergeable: "CONFLICTING" }, account: { name: "side", nearLimit: true } });
    render(<SessionRow s={row} comfortable {...on} />);
    const line = document.querySelector("[data-attention]")!;
    // One bar, in that order, in its most serious tone (owner, 2026-11-24: info blue, warnings orange, problems red).
    expect(line.textContent).toBe("Needs you · #5 merge conflict · side near its limit");
    expect(line.getAttribute("data-tone")).toBe("alert");
    expect(line.className).toMatch(/bg-ac-alert-tint/);
    cleanup();
    render(<SessionRow s={s("calm")} comfortable {...on} />);
    expect(document.querySelector("[data-attention]"), "nothing to do: no extra line").toBeNull();
  });

  it("a compact row says CI failing and merge conflict in words in its one trailing slot", () => {
    render(<SessionRow s={failing()} {...on} />);
    expect(screen.getByText("CI failing")).toBeTruthy();
    cleanup();
    const { container } = render(<SessionRow s={s("m", { pr: { number: 3, ci: "SUCCESS", mergeable: "CONFLICTING" } })} {...on} />);
    expect(screen.getByText("merge conflict").className).toMatch(/text-ac-alert-text/);
    expect(container.querySelectorAll("svg")).toHaveLength(0);
  });

  it("the selected row and a checked box use the neutral accent; brand orange stays out of the list", () => {
    const { container } = render(<SessionRow s={s("a")} active {...on} />);
    expect(container.querySelector(".border-l-ac-text")).toBeTruthy();
    expect(container.innerHTML).not.toMatch(/ac-brand/);
    cleanup();
    const sel = render(<SessionRow s={s("b")} selecting checked {...on} />);
    expect(sel.getByRole("checkbox").className).toMatch(/bg-ac-text/);
    expect(sel.container.innerHTML).not.toMatch(/ac-brand/);
  });
});

describe("status groups with counts (proposal B)", () => {
  const rows = [
    s("w1", { title: "Working one", state: "working" }),
    s("n1", { title: "Asking one", state: "needs-you", needsYou: true }),
    s("n2", { title: "Failing one", pr: { number: 3, ci: "FAILURE", mergeable: "MERGEABLE" } }),
    s("i1", { title: "Idle one" }),
  ];
  it("Needs you, Running, Idle — in that order, each with a count pill", () => {
    render(zone(rows, { group: "status" }));
    const heads = screen.getAllByRole("button", { expanded: true }).map((b) => b.textContent);
    expect(heads).toEqual(["Needs you2", "Running1"]);
    // Idle starts folded (owner, 2026-11-24); one click opens it.
    const idle = screen.getByRole("button", { expanded: false, name: /^Idle/ });
    expect(idle.textContent).toBe("Idle1");
    expect(screen.queryByText("Idle one")).toBeNull();
    fireEvent.click(idle);
    expect(screen.getAllByText(/^(Asking|Failing|Working|Idle) one$/).map((e) => e.textContent)).toEqual(["Asking one", "Failing one", "Working one", "Idle one"]);
  });
  it("Idle stays open when the open session is idle", () => {
    render(zone(rows, { group: "status", activeKey: "i1" }));
    expect(screen.getByText("Idle one")).toBeTruthy();
  });
  it("a session a Needs-you row already shows is not listed twice; an empty group has no header", () => {
    render(zone(rows, { group: "status", inNeeds: new Set(["n1", "n2"]) }));
    expect(screen.queryByText("Asking one")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Needs you/ })).toBeNull();
    expect(screen.getByText("Working one")).toBeTruthy();
  });
  it("a long group shows five rows and “N more”, which opens it; the active row always shows", () => {
    const many = Array.from({ length: 9 }, (_, i) => s(`r${i}`, { title: `Run ${i}`, state: "working" }));
    render(zone(many, { group: "status", sort: "name", activeKey: "r8" }));
    expect(screen.getAllByText(/^Run \d$/).map((e) => e.textContent)).toEqual(["Run 0", "Run 1", "Run 2", "Run 3", "Run 4", "Run 8"]);
    fireEvent.click(screen.getByRole("button", { name: "3 more ›" }));
    expect(screen.getAllByText(/^Run \d$/)).toHaveLength(9);
  });
});

describe("ended sessions under the status grouping", () => {
  const NOW = new Date(2026, 10, 24, 15, 0).getTime();
  const rows = [
    s("claude/w/live", { state: "working" }),
    s("claude/w/today", { state: "done", doneToday: true, lastActiveMs: NOW - 60 * 60_000 }),
    s("claude/w/old", { state: "done", doneToday: true, lastActiveMs: NOW - 26 * 60 * 60_000 }),
  ];
  it("pins Done today and Older below the list; each opens All sessions", () => {
    const onDoneToday = vi.fn();
    render(zone(rows, { group: "status", nowMs: NOW, onDoneToday }));
    const pinned = document.querySelector("[data-done-groups]") as HTMLElement;
    expect(pinned.textContent).toMatch(/Done today1.*Older1/);
    expect(screen.queryByText("title claude/w/today")).toBeNull();
    for (const b of pinned.querySelectorAll('button[title^="Open All sessions"]')) fireEvent.click(b);
    // Each opens All sessions on its own tab.
    expect(onDoneToday.mock.calls).toEqual([["today"], ["older"]]);
  });
  it("leaves an empty row out", () => {
    render(zone(rows.slice(0, 2), { group: "status", nowMs: NOW }));
    expect(document.querySelector("[data-done-groups]")!.textContent).not.toContain("Older");
  });
});
