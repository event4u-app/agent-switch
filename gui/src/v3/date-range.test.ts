import { describe, expect, it } from "vitest";
import { ANY_TIME, inRange, monthGrid, pickDay, presets, rangeLabel, withClock } from "./date-range.js";

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

describe("calendar picking (owner, 2026-11-24)", () => {
  it("weeks start on Monday; six weeks are shown", () => {
    const g = monthGrid(new Date(2026, 10, 15).getTime());
    expect(g).toHaveLength(42);
    expect(new Date(g[0]).getDay()).toBe(1);
    expect(new Date(g[0]).getDate()).toBe(26); // Mon 26 Oct 2026 leads November
  });
  it("first click starts, second ends (either order), a third starts again", () => {
    let r = pickDay(ANY_TIME, at(20, 13));
    expect(r).toEqual({ from: at(20), to: null });
    r = pickDay(r, at(18));
    expect(r).toEqual({ from: at(18), to: new Date(2026, 10, 20, 23, 59, 59, 999).getTime() });
    expect(pickDay(r, at(22))).toEqual({ from: at(22), to: null });
  });
  it("a typed clock sets the time of its day; nonsense is refused", () => {
    expect(withClock(at(20), "9:30")).toBe(at(20, 9, 30));
    expect(withClock(at(20), "0930")).toBe(at(20, 9, 30));
    expect(withClock(at(20), "25:00")).toBeNull();
  });
});

describe("short trigger words for whole days", () => {
  it("a range of whole days says only its dates", () => {
    expect(rangeLabel(pickDay(pickDay(ANY_TIME, at(18)), at(21)), NOW)).toBe("18 Nov – 21 Nov");
    expect(rangeLabel(pickDay(pickDay(ANY_TIME, at(18)), at(18)), NOW)).toBe("18 Nov");
  });
});
