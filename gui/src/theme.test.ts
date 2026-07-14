import { describe, it, expect } from "vitest";
import { resolveTheme } from "./theme.js";

describe("resolveTheme", () => {
  it("returns the explicit theme regardless of the OS preference", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
  it("follows the OS preference for 'system'", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});
