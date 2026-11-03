import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import fx from "./fixtures/timeline-claude-2.1.316.json";
import { ChatTimeline } from "./chat.js";
import type { AsEvent } from "./timeline.js";

afterEach(cleanup);

describe("ChatTimeline", () => {
  it("draws the recorded session: bubbles, Update with its diff, the Task row, hidden lines counted", () => {
    render(<ChatTimeline events={fx.transcript as AsEvent[]} />);
    expect(screen.getByText(/Create a file notes\.md/)).toBeTruthy();
    expect(screen.getAllByText("Update").length).toBeGreaterThan(0);
    expect(screen.getByText("Task")).toBeTruthy();
    expect(screen.getByText("subagent · via hook")).toBeTruthy();
    expect(screen.getByText(/internal lines not shown/)).toBeTruthy();
    const edit = screen.getAllByRole("button", { expanded: false }).find((b) => b.textContent?.includes("−1"))!;
    fireEvent.click(edit);
    expect(screen.getByText("beta")).toBeTruthy();
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
