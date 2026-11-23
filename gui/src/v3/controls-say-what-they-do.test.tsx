import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

describe("engine stopped: every move, send and blocker entry point waits (7.6)", () => {
  const sendNext = () => ({ text: "CI failing: lint", action: "Send to agent" });
  const summaryFacts = () => ({ next: sendNext(), pr: null, git: null, limit: null, more: { id: "s1", host: "Hosted by Agent Switch", library: "Kept in the vault", children: "0 child sessions" } });
  const accountChip = () => screen.getAllByRole("button").find((b) => b.tagName === "BUTTON" && b.textContent?.startsWith("work"))!;

  it("the account chip says why and opens no decision sheet", () => {
    mount();
    const chip = accountChip();
    expect(chip.getAttribute("aria-disabled")).toBe("true");
    expect(chip.getAttribute("title")).toBe(ENGINE_DOWN_WHY);
    fireEvent.click(chip);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("⌘⇧M opens no decision sheet", () => {
    mount();
    fireEvent.keyDown(window, { key: "m", metaKey: true, shiftKey: true });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the limit hint's Move… is disabled with the reason", () => {
    mount();
    const move = screen.getByRole("button", { name: "Move…" });
    expect(move.getAttribute("aria-disabled")).toBe("true");
    expect(move.getAttribute("title")).toBe(ENGINE_DOWN_WHY);
    fireEvent.click(move);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the Limits popover's Move its session… is disabled with the reason", () => {
    mount();
    fireEvent.click(within(screen.getByLabelText("Limits")).getByText("work"));
    const pop = screen.getByRole("dialog", { name: "work limits" });
    const move = within(pop).getByText("Move its session…");
    expect(move.getAttribute("aria-disabled")).toBe("true");
    expect(move.getAttribute("title")).toBe(ENGINE_DOWN_WHY);
    fireEvent.click(move);
    expect(screen.getByRole("dialog", { name: "work limits" })).toBeTruthy();
  });

  it("the blocker strip's Send to agent is disabled with the reason; Copy prompt still works", () => {
    const act = mount({ next: sendNext });
    const send = screen.getByRole("button", { name: "Send to agent" });
    expect(send.getAttribute("aria-disabled")).toBe("true");
    expect(send.getAttribute("title")).toBe(ENGINE_DOWN_WHY);
    fireEvent.click(send);
    expect(act).not.toHaveBeenCalledWith(expect.objectContaining({ type: "blocker" }));
    cleanup();
    const act2 = mount({ next: () => ({ text: "CI failing: lint", action: "Copy prompt" }) });
    fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
    expect(act2).toHaveBeenCalledWith({ type: "blocker", key: "s1" });
  });

  it("Summary's Send to agent is disabled with the reason", () => {
    const act = mount({ summary: summaryFacts });
    fireEvent.keyDown(window, { key: "i", metaKey: true });
    const send = screen.getByRole("button", { name: "Send to agent" });
    expect(send.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(send);
    expect(act).not.toHaveBeenCalledWith(expect.objectContaining({ type: "blocker" }));
  });

  it("with the engine up the same entry points act", () => {
    const act = mount({ health: READY, next: sendNext });
    fireEvent.click(screen.getByRole("button", { name: "Send to agent" }));
    expect(act).toHaveBeenCalledWith({ type: "blocker", key: "s1" });
    fireEvent.keyDown(window, { key: "m", metaKey: true, shiftKey: true });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

describe("Move to another account needs the account's usage (7.6)", () => {
  it("without it the menu item says why and nothing opens, from the menu or ⌘⇧M", () => {
    mount({ health: READY, decision: () => null });
    sessionMenu();
    const item = screen.getByRole("menuitem", { name: "Move to another account…" });
    expect(item.getAttribute("aria-disabled")).toBe("true");
    expect(item.getAttribute("title")).toMatch(/usage/);
    fireEvent.click(item);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(window, { key: "m", metaKey: true, shiftKey: true });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(accountChipTitle()).toMatch(/usage/);
  });
  const accountChipTitle = () => screen.getAllByRole("button").find((b) => b.tagName === "BUTTON" && b.textContent?.startsWith("work"))!.getAttribute("title");
});

describe("Open in › Bring its terminal to the front is offered only where focusing works (7.6)", () => {
  const own = (key: string) => () => ({ key, hosted: false, chatAvailable: true, view: "chat" as const, account: { name: "work", color: "teal" as const, fiveH: 10, protect: 98 }, model: "Opus", thinking: "high", contextPct: 10 });
  const sessions = (key: string) => [{ ...data().sessions[0], key }];
  const items = () => {
    fireEvent.click(screen.getByLabelText("Open in…"));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Terminal/ }));
    return screen.queryByText("Bring its terminal to the front");
  };

  it.each([
    ["the switch is off", "claude/work/a", false],
    ["a Codex session", "codex/work/c", true],
  ])("not when %s", (_, key, on) => {
    render(<V3Window data={{ ...data(), health: READY, sessions: sessions(key), bar: own(key), openIn: { ...data().openIn, focusTerminal: on } }} slots={slots} act={vi.fn()} platform="mac" layout={{ load: () => ({ tabs: [key], active: key }), save: vi.fn() }} />);
    expect(items()).toBeNull();
  });

  it("with the switch on, a Claude session in your terminal offers it", () => {
    render(<V3Window data={{ ...data(), health: READY, sessions: sessions("claude/work/a"), bar: own("claude/work/a") }} slots={slots} act={vi.fn()} platform="mac" layout={{ load: () => ({ tabs: ["claude/work/a"], active: "claude/work/a" }), save: vi.fn() }} />);
    expect(items()).not.toBeNull();
  });
});

describe("the Compact hint is offered only where Compact works (7.6)", () => {
  const full = (hosted: boolean) => () => ({ key: "s1", hosted, chatAvailable: true, view: "terminal" as const, account: { name: "work", color: "teal" as const, fiveH: 10, protect: 98 }, model: "Opus", thinking: "high", contextPct: 70, contextTokens: 120_000, tool: "claude" });

  it("a session Agent Switch does not host keeps the words (/compact) and gets no button", () => {
    mount({ health: READY, bar: full(false), menu: () => ["Rename…", "Pin"] });
    expect(screen.getByText(/\/compact keeps the gist/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Compact" })).toBeNull();
  });

  it("a hosted session gets the button, and it compacts", () => {
    const act = mount({ health: READY, bar: full(true), menu: () => ["Rename…", "Compact"] });
    fireEvent.click(screen.getByRole("button", { name: "Compact" }));
    expect(act).toHaveBeenCalledWith({ type: "session-menu", key: "s1", item: "Compact" });
  });
});
