import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BlockerStrip, ExternalBody, SessionBar, TabStrip, engineDownText, xtermTheme, type BarSession } from "./workbench.js";
import { resolveTheme } from "./themes/resolve.js";
import { THEMES } from "./themes/registry.js";

afterEach(cleanup);
const bar = (over: Partial<BarSession> = {}): BarSession => ({ key: "k", hosted: true, chatAvailable: false, view: "terminal", account: { name: "work", color: "teal", fiveH: 39, protect: 98 }, model: "Opus 5.5", thinking: "high", contextPct: 58, ...over });
const handlers = () => ({ view: vi.fn(), account: vi.fn(), model: vi.fn(), thinking: vi.fn(), menu: vi.fn() });

describe("workbench (spec §6)", () => {
  it("tabs: pages first, sessions numbered ⌘1…, the active one framed; a page tab closes on its ×", () => {
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
    fireEvent.click(tabs[0].querySelector("[data-tab-close]")!);
    expect(onClose).toHaveBeenCalledWith("accounts");
  });

  it("tabs are real ARIA tabs: one tab stop, arrows move, Enter opens, Delete closes; the × still closes on click", () => {
    const onClose = vi.fn();
    const onSelect = vi.fn();
    render(
      <TabStrip
        activeId="s1"
        onSelect={onSelect}
        onClose={onClose}
        pinned={new Set(["s3"])}
        tabs={[
          { kind: "session", id: "s1", title: "Event store", state: "working" },
          { kind: "page", id: "accounts", label: "Accounts", icon: null },
          { kind: "session", id: "s2", title: "Themes", state: "idle" },
          { kind: "session", id: "s3", title: "Pinned one", state: "idle" },
        ]}
      />,
    );
    const tab = (name: RegExp) => screen.getByRole("tab", { name });
    // Order: pinned, pages, sessions. Only the active tab is in the Tab order.
    expect(screen.getAllByRole("tab").map((t) => t.tabIndex)).toEqual([-1, -1, 0, -1]);
    const strip = screen.getByRole("tablist");
    expect(strip.querySelectorAll("button, [tabindex='0']").length).toBe(1);

    tab(/Event store/).focus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(tab(/Themes/));
    expect(tab(/Themes/).tabIndex).toBe(0);
    expect(tab(/Event store/).tabIndex).toBe(-1);
    // Moving focus does not open the tab; Enter and Space do.
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(tab(/Pinned one/));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(tab(/Accounts/));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(tab(/Pinned one/));
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toBe(tab(/Themes/));
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toBe(tab(/Pinned one/));
    fireEvent.keyDown(document.activeElement!, { key: "Enter" });
    expect(onSelect).toHaveBeenLastCalledWith("s3");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    fireEvent.keyDown(document.activeElement!, { key: " " });
    expect(onSelect).toHaveBeenLastCalledWith("accounts");

    // A pinned tab does not close from the keyboard either.
    tab(/Pinned one/).focus();
    fireEvent.keyDown(document.activeElement!, { key: "Delete" });
    expect(onClose).not.toHaveBeenCalled();
    tab(/Themes/).focus();
    fireEvent.keyDown(document.activeElement!, { key: "Delete" });
    expect(onClose).toHaveBeenLastCalledWith("s2");
    tab(/Accounts/).focus();
    fireEvent.keyDown(document.activeElement!, { key: "Backspace" });
    expect(onClose).toHaveBeenLastCalledWith("accounts");
    expect(onClose).toHaveBeenCalledTimes(2);

    // The pointer path is unchanged: the × closes without selecting.
    onSelect.mockClear();
    fireEvent.click(tab(/Event store/).querySelector("[data-tab-close]")!);
    expect(onClose).toHaveBeenLastCalledWith("s1");
    expect(onSelect).not.toHaveBeenCalled();
    expect(tab(/Pinned one/).querySelector("[data-tab-close]")).toBeNull();
  });

  it("focus comes back into the strip on the active tab, and a keyboard close hands focus to the neighbour", () => {
    const tabs = [
      { kind: "session" as const, id: "s1", title: "Event store", state: "working" as const },
      { kind: "session" as const, id: "s2", title: "Themes", state: "idle" as const },
    ];
    const { rerender } = render(<><TabStrip activeId="s2" onSelect={vi.fn()} onClose={vi.fn()} tabs={tabs} /><button type="button">outside</button></>);
    screen.getByRole("tab", { name: /Themes/ }).focus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: /Event store/ }).tabIndex).toBe(0);
    // Leaving the strip resets the tab stop to the active tab.
    const out = screen.getByRole("button", { name: "outside" });
    fireEvent.blur(document.activeElement!, { relatedTarget: out });
    out.focus();
    expect(screen.getByRole("tab", { name: /Themes/ }).tabIndex).toBe(0);

    screen.getByRole("tab", { name: /Themes/ }).focus();
    fireEvent.keyDown(document.activeElement!, { key: "Delete" });
    rerender(<><TabStrip activeId="s1" onSelect={vi.fn()} onClose={vi.fn()} tabs={tabs.slice(0, 1)} /><button type="button">outside</button></>);
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: /Event store/ }));
  });

  it("session bar: in the user's own terminal both views switch (read-only) and the chips lock; the account chip only opens the sheet", () => {
    const on = handlers();
    const { rerender } = render(<SessionBar s={bar({ hosted: false })} openIn={null} on={on} />);
    const chat = screen.getByRole("radio", { name: /Chat/ });
    expect(chat.getAttribute("title")).toBe("Chat · read-only here — you type in your terminal");
    fireEvent.click(chat);
    expect(on.view).toHaveBeenCalledWith("chat");
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

  it("session bar: a session started in the chat offers no Terminal and says why (8.3)", () => {
    const on = handlers();
    render(<SessionBar s={bar({ view: "chat", terminalWhy: "This session started in the chat view; it has no terminal here" })} openIn={null} on={on} />);
    const terminal = screen.getByRole("radio", { name: /Terminal/ });
    expect(terminal.getAttribute("aria-disabled")).toBe("true");
    expect(terminal.getAttribute("title")).toBe("This session started in the chat view; it has no terminal here");
    fireEvent.click(terminal);
    expect(on.view).not.toHaveBeenCalled();
  });

  it("session bar: a hosted session whose model and thinking cannot change locks the chip and says why (7.6)", () => {
    const on = handlers();
    render(<SessionBar s={bar({ respawnWhy: "Codex keeps the model and thinking it started with" })} openIn={null} on={on} />);
    const chip = screen.getByText("Opus 5.5").closest("button")!;
    expect(chip.getAttribute("aria-disabled")).toBe("true");
    expect(chip.getAttribute("title")).toMatch(/Codex keeps/);
    fireEvent.click(chip);
    expect(on.model).not.toHaveBeenCalled();
  });

  it("session bar: thinking is an arrow behind the model — down least, right medium, up most (owner, 2026-11-24)", () => {
    const dir = (level: string) => {
      const { container, unmount } = render(<SessionBar s={bar({ thinking: level })} openIn={null} on={handlers()} />);
      const a = container.querySelector("[data-thinking]")!;
      const out = [a.getAttribute("aria-label"), a.querySelector("svg")!.getAttribute("class")!.match(/lucide-arrow-[a-z-]+/)![0]];
      unmount();
      return out;
    };
    expect(dir("minimal")).toEqual(["Thinking Minimal", "lucide-arrow-down"]);
    expect(dir("low")).toEqual(["Thinking Low", "lucide-arrow-down-right"]);
    expect(dir("medium")).toEqual(["Thinking Medium", "lucide-arrow-right"]);
    expect(dir("high")).toEqual(["Thinking High", "lucide-arrow-up-right"]);
    expect(dir("max")).toEqual(["Thinking Max", "lucide-arrow-up"]);
    expect(screen.queryByText("High"), "no second chip").toBeNull();
  });

  it("session bar: where the session runs is a visible chip — hosted, or the user's terminal app being watched", () => {
    const { rerender } = render(<SessionBar s={bar()} openIn={null} on={handlers()} />);
    const hosted = screen.getByText("Hosted");
    expect(hosted.closest("[title]")?.getAttribute("title")).toBe("Hosted by Agent Switch: type here, or attach from your terminal");
    expect(screen.getByText("type here, or attach from your terminal")).toBeTruthy();
    rerender(<SessionBar s={bar({ hosted: false, where: "Terminal.app" })} openIn={null} on={handlers()} />);
    expect(screen.queryByText("Hosted")).toBeNull();
    expect(screen.getByText("Terminal.app · read-only")).toBeTruthy();
  });

  it("a session in the user's own terminal has no strip of its own: Focus terminal and Take over live in ⋯ (proposal C)", () => {
    render(<ExternalBody facts={null} lastLine={null} />);
    expect(screen.queryByText("Focus terminal")).toBeNull();
    expect(screen.queryByText("Take over here…")).toBeNull();
    expect(screen.queryByText(/read-only here/)).toBeNull();
  });

  it("the blocker shows only while Summary is closed, with one action", () => {
    const onAction = vi.fn();
    const { rerender } = render(<BlockerStrip text="CI fails and the branch has a conflict." action="Send to agent" summaryOpen={false} onAction={onAction} onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByText("Send to agent"));
    expect(onAction).toHaveBeenCalledOnce();
    rerender(<BlockerStrip text="x" action="Send to agent" summaryOpen onAction={onAction} onDismiss={vi.fn()} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a session in the user's own terminal: its facts and its last line (D-mirror)", () => {
    render(<ExternalBody facts={<p>work · main</p>} lastLine="41 passed" />);
    expect(screen.getByText("work · main")).toBeTruthy();
    expect(screen.getByText("41 passed")).toBeTruthy();
  });

  it("the engine banner says hosted sessions keep running", () => {
    expect(engineDownText(0, 2 * 60_000, 2)).toBe("The engine stopped 2 min ago. Hosted sessions keep running in tmux; Agent Switch reconnects when it is back.");
    expect(engineDownText(0, 10_000, 0)).toBe("The engine stopped 1 min ago. Agent Switch reconnects when it is back.");
    expect(engineDownText(0, 10_000, 2, true)).toBe("The background service runs another Agent Switch install, which has no engine for this window. Hosted sessions keep running in tmux. Move the service here to start it.");
    expect(engineDownText(0, 10_000, 0, true)).toBe("The background service runs another Agent Switch install, which has no engine for this window. Move the service here to start it.");
  });

  it("the terminal uses the theme's colours, or the agent's own on the theme background", () => {
    const vars = resolveTheme(THEMES.find((t) => t.id === "darcula")!).vars;
    const on = xtermTheme(vars, true);
    expect(on.background).toBe(vars["--as-term-bg"]);
    expect(on.brightWhite).toBe(vars["--as-ansi-15"]);
    expect(Object.keys(xtermTheme(vars, false))).toEqual(["background", "foreground"]);
  });
});
