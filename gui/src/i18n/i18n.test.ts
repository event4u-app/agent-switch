import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getLanguagePref } from "../settings-store.js";
import { PET_WELCOME } from "../pet/model.js";
import { getLang, resolveLanguage, setLangForTests, setLanguagePref, tables } from "./index.js";

function memStorage() {
  const map = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
      clear: () => map.clear(),
    },
  });
  return map;
}

describe("language tables", () => {
  it("de carries every en key and no other", () => {
    const { en, de } = tables();
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
  });

  it("de keeps every {param} placeholder of the en string", () => {
    const { en, de } = tables();
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    const drift = Object.keys(en).filter((k) => JSON.stringify(ph(en[k]!)) !== JSON.stringify(ph(de[k]!)));
    expect(drift).toEqual([]);
  });

  it("no de string is empty", () => {
    const { de } = tables();
    expect(Object.entries(de).filter(([, v]) => v.trim() === "").map(([k]) => k)).toEqual([]);
  });

  it("plural sets are complete in both languages", () => {
    const { en, de } = tables();
    for (const table of [en, de]) {
      const ones = Object.keys(table).filter((k) => k.endsWith("_one"));
      for (const k of ones) expect(table[k.replace(/_one$/, "_other")], k).toBeTypeOf("string");
    }
  });
});

describe("resolveLanguage", () => {
  it("follows the system language unless pinned", () => {
    expect(resolveLanguage("system", "de-DE")).toBe("de");
    expect(resolveLanguage("system", "de")).toBe("de");
    expect(resolveLanguage("system", "en-US")).toBe("en");
    expect(resolveLanguage("system", "fr-FR")).toBe("en");
    expect(resolveLanguage("system", undefined)).toBe("en");
    expect(resolveLanguage("en", "de-DE")).toBe("en");
    expect(resolveLanguage("de", "en-US")).toBe("de");
  });
});

describe("Settings › General language override", () => {
  beforeEach(() => void memStorage());
  afterEach(() => setLangForTests("en"));

  it("defaults to system, and an unknown stored value migrates to system", () => {
    expect(getLanguagePref()).toBe("system");
    localStorage.setItem("agent-switch-language", "fr");
    expect(getLanguagePref()).toBe("system");
  });

  it("pins and releases the language", () => {
    setLanguagePref("de");
    expect(getLanguagePref()).toBe("de");
    expect(getLang()).toBe("de");
    setLanguagePref("system"); // jsdom's navigator.language is en-US
    expect(getLanguagePref()).toBe("system");
    expect(localStorage.getItem("agent-switch-language")).toBeNull();
    expect(getLang()).toBe("en");
  });
});

describe("PET_WELCOME", () => {
  it("stays byte-exact English (D7)", () => {
    expect(PET_WELCOME).toBe(
      "agent-switch is installed! The name's Switch — Agent Switch. I like my AIs switched, not stirred. Toggle me anytime in the Pet settings.",
    );
  });
});
