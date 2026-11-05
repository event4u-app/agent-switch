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
