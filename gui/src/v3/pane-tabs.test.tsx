/**
 * The Sessions window, alternative B (owner, 2026-11-25): three tabs — For you, Running, All —
 * one list at a time, and alternative A's filter at the foot over Done today and Older.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { V3Window } from "./window.js";
import { data, slots } from "./window-fixture.js";
import { paneTab } from "./pane-tabs.test-helper.js";

afterEach(cleanup);

const sessions = () => {
  const base = data().sessions[0];
  return [
    base,
    { ...base, key: "s2", title: "Checkout flow", branch: "a11y/checkout", state: "idle" as const },
    { ...base, key: "s3", title: "Release notes", state: "done" as const, doneToday: true },
  ];
};
const mount = () => {
  const act = vi.fn();
  render(<V3Window data={{ ...data(), sessions: sessions() }} slots={slots} act={act} />);
  return within(screen.getByLabelText("Sessions window"));
};

describe("the Sessions window's tabs", () => {
  it("opens on Running; Other holds the rest; each tab counts what it lists, ended sessions stay out", () => {
    const win = mount();
    const tabs = win.getAllByRole("radio").map((r) => r.textContent);
    expect(tabs[0]).toMatch(/^For you\s*\d+$/);
    expect(tabs.slice(1)).toEqual(["Running 1", "Other 1"]);
    expect(win.getByRole("radio", { name: /^Running/ }).getAttribute("aria-checked")).toBe("true");
    expect(win.getByText("Event store")).toBeTruthy();
    expect(win.queryByText("Checkout flow")).toBeNull();
    paneTab("Other");
    expect(win.getByText("Checkout flow")).toBeTruthy();
    expect(win.queryByText("Event store")).toBeNull();
    expect(win.queryByText("Release notes")).toBeNull();
  });

  it("lists newest activity first, with no groups to fold and no sort control", () => {
    const base = data().sessions[0];
    const t0 = data().nowMs ?? Date.now();
    render(
      <V3Window
        data={{ ...data(), sessions: ["Old", "New", "Mid"].map((title, i) => ({ ...base, key: `r${i}`, title, needsYou: false, lastActiveMs: t0 - [90, 1, 30][i] * 60_000 })) }}
        slots={slots}
        act={vi.fn()}
      />,
    );
    const win = within(screen.getByLabelText("Sessions window"));
    const order = [...document.querySelectorAll("[data-session-card]")].map((c) => c.textContent);
    expect(order.map((t) => ["New", "Mid", "Old"].find((x) => t!.includes(x)))).toEqual(["New", "Mid", "Old"]);
    expect(win.queryByTitle("Sort and group")).toBeNull();
    expect(win.queryByRole("button", { expanded: true })).toBeNull();
  });

  it("For you lists every item, with no N more", () => {
    const win = mount();
    paneTab("For you");
    expect(win.getByText("94% of 5h")).toBeTruthy();
    expect(win.queryByText(/more ›/)).toBeNull();
  });

  it("the filter at the foot narrows the open tab; Esc clears it", () => {
    const win = mount();
    paneTab("Other");
    const box = win.getByLabelText("Filter sessions");
    fireEvent.change(box, { target: { value: "nothing-like-it" } });
    expect(win.queryByText("Checkout flow")).toBeNull();
    fireEvent.keyDown(box, { key: "Escape" });
    expect(win.getByText("Checkout flow")).toBeTruthy();
  });

  it("Done today and Older sit side by side under the filter and open All sessions", () => {
    const win = mount();
    const done = win.getByTitle("Open All sessions · Done today");
    expect(done.textContent).toBe("Done today1");
    expect(win.getByTitle("Open All sessions · Older").textContent).toBe("Older0");
    fireEvent.click(done);
    expect(screen.getAllByText("All sessions").length).toBeGreaterThan(0);
  });
});
