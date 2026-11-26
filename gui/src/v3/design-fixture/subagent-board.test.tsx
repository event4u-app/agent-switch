/**
 * Arena r2 04 F5: the design fixture has a board for an opened subagent, and
 * it shows that subagent's own transcript, never its parent's — so a review by
 * eye cannot pass on the parent's conversation.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { BOARDS } from "./embed.js";
import { Scene } from "./scene.js";

// jsdom has no canvas/matchMedia for xterm and no Tauri pty: stub both.
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    rows = 24;
    cols = 80;
    options = {};
    loadAddon() {}
    open() {}
    focus() {}
    onData() {}
    write() {}
    dispose() {}
  },
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));

// The fixture's hosted terminal watches its size; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

afterEach(cleanup);

describe("the subagent board", () => {
  it("opens the running subagent from the tree: Back, its tool, its time, and its own transcript", () => {
    expect(BOARDS.subagent.steps).toEqual([{ click: "Show 3 subagents" }, { click: "general-purpose · migrate JSON stores" }]);
    render(<Scene />);
    fireEvent.click(screen.getByRole("button", { name: /Show 3 subagents/ }));
    fireEvent.click(screen.getByRole("button", { name: /general-purpose · migrate JSON stores/ }));
    const view = screen.getByRole("region", { name: "Subagent" });
    expect(within(view).getByText(/Back to/)).toBeTruthy();
    expect(within(view).getByText(/running 6m/)).toBeTruthy();
    expect(within(view).getAllByText(/npm test -- store/).length).toBeGreaterThan(0);
    expect(within(view).getByText(/Earlier steps not shown/)).toBeTruthy();
    expect(within(view).getByText(/Moved sessions\.json and arms\.json/)).toBeTruthy();
    expect(within(view).queryByText(/Create a file notes\.md/)).toBeNull();
  });

  it("while a subagent is open, its session's row and the subagent's own row both read as selected", () => {
    render(<Scene />);
    fireEvent.click(screen.getByRole("button", { name: /Show 3 subagents/ }));
    fireEvent.click(screen.getByRole("button", { name: /general-purpose · migrate JSON stores/ }));
    const list = screen.getByLabelText("Sessions window");
    expect(within(list).getByRole("button", { name: /general-purpose · migrate JSON stores/ }).getAttribute("aria-current")).toBe("true");
    expect(list.querySelector('[role=button][aria-current=true]:not([data-child-row])')?.textContent).toMatch(/v3 engine/);
  });
});
