import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import fx from "./fixtures/timeline-claude-2.1.316.json";
import { ChatTimeline, hiddenText } from "./chat.js";
import type { AsEvent } from "./timeline.js";

afterEach(cleanup);

describe("ChatTimeline", () => {
  it("draws the recorded session: bubbles, Update with its diff, the Task row; no footer for hidden lines", () => {
    render(<ChatTimeline events={fx.transcript as AsEvent[]} />);
    expect(screen.getByText(/Create a file notes\.md/)).toBeTruthy();
    expect(screen.getAllByText("Update").length).toBeGreaterThan(0);
    const subagentRow = screen.getByText("subagent · via hook").parentElement!;
    expect(subagentRow.textContent).toContain("Task");
    // The reply's `Task` is markdown inline code now, not literal backticks.
    expect(screen.getAllByText("Task").some((el) => el.tagName === "CODE")).toBe(true);
    // The count moved into the "read-only here" tooltip (gap §5e).
    expect(screen.queryByText(/internal lines? not shown/)).toBeNull();
    const edit = screen.getAllByRole("button", { expanded: false }).find((b) => b.textContent?.includes("−1"))!;
    expect(screen.getAllByText("beta").filter((el) => el.tagName === "SPAN")).toHaveLength(0);
    fireEvent.click(edit);
    // The diff line (a span in the diff view), not the reply's inline code.
    expect(screen.getAllByText("beta").filter((el) => el.tagName === "SPAN")).toHaveLength(1);
  });

  it("an open approval offers allow once, always and deny only when the session is bridged", () => {
    const events = fx.stream as AsEvent[];
    const { unmount } = render(<ChatTimeline events={events} />);
    expect(screen.getByText(/Claude wants to change a file/)).toBeTruthy();
    expect(screen.queryByText("Allow once")).toBeNull();
    unmount();
    const approve = vi.fn();
    const deny = vi.fn();
    render(<ChatTimeline events={events} on={{ approve, deny }} />);
    fireEvent.click(screen.getByText("Allow once"));
    fireEvent.click(screen.getByText(/Always allow/));
    fireEvent.click(screen.getByText("Deny"));
    expect(approve.mock.calls.map((c) => c[1])).toEqual([false, true]);
    expect(deny).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Same rule as the terminal prompt · never bypassed")).toBeTruthy();
  });

  it("a subagent with a worktree from its hook shows the violet badge; without one, none", () => {
    const ev = fx.transcript as AsEvent[];
    const agentId = (ev.find((e) => e.t === "subagent.finished") as { agentId?: string }).agentId!;
    const { unmount } = render(<ChatTimeline events={ev} on={{ worktreeOf: (id) => (id === agentId ? "es-migrate" : null) }} />);
    expect(screen.getByText("es-migrate")).toBeTruthy();
    unmount();
    render(<ChatTimeline events={ev} />);
    expect(screen.queryByText("es-migrate")).toBeNull();
  });

  it("an empty session says so", () => {
    render(<ChatTimeline events={[]} />);
    expect(screen.getByText("Nothing in this session yet.")).toBeTruthy();
  });
});

describe("hiddenText", () => {
  it("counts the dropped lines with their kinds, and says nothing when none were dropped", () => {
    expect(hiddenText({})).toBeNull();
    expect(hiddenText({ "file-history-snapshot": 2, summary: 1 })).toBe("3 internal lines not shown\nfile-history-snapshot: 2\nsummary: 1");
    expect(hiddenText({ x: 1 })).toBe("1 internal line not shown\nx: 1");
  });
});
