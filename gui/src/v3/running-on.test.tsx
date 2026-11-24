import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RunningOn, runningOn } from "./running-on.js";
import type { RowSession } from "./sessions.js";

afterEach(cleanup);
const s = (key: string, over: Partial<RowSession> = {}): RowSession => ({ key, title: `title ${key}`, state: "working", account: { name: "side", nearLimit: true }, branch: null, pr: null, children: [], needsYou: false, ...over });

describe("running on an account (limits popover)", () => {
  it("lists only the account's live sessions", () => {
    const rows = [s("claude/side/a"), s("claude/side/b", { state: "done" }), s("claude/work/c"), s("codex/side/d")];
    expect(runningOn({ tool: "claude", name: "side" }, rows).map((r) => r.key)).toEqual(["claude/side/a"]);
  });

  it("opens a session, unfolds its subagents, shows one in Children, and changes model only where hosted", () => {
    const on = { onOpen: vi.fn(), onShowChild: vi.fn(), onModel: vi.fn() };
    const kid = { id: "k1", label: "Explore", kind: "subagent", state: "done" as const, source: "hook" as const };
    render(
      <RunningOn
        name="side"
        sessions={[
          { row: s("claude/side/a", { title: "Fix wedge", children: [kid] }), model: "Sonnet 5.5", thinking: "Medium", hosted: true },
          { row: s("claude/side/b", { title: "Own one" }), model: null, thinking: null, hosted: false },
        ]}
        {...on}
      />,
    );
    expect(screen.getByText("Running on side")).toBeTruthy();
    fireEvent.click(screen.getByTitle("Open “Fix wedge” in its tab"));
    expect(on.onOpen).toHaveBeenCalledWith("claude/side/a");
    expect(screen.queryByText("Explore")).toBeNull();
    fireEvent.click(screen.getByLabelText(/^Show /));
    fireEvent.click(screen.getByRole("button", { name: /^Idle/, expanded: false }));
    fireEvent.click(screen.getByTitle("Show in the Children window"));
    expect(on.onShowChild).toHaveBeenCalledWith("claude/side/a");
    fireEvent.click(screen.getByTitle("Model and thinking for the next turn — same popover as the session bar"));
    expect(on.onModel).toHaveBeenCalledWith("claude/side/a", "model");
    const locked = screen.getByTitle("Locked: change it in your terminal (/model)");
    expect(locked.textContent).toContain("Model");
    fireEvent.click(locked);
    expect(on.onModel).toHaveBeenCalledOnce();
  });
});

describe("switch from the limits popover (owner, 2026-11-24)", () => {
  it("each session has the account chip of the session bar: it opens the move sheet, or says why it cannot", () => {
    const onMove = vi.fn();
    render(
      <RunningOn
        name="side"
        sessions={[
          { row: s("claude/side/a", { title: "Fix wedge", account: { name: "side", nearLimit: true, color: "purple" } }), model: "Sonnet 5.5", thinking: "medium", hosted: true },
          { row: s("claude/side/b", { title: "No usage" }), model: null, thinking: null, hosted: true },
        ]}
        onOpen={vi.fn()}
        onShowChild={vi.fn()}
        onModel={vi.fn()}
        onMove={onMove}
        moveWhy={(k) => (k === "claude/side/b" ? "No usage read yet" : null)}
      />,
    );
    const chips = screen.getAllByText("side", { selector: "button" });
    fireEvent.click(chips[0]);
    expect(onMove).toHaveBeenCalledWith("claude/side/a");
    expect(chips[1].getAttribute("aria-disabled")).toBe("true");
    expect(chips[1].getAttribute("title")).toBe("No usage read yet");
    fireEvent.click(chips[1]);
    expect(onMove).toHaveBeenCalledOnce();
    // Model and thinking read as in the session bar: the model, then the level arrow.
    expect(document.querySelector('[data-thinking="medium"]')).not.toBeNull();
  });
});

describe("only active sessions, in a dark box (owner, 2026-11-24)", () => {
  it("leaves idle and ended sessions out", () => {
    const rows = [s("claude/side/run"), s("claude/side/ask", { state: "needs-you" }), s("claude/side/idle", { state: "idle" }), s("claude/side/end", { state: "done" })];
    expect(runningOn({ tool: "claude", name: "side" }, rows).map((r) => r.key)).toEqual(["claude/side/run", "claude/side/ask"]);
  });
  it("the box has one fixed height and scrolls, whatever it holds", () => {
    const one = (k: string) => ({ row: s(k), model: null, thinking: null, hosted: true });
    const { rerender } = render(<RunningOn name="side" sessions={[one("claude/side/a"), one("claude/side/b")]} onOpen={vi.fn()} onShowChild={vi.fn()} onModel={vi.fn()} />);
    const box = () => document.querySelector("[data-running-box]")!;
    expect(box().className).toMatch(/h-\[160px\] overflow-y-auto/);
    expect(box().className).toMatch(/bg-ac-bg/);
    rerender(<RunningOn name="side" sessions={[one("claude/side/a"), one("claude/side/b"), one("claude/side/c")]} onOpen={vi.fn()} onShowChild={vi.fn()} onModel={vi.fn()} />);
    expect(box().className).toMatch(/h-\[160px\] overflow-y-auto/);
  });
});

describe("subagents split into Running and Idle (owner, 2026-11-24)", () => {
  it("Running is open, Idle is folded, each with its count; an empty group has no header", () => {
    const kids = [
      { id: "r1", label: "Explore", kind: "subagent", state: "working" as const, source: "hook" as const },
      { id: "i1", label: "Plan", kind: "subagent", state: "done" as const, source: "hook" as const },
      { id: "i2", label: "Review", kind: "subagent", state: "done" as const, source: "hook" as const },
    ];
    render(<RunningOn name="side" sessions={[{ row: s("claude/side/a", { title: "Fix wedge", children: kids }), model: null, thinking: null, hosted: true }]} onOpen={vi.fn()} onShowChild={vi.fn()} onModel={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(/^Show /));
    expect(screen.getByRole("button", { name: /^Running/ }).textContent).toBe("Running1");
    expect(screen.getByRole("button", { name: /^Running/ }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: /^Idle/ }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("Explore")).toBeTruthy();
    expect(screen.queryByText("Plan")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Idle/ }));
    expect(screen.getByText("Plan")).toBeTruthy();
  });
});

describe("one session unfolded at a time (owner, 2026-11-24)", () => {
  it("opening a second session folds the first", () => {
    const kid = (id: string) => ({ id, label: `kid ${id}`, kind: "subagent", state: "working" as const, source: "hook" as const });
    render(
      <RunningOn
        name="side"
        sessions={[
          { row: s("claude/side/a", { title: "A", children: [kid("1")] }), model: null, thinking: null, hosted: true },
          { row: s("claude/side/b", { title: "B", children: [kid("2")] }), model: null, thinking: null, hosted: true },
        ]}
        onOpen={vi.fn()}
        onShowChild={vi.fn()}
        onModel={vi.fn()}
      />,
    );
    const [a, b] = screen.getAllByLabelText(/^Show /);
    fireEvent.click(a);
    expect(screen.getByText("kid 1")).toBeTruthy();
    fireEvent.click(b);
    expect(screen.getByText("kid 2")).toBeTruthy();
    expect(screen.queryByText("kid 1")).toBeNull();
  });
});
