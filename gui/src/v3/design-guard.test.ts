import { describe, expect, it } from "vitest";

// Spec §14: checks that hold for every screen, run over the source tree. Read
// through Vite rather than node:fs — CI installs inside gui/ only, without @types/node.
const SOURCES = Object.entries(import.meta.glob<string>(["../**/*.{ts,tsx}", "!../**/*.test.{ts,tsx}"], { query: "?raw", import: "default", eager: true })).map(([p, text]) => ({ path: p.slice(3), text }));

describe("v3 design guard (spec §14)", () => {
  it("no selection drawn as an inset shadow bar", () => {
    const hits = SOURCES.filter((f) => /shadow-\[inset_(2px|0_2px)/.test(f.text)).map((f) => f.path);
    expect(SOURCES.length).toBeGreaterThan(50);
    expect(hits).toEqual([]);
  });

  it("v3 code uses only the radii of spec §3.1", () => {
    const allowed = new Set(["rounded", "rounded-md", "rounded-xl", "rounded-full", "rounded-none", "rounded-[10px]", "rounded-t-md"]);
    const bad: string[] = [];
    for (const f of SOURCES.filter((s) => s.path.startsWith("v3/"))) {
      for (const m of f.text.matchAll(/\brounded(?:-[a-z0-9[\]-]+)?/g)) {
        if (!allowed.has(m[0])) bad.push(`${f.path}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
