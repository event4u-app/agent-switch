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
