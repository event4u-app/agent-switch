import { describe, expect, it } from "vitest";
import { anchorFor, placeFromAnchor, type Screen } from "./pet-anchor.js";

const laptop: Screen = { name: "Built-in", position: { x: 0, y: 0 }, size: { width: 1512, height: 982 } };
const wide: Screen = { name: "LG UltraWide", position: { x: 0, y: 0 }, size: { width: 3440, height: 1440 } };
const side: Screen = { name: "Side", position: { x: 1512, y: 0 }, size: { width: 1920, height: 1080 } };
const win = { width: 120, height: 140 };

describe("pet corner anchor", () => {
  it("measures from the nearest corner of the screen the pet is on", () => {
    // 24 px from the right edge, 40 px from the bottom of the laptop screen.
    const pos = { x: 1512 - 120 - 24, y: 982 - 140 - 40 };
    expect(anchorFor(pos, win, [laptop])).toEqual({ corner: "bottom-right", dx: 24, dy: 40, screen: "Built-in" });
    expect(anchorFor({ x: 30, y: 10 }, win, [laptop])).toEqual({ corner: "top-left", dx: 30, dy: 10, screen: "Built-in" });
  });

  it("keeps the bottom-right corner on a bigger screen instead of the old absolute position", () => {
    const a = anchorFor({ x: 1512 - 120 - 24, y: 982 - 140 - 40 }, win, [laptop])!;
    // The laptop screen is gone (docked, lid closed); only the wide one remains.
    expect(placeFromAnchor(a, win, [wide], wide)).toEqual({ x: 3440 - 120 - 24, y: 1440 - 140 - 40 });
  });

  it("returns to the named screen when it is still connected, at its offset there", () => {
    const pos = { x: 1512 + 1920 - 120 - 10, y: 20 };
    const a = anchorFor(pos, win, [laptop, side])!;
    expect(a).toMatchObject({ corner: "top-right", dx: 10, dy: 20, screen: "Side" });
    expect(placeFromAnchor(a, win, [laptop, side], laptop)).toEqual(pos);
  });

  it("clamps an offset larger than the screen so the pet stays visible", () => {
    const a = { corner: "bottom-right" as const, dx: 5000, dy: 3000, screen: null };
    expect(placeFromAnchor(a, win, [laptop], laptop)).toEqual({ x: 0, y: 0 });
  });
});
