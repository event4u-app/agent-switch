import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChatAccountDialog, DecisionSheet, EndDialog, NewSessionDialog, TakeoverDialog, type NewSessionFacts, type NewSessionPlan } from "./dialogs.js";

afterEach(cleanup);
const plan: NewSessionPlan = { folder: "~/code/agent-switch", gitState: "main · clean", worktree: false, tool: "claude", model: "Opus 5.5 · last used here", thinking: "High", where: "terminal", remembered: true };
const facts = (over: Partial<NewSessionFacts> = {}): NewSessionFacts => ({
  terminalApp: "Terminal.app",
  hosting: "persistent",
  thinkingLevels: { claude: ["Low", "Medium", "High", "Max"], codex: ["low", "medium", "high"], antigravity: ["default"] },
  account: { name: "work", color: "teal", reason: "most room in pool “day”", limits: { key: "claude/work", tool: "claude", name: "work", color: "teal", protect: 98, next: true, signIn: false, checkedMs: 0, windows: [{ label: "5h", used: 39, resetsAtMs: null, pace: null }] }, why: ["work has the most room", "side is near its limit"], paceText: "At today's pace: about 3h of Opus · High before the 5h window is full" },
  command: "CLAUDE_CONFIG_DIR=… claude",
  nowMs: 0,
  models: { claude: [{ id: "opus", label: "Opus" }, { id: "sonnet", label: "Sonnet" }], codex: [], antigravity: [] },
  folders: ["~/code/agent-switch", "~/code/other"],
  home: "/Users/me",
  accounts: { claude: [{ name: "work", color: "teal" }, { name: "side", color: "blue" }], codex: [{ name: "cx", color: "green" }], antigravity: [] },
  ...over,
});

describe("New session (spec §8.1)", () => {
  it("prefilled, one primary naming the outcome, your terminal by default", () => {
    const onStart = vi.fn();
    render(<NewSessionDialog initial={plan} facts={facts()} onStart={onStart} onClose={vi.fn()} />);
    expect(screen.getByText("Claude in ~/code/agent-switch")).toBeTruthy();
    expect(screen.getByText("Remembered for this project")).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Your terminal/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByText(/Start in Terminal.app/));
    expect(onStart).toHaveBeenCalledWith(plan);
  });

  it("the folder's git state comes from the facts as they are now, over the plan's", () => {
    const { rerender } = render(<NewSessionDialog initial={{ ...plan, gitState: null }} facts={facts({ gitState: "feat/x · 3 changed" })} onStart={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("feat/x · 3 changed")).toBeTruthy();
    rerender(<NewSessionDialog initial={{ ...plan, gitState: null }} facts={facts({ gitState: null })} onStart={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByText(/changed|clean/)).toBeNull();
  });

  it("says 'Remembered for this project' only when something was remembered", () => {
    render(<NewSessionDialog initial={{ ...plan, model: "opus", remembered: false }} facts={facts()} onStart={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByText("Remembered for this project")).toBeNull();
    expect(screen.queryByText(/last used here/)).toBeNull();
  });

  it("another tool starts on its own default model, not the one remembered for the first", () => {
    const onStart = vi.fn();
    render(<NewSessionDialog initial={{ ...plan, model: "opus" }} facts={facts()} onStart={onStart} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: "Codex" }));
    fireEvent.click(screen.getByText(/Start in Terminal.app/));
    expect(onStart.mock.calls[0][0].model).toBe("");
  });

  it("hosting: the primary says 'Start here'", () => {
    const onStart = vi.fn();
    render(<NewSessionDialog initial={plan} facts={facts()} onStart={onStart} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: /Host in Agent Switch/ }));
    fireEvent.click(screen.getByText(/Start here/));
    expect(onStart.mock.calls[0][0].where).toBe("hosted");
  });

  it("without tmux hosting is off and says why; a remembered hosted start starts in the terminal", () => {
    const onStart = vi.fn();
    render(<NewSessionDialog initial={{ ...plan, where: "hosted" }} facts={facts({ hosting: "ephemeral" })} onStart={onStart} onClose={vi.fn()} />);
    const card = screen.getByRole("radio", { name: /Host in Agent Switch/ });
    expect(card.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText(/needs tmux/)).toBeTruthy();
    fireEvent.click(card);
    expect(screen.getByRole("radio", { name: /Your terminal/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByText(/Start in Terminal.app/));
    expect(onStart.mock.calls[0][0].where).toBe("terminal");
  });

  it("every change is reported, so the account box and the preview can follow it", () => {
    const onChange = vi.fn();
    const { rerender } = render(<NewSessionDialog initial={plan} facts={facts()} onChange={onChange} onStart={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: "Codex" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ tool: "codex" }));
    rerender(<NewSessionDialog initial={plan} facts={facts({ command: "agent-switch run --provider codex --cwd ~/code/agent-switch --new-window" })} onChange={onChange} onStart={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Command preview" }));
    expect(screen.getByText(/--provider codex/)).toBeTruthy();
  });

  it("switching the tool keeps a thinking level the new tool has, else high — never silently the lowest", () => {
    const onStart = vi.fn();
    render(<NewSessionDialog initial={{ ...plan, thinking: "max" }} facts={facts({ thinkingLevels: { claude: ["low", "high", "max"], codex: ["minimal", "low", "high"], antigravity: [] } })} onStart={onStart} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: "Codex" }));
    fireEvent.click(screen.getByText(/Start in Terminal.app/));
    expect(onStart.mock.calls[0][0].thinking).toBe("high");
  });

  it("Choose another… picks the account inside the dialog; the rest of the plan stays", () => {
    const onStart = vi.fn();
    const onChange = vi.fn();
    render(<NewSessionDialog initial={{ ...plan, worktree: true, where: "hosted" }} facts={facts()} onChange={onChange} onStart={onStart} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose another…" }));
    fireEvent.click(screen.getByRole("radio", { name: /side/ }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ account: "side", worktree: true, where: "hosted" }));
    fireEvent.click(screen.getByText(/Start here/));
    expect(onStart).toHaveBeenCalledWith({ ...plan, worktree: true, where: "hosted", account: "side" });
    // Back to automatic: the CLI routes again.
    fireEvent.click(screen.getByRole("radio", { name: /Automatic/ }));
    expect(onChange.mock.calls.at(-1)![0].account).toBeUndefined();
  });

  it("the folder is picked from recent folders or typed; a typed ~ path is expanded and a dash refused", () => {
    const onChange = vi.fn();
    render(<NewSessionDialog initial={plan} facts={facts()} onChange={onChange} onStart={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Folder" }));
    fireEvent.click(screen.getByRole("option", { name: "~/code/other" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ folder: "~/code/other" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Folder" }));
    fireEvent.click(screen.getByRole("option", { name: /Another folder/ }));
    const field = screen.getByRole("textbox", { name: "Folder path" });
    fireEvent.change(field, { target: { value: "-rf" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.change(field, { target: { value: "~/x/y" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ folder: "/Users/me/x/y" }));
  });

  it("the model is picked from the tool's models; that model is the one started", () => {
    const onStart = vi.fn();
    render(<NewSessionDialog initial={plan} facts={facts()} onStart={onStart} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Model" }));
    fireEvent.click(screen.getByRole("option", { name: "Sonnet" }));
    fireEvent.click(screen.getByText(/Start in Terminal.app/));
    expect(onStart.mock.calls[0][0].model).toBe("sonnet");
  });

  it("the tool's own thinking levels; Why? and the command preview open on demand", () => {
    render(<NewSessionDialog initial={plan} facts={facts()} onStart={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "Max" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Codex" }));
    expect(screen.queryByRole("radio", { name: "Max" })).toBeNull();
    expect(screen.queryByText("work has the most room")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Why?" }));
    expect(screen.getByText("work has the most room")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Command preview" }));
    expect(screen.getByText("CLAUDE_CONFIG_DIR=… claude")).toBeTruthy();
  });

  it("strategy ask: no account until one is picked, then the pick is the one started", () => {
    const onStart = vi.fn();
    const ask = [{ name: "work", color: "teal" as const }, { name: "side", color: "blue" as const }];
    render(<NewSessionDialog initial={plan} facts={facts({ ask })} onStart={onStart} onClose={vi.fn()} />);
    expect(screen.getByText("Ask me — choose an account")).toBeTruthy();
    expect(screen.queryByText("Automatic →")).toBeNull();
    const startBtn = screen.getByRole("button", { name: /Start in Terminal.app/ }) as HTMLButtonElement;
    expect(startBtn.disabled).toBe(true);
    fireEvent.click(startBtn);
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    expect(onStart).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: /side/ }));
    expect(startBtn.disabled).toBe(false);
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    expect(onStart).toHaveBeenLastCalledWith({ ...plan, account: "side" });
  });

  it("without ask the account line stays automatic and Start is ready", () => {
    render(<NewSessionDialog initial={plan} facts={facts()} onStart={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("Automatic →")).toBeTruthy();
    expect(screen.queryByText("Ask me — choose an account")).toBeNull();
    expect((screen.getByRole("button", { name: /Start in Terminal.app/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("a chat under strategy ask: nothing starts until an account is picked", () => {
    const onStart = vi.fn();
    render(<ChatAccountDialog folder="~/r" ask={[{ name: "work", color: "teal" }, { name: "side", color: "blue" }]} onStart={onStart} onClose={vi.fn()} />);
    expect(screen.getByText("Ask me — choose an account")).toBeTruthy();
    const startBtn = screen.getByRole("button", { name: /Start here/ }) as HTMLButtonElement;
    expect(startBtn.disabled).toBe(true);
    fireEvent.click(startBtn);
    expect(onStart).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: /side/ }));
    fireEvent.click(startBtn);
    expect(onStart).toHaveBeenCalledWith("side");
  });

  it("Esc closes", () => {
    const onClose = vi.fn();
    render(<NewSessionDialog initial={plan} facts={facts()} onStart={vi.fn()} onClose={onClose} />);
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

  it("the kicker says Near limit only for an account that is near its limit (owner screenshot, 60 %)", () => {
    const base = { account: "MathiasB", window: "5h", resetsIn: "1 h 48 min", suggestion: "MBerg", room: null, onKeep: vi.fn(), onClose: vi.fn(), onDecide: vi.fn(), sessions: [{ key: "a", title: "Fix wedge", model: "Opus", target: "MBerg" }] };
    const { unmount } = render(<DecisionSheet {...base} pctUsed={60} nearLimit={false} />);
    expect(screen.queryByText("Near limit")).toBeNull();
    expect(screen.getByText("Move sessions")).toBeTruthy();
    unmount();
    render(<DecisionSheet {...base} pctUsed={96} nearLimit />);
    expect(screen.getByText("Near limit")).toBeTruthy();
  });

  it("nothing changes until a choice; the default is after this turn; unchecked sessions are not moved", () => {
    const onDecide = vi.fn();
    render(<DecisionSheet account="side" pctUsed={94} window="5h" resetsIn="1h 18m" suggestion="work" room={null} onKeep={vi.fn()} onClose={vi.fn()} onDecide={onDecide} sessions={[{ key: "a", title: "Fix wedge", model: "Opus", target: "work" }, { key: "b", title: "Docs", model: "Sonnet", target: "work" }]} />);
    expect(screen.getByText("Resets in 1h 18m. 2 sessions run on it. Nothing changes until you choose.")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("checkbox")[1]); // leave "Docs" where it is
    fireEvent.click(screen.getByText("Continue on work"));
    expect(onDecide).toHaveBeenCalledWith("after-turn", [{ key: "a", target: "work" }]);
  });

  it("a live switch names the sessions on the account that switch along; a brief or a move does not", () => {
    const sessions = [{ key: "a", title: "Fix wedge", model: "Opus", target: "work" }, { key: "b", title: "Docs", model: "Sonnet", target: "work" }];
    const alsoOn = [{ key: "a", title: "Fix wedge" }, { key: "b", title: "Docs" }, { key: "c", title: "Release notes" }];
    render(<DecisionSheet account="side" pctUsed={94} window="5h" resetsIn="1h" suggestion="work" room={null} onKeep={vi.fn()} onClose={vi.fn()} onDecide={vi.fn()} sessions={sessions} alsoOn={alsoOn} />);
    // Both checked: the one outside the sheet still follows.
    expect(screen.getByText("A live switch changes side's sign-in, so these sessions switch too: Release notes.")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("checkbox")[1]); // leave "Docs" — it follows anyway
    expect(screen.getByText("A live switch changes side's sign-in, so these sessions switch too: Docs, Release notes.")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /New session with a brief/ }));
    expect(screen.queryByText(/switch too/)).toBeNull();
    cleanup();
    render(<DecisionSheet account="side" pctUsed={94} window="5h" resetsIn="1h" suggestion="work" room={null} onKeep={vi.fn()} onClose={vi.fn()} onDecide={vi.fn()} sessions={sessions} alsoOn={alsoOn} tool="codex" />);
    expect(screen.queryByText(/switch too/)).toBeNull();
    cleanup();
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

describe("Take over (from your terminal into Agent Switch)", () => {
  const claude = { title: "Fix the parser", tool: "claude" as const, account: "work", where: "iTerm2", running: true };

  it("a running Claude session: says what happens, and ends the source between turns by default", () => {
    const onTakeOver = vi.fn();
    render(<TakeoverDialog facts={claude} busy={false} error={null} onTakeOver={onTakeOver} onClose={vi.fn()} />);
    expect(screen.getByText(/same conversation continues here, hosted by Agent Switch on work/)).toBeTruthy();
    expect(screen.getByRole("radio", { name: /End it in iTerm2 for me/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Take over" }));
    expect(onTakeOver).toHaveBeenLastCalledWith({ stopSource: true, force: false });
    fireEvent.click(screen.getByRole("radio", { name: /I end it myself/ }));
    expect(screen.getByText(/type \/exit/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Take over" }));
    expect(onTakeOver).toHaveBeenLastCalledWith({ stopSource: false, force: false });
  });

  it("a Claude session that no longer runs: nothing to end, no choice", () => {
    render(<TakeoverDialog facts={{ ...claude, running: false }} busy={false} error={null} onTakeOver={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByText(/no longer runs in iTerm2/)).toBeTruthy();
  });

  it("Codex: Agent Switch cannot end it, so the user is told exactly what to do in the terminal first", () => {
    const onTakeOver = vi.fn();
    render(<TakeoverDialog facts={{ ...claude, tool: "codex", where: "your terminal", running: null }} busy={false} error={null} onTakeOver={onTakeOver} onClose={vi.fn()} />);
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByText(/Quit Codex in your terminal first: type \/quit/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Take over" }));
    expect(onTakeOver).toHaveBeenCalledWith({ stopSource: false, force: false });
  });

  it("a refusal is shown; where the CLI allows it, 'Take over anyway' says the risk and forces", () => {
    const onTakeOver = vi.fn();
    const { rerender } = render(<TakeoverDialog facts={claude} busy={false} error={{ text: "codex is running on codex/main.", forceable: true }} onTakeOver={onTakeOver} onClose={vi.fn()} />);
    expect(screen.getByRole("alert").textContent).toContain("codex is running on codex/main.");
    fireEvent.click(screen.getByRole("button", { name: "Take over anyway" }));
    expect(onTakeOver).toHaveBeenCalledWith({ stopSource: true, force: true });
    rerender(<TakeoverDialog facts={claude} busy={false} error={{ text: "mid-turn", forceable: false }} onTakeOver={onTakeOver} onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Take over anyway" })).toBeNull();
    rerender(<TakeoverDialog facts={claude} busy error={null} onTakeOver={onTakeOver} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Taking over…" }).hasAttribute("disabled")).toBe(true);
  });
});
