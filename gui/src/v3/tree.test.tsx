/**
 * The session tree (road-to-a-tree-that-reads-at-a-glance Phases 2, 3, 5):
 * child identity, one row grammar, peek and open, connectors, roll-up, the idle fold.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { SessionRow, trailing, type ChildModel, type RowSession } from "./sessions.js";
import { V3Window, type V3Data } from "./window.js";
import { NOW, data, slots } from "./window-fixture.js";

afterEach(cleanup);

const s = (key: string, over: Partial<RowSession> = {}): RowSession => ({ key, title: `title ${key}`, state: "idle", account: { name: "work", nearLimit: false }, branch: "main", pr: null, children: [], needsYou: false, ...over });
const seat = (id: string, over: Partial<ChildModel> = {}): ChildModel => ({ id: `claude/work/${id}`, label: `seat ${id}`, kind: "council", state: "idle", source: "lineage", tool: "claude", account: { name: "work", color: "teal" }, ...over });
const sub = (id: string, over: Partial<ChildModel> = {}): ChildModel => ({ id, label: "Explore", kind: "subagent", state: "working", source: "hook", tool: "claude", account: { name: "work", color: "teal" }, ...over });
const on = { onSelect: vi.fn(), onToggleChildren: vi.fn(), onCheck: vi.fn() };
const rowOf = (r: RowSession, extra: Partial<Parameters<typeof SessionRow>[0]> = {}) => render(<SessionRow s={r} open {...on} {...extra} />);
const childRows = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>("[data-child-row]")];

describe("trailing slot over the tree (3.3, D6)", () => {
  it("a collapsed council with one seat waiting shows the amber dot, and its tooltip names the seat", () => {
    const r = s("c", { children: [seat("a"), seat("b", { state: "needs-you" }), seat("c")] });
    render(<>{trailing(r)}</>);
    const dot = screen.getByLabelText("needs you");
    expect(dot.getAttribute("title")).toBe("seat b needs you");
  });

  it("a Needs-you item on a grandchild rolls up the same way", () => {
    const r = s("c", { children: [seat("a", { children: [sub("x", { label: "Plan", state: "done", needsYou: true })], needsYou: true })] });
    render(<>{trailing(r)}</>);
    expect(screen.getByLabelText("needs you").getAttribute("title")).toBe("Plan needs you");
  });

  it("the running count sums descendants", () => {
    const r = s("c", { children: [seat("a", { children: [sub("x"), sub("y")] }), seat("b", { state: "working" })] });
    const { container } = render(<>{trailing(r)}</>);
    expect(container.textContent).toBe("3");
  });
});

describe("one row grammar (2.1, 2.2)", () => {
  it("a child row: state dot, tool monogram, account tick, label; no words while OK", () => {
    const { container } = rowOf(s("p", { children: [seat("a", { state: "working", account: { name: "side", color: "pink" } })] }));
    const [row] = childRows(container);
    expect(row.textContent).toBe("WorkingCseat a");
    expect(row.querySelector("[data-account-mark]")).toBeTruthy();
    expect(row.getAttribute("title")).toMatch(/Claude · side · via lineage/);
  });

  it("words only when not OK: an unconfirmed child says how long it was quiet", () => {
    const { container } = rowOf(s("p", { children: [seat("a", { state: "working", quiet: "no update in 34m" })] }));
    expect(childRows(container)[0].textContent).toContain("no update in 34m");
  });

  it("a subagent shows the subagent glyph and its worktree in the tooltip", () => {
    const { container } = rowOf(s("p", { children: [sub("x", { worktree: "agent-x" })] }));
    const [row] = childRows(container);
    expect(row.querySelector("[aria-label='subagent']")).toBeTruthy();
    expect(row.getAttribute("title")).toMatch(/worktree agent-x/);
  });
});

describe("open and peek (2.3, 2.4)", () => {
  it("a click on a session child opens it", () => {
    const onSelect = vi.fn();
    const { container } = rowOf(s("p", { children: [seat("a")] }), { onSelect });
    fireEvent.click(childRows(container)[0]);
    expect(onSelect).toHaveBeenCalledWith("claude/work/a");
  });

  it("a subagent row is not a button and says why", () => {
    const onSelect = vi.fn();
    const { container } = rowOf(s("p", { children: [sub("x")] }), { onSelect });
    const [row] = childRows(container);
    expect(row.getAttribute("role")).toBeNull();
    fireEvent.click(row);
    expect(onSelect).not.toHaveBeenCalled();
    expect(row.getAttribute("title")).toMatch(/runs inside its session — nothing to open/);
  });

  it("hovering a child asks for its peek card, and leaving drops it", () => {
    const onPeek = vi.fn();
    const { container } = rowOf(s("p", { children: [seat("a")] }), { onPeek });
    fireEvent.mouseEnter(childRows(container)[0]);
    expect(onPeek).toHaveBeenLastCalledWith("claude/work/a", expect.any(Number));
    fireEvent.mouseLeave(childRows(container)[0]);
    expect(onPeek).toHaveBeenLastCalledWith(null, 0);
  });
});

describe("tree connectors (3.1, 3.2)", () => {
  it("a middle child gets a tee, the last an elbow; a deeper row keeps the rail of a parent that continues", () => {
    const tree = s("p", { children: [seat("a", { state: "working", children: [sub("x"), sub("y", { state: "needs-you" })] }), seat("b", { state: "working" })] });
    const { container } = rowOf(tree);
    const rows = childRows(container);
    expect(rows.map((r) => r.dataset.depth)).toEqual(["1", "2", "2", "1"]);
    const guide = (r: HTMLElement, g: string) => r.querySelectorAll(`[data-guide=${g}]`).length;
    expect(guide(rows[0], "tee")).toBe(1);
    expect(guide(rows[0], "stem"), "seat a has children below it").toBe(1);
    expect(guide(rows[1], "tee")).toBe(1);
    expect(guide(rows[1], "rail"), "seat a continues to seat b").toBe(1);
    expect(guide(rows[2], "elbow")).toBe(1);
    expect(guide(rows[3], "elbow")).toBe(1);
    expect(guide(rows[3], "rail")).toBe(0);
    // The root row's stem reaches down to its first child.
    expect(container.querySelector("[role=button] [data-guide=stem]")).toBeTruthy();
  });
});

describe("idle children fold (3.5, D11)", () => {
  const nine = () => s("p", { children: Array.from({ length: 9 }, (_, i) => seat(`n${i}`, { state: i === 4 ? "working" : "idle" })) });

  it("a nine-seat council with one working seat shows two lines, and the fold opens in place", () => {
    const { container } = rowOf(nine());
    const rows = childRows(container);
    expect(rows.map((r) => r.textContent)).toEqual(["WorkingCseat n4", "8 idle"]);
    fireEvent.click(within(rows[1]).getByRole("button", { name: "Show 8 idle" }));
    expect(childRows(container)).toHaveLength(10);
  });

  it("remembers the open fold per parent while the row is closed and opened again", () => {
    const r = { ...nine(), key: "remember" };
    const first = rowOf(r);
    fireEvent.click(screen.getByRole("button", { name: "Show 8 idle" }));
    first.unmount();
    const again = rowOf(r);
    expect(childRows(again.container)).toHaveLength(10);
  });

  it("a waiting idle seat is never folded away", () => {
    const r = s("q", { children: [seat("a", { state: "needs-you" }), seat("b"), seat("c")] });
    const { container } = rowOf(r);
    expect(childRows(container).map((x) => x.textContent)).toEqual(["Needs a decisionCseat a", "2 idle"]);
  });
});

describe("one block for the open row (5.2, D12)", () => {
  it("the active open row and its children share one raise surface and one Marker", () => {
    const { container } = rowOf(s("p", { children: [seat("a"), seat("b"), seat("c")] }), { active: true });
    const markers = container.querySelectorAll(".border-l-ac-brand");
    expect(markers).toHaveLength(1);
    const block = markers[0].parentElement!;
    expect(block.className).toMatch(/bg-ac-raise/);
    expect(block.querySelectorAll("[data-child-row]").length).toBeGreaterThan(0);
    expect(block.querySelector("[role=button]")!.className).not.toMatch(/(^|\s)bg-ac-raise/);
  });

  it("closed, the active row alone carries fill and Marker", () => {
    const { container } = render(<SessionRow s={s("p", { children: [seat("a")] })} active {...on} />);
    const marker = container.querySelector(".border-l-ac-brand")!;
    expect(marker.parentElement!.getAttribute("role")).toBe("button");
  });
});

describe("the tree in the window (2.3, 3.4)", () => {
  const council = (): Partial<V3Data> => ({
    sessions: [{ ...data().sessions[0], key: "s1", account: { name: "work", nearLimit: false }, children: [seat("a", { state: "working" }), seat("b"), seat("c"), seat("w", { needsYou: true })] }],
    table: [{ key: "claude/work/a", title: "seat a", state: "working", live: true, tool: "claude", account: { name: "work", color: "teal" }, branch: "feat/seat", pr: null, model: "Sonnet", thinking: "high", contextPct: 10, lastActiveMs: NOW - 120_000 }],
  });

  it("⌘J on a Needs-you item about a child opens its parent's children and focuses the child row", () => {
    const needs: V3Data["needs"] = [{ id: "n", kind: "approval", subject: "claude/work/w", who: "council", what: "approve a command", verb: "Approve", since: new Date(NOW).toISOString(), version: "1" }];
    render(<V3Window data={{ ...data(), ...council(), needs }} slots={slots} act={vi.fn()} platform="mac" />);
    expect(screen.queryByText("seat w")).toBeNull();
    fireEvent.keyDown(window, { key: "j", metaKey: true });
    const row = screen.getByText("seat w").closest("[data-child-row]");
    expect(row).toBeTruthy();
    expect(document.activeElement).toBe(row);
  });

  it("hovering a child shows its peek card with the session's model and thinking; one card at a time", () => {
    vi.useFakeTimers();
    try {
      const c = council();
      const two = { ...c, sessions: [...c.sessions!, { ...data().sessions[0], key: "s2", title: "Checkout flow", account: { name: "work", nearLimit: false } }], table: [...c.table!, { ...c.table![0], key: "s2", title: "Checkout flow" }] };
      render(<V3Window data={{ ...data(), ...two }} slots={slots} act={vi.fn()} platform="mac" />);
      fireEvent.click(screen.getByLabelText(/^Show /));
      const seatRow = screen.getByText("seat a").closest("[data-child-row]")!;
      fireEvent.mouseEnter(seatRow);
      act(() => void vi.advanceTimersByTime(450));
      const card = screen.getByRole("tooltip");
      expect(card.textContent).toContain("seat a");
      expect(card.textContent).toContain("Claude · work · Sonnet · high");
      fireEvent.mouseLeave(seatRow);
      fireEvent.mouseEnter(within(screen.getByLabelText("Sessions window")).getByText("Checkout flow").closest("[role=button]")!);
      act(() => void vi.advanceTimersByTime(450));
      expect(screen.getAllByRole("tooltip").map((t) => t.textContent?.includes("Checkout flow"))).toEqual([true]);
    } finally {
      vi.useRealTimers();
    }
  });
});
