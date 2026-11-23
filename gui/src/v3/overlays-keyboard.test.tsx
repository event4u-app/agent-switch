/**
 * Overlays (roadmap 7.5): dialogs take focus and trap it, Esc closes them even
 * over a focused terminal; menus work from the keyboard; the session's menus
 * are anchored to their trigger and offer the same items from one source.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { Modal } from "./dialogs.js";
import { Anchored, Menu } from "./menus.js";
import { CheckBox } from "./kit.js";
import { SessionBar } from "./workbench.js";
import { V3Window, type V3Data } from "./window.js";
import { data, slots } from "./window-fixture.js";

afterEach(cleanup);

/** A stand-in for xterm: its textarea swallows Esc so it never bubbles. */
function FakeTerminal() {
  return (
    <div data-terminal="">
      <textarea
        aria-label="Terminal input"
        ref={(el) => {
          el?.addEventListener("keydown", (e) => {
            if (e.key === "Escape") e.stopPropagation();
          });
        }}
      />
    </div>
  );
}

function Harness({ onClose = () => undefined }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <FakeTerminal />
      <button type="button" onClick={() => setOpen(true)}>
        open
      </button>
      {open && (
        <Modal
          title="New session"
          onClose={() => (onClose(), setOpen(false))}
          footer={<button type="button">Start</button>}
        >
          <input aria-label="Folder" />
        </Modal>
      )}
    </div>
  );
}
const active = () => document.activeElement as HTMLElement | null;

describe("dialogs take focus, trap it and give it back", () => {
  it("is modal and moves focus into itself on open", () => {
    render(<Harness />);
    screen.getByLabelText("Terminal input").focus();
    fireEvent.click(screen.getByText("open"));
    const dialog = screen.getByRole("dialog", { name: "New session" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.contains(active())).toBe(true);
  });

  it("Esc closes it even when the terminal took focus back and swallows the key", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByText("open"));
    const term = screen.getByLabelText("Terminal input");
    term.focus();
    fireEvent.keyDown(term, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Tab and Shift+Tab wrap inside the dialog", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("open"));
    const dialog = screen.getByRole("dialog");
    const stops = [
      within(dialog).getByRole("button", { name: /Close/ }),
      within(dialog).getByLabelText("Folder"),
      within(dialog).getByRole("button", { name: "Start" }),
    ];
    stops[2].focus();
    fireEvent.keyDown(stops[2], { key: "Tab" });
    expect(active()).toBe(stops[0]);
    fireEvent.keyDown(stops[0], { key: "Tab", shiftKey: true });
    expect(active()).toBe(stops[2]);
  });

  it("the window behind it is inert while it is open", () => {
    render(
      <V3Window
        data={{ ...data(), health: { state: "ready" } }}
        slots={slots}
        act={vi.fn()}
        platform="mac"
        layout={{ load: () => ({ tabs: ["s1"], active: "s1" }), save: vi.fn() }}
      />,
    );
    fireEvent.keyDown(window, { key: "n", metaKey: true });
    const dialog = screen.getByRole("dialog");
    const shell = document.querySelector("[data-v3-shell]")!;
    const behind = [...shell.children].filter((c) => !c.contains(dialog));
    expect(behind.length).toBeGreaterThan(0);
    expect(behind.every((c) => c.hasAttribute("inert"))).toBe(true);
    fireEvent.keyDown(active()!, { key: "Escape" });
    expect([...shell.children].some((c) => c.hasAttribute("inert"))).toBe(
      false,
    );
  });

  it("gives focus back to what had it on close", () => {
    render(<Harness />);
    const opener = screen.getByText("open");
    opener.focus();
    fireEvent.click(opener);
    fireEvent.keyDown(active()!, { key: "Escape" });
    expect(active()).toBe(opener);
  });
});

describe("menus work from the keyboard", () => {
  function mount(over: Partial<V3Data> = {}) {
    const act = vi.fn();
    const d = data();
    const openIn = {
      ...d.openIn,
      targets: [
        ...d.openIn.targets,
        {
          target: "phpstorm",
          label: "PhpStorm",
          kind: "editor" as const,
          installed: true,
        },
      ],
      defaultTarget: "phpstorm",
      lastUsed: "vscode",
    };
    render(
      <V3Window
        data={{ ...d, health: { state: "ready" }, openIn, ...over }}
        slots={slots}
        act={act}
        platform="mac"
        layout={{ load: () => ({ tabs: ["s1"], active: "s1" }), save: vi.fn() }}
      />,
    );
    return act;
  }
  const items = (menu: HTMLElement) =>
    within(menu)
      .getAllByRole("menuitem")
      .filter((b) => b.getAttribute("aria-disabled") !== "true");

  it("⋯ focuses its first item; arrows, Home and End move; Esc closes and returns to the trigger", () => {
    mount();
    const trigger = screen.getByRole("button", { name: /Session actions/ });
    trigger.focus();
    fireEvent.click(trigger);
    const menu = screen.getByRole("menu", { name: "Session actions" });
    const list = items(menu);
    expect(active()).toBe(list[0]);
    fireEvent.keyDown(active()!, { key: "ArrowDown" });
    expect(active()).toBe(list[1]);
    fireEvent.keyDown(active()!, { key: "End" });
    expect(active()).toBe(list[list.length - 1]);
    fireEvent.keyDown(active()!, { key: "ArrowDown" });
    expect(active()).toBe(list[0]);
    fireEvent.keyDown(active()!, { key: "ArrowUp" });
    expect(active()).toBe(list[list.length - 1]);
    fireEvent.keyDown(active()!, { key: "Home" });
    expect(active()).toBe(list[0]);
    fireEvent.keyDown(active()!, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Session actions" })).toBeNull();
    expect(active()).toBe(trigger);
  });

  it("Enter activates the focused item", () => {
    const act = mount();
    fireEvent.click(screen.getByRole("button", { name: /Session actions/ }));
    fireEvent.keyDown(active()!, { key: "Enter" });
    expect(act).toHaveBeenCalledWith({
      type: "session-menu",
      key: "s1",
      item: "Rename…",
    });
  });

  it("Open in: → enters a submenu, ← leaves it, Esc closes one level at a time", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Open in…" }));
    const editor = screen.getByRole("menuitem", { name: /^Editor/ });
    editor.focus();
    fireEvent.keyDown(editor, { key: "ArrowRight" });
    const sub = screen.getByRole("menu", { name: "Editor" });
    expect(sub.contains(active())).toBe(true);
    fireEvent.keyDown(active()!, { key: "ArrowLeft" });
    expect(screen.queryByRole("menu", { name: "Editor" })).toBeNull();
    expect(active()).toBe(screen.getByRole("menuitem", { name: /^Editor/ }));
    fireEvent.keyDown(active()!, { key: "ArrowRight" });
    fireEvent.keyDown(active()!, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Editor" })).toBeNull();
    expect(screen.getByRole("menu", { name: "Open in" })).toBeTruthy();
    fireEvent.keyDown(active()!, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Open in" })).toBeNull();
  });

  it("the printed digits pick their row", () => {
    const act = mount();
    fireEvent.click(screen.getByRole("button", { name: "Open in…" }));
    fireEvent.keyDown(active()!, { key: "2" });
    expect(act).toHaveBeenCalledWith({
      type: "open-in",
      key: "s1",
      pick: { kind: "target", target: "vscode" },
    });
  });

  it("an opened menu takes focus from the terminal, so Esc reaches the menu", () => {
    const onClose = vi.fn();
    render(<FakeTerminal />);
    screen.getByLabelText("Terminal input").focus();
    render(
      <Anchored onClose={onClose}>
        <Menu label="M" items={[{ id: "a", label: "A" }]} />
      </Anchored>,
    );
    expect(screen.getByRole("menu").contains(active())).toBe(true);
    fireEvent.keyDown(active()!, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("the session's two menus come from one list", () => {
  const library = (pinned: boolean): V3Data["library"] => [
    {
      key: "s1",
      name: "Event store",
      summary: null,
      tags: [],
      color: "teal",
      project: null,
      branch: null,
      pr: null,
      lastMs: 0,
      pinned,
      archived: false,
      vault: { state: "saved", bytes: 1 },
      transcript: true,
    },
  ];
  function mount(over: Partial<V3Data> = {}) {
    const act = vi.fn();
    render(
      <V3Window
        data={{ ...data(), health: { state: "ready" }, ...over }}
        slots={slots}
        act={act}
        platform="mac"
        layout={{ load: () => ({ tabs: ["s1"], active: "s1" }), save: vi.fn() }}
      />,
    );
    return act;
  }
  const labels = (menu: HTMLElement) =>
    within(menu)
      .getAllByRole("menuitem")
      .map((b) => b.textContent);

  it("⋯ and the tab's right-click menu offer the same session items", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Session actions/ }));
    const session = labels(
      screen.getByRole("menu", { name: "Session actions" }),
    );
    fireEvent.pointerDown(document.body);
    fireEvent.contextMenu(screen.getByRole("tab", { name: /Event store/ }), {
      clientX: 40,
      clientY: 20,
    });
    const tab = labels(screen.getByRole("menu", { name: "Tab" }));
    expect(session.length).toBeGreaterThan(3);
    expect(tab.slice(-session.length)).toEqual(session);
  });

  it("Pin turns into Unpin for a pinned session, and unpins it", () => {
    const act = mount({ library: library(true) });
    fireEvent.click(screen.getByRole("button", { name: /Session actions/ }));
    expect(screen.queryByRole("menuitem", { name: "Pin session" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Unpin session" }));
    expect(act).toHaveBeenCalledWith({
      type: "library",
      op: "pin",
      key: "s1",
      value: false,
    });
  });

  it("an unpinned session offers Pin", () => {
    const act = mount({ library: library(false) });
    fireEvent.click(screen.getByRole("button", { name: /Session actions/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Pin session" }));
    expect(act).toHaveBeenCalledWith({
      type: "session-menu",
      key: "s1",
      item: "Pin",
    });
  });
});

describe("overlays are anchored to their trigger", () => {
  it("the bar keeps Open in and ⋯ outside the part that clips", () => {
    const bar = {
      key: "s1",
      hosted: true,
      chatAvailable: false,
      view: "terminal" as const,
      account: { name: "work", color: "teal" as const, fiveH: 94, protect: 98 },
      model: "Opus",
      thinking: "high",
      contextPct: 40,
    };
    render(
      <SessionBar
        s={bar}
        openIn={<button type="button">Open in…</button>}
        on={{
          view: vi.fn(),
          account: vi.fn(),
          model: vi.fn(),
          thinking: vi.fn(),
          menu: vi.fn(),
        }}
      />,
    );
    const dots = screen.getByRole("button", { name: /Session actions/ });
    const openIn = screen.getByRole("button", { name: "Open in…" });
    // Neither sits inside the shrinking, clipping cluster.
    expect(dots.closest("[data-bar-clip]")).toBeNull();
    expect(openIn.closest("[data-bar-clip]")).toBeNull();
    expect(screen.getByText("Opus").closest("[data-bar-clip]")).not.toBeNull();
  });

  it("the ⋯ menu opens under its button, wherever the button is", () => {
    render(
      <V3Window
        data={{ ...data(), health: { state: "ready" } }}
        slots={slots}
        act={vi.fn()}
        platform="mac"
        layout={{ load: () => ({ tabs: ["s1"], active: "s1" }), save: vi.fn() }}
      />,
    );
    const shell = document.querySelector("[data-v3-shell]") as HTMLElement;
    shell.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 1100,
      bottom: 800,
      width: 1100,
      height: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const trigger = screen.getByRole("button", { name: /Session actions/ });
    trigger.getBoundingClientRect = () => ({
      left: 700,
      top: 80,
      right: 728,
      bottom: 108,
      width: 28,
      height: 28,
      x: 700,
      y: 80,
      toJSON: () => ({}),
    });
    fireEvent.click(trigger);
    const layer = screen.getByRole("menu", { name: "Session actions" })
      .parentElement as HTMLElement;
    expect(layer.style.top).toBe("112px");
    expect(layer.style.right).toBe("372px");
  });
});

describe("one section header style", () => {
  it("a menu section is a labelled group with the caps heading", () => {
    render(
      <Menu
        label="Sort and group"
        items={[
          { section: "Sort by", label: "" },
          { id: "a", label: "Activity" },
          { section: "Group by", label: "" },
          { id: "b", label: "Project" },
        ]}
      />,
    );
    const sort = screen.getByRole("group", { name: "Sort by" });
    expect(
      within(sort).getByRole("menuitem", { name: "Activity" }),
    ).toBeTruthy();
    expect(within(sort).getByText("Sort by").className).toContain("ac-caps");
    expect(
      within(screen.getByRole("group", { name: "Group by" })).getByRole(
        "menuitem",
        { name: "Project" },
      ),
    ).toBeTruthy();
  });
});

describe("a selected checkbox is clearly selected", () => {
  // The fill stays neutral (orange means "needs you", sessions.test); the check glyph is what tells on from off.
  it("carries a check at both sizes, and none when off", () => {
    for (const size of [14, 16] as const) {
      const on = render(
        <CheckBox checked size={size} label="pick" onChange={vi.fn()} />,
      );
      const box = on.container.querySelector("input + span") as HTMLElement;
      expect(box.className).toContain("bg-ac-text");
      expect(box.querySelector("svg")).not.toBeNull();
      on.unmount();
      const off = render(
        <CheckBox
          checked={false}
          size={size}
          label="pick"
          onChange={vi.fn()}
        />,
      );
      expect(off.container.querySelector("svg")).toBeNull();
      off.unmount();
    }
  });

  it("a checked row in the selecting list shows the check too", () => {
    render(
      <V3Window
        data={{ ...data(), health: { state: "ready" } }}
        slots={slots}
        act={vi.fn()}
        platform="mac"
        layout={{ load: () => ({ tabs: ["s1"], active: "s1" }), save: vi.fn() }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Select · density/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Select" }));
    const box = within(screen.getByLabelText("Sessions window")).getByRole(
      "checkbox",
    );
    expect(box.querySelector("svg")).toBeNull();
    fireEvent.click(box);
    const checked = within(screen.getByLabelText("Sessions window")).getByRole(
      "checkbox",
    );
    expect(checked.getAttribute("aria-checked")).toBe("true");
    expect(checked.querySelector("svg")).not.toBeNull();
  });
});
