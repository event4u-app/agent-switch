import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { VirtualList } from "./virtual.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("VirtualList measuring", () => {
  // A row's height can flip back and forth while the window is narrow: the
  // scrollbar appears, the text rewraps, the scrollbar goes again. Measuring
  // on every render then never settles and React aborts the whole window.
  it("survives a row whose measured height keeps changing", () => {
    const seen = new WeakMap<Element, number>();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const n = (seen.get(this) ?? 0) + 1;
      seen.set(this, n);
      const h = n % 2 ? 40 : 58;
      return { height: h, width: 600, top: 0, left: 0, right: 600, bottom: h, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
    const items = Array.from({ length: 12 }, (_, i) => `row ${i}`);
    expect(() =>
      act(() => {
        render(<VirtualList label="Conversation" items={items} keyOf={(t) => t} render={(t) => <p>{t}</p>} />);
      }),
    ).not.toThrow();
    expect(screen.getByText("row 0")).toBeTruthy();
  });

  it("keeps the scrollbar's room so a wrap cannot toggle it", () => {
    render(<VirtualList label="Conversation" items={["a"]} keyOf={(t) => t} render={(t) => <p>{t}</p>} />);
    expect(screen.getByRole("log").style.scrollbarGutter).toBe("stable");
  });
});

describe("VirtualList keeps what you read in place (owner, 2026-11-26: the chat hakes when scrolling)", () => {
  it("a row above the viewport measured taller than estimated moves the scroll position with it, not the text", async () => {
    let h = 64;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ height: h, width: 600, top: 0, left: 0, right: 600, bottom: h, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect);
    const items = Array.from({ length: 200 }, (_, i) => `row ${i}`);
    render(<VirtualList label="Conversation" items={items} keyOf={(t) => t} render={(t) => <p>{t}</p>} />);
    const log = screen.getByRole("log");
    let top = 0;
    Object.defineProperty(log, "scrollTop", { configurable: true, get: () => top, set: (v: number) => (top = v) });
    Object.defineProperty(log, "scrollHeight", { configurable: true, get: () => 200 * 64 });
    Object.defineProperty(log, "clientHeight", { configurable: true, get: () => 400 });
    // Rows reached by scrolling up turn out taller than the 64 px estimate (a long message, wrapped in a narrow flyout).
    h = 164;
    top = 6000;
    await act(async () => {
      log.dispatchEvent(new Event("scroll"));
      await new Promise((r) => setTimeout(r, 40));
    });
    expect(top).toBeGreaterThan(6000);
    expect((top - 6000) % 100).toBe(0);
  });
});
