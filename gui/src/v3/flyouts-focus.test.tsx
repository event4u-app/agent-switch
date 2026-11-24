/**
 * Roadmap 8.6: the flyouts give and take focus truthfully. ⌘J moves DOM focus
 * to the Needs-you item, so its keys never reach a focused terminal, and Esc
 * gives focus back to where it was.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { V3Window, type V3Data } from "./window.js";
import { data, slots } from "./window-fixture.js";
import { ModelPopover } from "./workbench.js";

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

  it("an item about a child focuses the child row; its keys still answer the item, Esc returns to the terminal", () => {
    const row = data().sessions[0];
    const child = { id: "claude/work/w", label: "seat w", kind: "council" as const, state: "idle" as const, source: "lineage" as const, tool: "claude" as const, account: { name: "work", color: "teal" as const }, needsYou: true };
    const { act, typed } = mount({ sessions: [{ ...row, children: [child] }], needs: [{ ...approval, subject: "claude/work/w" }] });
    const term = screen.getByLabelText("Terminal input");
    term.focus();
    key("j", { metaKey: true });
    expect(active()?.closest("[data-child-row]")).not.toBeNull();
    key("Backspace");
    expect(act).toHaveBeenCalledWith(expect.objectContaining({ type: "need-answer", decision: "deny" }));
    expect(typed).toEqual([]);
    key("j", { metaKey: true });
    key("Escape");
    expect(active()).toBe(term);
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
    // "Status" twice: the sort, and the grouping (proposal B) — both are the defaults.
    const [sortStatus, groupStatus] = within(menu).getAllByRole("menuitem", { name: /^Status/ });
    expect(sortStatus.textContent).toMatch(/default/);
    expect(groupStatus.textContent).toMatch(/default/);
    expect(within(menu).getByRole("menuitem", { name: /^Activity/ }).textContent).not.toMatch(/default/);
  });
});

describe("the All-sessions table follows the sidebar (8.6)", () => {
  it("lists the session that needs you first, as the sidebar does, though another was active later", () => {
    const d = data();
    const row = d.sessions[0];
    const t = (key: string, title: string, lastActiveMs: number) => ({ key, title, state: "idle" as const, live: true, tool: "claude" as const, account: { name: "work", color: "teal" as const }, branch: null, pr: null, model: null, thinking: null, contextPct: null, lastActiveMs });
    render(
      <V3Window
        data={{
          ...d,
          sessions: [{ ...row, key: "new", title: "Recent one", state: "idle" }, { ...row, key: "ask", title: "Asking one", state: "needs-you", needsYou: true }],
          table: [t("new", "Recent one", d.nowMs - 1_000), t("ask", "Asking one", d.nowMs - 3_600_000)],
        }}
        slots={slots}
        act={vi.fn()}
        platform="mac"
        layout={{ load: () => ({ tabs: [], active: null, pinned: ["page:sessions-table"] }), save: vi.fn() }}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /All sessions/ }));
    // The row checkboxes exist only in the table.
    const titles = screen.getAllByLabelText(/^Select (Recent|Asking) one/).map((e) => e.getAttribute("aria-label") ?? e.textContent);
    expect(titles).toEqual(["Select Asking one", "Select Recent one"]);
  });
});

describe("the model popover names the session's own tool (8.6)", () => {
  const c = { models: [{ id: "opus", label: "Opus", hint: "" }], current: "opus", thinking: ["low", "high"], currentThinking: "high" };
  it("a Claude session never reads about Codex", () => {
    render(<ModelPopover c={c} tool="claude" onModel={vi.fn()} onThinking={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "Model and thinking" });
    expect(dialog.textContent).not.toMatch(/Codex/);
    expect(dialog.textContent).toMatch(/come from Claude Code itself/);
  });
  it("a Codex session reads about its own reasoning levels", () => {
    render(<ModelPopover c={c} tool="codex" onModel={vi.fn()} onThinking={vi.fn()} />);
    expect(screen.getByRole("dialog").textContent).toMatch(/Codex's own reasoning levels/);
  });
});

describe("the right rail on a page tab (8.6)", () => {
  it("is disabled and says why, and never shows a panel as open", () => {
    mount();
    // A session tab first, with Summary open; then a page tab.
    const rail = () => within(screen.getByRole("navigation", { name: "Session panels" }));
    fireEvent.click(rail().getByLabelText(/^Summary/));
    expect(rail().getByLabelText(/^Summary/).getAttribute("aria-pressed")).toBe("true");
    key(",", { metaKey: true });
    for (const name of [/^Summary/, /^Changes/, /^Children/]) {
      const b = rail().getByLabelText(name);
      expect(b.getAttribute("aria-disabled")).toBe("true");
      expect(b.getAttribute("aria-pressed")).toBe("false");
      expect(b.getAttribute("title")).toMatch(/no session in this tab/i);
      fireEvent.click(b);
      expect(b.getAttribute("aria-pressed")).toBe("false");
    }
    // Back on the session, its panel is still the one it had.
    fireEvent.click(screen.getByRole("tab", { name: /Event store/ }));
    expect(rail().getByLabelText(/^Summary/).getAttribute("aria-pressed")).toBe("true");
    expect(rail().getByLabelText(/^Summary/).getAttribute("aria-disabled")).toBeNull();
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
