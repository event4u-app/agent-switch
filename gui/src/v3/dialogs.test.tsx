import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DecisionSheet, EndDialog, NewSessionDialog, type NewSessionFacts, type NewSessionPlan } from "./dialogs.js";

afterEach(cleanup);
const plan: NewSessionPlan = { folder: "~/code/agent-switch", gitState: "main · clean", worktree: false, tool: "claude", model: "Opus 5.5 · last used here", thinking: "High", where: "terminal" };
const facts = (over: Partial<NewSessionFacts> = {}): NewSessionFacts => ({
  terminalApp: "Terminal.app",
  hosting: "persistent",
  thinkingLevels: { claude: ["Low", "Medium", "High", "Max"], codex: ["low", "medium", "high"], antigravity: ["default"] },
  account: { name: "work", color: "teal", reason: "most room in pool “day”", limits: { key: "claude/work", tool: "claude", name: "work", color: "teal", protect: 98, next: true, signIn: false, checkedMs: 0, windows: [{ label: "5h", used: 39, resetsAtMs: null, pace: null }] }, why: ["work has the most room", "side is near its limit"], paceText: "At today's pace: about 3h of Opus · High before the 5h window is full" },
  command: "CLAUDE_CONFIG_DIR=… claude",
  nowMs: 0,
  ...over,
});

describe("New session (spec §8.1)", () => {
  it("prefilled, one primary naming the outcome, your terminal by default", () => {
    const onStart = vi.fn();
    render(<NewSessionDialog initial={plan} facts={facts()} onStart={onStart} onClose={vi.fn()} onChooseAccount={vi.fn()} />);
    expect(screen.getByText("Claude in ~/code/agent-switch")).toBeTruthy();
    expect(screen.getByText("Remembered for this project")).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Your terminal/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByText(/Start in Terminal.app/));
    expect(onStart).toHaveBeenCalledWith(plan);
  });

  it("hosting: the primary says 'Start here', and without tmux the card says it ends with the app", () => {
    const onStart = vi.fn();
    render(<NewSessionDialog initial={plan} facts={facts({ hosting: "ephemeral" })} onStart={onStart} onClose={vi.fn()} onChooseAccount={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: /Host in Agent Switch/ }));
    expect(screen.getByText(/ends when the app closes/)).toBeTruthy();
    fireEvent.click(screen.getByText(/Start here/));
    expect(onStart.mock.calls[0][0].where).toBe("hosted");
  });

  it("the tool's own thinking levels; Why? and the command preview open on demand", () => {
    render(<NewSessionDialog initial={plan} facts={facts()} onStart={vi.fn()} onClose={vi.fn()} onChooseAccount={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "Max" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Codex" }));
    expect(screen.queryByRole("radio", { name: "Max" })).toBeNull();
    expect(screen.queryByText("work has the most room")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Why?" }));
    expect(screen.getByText("work has the most room")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Command preview" }));
    expect(screen.getByText("CLAUDE_CONFIG_DIR=… claude")).toBeTruthy();
  });

  it("Esc closes", () => {
    const onClose = vi.fn();
    render(<NewSessionDialog initial={plan} facts={facts()} onStart={vi.fn()} onClose={onClose} onChooseAccount={vi.fn()} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("decision sheet and End (spec §8.2, §8.3)", () => {
  it("an account running its own session is still a target: the session moves there instead of borrowing its login", () => {
    const onDecide = vi.fn();
    render(
      <DecisionSheet
        account="side"
        pctUsed={100}
        window="5h"
        resetsIn="1 h"
        suggestion="work"
        room={null}
        onKeep={vi.fn()}
        onClose={vi.fn()}
        onDecide={onDecide}
        targets={[{ name: "work", color: "blue", busy: true }]}
        sessions={[{ key: "a", title: "Fix wedge", model: "Opus", target: "work" }]}
      />,
    );
    const go = screen.getByRole("button", { name: "Continue on work" }) as HTMLButtonElement;
    expect(go.disabled).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/work runs a session of its own, so this conversation moves to work and resumes there/);
    fireEvent.click(go);
    expect(onDecide).toHaveBeenCalledWith("after-turn", [{ key: "a", target: "work", via: "takeover" }]);
    onDecide.mockClear();
    fireEvent.click(screen.getByRole("radio", { name: /New session with a brief/ }));
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(go);
    expect(onDecide).toHaveBeenCalledWith("brief", [{ key: "a", target: "work" }]);
    cleanup();
  });

  it("nothing changes until a choice; the default is after this turn; unchecked sessions are not moved", () => {
    const onDecide = vi.fn();
    render(<DecisionSheet account="side" pctUsed={94} window="5h" resetsIn="1h 18m" suggestion="work" room={null} onKeep={vi.fn()} onClose={vi.fn()} onDecide={onDecide} sessions={[{ key: "a", title: "Fix wedge", model: "Opus", target: "work" }, { key: "b", title: "Docs", model: "Sonnet", target: "work" }]} />);
    expect(screen.getByText("Resets in 1h 18m. 2 sessions run on it. Nothing changes until you choose.")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("checkbox")[1]); // leave "Docs" where it is
    fireEvent.click(screen.getByText("Continue on work"));
    expect(onDecide).toHaveBeenCalledWith("after-turn", [{ key: "a", target: "work" }]);
  });

  it("sessions bound for different accounts all move, each to its own; the labels stop naming one account", () => {
    const onDecide = vi.fn();
    const targets = [{ name: "work", color: "blue" as const }, { name: "lab", color: "pink" as const }];
    render(<DecisionSheet account="side" pctUsed={94} window="5h" resetsIn="1h" suggestion="work" room={null} targets={targets} onKeep={vi.fn()} onClose={vi.fn()} onDecide={onDecide} sessions={[{ key: "a", title: "Fix wedge", model: "Opus", target: "work" }, { key: "b", title: "Docs", model: "Sonnet", target: "lab" }]} />);
    expect(screen.queryByRole("button", { name: /^Continue on/ })).toBeNull();
    expect(screen.getByRole("radio", { name: /After this turn, continue on the accounts above/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Switch 2 sessions" }));
    expect(onDecide).toHaveBeenCalledWith("after-turn", [{ key: "a", target: "work" }, { key: "b", target: "lab" }]);
    // Leaving one out: what is left goes to one account, and the button names it again.
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    expect(screen.getByRole("button", { name: "Continue on work" })).toBeTruthy();
  });

  it("a brief starts one new session: with two checked it cannot go", () => {
    render(<DecisionSheet account="side" pctUsed={94} window="5h" resetsIn="1h" suggestion="work" room={null} onKeep={vi.fn()} onClose={vi.fn()} onDecide={vi.fn()} sessions={[{ key: "a", title: "Fix wedge", model: "Opus", target: "work" }, { key: "b", title: "Docs", model: "Sonnet", target: "work" }]} />);
    fireEvent.click(screen.getByRole("radio", { name: /New session with a brief/ }));
    expect((screen.getByRole("button", { name: "Continue on work" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    expect((screen.getByRole("button", { name: "Continue on work" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("End says what stops with it and whether this session is kept (D-vault); closing the tab is its own button", () => {
    const onCloseTab = vi.fn();
    const { rerender } = render(<EndDialog title="Event store" stops={["subagent general-purpose in .claude/worktrees/agent-a1"]} kept onEnd={vi.fn()} onCloseTab={onCloseTab} onClose={vi.fn()} />);
    expect(screen.getByText("Stops with it")).toBeTruthy();
    expect(screen.getByText("Its transcript is kept in the vault.")).toBeTruthy();
    fireEvent.click(screen.getByText("Just close the tab"));
    expect(onCloseTab).toHaveBeenCalledOnce();
    rerender(<EndDialog title="x" stops={[]} kept={false} onEnd={vi.fn()} onCloseTab={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/pin the session to keep a copy/)).toBeTruthy();
  });
});
