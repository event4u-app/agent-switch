/**
 * Roadmap 8.6: when the session bar is too narrow (a side panel open), the
 * chips that do not fit leave the bar — hidden, so no clipped chip and no
 * invisible Tab stop — and their actions move into ⋯.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { V3Window, type V3Data } from "./window.js";
import { data, slots } from "./window-fixture.js";

afterEach(cleanup);

/** jsdom has no layout: the clipping cluster is `width` wide; each shown chip takes 100 px after a fixed 200 px (view switch, Hosted). */
let width = 2000;
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
    configurable: true,
    get(this: HTMLElement) {
      if (!this.hasAttribute("data-bar-clip")) return 0;
      return 200 + [...this.querySelectorAll<HTMLElement>("[data-bar-chip]")].filter((c) => !c.hidden).length * 100;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute("data-bar-clip") ? width : 0;
    },
  });
});
afterEach(() => {
  // The stubs shadow Element's own getters; removing them restores those.
  delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth;
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
});

function mount(over: Partial<V3Data> = {}) {
  const act = vi.fn();
  render(
    <V3Window
      data={{ ...data(), health: { state: "ready" }, models: () => ({ models: [{ id: "opus", label: "Opus", hint: "" }], current: "opus", thinking: ["low", "high"], currentThinking: "high" }), ...over }}
      slots={slots}
      act={act}
      platform="mac"
      layout={{ load: () => ({ tabs: ["s1"], active: "s1" }), save: vi.fn() }}
    />,
  );
  return act;
}
const menuLabels = () => within(screen.getByRole("menu", { name: "Session actions" })).getAllByRole("menuitem").map((b) => b.textContent ?? "");
const openMenu = () => fireEvent.click(screen.getByRole("button", { name: /Session actions/ }));

describe("session-bar chips that do not fit move into ⋯ (8.6)", () => {
  it("a wide bar keeps every chip and adds nothing to ⋯", () => {
    width = 2000;
    mount();
    expect(screen.getByTitle("Thinking for the next turn").hidden).toBe(false);
    openMenu();
    expect(menuLabels().some((l) => /^(Account|Model|Thinking)…/.test(l))).toBe(false);
  });

  it("drops chips from the right: ctx and Thinking leave first, then Model, then Account", () => {
    width = 550; // 200 + 3 chips fit: where it runs, account, model
    mount();
    const chip = (title: RegExp | string) => screen.getByTitle(title);
    expect(chip(/moving opens the decision sheet/).hidden).toBe(false);
    expect(chip("Model for the next turn").hidden).toBe(false);
    expect(chip("Thinking for the next turn").hidden).toBe(true);
    expect(chip("Context used").hidden).toBe(true);
    openMenu();
    const labels = menuLabels();
    expect(labels.some((l) => l.startsWith("Thinking…"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Model…"))).toBe(false);
    expect(screen.getByRole("menu", { name: "Session actions" }).textContent).toMatch(/Context 40% used/);
    expect(screen.getByText("Hosted").closest("[hidden]")).toBeNull();
  });

  it("where it runs leaves last, and ⋯ then says it", () => {
    width = 250;
    mount();
    expect(screen.getByText("Hosted").closest("[hidden]")).not.toBeNull();
    expect(screen.getByText(/^type here, or attach/).closest("[hidden]"), "its hint leaves with it").not.toBeNull();
    openMenu();
    expect(screen.getByRole("menu", { name: "Session actions" }).textContent).toMatch(/Hosted by Agent Switch/);
  });

  it("a hidden chip is never a Tab stop", () => {
    width = 250;
    mount();
    for (const t of [/moving opens the decision sheet/, "Model for the next turn", "Thinking for the next turn"]) {
      const el = screen.getByTitle(t);
      expect(el.closest("[hidden]")).not.toBeNull();
    }
  });

  it("Thinking… and Model… open the model popover; Account… opens the move sheet", () => {
    width = 250;
    const act = mount();
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /^Thinking…/ }));
    expect(screen.getByRole("dialog", { name: "Model and thinking" })).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /^Account…/ }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(act).not.toHaveBeenCalledWith(expect.objectContaining({ type: "session-menu" }));
  });

  it("a locked chip moves as a disabled item that says why", () => {
    width = 250;
    mount({ bar: () => ({ key: "s1", hosted: false, chatAvailable: true, view: "terminal", account: { name: "work", color: "teal", fiveH: 94, protect: 98 }, model: "Opus", thinking: "high", contextPct: 40 }) });
    openMenu();
    const model = screen.getByRole("menuitem", { name: /^Model…/ });
    expect(model.getAttribute("aria-disabled")).toBe("true");
    expect(model.textContent + (model.getAttribute("title") ?? "")).toMatch(/terminal/);
  });
});
