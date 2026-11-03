import { describe, expect, it } from "vitest";
import { DEFAULT_APPEARANCE } from "../themes/resolve.js";
import { applyAppearance, parseAppearance, themeVars } from "./appearance.js";

describe("appearance", () => {
  it("parses a stored value and repairs unknown themes", () => {
    expect(parseAppearance(JSON.stringify({ mode: "light", dark: "nope", light: "github-light", accent: "agent-switch", terminalFollows: false }))).toEqual({ mode: "light", dark: DEFAULT_APPEARANCE.dark, light: "github-light", accent: "agent-switch", terminalFollows: false });
  });

  it.each([null, "", "{", JSON.stringify({ mode: "neon" }), "3"])("rejects %j", (raw) => {
    expect(parseAppearance(raw)).toBeNull();
  });

  it("system mode follows the OS", () => {
    const a = { ...DEFAULT_APPEARANCE, mode: "system" as const };
    expect(themeVars(a, true).mode).toBe("dark");
    expect(themeVars(a, false).mode).toBe("light");
  });

  it("applies the tokens and the mode to the root element", () => {
    const el = document.createElement("div");
    const vars = applyAppearance(DEFAULT_APPEARANCE, true, el);
    expect(el.dataset.theme).toBe("dark");
    const k = Object.keys(vars).find((x) => x.startsWith("--ac-"))!;
    expect(el.style.getPropertyValue(k)).toBe(vars[k]);
  });
});
