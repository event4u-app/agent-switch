import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  render(<V3Window data={{ ...d, health: { state: "ready" }, sessions }} slots={slots} act={act} platform="mac" layout={{ load: () => saved, save }} />);
  return { act, save };
}
const tab = (name: string) => screen.getByRole("tab", { name: new RegExp(name) });
/** The tab's × — pointer-only, so it is found inside the tab, not by role. */
const closeX = (name: string) => tab(name).querySelector("[data-tab-close]");
const titles = () => screen.getAllByRole("tab").map((t) => t.getAttribute("title")!.split(" · ")[0]);
const menu = (name: string) => fireEvent.contextMenu(tab(name), { clientX: 40, clientY: 20 });
const pick = (item: string | RegExp) => fireEvent.click(screen.getByRole("menuitem", { name: item }));

describe("tabs: pin, close, reopen, sort (owner request 2026-11-05)", () => {
  it("right click pins a tab: it moves right after the main tab, shows only its icon and loses its close button", () => {
    const { save } = mount();
    menu("Themes");
    expect(screen.getByRole("menu", { name: "Tab" })).toBeTruthy();
    pick("Pin tab");
    expect(titles()).toEqual(["Event store", "Themes", "Checkout flow"]);
    expect(tab("Themes").getAttribute("data-pinned")).toBe("true");
    expect(tab("Themes").getAttribute("title")).toContain("pinned");
    expect(tab("Themes").textContent).not.toContain("Themes");
    expect(closeX("Themes")).toBeNull();
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ tabs: ["s1", "s3", "s2"], pinned: ["s3"] }));
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

  it("an unpinned tab closes on a middle click; the main tab does not", () => {
    mount();
    fireEvent(tab("Checkout flow"), new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(titles()).toEqual(["Event store", "Themes"]);
    fireEvent(tab("Event store"), new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(titles()).toEqual(["Event store", "Themes"]);
    expect(closeX("Event store")).toBeNull();
  });

  it("⇧⌘T and the menu reopen closed tabs where they stood, last closed first", () => {
    mount();
    fireEvent.click(closeX("Checkout flow")!);
    fireEvent.click(closeX("Themes")!);
    expect(titles()).toEqual(["Event store"]);
    fireEvent.keyDown(window, { key: "t", metaKey: true, shiftKey: true });
    expect(titles()).toEqual(["Event store", "Themes"]);
    expect(tab("Themes").getAttribute("aria-selected")).toBe("true");
    menu("Event store");
    pick(/Reopen closed tab/);
    expect(titles()).toEqual(["Event store", "Checkout flow", "Themes"]);
    menu("Event store");
    expect(screen.getByRole("menuitem", { name: /Reopen closed tab/ }).getAttribute("aria-disabled")).toBe("true");
  });

  it("close others / to the right / all unpinned keep the pinned tab and the main tab", () => {
    mount({ tabs: ["s1", "s2", "s3"], pinned: ["s1"], active: "s2" });
    // s1 pinned; s2 (Checkout flow) is the main tab now, first in the strip.
    expect(titles()).toEqual(["Checkout flow", "Event store", "Themes"]);
    menu("Themes");
    pick("Close other tabs");
    expect(titles()).toEqual(["Checkout flow", "Event store", "Themes"]);
    menu("Themes");
    pick("Close tabs to the left");
    expect(titles()).toEqual(["Checkout flow", "Event store", "Themes"]);
    menu("Event store");
    pick("Close tabs to the right");
    expect(titles()).toEqual(["Checkout flow", "Event store"]);
    menu("Checkout flow");
    // The main tab's menu has no Close at all.
    expect(screen.queryByRole("menuitem", { name: /^Close tab(?!s)/ })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Close all unpinned tabs" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("restores pinned tabs after a restart, right after the main tab", () => {
    mount({ tabs: ["s1", "s2", "s3"], pinned: ["s3", "gone"], active: "s1" });
    expect(titles()).toEqual(["Event store", "Themes", "Checkout flow"]);
    expect(tab("Themes").getAttribute("data-pinned")).toBe("true");
  });

  it("a session tab's menu carries its session actions", () => {
    const { act } = mount();
    menu("Checkout flow");
    pick("End…");
    expect(screen.getByRole("dialog", { name: /End “Checkout flow”\?/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "End session" }));
    expect(act).toHaveBeenCalledWith({ type: "end", key: "s2" });
    menu("Checkout flow");
    pick("Move to another account…");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("drag and drop reorders the tabs; the main tab does not drag and nothing drops before it", () => {
    mount();
    // jsdom has no PointerEvent; a MouseEvent of the same type carries button and clientX.
    const pointer = (type: string, init: MouseEventInit) => new MouseEvent(type, { bubbles: true, ...init });
    fireEvent(tab("Checkout flow"), pointer("pointerdown", { button: 0, clientX: 10 }));
    fireEvent(tab("Themes"), pointer("pointermove", { clientX: 400 }));
    fireEvent(window, pointer("pointerup", {}));
    expect(titles()).toEqual(["Event store", "Themes", "Checkout flow"]);
    // The click that ends the drag does not select the dragged tab.
    fireEvent.click(tab("Checkout flow"));
    expect(tab("Themes").getAttribute("aria-selected")).toBe("true");
    // Before the main tab: no drop.
    fireEvent(tab("Themes"), pointer("pointerdown", { button: 0, clientX: 400 }));
    fireEvent(tab("Event store"), pointer("pointermove", { clientX: -400 }));
    fireEvent(window, pointer("pointerup", {}));
    expect(titles()).toEqual(["Event store", "Themes", "Checkout flow"]);
    // The main tab itself does not drag.
    fireEvent(tab("Event store"), pointer("pointerdown", { button: 0, clientX: 10 }));
    fireEvent(tab("Checkout flow"), pointer("pointermove", { clientX: 900 }));
    fireEvent(window, pointer("pointerup", {}));
    expect(titles()).toEqual(["Event store", "Themes", "Checkout flow"]);
  });

  it("the main tab's menu says it stays first: no pin, no move; other tabs move a step left or right", () => {
    mount();
    menu("Event store");
    expect(screen.getByText(/Main tab: always first/)).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Pin tab" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Move left" })).toBeNull();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    menu("Themes");
    expect(screen.getByRole("menuitem", { name: "Move right" }).getAttribute("aria-disabled")).toBe("true");
    pick("Move left");
    expect(titles()).toEqual(["Event store", "Themes", "Checkout flow"]);
    menu("Themes");
    expect(screen.getByRole("menuitem", { name: "Move left" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("stripe pages open in the main tab; ⌘-click, middle click or the right-click menu give them a tab of their own", () => {
    mount();
    const stripe = within(screen.getByRole("navigation", { name: "Tool windows" }));
    fireEvent.click(stripe.getByLabelText(/^Arenas/));
    expect(titles()).toEqual(["Arenas", "Checkout flow", "Themes"]);
    expect(tab("Arenas").getAttribute("aria-selected")).toBe("true");
    fireEvent.click(stripe.getByLabelText(/^Tools/), { metaKey: true });
    expect(titles()).toEqual(["Arenas", "Tools", "Checkout flow", "Themes"]);
    fireEvent.contextMenu(stripe.getByLabelText(/^Library/), { clientX: 20, clientY: 200 });
    pick("Open in new tab");
    expect(titles()).toEqual(["Arenas", "Tools", "Library", "Checkout flow", "Themes"]);
    // Settings opens in the main tab too.
    fireEvent.click(screen.getByLabelText(/^Settings/));
    expect(titles()[0]).toBe("Settings");
  });

  it("a session row opens in a pinned tab from its right-click menu", () => {
    mount({ tabs: ["s1"], active: "s1" });
    fireEvent.contextMenu(within(screen.getByLabelText("Sessions window")).getAllByText("Themes")[0]);
    pick("Open in pinned tab");
    expect(titles()).toEqual(["Event store", "Themes"]);
    expect(tab("Themes").getAttribute("data-pinned")).toBe("true");
  });
});
