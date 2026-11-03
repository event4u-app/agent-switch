import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BlockerStrip, ExternalBody, SessionBar, TabStrip, engineDownText, xtermTheme, type BarSession } from "./workbench.js";
import { resolveTheme } from "./themes/resolve.js";
import { THEMES } from "./themes/registry.js";

afterEach(cleanup);
const bar = (over: Partial<BarSession> = {}): BarSession => ({ key: "k", hosted: true, chatAvailable: false, view: "terminal", account: { name: "work", color: "teal", fiveH: 39, protect: 98 }, model: "Opus 5.5", thinking: "high", contextPct: 58, ...over });
const handlers = () => ({ view: vi.fn(), account: vi.fn(), model: vi.fn(), thinking: vi.fn(), menu: vi.fn() });

describe("workbench (spec §6)", () => {
  it("tabs: pages first, sessions numbered ⌘1…, the active one framed; closing a page tab is its own button", () => {
    const onClose = vi.fn();
    render(
      <TabStrip
        activeId="s1"
        onSelect={vi.fn()}
        onClose={onClose}
        tabs={[
          { kind: "session", id: "s1", title: "Event store", state: "working" },
          { kind: "page", id: "accounts", label: "Accounts", icon: null },
          { kind: "session", id: "s2", title: "Themes", state: "idle" },
        ]}
      />,
    );
    const tabs = screen.getAllByRole("tab");
    // The state icon carries its state as words for screen readers.
    expect(tabs.map((t) => t.textContent)).toEqual(["Accounts", "WorkingEvent store⌘1", "IdleThemes⌘2"]);
    expect(tabs[1].className).toContain("border-t-ac-brand");
    fireEvent.click(screen.getByLabelText("Close Accounts"));
    expect(onClose).toHaveBeenCalledWith("accounts");
  });

  it("session bar: Chat is disabled with the reason, chips lock in the user's own terminal, the account chip only opens the sheet", () => {
    const on = handlers();
    const { rerender } = render(<SessionBar s={bar({ hosted: false })} openIn={null} on={on} />);
    const chat = screen.getByRole("radio", { name: /Chat/ });
    expect(chat.getAttribute("title")).toBe("Chat needs a session hosted in Agent Switch");
    fireEvent.click(chat);
    expect(on.view).not.toHaveBeenCalled();
    const model = screen.getByText("Opus 5.5").closest("button")!;
    expect(model.getAttribute("title")).toBe("Locked: change it in your terminal (/model)");
    fireEvent.click(model);
    expect(on.model).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("work").closest("button")!);
    expect(on.account).toHaveBeenCalledOnce();
    expect(screen.getByText("ctx 58%")).toBeTruthy();

    rerender(<SessionBar s={bar()} openIn={null} on={on} />);
    fireEvent.click(screen.getByText("Opus 5.5").closest("button")!);
    expect(on.model).toHaveBeenCalledOnce();
    expect(screen.getByRole("radio", { name: /Chat/ }).getAttribute("title")).toBe("This tool keeps the view it started in");
  });

  it("the blocker shows only while Summary is closed, with one action", () => {
    const onAction = vi.fn();
    const { rerender } = render(<BlockerStrip text="CI fails and the branch has a conflict." action="Send to agent" summaryOpen={false} onAction={onAction} onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByText("Send to agent"));
    expect(onAction).toHaveBeenCalledOnce();
    rerender(<BlockerStrip text="x" action="Send to agent" summaryOpen onAction={onAction} onDismiss={vi.fn()} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a session in the user's own terminal: where it runs, focus, take over, facts and its last line (D-mirror)", () => {
    const onFocus = vi.fn();
    render(<ExternalBody where="Terminal.app" facts={<p>work · main</p>} lastLine="41 passed" onFocus={onFocus} onTakeOver={vi.fn()} />);
    expect(screen.getByText("Terminal.app")).toBeTruthy();
    fireEvent.click(screen.getByText("Focus terminal"));
    expect(onFocus).toHaveBeenCalledOnce();
    expect(screen.getByText("41 passed")).toBeTruthy();
  });

  it("the engine banner says hosted sessions keep running", () => {
    expect(engineDownText(0, 2 * 60_000, 2)).toBe("The engine stopped 2 min ago. Hosted sessions keep running in tmux; Agent Switch reconnects when it is back.");
    expect(engineDownText(0, 10_000, 0)).toBe("The engine stopped 1 min ago. Agent Switch reconnects when it is back.");
  });

  it("the terminal uses the theme's colours, or the agent's own on the theme background", () => {
    const vars = resolveTheme(THEMES.find((t) => t.id === "darcula")!).vars;
    const on = xtermTheme(vars, true);
    expect(on.background).toBe(vars["--as-term-bg"]);
    expect(on.brightWhite).toBe(vars["--as-ansi-15"]);
    expect(Object.keys(xtermTheme(vars, false))).toEqual(["background", "foreground"]);
  });
});
