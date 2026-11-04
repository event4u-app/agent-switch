/** Gap report §6: the details of dialogs and pages, each against the board. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import css from "../index.css?raw";
import { DecisionSheet } from "./dialogs.js";
import { RoomLeft } from "./limits.js";
import { lastSeen } from "./pages.js";
import { prLine } from "./panels.js";
import { NOW, limit } from "./window-fixture.js";

afterEach(cleanup);

describe("Summary PR line", () => {
  it.each([
    [{ lifecycle: "OPEN", mergeable: "CONFLICTING", review: "CHANGES_REQUESTED" }, "open · conflict · changes requested"],
    [{ lifecycle: "OPEN", mergeable: "MERGEABLE", review: "APPROVED" }, "open · mergeable · approved"],
    [{ lifecycle: "OPEN", mergeable: "UNKNOWN", review: "REVIEW_REQUIRED" }, "open · review required"],
    [{ lifecycle: "MERGED", mergeable: "", review: "" }, "merged"],
  ])("%j → %s", (pr, line) => expect(prLine(pr)).toBe(line));
});

describe("Library Last", () => {
  it("now, minutes, hours, then a short date", () => {
    expect(lastSeen(NOW - 10_000, NOW)).toBe("now");
    expect(lastSeen(NOW - 5 * 60_000, NOW)).toBe("5 min");
    expect(lastSeen(NOW - 3 * 3_600_000, NOW)).toBe("3 h");
    expect(lastSeen(Date.UTC(2026, 9, 28, 12), NOW, "en-US")).toBe("Oct 28");
  });
});

describe("Decision sheet (spec §8.2)", () => {
  const sheet = (onDecide = vi.fn(), tool?: string) =>
    render(
      <DecisionSheet
        tool={tool}
        account="side"
        pctUsed={94}
        window="5h"
        resetsIn="1h 18m"
        suggestion="work"
        sessions={[{ key: "s1", title: "Fix wedge", model: "Sonnet 5.5", target: "work", state: "working" }]}
        targets={[{ name: "work", color: "teal" }, { name: "home", color: "purple" }]}
        room={<RoomLeft accounts={[limit, { ...limit, key: "claude/home", name: "home", windows: [] }]} nowMs={NOW} />}
        onDecide={onDecide}
        onKeep={vi.fn()}
        onClose={vi.fn()}
      />,
    );

  it("each session row has its state, its model and an account picker", () => {
    const onDecide = vi.fn();
    sheet(onDecide);
    const pick = screen.getByRole("button", { name: "Target account for Fix wedge" });
    expect(pick.textContent).toContain("work");
    fireEvent.click(pick);
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: /home/ }));
    expect(screen.getByRole("button", { name: "Target account for Fix wedge" }).textContent).toContain("home");
    fireEvent.click(screen.getByRole("button", { name: "Continue on home" }));
    expect(onDecide).toHaveBeenCalledWith("after-turn", [{ key: "s1", target: "home" }]);
  });

  it("all three How cards carry their one-line detail", () => {
    sheet();
    const how = screen.getByRole("radiogroup", { name: "How" });
    expect(within(how).getAllByRole("radio").map((r) => r.textContent)).toEqual([
      "After this turn, continue on workSwitches when the turn ends, then carries on by itself where Agent Switch hosts the session.",
      "Switch now and continueChecked for this Claude version. The session adopts work and is told to continue; if the switch fails, it stays on side.",
      "New session with a briefStarts fresh on work with a summary of this one.",
    ]);
  });

  it("Codex: one move-and-continue card (no live login switch) and the brief", () => {
    const onDecide = vi.fn();
    sheet(onDecide, "codex");
    const how = screen.getByRole("radiogroup", { name: "How" });
    expect(within(how).getAllByRole("radio").map((r) => r.textContent)).toEqual([
      "Move and continue on workMoves the conversation to work and resumes it there with “continue”. End codex in your own terminal first; a session Agent Switch hosts moves in its window.",
      "New session with a briefStarts fresh on work with a summary of this one.",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Continue on work" }));
    expect(onDecide).toHaveBeenCalledWith("after-turn", [{ key: "s1", target: "work" }]);
  });

  it("Room left lists every account of the tool with all its windows", () => {
    sheet();
    expect(screen.getByText("5h")).toBeTruthy();
    expect(screen.getByText("home")).toBeTruthy();
    expect(screen.getByText("no data yet")).toBeTruthy();
  });
});

describe("palette input", () => {
  it("draws no focus ring of its own; the palette is the focus context", () => {
    expect(css).toMatch(/\.as-ac input\[data-palette\]:focus-visible\s*\{\s*outline: none;/);
  });
});
