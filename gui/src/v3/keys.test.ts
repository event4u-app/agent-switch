import { describe, expect, it } from "vitest";
import { DEFAULT_KEYS, actionFor, label, matches, withRebinds, type KeyLike } from "./keys.js";

const k = (key: string, mods: Partial<Omit<KeyLike, "key">> = {}): KeyLike => ({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods });

describe("v3 keyboard (spec §12)", () => {
  it("the spec's keys on macOS, terminal focused or not (⌘ never reaches the CLI)", () => {
    for (const focused of [false, true]) {
      expect(actionFor(k("k", { metaKey: true }), DEFAULT_KEYS, "mac", focused)).toBe("palette");
      expect(actionFor(k("j", { metaKey: true }), DEFAULT_KEYS, "mac", focused)).toBe("nextNeed");
      expect(actionFor(k("M", { metaKey: true, shiftKey: true }), DEFAULT_KEYS, "mac", focused)).toBe("moveSession");
      expect(actionFor(k("3", { metaKey: true }), DEFAULT_KEYS, "mac", focused)).toBe("tab3");
    }
    expect(actionFor(k("Tab", { ctrlKey: true }), DEFAULT_KEYS, "mac", false)).toBe("switcher");
    expect(actionFor(k("Escape"), DEFAULT_KEYS, "mac", false)).toBe("close");
  });

  it("Linux/Windows: Ctrl keys stay the CLI's while the terminal has focus; the app's become Ctrl+Shift", () => {
    expect(actionFor(k("k", { ctrlKey: true }), DEFAULT_KEYS, "other", false)).toBe("palette");
    expect(actionFor(k("k", { ctrlKey: true }), DEFAULT_KEYS, "other", true)).toBeNull();
    expect(actionFor(k("c", { ctrlKey: true }), DEFAULT_KEYS, "other", true)).toBeNull();
    expect(actionFor(k("K", { ctrlKey: true, shiftKey: true }), DEFAULT_KEYS, "other", true)).toBe("palette");
    expect(actionFor(k("Escape"), DEFAULT_KEYS, "other", true), "Esc belongs to the CLI").toBeNull();
    expect(actionFor(k("Tab", { ctrlKey: true }), DEFAULT_KEYS, "other", true)).toBeNull();
  });

  it("Alt or the wrong modifier never triggers", () => {
    expect(matches(k("k", { metaKey: true, altKey: true }), DEFAULT_KEYS.palette, "mac", false)).toBe(false);
    expect(matches(k("k", { ctrlKey: true }), DEFAULT_KEYS.palette, "mac", false)).toBe(false);
    expect(matches(k("k"), DEFAULT_KEYS.palette, "mac", false)).toBe(false);
  });

  it("labels show the keys that work right now", () => {
    expect(label(DEFAULT_KEYS.palette, "mac")).toBe("⌘K");
    expect(label(DEFAULT_KEYS.moveSession, "mac")).toBe("⇧⌘M");
    expect(label(DEFAULT_KEYS.switcher, "mac")).toBe("⌃Tab");
    expect(label(DEFAULT_KEYS.palette, "other")).toBe("Ctrl+K");
    expect(label(DEFAULT_KEYS.palette, "other", true)).toBe("Ctrl+Shift+K");
    expect(label(DEFAULT_KEYS.close, "other")).toBe("Esc");
  });

  it("every key can be rebound; a rebind onto another action's key is dropped", () => {
    const keys = withRebinds(JSON.stringify({ palette: { key: "p", mod: true }, settings: { key: "n", mod: true }, toggleSummary: { key: "k", mod: true }, bogus: { key: "x" } }));
    expect(keys.palette).toEqual({ key: "p", mod: true, shift: false, ctrl: false });
    expect(keys.settings, "⌘N is New session's").toEqual(DEFAULT_KEYS.settings);
    expect(keys.toggleSummary, "⌘K was freed by the palette's rebind").toEqual({ key: "k", mod: true, shift: false, ctrl: false });
    expect(actionFor(k("p", { metaKey: true }), keys, "mac", false)).toBe("palette");
    expect(withRebinds("{broken")).toEqual(DEFAULT_KEYS);
    const reordered = withRebinds(JSON.stringify({ toggleSummary: { key: "k", mod: true }, palette: { key: "p", mod: true } }));
    expect(reordered.toggleSummary, "the order of rebinds does not matter").toEqual({ key: "k", mod: true, shift: false, ctrl: false });
  });

  it("no two default actions share a binding", () => {
    const seen = new Set(Object.values(DEFAULT_KEYS).map((b) => `${b.key.toLowerCase()}|${!!b.mod}|${!!b.shift}|${!!b.ctrl}`));
    expect(seen.size).toBe(Object.keys(DEFAULT_KEYS).length);
  });
});
