/**
 * The v3 design gap (road-to-v3-design-gap): frame elements that were missing
 * or wired differently from the boards, each checked through the real window.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

  it("closes on a press outside it, and the caret toggles it", () => {
    mount(withTargets());
    openSession();
    const caret = screen.getByRole("button", { name: "Open in…" });
    fireEvent.click(caret);
    // A press inside the menu keeps it open.
    fireEvent.pointerDown(screen.getByRole("menuitem", { name: /Editor/ }));
    expect(screen.queryByRole("menu", { name: "Open in" })).not.toBeNull();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu", { name: "Open in" })).toBeNull();
    // The caret opens it and, pressed again, closes it (never close-then-reopen).
    fireEvent.click(caret);
    fireEvent.pointerDown(caret);
    fireEvent.click(caret);
    expect(screen.queryByRole("menu", { name: "Open in" })).toBeNull();
  });

  it("every anchored popover closes on a press outside it", () => {
    const models = () => ({ models: [{ id: "opus", label: "Opus", hint: "deepest" }], current: "opus", thinking: ["high"], currentThinking: "high" });
    mount({ ...withTargets(), models });
    openSession();
    fireEvent.click(screen.getByTitle("Model for the next turn"));
    expect(screen.queryByRole("dialog", { name: "Model and thinking" })).not.toBeNull();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog", { name: "Model and thinking" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Session actions/ }));
    expect(screen.queryByRole("menu", { name: "Session actions" })).not.toBeNull();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu", { name: "Session actions" })).toBeNull();
  });

  it("offers only the agent app of the session's own tool, as opening the project", () => {
    const { act } = mount(withTargets());
    openSession();
    fireEvent.click(screen.getByRole("button", { name: "Open in…" }));
    // Hover opens the submenu, and the click that follows keeps it open.
    fireEvent.mouseEnter(screen.getByRole("menuitem", { name: /Agent app/ }));
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

  it("a session tab closes without ending its session, and the neighbour takes over (spec §6.1)", () => {
    const d = data();
    const two = [d.sessions[0], { ...d.sessions[0], key: "s2", title: "Checkout flow" }];
    const act = vi.fn();
    render(<V3Window data={{ ...d, sessions: two }} slots={slots} act={act} layout={{ load: () => ({ tabs: ["s1", "s2"], active: "s2" }), save: vi.fn() }} />);
    fireEvent.click(screen.getByRole("button", { name: "Close Checkout flow" }));
    expect(screen.queryByRole("tab", { name: /Checkout flow/ })).toBeNull();
    expect(screen.getByRole("tab", { name: /Event store/ }).getAttribute("aria-selected")).toBe("true");
    expect(act).not.toHaveBeenCalled();
    // Still in the sidebar.
    expect(screen.getAllByText("Checkout flow").length).toBeGreaterThan(0);
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

  it("while the first read runs: no empty state, no \"No sessions running\"", () => {
    mount({ sessions: [], needs: [], loading: true });
    expect(screen.queryByText("No sessions yet")).toBeNull();
    expect(screen.queryByText("No sessions running.")).toBeNull();
    expect(screen.getByLabelText("Sessions window").getAttribute("data-loaded")).toBe("false");
  });
});

describe("one trailing glyph per row (spec §5.2)", () => {
  const kid = (state: "working" | "done") => [{ id: "c", label: "Explore", kind: "subagent", state, source: "hook" as const }];

  it("running children: the count is the slot and unfolds them; no second glyph", () => {
    const d = data();
    render(<V3Window data={{ ...d, sessions: [d.sessions[0], { ...d.sessions[0], key: "s2", title: "Checkout flow", account: { name: "work", nearLimit: false }, children: kid("working") }] }} slots={slots} act={vi.fn()} />);
    const slot = screen.getByLabelText("Show 1 subagent");
    expect(slot.textContent).toBe("1");
    expect(slot.className).not.toMatch(/opacity-0/);
    fireEvent.click(slot);
    expect(screen.getByText("Explore")).toBeTruthy();
    expect(screen.getByLabelText("Hide children")).toBeTruthy();
  });

  it("finished children in an empty slot: a chevron on hover only", () => {
    const d = data();
    render(<V3Window data={{ ...d, sessions: [d.sessions[0], { ...d.sessions[0], key: "s2", title: "Checkout flow", account: { name: "work", nearLimit: false }, children: kid("done") }] }} slots={slots} act={vi.fn()} />);
    const toggle = screen.getByLabelText("Show 1 subagent");
    expect(toggle.className).toMatch(/opacity-0/);
    expect(toggle.className).toMatch(/group-hover\/row:opacity-100/);
  });

  it("a slot taken by a higher priority keeps its glyph alone", () => {
    const d = data();
    render(<V3Window data={{ ...d, sessions: [d.sessions[0], { ...d.sessions[0], key: "s2", title: "Checkout flow", account: { name: "side", nearLimit: true }, children: kid("working") }] }} slots={slots} act={vi.fn()} />);
    expect(screen.queryByLabelText("Show 1 subagent")).toBeNull();
    expect(screen.getByTitle("side is near its limit")).toBeTruthy();
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

describe("Limits popover (spec §7.5)", () => {
  it("a row opens the popover with every window; the row keeps its fill; Move opens the decision sheet", () => {
    mount();
    const strip = screen.getByLabelText("Limits");
    fireEvent.click(within(strip).getByText("work"));
    const pop = screen.getByRole("dialog", { name: "work limits" });
    expect(within(pop).getByText("5h")).toBeTruthy();
    expect(within(strip).getByText("work").closest("[role=button]")!.className).toMatch(/bg-ac-raise/);
    fireEvent.click(within(pop).getByText("Move its session…"));
    expect(screen.queryByRole("dialog", { name: "work limits" })).toBeNull();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("Open Accounts opens the Accounts page", () => {
    mount();
    fireEvent.click(within(screen.getByLabelText("Limits")).getByText("work"));
    fireEvent.click(screen.getByText("Open Accounts"));
    expect(screen.getByRole("tab", { name: /Accounts/ })).toBeTruthy();
  });

  it("an account not read yet says so instead of an empty bar", () => {
    const d = data();
    mount({ limits: [{ ...d.limits[0], windows: [] }] });
    expect(within(screen.getByLabelText("Limits")).getByText("no data yet")).toBeTruthy();
  });
});

describe("Model popover (spec §7.6)", () => {
  const models = () => ({ models: [{ id: "opus", label: "Opus", hint: "deepest" }, { id: "sonnet", label: "Sonnet", hint: "balanced" }], current: "opus", thinking: ["low", "high"], currentThinking: "high" });

  it("opens under the chip, marks only the chosen model and changes it for the next turn", () => {
    const { act } = mount({ models });
    fireEvent.click(screen.getByTitle("Model for the next turn"));
    const pop = screen.getByRole("dialog", { name: "Model and thinking" });
    expect(within(pop).getAllByRole("menuitemradio").map((b) => b.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    expect(within(pop).getByText("Applies from the next turn.", { exact: false })).toBeTruthy();
    fireEvent.click(within(pop).getByText("Sonnet"));
    expect(act).toHaveBeenCalledWith({ type: "set-model", key: "s1", model: "sonnet" });
    expect(screen.queryByRole("dialog", { name: "Model and thinking" })).toBeNull();
  });

  it("the thinking chip opens the same popover; the segmented control sets the level", () => {
    const { act } = mount({ models });
    fireEvent.click(screen.getByTitle("Thinking for the next turn"));
    fireEvent.click(screen.getByRole("radio", { name: "Low" }));
    expect(act).toHaveBeenCalledWith({ type: "set-thinking", key: "s1", level: "low" });
  });
});

describe("real data without placeholders (gap §5a–§5b)", () => {
  it("unknown model, thinking and 5h read as the muted field names, never a dash", () => {
    const d = data();
    mount({ bar: () => ({ ...d.bar("s1")!, model: null, thinking: null, account: { ...d.bar("s1")!.account, fiveH: null } }) });
    const bar = screen.getByTitle("Model for the next turn").parentElement!;
    expect(bar.textContent).not.toContain("—");
    expect(screen.getByTitle("Model for the next turn").textContent).toBe("Model");
    expect(screen.getByTitle("Thinking for the next turn").textContent!.trim()).toBe("Thinking");
  });

  it("the model chip shows the label and keeps the raw id in its tooltip", () => {
    const d = data();
    mount({ bar: () => ({ ...d.bar("s1")!, model: "Opus 4.7", modelId: "claude-opus-4-7" }) });
    expect(screen.getByTitle("claude-opus-4-7").textContent).toBe("Opus 4.7");
  });
});

describe("hover peek and engine banner (gap §4d–§4e)", () => {
  it("a row hovered for 400 ms shows one peek card; leaving hides it", () => {
    vi.useFakeTimers();
    try {
      const d = data();
      const t = { key: "s1", title: "Event store", state: "working" as const, live: true, tool: "claude" as const, account: { name: "work", color: "teal" as const }, branch: "feat/store", pr: null, model: "Opus 4.7", thinking: "high", contextPct: 40, lastActiveMs: d.nowMs - 120_000 };
      mount({ sessions: [d.sessions[0], { ...d.sessions[0], key: "s2", title: "Checkout flow" }], table: [t, { ...t, key: "s2", title: "Checkout flow", model: "Sonnet 4.6" }] });
      const win = screen.getByLabelText("Sessions window");
      // The active row (opened at start) shows its facts in the workbench, not in a peek.
      fireEvent.mouseEnter(within(win).getByText("Event store").closest("[role=button]")!);
      act(() => void vi.advanceTimersByTime(500));
      expect(screen.queryByRole("tooltip")).toBeNull();
      const row = within(win).getByText("Checkout flow").closest("[role=button]")!;
      fireEvent.mouseEnter(row);
      act(() => void vi.advanceTimersByTime(399));
      expect(screen.queryByRole("tooltip")).toBeNull();
      act(() => void vi.advanceTimersByTime(1));
      expect(screen.getByRole("tooltip").textContent).toContain("Sonnet 4.6");
      fireEvent.mouseLeave(row);
      expect(screen.queryByRole("tooltip")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("the engine banner sits under the session bar with one action, Restart engine", () => {
    const { act: a } = mount();
    const banner = screen.getByRole("alert");
    expect(banner.previousElementSibling?.textContent).toContain("Terminal");
    fireEvent.click(within(banner).getByText("Restart engine"));
    expect(a).toHaveBeenCalledWith({ type: "restart-engine" });
  });
});

describe("empty home (gap §5d)", () => {
  it("no line hangs under the header when the Needs-you zone is hidden", () => {
    mount({ sessions: [], needs: [], away: null, tools: [] });
    const zone = within(screen.getByLabelText("Sessions window")).getByLabelText("Sessions");
    expect(zone.querySelector(".h-px")).toBeNull();
  });
});

describe("a long active title keeps its ellipsis (v3-render, seeded)", () => {
  it("an overflowing title is laid out anew after the row is hovered", () => {
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => (cb(0), 1));
    try {
      const d = data();
      mount({ sessions: [{ ...d.sessions[0], title: "Knowledge map: edge filter for stale links" }] });
      const title = within(screen.getByLabelText("Sessions window")).getByText("Knowledge map: edge filter for stale links");
      Object.defineProperty(title, "scrollWidth", { configurable: true, value: 257 });
      Object.defineProperty(title, "clientWidth", { configurable: true, value: 253 });
      const shown: string[] = [];
      const style = title.style;
      Object.defineProperty(title, "style", { configurable: true, value: new Proxy(style, { set: (t, k, v) => (k === "display" && shown.push(v), Reflect.set(t, k, v)) }) });
      fireEvent.mouseEnter(title.closest("[role=button]")!);
      expect(shown).toEqual(["none", ""]);
    } finally {
      raf.mockRestore();
    }
  });
});
