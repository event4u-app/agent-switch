import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Spec §14: checks that hold for every screen, run over the source tree.
const SRC = join(process.cwd(), "src"); // vitest runs in gui/
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

describe("v3 design guard (spec §14)", () => {
  it("no selection drawn as an inset shadow bar", () => {
    const hits = files(SRC).filter((f) => /shadow-\[inset_(2px|0_2px)/.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });

  it("v3 code uses only the radii of spec §3.1", () => {
    const allowed = new Set(["rounded", "rounded-md", "rounded-xl", "rounded-full", "rounded-none", "rounded-[10px]", "rounded-t-md"]);
    const bad: string[] = [];
    for (const f of files(join(SRC, "v3"))) {
      for (const m of readFileSync(f, "utf8").matchAll(/\brounded(?:-[a-z0-9[\]-]+)?/g)) {
        if (!allowed.has(m[0])) bad.push(`${f.slice(SRC.length + 1)}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
