import { describe, expect, it } from "vitest";
import { mergeHeldOrder } from "./held-order.js";

describe("mergeHeldOrder (D9)", () => {
  it("keeps the held places when the new order moves rows", () => {
    expect(mergeHeldOrder(["a", "b", "c"], ["c", "a", "b"])).toEqual(["a", "b", "c"]);
  });

  it("removes rows that left", () => {
    expect(mergeHeldOrder(["a", "b", "c"], ["c", "a"])).toEqual(["a", "c"]);
  });

  it("inserts an arrival after its predecessor in the new order", () => {
    expect(mergeHeldOrder(["a", "b", "c"], ["c", "a", "x", "b"])).toEqual(["a", "x", "b", "c"]);
  });

  it("inserts an arrival that leads the new order at the top", () => {
    expect(mergeHeldOrder(["a", "b"], ["x", "b", "a"])).toEqual(["x", "a", "b"]);
  });

  it("keeps consecutive arrivals in their new order, also at the top", () => {
    expect(mergeHeldOrder(["a", "b"], ["x", "y", "b", "z", "w", "a"])).toEqual(["x", "y", "a", "b", "z", "w"]);
  });

  it("returns the held array itself when the set is unchanged", () => {
    const held = ["a", "b", "c"];
    expect(mergeHeldOrder(held, ["b", "c", "a"])).toBe(held);
  });

  it("handles a departure and an arrival in one refresh", () => {
    expect(mergeHeldOrder(["a", "b", "c"], ["x", "c", "a"])).toEqual(["x", "a", "c"]);
  });
});
