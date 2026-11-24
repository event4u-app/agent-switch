import { describe, expect, it } from "vitest";
import { ANY_TIME, inRange, presets, rangeLabel } from "./date-range.js";

const NOW = new Date(2026, 10, 24, 15, 30).getTime();
const at = (d: number, h = 0, m = 0) => new Date(2026, 10, d, h, m).getTime();

describe("time range", () => {
  it("quick picks: today from midnight, yesterday whole, last 7 days from a midnight", () => {
    const p = Object.fromEntries(presets(NOW).map((x) => [x.id, x.range]));
    expect(p.today).toEqual({ from: at(24), to: null });
    expect(p.yesterday).toEqual({ from: at(23), to: at(24) - 1 });
    expect(p["7d"]).toEqual({ from: at(18), to: null });
  });
  it("open ends let everything through; an unknown time only passes Any time", () => {
    expect(inRange(at(20), ANY_TIME)).toBe(true);
    expect(inRange(null, ANY_TIME)).toBe(true);
    expect(inRange(at(20), { from: at(21), to: null })).toBe(false);
    expect(inRange(null, { from: at(21), to: null })).toBe(false);
    expect(inRange(at(22, 12), { from: at(22), to: at(23) })).toBe(true);
  });
  it("labels a pick by name, a custom range by its ends", () => {
    expect(rangeLabel(ANY_TIME, NOW)).toBe("Any time");
    expect(rangeLabel(presets(NOW)[1].range, NOW)).toBe("Today");
    expect(rangeLabel({ from: at(22, 9), to: at(23, 18) }, NOW)).toBe("22 Nov, 09:00 – 23 Nov, 18:00");
    expect(rangeLabel({ from: at(22, 9), to: null }, NOW)).toBe("Since 22 Nov, 09:00");
  });
});
