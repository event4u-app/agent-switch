import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Shell, TitleBar, useFrame } from "./frame.js";

afterEach(cleanup);
const noop = () => {};
const actions = { onSearch: vi.fn(), onStart: vi.fn(), onSettings: vi.fn(), onInbox: vi.fn(), onRestart: vi.fn() };

function Harness(props: { needsYou?: boolean; blocker?: boolean; health?: "ready" | "down"; onPage?: (p: string) => void }) {
  const frame = useFrame(props.onPage ?? noop);
  return (
    <Shell
      frame={frame}
      health={props.health ?? "ready"}
      inbox={{ count: 3, ciFailing: false }}
      needsYou={props.needsYou ?? false}
      blocker={props.blocker ?? false}
      sessionsWindow={<aside>SESSIONS WINDOW</aside>}
      centre={<main>WORKBENCH</main>}
      rightWindow={<aside>RIGHT {frame.right}</aside>}
      actions={actions}
    />
  );
}

describe("window frame (spec §4)", () => {
  it("Sessions shows by default; its button hides it (focus mode), and then the inbox pill appears", () => {
    render(<Harness needsYou />);
    expect(screen.getByText("SESSIONS WINDOW")).toBeTruthy();
    expect(screen.queryByTitle(/Needs you · ⌘J/)).toBeNull();
    const sessions = screen.getByLabelText("Sessions ⌘B");
    expect(sessions.getAttribute("aria-pressed")).toBe("true");
    act(() => void fireEvent.click(sessions));
    expect(screen.queryByText("SESSIONS WINDOW")).toBeNull();
    expect(screen.getByTitle(/Needs you · ⌘J/).textContent).toContain("3");
    expect(screen.getByLabelText("Sessions ⌘B").querySelector(".bg-ac-warn"), "amber dot while hidden").toBeTruthy();
  });

  it("one right window at a time, closed by default; clicking the open one closes it", () => {
    render(<Harness />);
    expect(screen.queryByText(/^RIGHT/)).toBeNull();
    act(() => void fireEvent.click(screen.getByLabelText("Summary ⌘I")));
    expect(screen.getByText("RIGHT summary")).toBeTruthy();
    act(() => void fireEvent.click(screen.getByLabelText("Changes")));
    expect(screen.getByText("RIGHT changes")).toBeTruthy();
    act(() => void fireEvent.click(screen.getByLabelText("Changes")));
    expect(screen.queryByText(/^RIGHT/)).toBeNull();
  });

  it("a blocker dots Summary only while Summary is closed; page buttons open page tabs", () => {
    const onPage = vi.fn();
    render(<Harness blocker onPage={onPage} />);
    expect(screen.getByLabelText("Summary ⌘I").querySelector(".bg-ac-warn")).toBeTruthy();
    act(() => void fireEvent.click(screen.getByLabelText("Summary ⌘I")));
    expect(screen.getByLabelText("Summary ⌘I").querySelector(".bg-ac-warn")).toBeNull();
    act(() => void fireEvent.click(screen.getByLabelText("Library")));
    expect(onPage).toHaveBeenCalledWith("library", false);
  });

  it("the title bar: one filled button, 'Engine stopped' only when down, the pill turns alert with failing CI", () => {
    const { rerender } = render(<TitleBar health="ready" inbox={null} {...actions} />);
    expect(screen.queryByText("Engine stopped")).toBeNull();
    rerender(<TitleBar health="down" inbox={{ count: 2, ciFailing: true }} {...actions} />);
    fireEvent.click(screen.getByText("Engine stopped"));
    expect(actions.onRestart).toHaveBeenCalledOnce();
    expect(screen.getByTitle(/Needs you/).className).toMatch(/bg-ac-alert-tint/);
    fireEvent.click(screen.getByText("Start session"));
    fireEvent.click(screen.getByText(/Go to session/));
    expect(actions.onStart).toHaveBeenCalledOnce();
    expect(actions.onSearch).toHaveBeenCalledOnce();
  });

  it("the title bar drags the window: the bar and its empty areas carry the drag region, the controls do not", () => {
    const { container } = render(<TitleBar health="down" inbox={{ count: 2, ciFailing: false }} {...actions} />);
    const header = container.querySelector("header")!;
    expect(header.hasAttribute("data-tauri-drag-region")).toBe(true);
    // Tauri only starts a drag when the pressed element itself carries the attribute,
    // so the stretch area around the search field needs it too.
    const searchSlot = screen.getByText(/Go to session/).closest("button")!.parentElement!;
    expect(searchSlot.hasAttribute("data-tauri-drag-region")).toBe(true);
    for (const control of container.querySelectorAll("button")) {
      expect(control.hasAttribute("data-tauri-drag-region")).toBe(false);
    }
  });
});

describe("the notification bell (owner, 2026-11-24, as in v2)", () => {
  it("History, bell, Settings — in v2's order; History opens its sheet", () => {
    const onHistory = vi.fn();
    render(<TitleBar health="ready" inbox={null} {...actions} onHistory={onHistory} />);
    expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-label")).slice(-3)).toEqual(["History", "Notifications", "Settings  ⌘,"]);
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(onHistory).toHaveBeenCalledOnce();
  });

  it("sits right before Settings, carries the count and opens Needs you", () => {
    const onInbox = vi.fn();
    render(<TitleBar health="ready" inbox={null} notifications={12} {...actions} onInbox={onInbox} />);
    const buttons = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(buttons.slice(-2)).toEqual(["Notifications", "Settings  ⌘,"]);
    const bell = screen.getByRole("button", { name: "Notifications" });
    expect(bell.textContent).toBe("9+");
    fireEvent.click(bell);
    expect(onInbox).toHaveBeenCalledOnce();
  });
});
