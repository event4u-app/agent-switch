import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { V3Window, type V3Data } from "./window.js";
import { data, slots } from "./window-fixture.js";
import { ENGINE_DOWN_WHY } from "./workbench.js";

afterEach(cleanup);

const READY: V3Data["health"] = { state: "ready" };
const allow = { id: "a", kind: "approval" as const, subject: "s1", who: "Bash · npm test", what: "wants your approval", verb: "Allow", since: new Date().toISOString(), version: "toolu_1" };

function mount(over: Partial<V3Data> = {}) {
  const act = vi.fn();
  render(<V3Window data={{ ...data(), ...over }} slots={slots} act={act} platform="mac" layout={{ load: () => ({ tabs: ["s1"], active: "s1" }), save: vi.fn() }} />);
  return act;
}
const sessionMenu = () => fireEvent.click(screen.getByLabelText("Session actions: rename, pin, move, detach, end"));

describe("engine stopped: the session pane is stale and engine actions are off", () => {
  it("the pane says it shows the last known state and drops its live look", () => {
    mount();
    expect(screen.getByText("Engine stopped — showing the last known state")).toBeTruthy();
    expect(screen.getByText("terminal body").closest("[data-stale]")).not.toBeNull();
  });

  it("with the engine up the pane is live", () => {
    mount({ health: READY });
    expect(screen.queryByText("Engine stopped — showing the last known state")).toBeNull();
    expect(screen.getByText("terminal body").closest("[data-stale]")).toBeNull();
  });

  it("Decide in Needs you is disabled with the reason, and does nothing", () => {
    const act = mount();
    const decide = screen.getByRole("button", { name: "Decide" });
    expect(decide.getAttribute("aria-disabled")).toBe("true");
    expect(decide.getAttribute("title")).toBe(ENGINE_DOWN_WHY);
    fireEvent.click(decide);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(act).not.toHaveBeenCalledWith(expect.objectContaining({ type: "need" }));
  });

  it("with the engine up Decide opens the decision sheet", () => {
    mount({ health: READY });
    fireEvent.click(screen.getByRole("button", { name: "Decide" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("Allow is disabled, and its keys answer nothing", () => {
    const act = mount({ needs: [allow] });
    expect(screen.getByRole("button", { name: "Allow" }).getAttribute("aria-disabled")).toBe("true");
    fireEvent.keyDown(window, { key: "j", metaKey: true });
    fireEvent.keyDown(window, { key: "y" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(act).not.toHaveBeenCalledWith(expect.objectContaining({ type: "need-answer" }));
    expect(act).not.toHaveBeenCalledWith(expect.objectContaining({ type: "need" }));
  });

  it("the session menu's moves are disabled with the reason; rename still works", () => {
    const act = mount();
    sessionMenu();
    for (const name of ["Move to another account…", "Take over here…", "Hand off…"]) {
      const item = screen.getByRole("menuitem", { name });
      expect(item.getAttribute("aria-disabled")).toBe("true");
      expect(item.getAttribute("title")).toBe(ENGINE_DOWN_WHY);
    }
    fireEvent.click(screen.getByRole("menuitem", { name: "Hand off…" }));
    expect(act).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename…" }));
    expect(act).toHaveBeenCalledWith({ type: "session-menu", key: "s1", item: "Rename…" });
  });
});

describe("End… opens the End dialog", () => {
  const withKid = () => [{ ...data().sessions[0], children: [{ id: "k", label: "general-purpose", kind: "subagent", state: "working" as const, source: "hook" as const, worktree: "agent-a1" }] }];

  it("names what stops with the session and whether it is kept; End session ends it", () => {
    const act = mount({ health: READY, sessions: withKid(), library: [{ key: "s1", name: "Event store", summary: null, tags: [], color: "teal", project: null, branch: null, pr: null, lastMs: 0, pinned: true, archived: false, vault: { state: "saved", bytes: 1 }, transcript: true }] });
    sessionMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "End…" }));
    expect(screen.getByRole("dialog", { name: /End “Event store”\?/ })).toBeTruthy();
    expect(screen.getByText("subagent general-purpose in .claude/worktrees/agent-a1")).toBeTruthy();
    expect(screen.getByText("Its transcript is kept in the vault.")).toBeTruthy();
    expect(act).not.toHaveBeenCalledWith(expect.objectContaining({ type: "session-menu", item: "End…" }));
    fireEvent.click(screen.getByRole("button", { name: "End session" }));
    expect(act).toHaveBeenCalledWith({ type: "end", key: "s1" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Just close the tab closes the tab and ends nothing", () => {
    const act = mount({ health: READY });
    sessionMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "End…" }));
    fireEvent.click(screen.getByRole("button", { name: "Just close the tab" }));
    expect(screen.queryByRole("tab", { name: /Event store/ })).toBeNull();
    expect(act).not.toHaveBeenCalledWith(expect.objectContaining({ type: "end" }));
  });
});
