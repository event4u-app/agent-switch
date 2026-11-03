/**
 * The v3 design gap (road-to-v3-design-gap): frame elements that were missing
 * or wired differently from the boards, each checked through the real window.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { V3Window, type V3Data } from "./window.js";
import { data, slots } from "./window-fixture.js";

afterEach(cleanup);

function mount(over: Partial<V3Data> = {}) {
  const act = vi.fn();
  const view = render(<V3Window data={{ ...data(), ...over }} slots={slots} act={act} />);
  return { act, view };
}
const openSession = () => fireEvent.click(screen.getAllByText("Event store")[0]);

describe("Open in (spec §7.7)", () => {
  const targets = [
    { target: "phpstorm", label: "PhpStorm", kind: "editor" as const, installed: true },
    { target: "vscode", label: "VS Code", kind: "editor" as const, installed: true },
    { target: "cursor", label: "Cursor", kind: "editor" as const, installed: false },
    { target: "finder", label: "Finder", kind: "files" as const, installed: true },
    { target: "terminal", label: "Terminal", kind: "terminal" as const, installed: true },
  ];
  const withTargets = (): Partial<V3Data> => ({
    openIn: { targets, defaultTarget: "phpstorm", lastUsed: "vscode", perRepo: {}, focusTerminal: true, agentApps: [{ id: "claude-desktop", label: "Claude Desktop", tool: "claude" }, { id: "codex-desktop", label: "Codex", tool: "codex" }] },
    sessions: [{ ...data().sessions[0], key: "claude/work/s1" }],
    bar: () => ({ ...data().bar("s1")!, key: "claude/work/s1" }),
    summary: () => ({ next: null, pr: { number: 142, url: "https://github.com/o/r/pull/142", ci: "SUCCESS", lifecycle: "open", mergeable: "MERGEABLE", review: "", failingChecks: [] }, git: null, limit: null, more: { id: "", host: "", library: "", children: "" } }),
  });

  it("is a split button: the main part opens the default target with its monogram", () => {
    const { act } = mount(withTargets());
    openSession();
    const main = screen.getByTitle("Open in PhpStorm (default) · ⌘O");
    expect(main.textContent).toContain("PS");
    fireEvent.click(main);
    expect(act).toHaveBeenCalledWith({ type: "open-in", key: "claude/work/s1", pick: { kind: "default" } });
  });

  it("the caret opens the menu outside the clipping session bar", () => {
    mount(withTargets());
    openSession();
    fireEvent.click(screen.getByRole("button", { name: "Open in…" }));
    const menu = screen.getByRole("menu", { name: "Open in" });
    // Not a child of the 40 px bar, which keeps overflow-hidden.
    expect(menu.closest(".overflow-hidden.h-10")).toBeNull();
    const items = within(menu).getAllByRole("menuitem").map((b) => b.textContent);
    expect(items).toEqual(["PSPhpStormdefault1", "VSVS Codelast used2", "Editor", "Agent app", "Terminal", "Files", "WebPR #142", "Configure targets…"]);
  });

  it("offers only the agent app of the session's own tool, as opening the project", () => {
    const { act } = mount(withTargets());
    openSession();
    fireEvent.click(screen.getByRole("button", { name: "Open in…" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Agent app/ }));
    const sub = screen.getByRole("menu", { name: "Agent app" });
    expect(sub.textContent).toContain("Claude Desktop");
    expect(sub.textContent).toContain("opens this project");
    expect(sub.textContent).not.toContain("Codex");
    fireEvent.click(within(sub).getByRole("menuitem", { name: /Claude Desktop/ }));
    expect(act).toHaveBeenCalledWith({ type: "open-in", key: "claude/work/s1", pick: { kind: "app", app: "claude-desktop" } });
  });

  it("the Editor submenu names a missing editor as not installed and disables it", () => {
    mount(withTargets());
    openSession();
    fireEvent.click(screen.getByRole("button", { name: "Open in…" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Editor/ }));
    const cursor = within(screen.getByRole("menu", { name: "Editor" })).getByRole("menuitem", { name: /Cursor/ });
    expect(cursor.getAttribute("aria-disabled")).toBe("true");
    expect(cursor.textContent).toContain("not installed");
  });

  it("Configure targets… opens Settings › Open in", () => {
    mount(withTargets());
    openSession();
    fireEvent.click(screen.getByRole("button", { name: "Open in…" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Configure targets/ }));
    expect(screen.getByText(/What “Open in” offers/)).toBeTruthy();
    expect(screen.queryByRole("menu", { name: "Open in" })).toBeNull();
  });
});

describe("Sessions window header (spec §5)", () => {
  it("has the title, + for a new session and ⋯ for the view", () => {
    mount();
    const win = screen.getByLabelText("Sessions window");
    fireEvent.click(within(win).getByRole("button", { name: /New session/ }));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("⋯ offers select, group by project, density and pinned only", () => {
    const store = { load: vi.fn(() => null), save: vi.fn() };
    const d = data();
    render(
      <V3Window
        data={{
          ...d,
          sessions: [d.sessions[0], { ...d.sessions[0], key: "s2", title: "Checkout flow" }],
          table: [{ key: "s1", project: "/code/agent-switch" }, { key: "s2", project: "/code/shop" }] as never,
          library: [{ key: "s2", pinned: true }] as never,
        }}
        slots={slots}
        act={vi.fn()}
        layout={store}
      />,
    );
    const view = () => (fireEvent.click(screen.getByLabelText("Select · group by project · density · show pinned")), screen.getByRole("menu", { name: "Sessions view" }));
    expect(within(view()).getAllByRole("menuitem").map((b) => b.textContent)).toEqual(["Select", "Group by project", "DensityCompact", "Show pinned only"]);
    fireEvent.click(within(screen.getByRole("menu", { name: "Sessions view" })).getByText("Group by project"));
    const win = screen.getByLabelText("Sessions window");
    expect(within(win).getByText("agent-switch")).toBeTruthy();
    expect(within(win).getByText("shop")).toBeTruthy();
    fireEvent.click(within(view()).getByText("Show pinned only"));
    expect(within(win).queryByText("Event store")).toBeNull();
    expect(within(win).getByText("Checkout flow")).toBeTruthy();
    fireEvent.click(within(view()).getByText("Density"));
    expect(store.save).toHaveBeenLastCalledWith(expect.objectContaining({ comfortable: true, groupByProject: true, pinnedOnly: true }));
    fireEvent.click(within(view()).getByText("Select"));
    expect(within(win).getAllByRole("checkbox").length).toBeGreaterThan(0);
  });
});

describe("start on a session (gap §4a)", () => {
  it("opens the first live session when nothing was saved", () => {
    mount();
    expect(screen.getByRole("tab", { name: /Event store/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("restores the saved tabs and the active one", () => {
    const d = data();
    const two = [d.sessions[0], { ...d.sessions[0], key: "s2", title: "Checkout flow" }];
    render(<V3Window data={{ ...d, sessions: two }} slots={slots} act={vi.fn()} layout={{ load: () => ({ tabs: ["s1", "s2"], active: "s2" }), save: vi.fn() }} />);
    expect(screen.getAllByRole("tab").map((t) => t.getAttribute("aria-selected"))).toEqual(["false", "true"]);
  });

  it("with no sessions: the workbench empty state and the zone's one action", () => {
    const { act } = mount({ sessions: [], needs: [] });
    expect(screen.getByText("No sessions yet")).toBeTruthy();
    expect(screen.getByText("No sessions running.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Library" }));
    expect(screen.getByRole("tab", { name: /Library/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Start session/ }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(act).not.toHaveBeenCalled();
  });
});

describe("one trailing glyph per row (spec §5.2)", () => {
  it("the children toggle is hidden at rest and shows on the active row", () => {
    const d = data();
    const kids = { ...d.sessions[0], key: "s2", title: "Checkout flow", children: [{ id: "c", label: "Explore", kind: "subagent", state: "working" as const, source: "hook" as const }] };
    render(<V3Window data={{ ...d, sessions: [d.sessions[0], kids] }} slots={slots} act={vi.fn()} />);
    const toggle = screen.getByLabelText("Show 1 subagent");
    expect(toggle.className).toMatch(/opacity-0/);
    fireEvent.click(within(screen.getByLabelText("Sessions window")).getByText("Checkout flow"));
    expect(screen.getByLabelText("Show 1 subagent").className).not.toMatch(/opacity-0/);
  });
});

describe("the v3 keyboard (spec §12)", () => {
  const press = (key: string, mods: Partial<KeyboardEventInit> = {}) => fireEvent.keyDown(window, { key, metaKey: true, ...mods });
  const mountMac = (over: Partial<V3Data> = {}) => {
    const act = vi.fn();
    render(<V3Window data={{ ...data(), ...over }} slots={slots} act={act} platform="mac" />);
    return act;
  };

  it("⌘K palette, ⌘N new session, ⌘, settings, Esc closes", () => {
    mountMac();
    press("k");
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    press("n");
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    press(",");
    expect(screen.getByRole("tab", { name: /Settings/ })).toBeTruthy();
  });

  it("⌘J focuses the next Needs-you item with its key line; ↵ runs its verb, L defers it", () => {
    const act = mountMac({
      needs: [
        { id: "a", kind: "ci", subject: "s1", who: "Event store", what: "CI failing", verb: "Open checks", since: new Date().toISOString(), version: "1" },
        { id: "b", kind: "signin", subject: "claude/home", who: "home", what: "signed out", verb: "Sign in", since: new Date().toISOString(), version: "1" },
      ],
    });
    press("j");
    expect(screen.getByText("↵ open checks · L later")).toBeTruthy();
    fireEvent.keyDown(window, { key: "l" });
    expect(act).toHaveBeenCalledWith({ type: "need-later", id: "a" });
    expect(screen.getByText("↵ sign in · L later")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(act).toHaveBeenCalledWith(expect.objectContaining({ type: "need", item: expect.objectContaining({ id: "b" }) }));
  });

  it("⌘B hides the Sessions window, ⌘⇧M opens the decision sheet, ⌘O opens the default target", () => {
    const act = mountMac();
    press("b");
    expect(screen.queryByLabelText("Sessions window")).toBeNull();
    press("o");
    expect(act).toHaveBeenCalledWith({ type: "open-in", key: "s1", pick: { kind: "default" } });
    press("m", { shiftKey: true });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("⌘2 selects the second session tab; ⌃Tab cycles recent sessions and picks on release", () => {
    const d = data();
    mountMac({ sessions: [d.sessions[0], { ...d.sessions[0], key: "s2", title: "Checkout flow" }] });
    fireEvent.click(within(screen.getByLabelText("Sessions window")).getByText("Checkout flow"));
    press("1");
    expect(screen.getByRole("tab", { name: /Event store/ }).getAttribute("aria-selected")).toBe("true");
    press("2");
    expect(screen.getByRole("tab", { name: /Checkout flow/ }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(window, { key: "Tab", ctrlKey: true });
    expect(screen.getByRole("dialog", { name: "Recent sessions" })).toBeTruthy();
    fireEvent.keyUp(window, { key: "Control" });
    expect(screen.queryByRole("dialog", { name: "Recent sessions" })).toBeNull();
    expect(screen.getByRole("tab", { name: /Checkout flow/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("keys typed into the terminal stay there off macOS", () => {
    const act = vi.fn();
    render(<V3Window data={data()} slots={{ ...slots, body: () => <div data-terminal tabIndex={0}>term</div> }} act={act} platform="other" />);
    (screen.getByText("term") as HTMLElement).focus();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(window, { key: "K", ctrlKey: true, shiftKey: true });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
