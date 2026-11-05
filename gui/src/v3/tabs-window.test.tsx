import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { V3Window } from "./window.js";
import { data, slots } from "./window-fixture.js";
import type { WindowLayout } from "./layout.js";

afterEach(cleanup);

// Three sessions, all open as tabs; s3 active.
function mount(saved: Partial<WindowLayout> = { tabs: ["s1", "s2", "s3"], active: "s3" }) {
  const d = data();
  const sessions = [d.sessions[0], { ...d.sessions[0], key: "s2", title: "Checkout flow" }, { ...d.sessions[0], key: "s3", title: "Themes" }];
  const act = vi.fn();
  const save = vi.fn();
  render(<V3Window data={{ ...d, sessions }} slots={slots} act={act} platform="mac" layout={{ load: () => saved, save }} />);
  return { act, save };
}
const tab = (name: string) => screen.getByRole("tab", { name: new RegExp(name) });
const titles = () => screen.getAllByRole("tab").map((t) => t.getAttribute("title")!.split(" · ")[0]);
const menu = (name: string) => fireEvent.contextMenu(tab(name), { clientX: 40, clientY: 20 });
const pick = (item: string | RegExp) => fireEvent.click(screen.getByRole("menuitem", { name: item }));

describe("tabs: pin, close, reopen, sort (owner request 2026-11-05)", () => {
  it("right click pins a tab: it moves first, is marked pinned and loses its close button", () => {
    const { save } = mount();
    menu("Themes");
    expect(screen.getByRole("menu", { name: "Tab" })).toBeTruthy();
    pick("Pin tab");
    expect(titles()).toEqual(["Themes", "Event store", "Checkout flow"]);
    expect(tab("Themes").getAttribute("data-pinned")).toBe("true");
    expect(tab("Themes").getAttribute("title")).toContain("pinned");
    expect(screen.queryByRole("button", { name: "Close Themes" })).toBeNull();
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ tabs: ["s3", "s1", "s2"], pinned: ["s3"] }));
  });

  it("a pinned tab ignores the middle click and closes only from its menu", () => {
    mount({ tabs: ["s1", "s2", "s3"], pinned: ["s2"], active: "s1" });
    fireEvent(tab("Checkout flow"), new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(tab("Checkout flow")).toBeTruthy();
    menu("Checkout flow");
    expect(screen.queryByRole("menuitem", { name: "Pin tab" })).toBeNull();
    pick("Close pinned tab");
    expect(screen.queryByRole("tab", { name: /Checkout flow/ })).toBeNull();
  });

  it("an unpinned tab closes on a middle click", () => {
    mount();
    fireEvent(tab("Event store"), new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(titles()).toEqual(["Checkout flow", "Themes"]);
  });

  it("⇧⌘T and the menu reopen closed tabs where they stood, last closed first", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Close Checkout flow" }));
    fireEvent.click(screen.getByRole("button", { name: "Close Event store" }));
    expect(titles()).toEqual(["Themes"]);
    fireEvent.keyDown(window, { key: "t", metaKey: true, shiftKey: true });
    expect(titles()).toEqual(["Event store", "Themes"]);
    expect(tab("Event store").getAttribute("aria-selected")).toBe("true");
    menu("Themes");
    pick(/Reopen closed tab/);
    expect(titles()).toEqual(["Event store", "Checkout flow", "Themes"]);
    menu("Themes");
    expect(screen.getByRole("menuitem", { name: /Reopen closed tab/ }).getAttribute("aria-disabled")).toBe("true");
  });

  it("close others / to the right / all unpinned keep the pinned tab", () => {
    mount({ tabs: ["s1", "s2", "s3"], pinned: ["s1"], active: "s2" });
    menu("Themes");
    pick("Close other tabs");
    expect(titles()).toEqual(["Event store", "Themes"]);
    menu("Event store");
    pick("Close tabs to the right");
    expect(titles()).toEqual(["Event store"]);
    expect(tab("Event store").getAttribute("aria-selected")).toBe("true");
    menu("Event store");
    expect(screen.getByRole("menuitem", { name: "Close all unpinned tabs" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("restores pinned tabs after a restart, pinned first", () => {
    mount({ tabs: ["s1", "s2", "s3"], pinned: ["s3", "gone"], active: "s1" });
    expect(titles()).toEqual(["Themes", "Event store", "Checkout flow"]);
    expect(tab("Themes").getAttribute("data-pinned")).toBe("true");
  });

  it("a session tab's menu carries its session actions", () => {
    const { act } = mount();
    menu("Checkout flow");
    pick("End…");
    expect(act).toHaveBeenCalledWith({ type: "session-menu", key: "s2", item: "End…" });
    menu("Checkout flow");
    pick("Move to another account…");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("drag and drop reorders the tabs", () => {
    mount();
    // jsdom has no PointerEvent; a MouseEvent of the same type carries button and clientX.
    const pointer = (type: string, init: MouseEventInit) => new MouseEvent(type, { bubbles: true, ...init });
    fireEvent(tab("Event store"), pointer("pointerdown", { button: 0, clientX: 10 }));
    fireEvent(tab("Themes"), pointer("pointermove", { clientX: 400 }));
    fireEvent(window, pointer("pointerup", {}));
    expect(titles()).toEqual(["Checkout flow", "Themes", "Event store"]);
    // The click that ends the drag does not select the dragged tab.
    fireEvent.click(tab("Event store"));
    expect(tab("Themes").getAttribute("aria-selected")).toBe("true");
  });
});
