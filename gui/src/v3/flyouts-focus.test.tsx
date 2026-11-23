/**
 * Roadmap 8.6: the flyouts give and take focus truthfully. ⌘J moves DOM focus
 * to the Needs-you item, so its keys never reach a focused terminal, and Esc
 * gives focus back to where it was.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { V3Window, type V3Data } from "./window.js";
import { data, slots } from "./window-fixture.js";

afterEach(cleanup);

/** A stand-in for xterm: its textarea eats the keys it gets, as the real one does. */
function FakeTerminal({ typed }: { typed: string[] }) {
  return (
    <div data-terminal="">
      <textarea
        aria-label="Terminal input"
        ref={(el) => {
          el?.addEventListener("keydown", (e) => {
            if (e.metaKey || e.ctrlKey) return;
            typed.push(e.key);
            e.stopPropagation();
          });
        }}
      />
    </div>
  );
}

const active = () => document.activeElement as HTMLElement | null;
/** A key goes where the browser sends it: to the focused element, bubbling to the window. */
const key = (k: string, mods: Partial<KeyboardEventInit> = {}) => fireEvent.keyDown(active() ?? document.body, { key: k, ...mods });

function mount(over: Partial<V3Data> = {}, needFocus?: { id: string; n: number }) {
  const act = vi.fn();
  const typed: string[] = [];
  render(
    <V3Window
      data={{ ...data(), health: { state: "ready" }, ...over }}
      slots={{ ...slots, body: () => <FakeTerminal typed={typed} /> }}
      act={act}
      platform="mac"
      needFocus={needFocus}
      layout={{ load: () => ({ tabs: ["s1"], active: "s1" }), save: vi.fn() }}
    />,
  );
  return { act, typed };
}

const since = new Date().toISOString();
const approval = { id: "a", kind: "approval" as const, subject: "claude/work/s1", who: "Bash · npm test", what: "wants your approval", verb: "Allow", since, version: "toolu_1" };
const signin = { id: "b", kind: "signin" as const, subject: "claude/home", who: "home", what: "signed out", verb: "Sign in", since, version: "1" };
const inNeeds = () => active()?.closest('[aria-label="Needs you"]') ?? null;

describe("⌘J from a focused terminal (8.6)", () => {
  it("moves focus to the item, so L defers it and never reaches the terminal", () => {
    const { act, typed } = mount({ needs: [approval, signin] });
    screen.getByLabelText("Terminal input").focus();
    key("j", { metaKey: true });
    expect(active()?.closest("[data-terminal]")).toBeNull();
    expect(inNeeds()).not.toBeNull();
    key("l");
    expect(act).toHaveBeenCalledWith({ type: "need-later", id: "a" });
    expect(typed).toEqual([]);
    // The next item takes the focus.
    expect(active()?.textContent).toMatch(/signed out/);
  });

  it("Y and ⌫ answer the item, not the agent", () => {
    const { act, typed } = mount({ needs: [approval, { ...approval, id: "a2", version: "toolu_2" }] });
    screen.getByLabelText("Terminal input").focus();
    key("j", { metaKey: true });
    key("Backspace");
    key("y");
    const answers = act.mock.calls.map(([a]) => a).filter((a) => a.type === "need-answer").map((a) => a.decision);
    expect(answers).toEqual(["deny", "allow"]);
    expect(typed).toEqual([]);
  });

  it("Esc gives focus back to the terminal", () => {
    const { typed } = mount({ needs: [approval, signin] });
    const term = screen.getByLabelText("Terminal input");
    term.focus();
    key("j", { metaKey: true });
    key("j", { metaKey: true });
    key("Escape");
    expect(active()).toBe(term);
    expect(screen.queryByText(/L later/)).toBeNull();
    expect(typed).toEqual([]);
  });

  it("the tray's focus verb moves focus to the item as well", () => {
    mount({ needs: [approval, signin] }, { id: "b", n: 1 });
    expect(inNeeds()).not.toBeNull();
    expect(active()?.textContent).toMatch(/signed out/);
  });
});

describe("the sort menu names its real default (8.6)", () => {
  it("Status carries the default hint, Activity none", () => {
    mount();
    fireEvent.click(within(screen.getByLabelText("Sessions window")).getByTitle("Sort and group"));
    const menu = screen.getByRole("menu", { name: "Sort and group" });
    expect(within(menu).getByRole("menuitem", { name: /^Status/ }).textContent).toMatch(/default/);
    expect(within(menu).getByRole("menuitem", { name: /^Activity/ }).textContent).not.toMatch(/default/);
  });
});

describe("⌘K then Esc (8.6)", () => {
  it("gives focus back to the element that had it, not to the page", () => {
    mount();
    const term = screen.getByLabelText("Terminal input");
    term.focus();
    key("k", { metaKey: true });
    expect(active()?.getAttribute("aria-label")).toBe("Search");
    key("Escape");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(active()).toBe(term);
  });
});
