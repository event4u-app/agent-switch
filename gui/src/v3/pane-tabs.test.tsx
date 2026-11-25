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
  it("opens on Running; each tab counts what it lists, and the ended sessions stay out of them", () => {
    const win = mount();
    const tabs = win.getAllByRole("radio").map((r) => r.textContent);
    expect(tabs[0]).toMatch(/^For you\s*\d+$/);
    expect(tabs.slice(1)).toEqual(["Running 1", "All 2"]);
    expect(win.getByRole("radio", { name: /^Running/ }).getAttribute("aria-checked")).toBe("true");
    expect(win.getByText("Event store")).toBeTruthy();
    expect(win.queryByText("Checkout flow")).toBeNull();
    paneTab("All");
    expect(win.getByText("Checkout flow")).toBeTruthy();
    expect(win.queryByText("Release notes")).toBeNull();
  });

  it("For you lists every item, with no N more", () => {
    const win = mount();
    paneTab("For you");
    expect(win.getByText("94% of 5h")).toBeTruthy();
    expect(win.queryByText(/more ›/)).toBeNull();
  });

  it("the filter at the foot narrows the open tab; Esc clears it", () => {
    const win = mount();
    paneTab("All");
    const box = win.getByLabelText("Filter sessions");
    fireEvent.change(box, { target: { value: "a11y" } });
    expect(win.getByText("Checkout flow")).toBeTruthy();
    expect(win.queryByText("Event store")).toBeNull();
    fireEvent.keyDown(box, { key: "Escape" });
    expect(win.getByText("Event store")).toBeTruthy();
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
