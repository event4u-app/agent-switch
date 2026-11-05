import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { V3Tray, trayTools } from "./tray.js";
import type { RowSession } from "./sessions.js";
import type { LimitAccount } from "./limits.js";

afterEach(cleanup);
const s = (key: string, over: Partial<RowSession> = {}): RowSession => ({ key, title: `session ${key}`, state: "idle", account: { name: "work", nearLimit: false }, branch: null, pr: null, children: [], needsYou: false, ...over });
const on = () => ({ verb: vi.fn(), moreNeeds: vi.fn(), away: vi.fn(), session: vi.fn(), moreSessions: vi.fn(), account: vi.fn(), signIn: vi.fn(), start: vi.fn(), open: vi.fn() });
const acc = (tool: "claude" | "codex", name: string): LimitAccount => ({ key: `${tool}/${name}`, tool, name, color: "teal", protect: 98, next: false, signIn: false, checkedMs: 0, windows: [{ label: "5h", used: 20, resetsAtMs: null, pace: null }] });
const need = [{ id: "n", kind: "approval" as const, subject: "x", who: "Theme system", what: "wants to run", verb: "Allow", since: "", version: "1" }];

describe("tray (spec §10.7)", () => {
  it("Needs you, tool tabs, Sessions (5 rows in the shared order, then N more), Limits, Open and Start — in that order", () => {
    const handlers = on();
    const sessions = [1, 2, 3, 4, 5, 6, 7].map((i) => s(`claude/work/${i}`, i === 7 ? { needsYou: true } : {}));
    const { container } = render(<V3Tray nowMs={0} needs={need} away={null} sessions={sessions} accounts={[acc("claude", "work")]} on={handlers} />);
    const text = container.textContent!;
    const at = (t: string) => text.indexOf(t);
    expect(at("Needs you")).toBeLessThan(at("Claude"));
    expect(at("Claude")).toBeLessThan(at("Sessions"));
    expect(at("Sessions")).toBeLessThan(at("Limits"));
    expect(at("Limits")).toBeLessThan(at("Open Agent Switch"));
    expect(at("Open Agent Switch", )).toBeLessThan(text.lastIndexOf("Start session"));
    expect(screen.getByText("session claude/work/7"), "the waiting session comes first").toBeTruthy();
    expect(screen.queryByText("session claude/work/5")).toBeNull();
    fireEvent.click(screen.getByText("2 more ›"));
    expect(handlers.moreSessions).toHaveBeenCalledOnce();
  });

  it("one tab per tool with live sessions, Claude first and default; each tab has that tool's sessions and limits", () => {
    const sessions = [s("claude/work/1"), s("codex/work/2")];
    render(<V3Tray nowMs={0} needs={[]} away={null} sessions={sessions} accounts={[acc("claude", "work"), acc("codex", "side")]} on={on()} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Claude1", "Codex1"]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    let panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText("session claude/work/1")).toBeTruthy();
    expect(within(panel).queryByText("session codex/work/2")).toBeNull();
    expect(within(panel).queryByText("side")).toBeNull();
    fireEvent.click(tabs[1]);
    panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText("session codex/work/2")).toBeTruthy();
    expect(within(panel).getByText("side"), "no “· Codex” suffix inside the Codex tab").toBeTruthy();
  });

  it("a tool without live sessions gets no tab; Claude always has one", () => {
    expect(trayTools([s("codex/work/1")])).toEqual(["claude", "codex"]);
    expect(trayTools([s("claude/work/1")])).toEqual(["claude"]);
    expect(trayTools([])).toEqual(["claude"]);
  });

  it("the head opens the window and shows health; Open plain on the left, Start filled on the right", () => {
    const handlers = on();
    const { container } = render(<V3Tray nowMs={0} ready needs={need} away={null} sessions={[s("claude/work/1")]} accounts={[]} on={handlers} />);
    const head = container.firstElementChild!.firstElementChild as HTMLButtonElement;
    expect(head.tagName).toBe("BUTTON");
    expect(head.textContent).toBe("Agent SwitchReady");
    expect(head.querySelector("img")).not.toBeNull();
    fireEvent.click(head);
    expect(handlers.open).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain("⌘J");
    for (const zone of ["Needs you", "Sessions"]) expect(screen.getByText(zone).parentElement!.className).toContain("h-6");
    const start = screen.getAllByText("Start session").at(-1)!.closest("button")!;
    const open = screen.getByText("Open Agent Switch", { selector: "button, button *" }).closest("button")!;
    expect(open.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(start.className).toContain("ml-auto");
    expect(open.className).not.toMatch(/\bborder\b/);
    fireEvent.click(open);
    expect(handlers.open).toHaveBeenCalledTimes(2);
  });
});
