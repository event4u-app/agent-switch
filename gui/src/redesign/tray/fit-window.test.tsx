import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { useFitWindow } from "./TrayApp.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  invoke.mockClear();
});

function Card({ width, height }: { width: number; height: number }) {
  const ref = useFitWindow();
  return <div ref={ref} data-w={width} data-h={height} />;
}

describe("the tray window follows its card", () => {
  // The v2 card is 340 px and the v3 card 360 px (tray board): a fixed window
  // width clips one of them, and the v3 bars ran past the window's edge.
  it.each([
    [340, 300],
    [360, 512],
  ])("sends a %i px wide card's width and height", (width, height) => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const w = Number(this.dataset.w ?? 0);
      const h = Number(this.dataset.h ?? 0);
      return { width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
    render(<Card width={width} height={height} />);
    expect(invoke).toHaveBeenCalledWith("tray_resize", { width, height });
    vi.unstubAllGlobals();
  });
});
