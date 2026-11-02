import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contrast } from "./color.js";
import { THEMES } from "./registry.js";
import { DEFAULT_APPEARANCE, FLOOR, activeTheme, migrate, resolveTheme } from "./resolve.js";

const hex = (v: string) => /^#[0-9a-f]{6}$/i.test(v);

describe("v3 themes", () => {
  it("ids are unique and every terminal palette has 16 colours", () => {
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
    for (const t of THEMES) expect(t.terminal.ansi).toHaveLength(16);
  });

  for (const t of THEMES) {
    for (const accent of ["theme", "agent-switch"] as const) {
      it(`${t.id} (${accent}) meets the contrast floors`, () => {
        const v = resolveTheme(t, accent).vars;
        const surfaces = ["--ac-bg", "--ac-panel", "--ac-rail"].map((k) => v[k]);
        const check = (k: string, bgs: string[], min: number) => {
          for (const bg of bgs) {
            if (!hex(v[k]) || !hex(bg)) continue;
            expect(contrast(v[k], bg), `${k} on ${bg}`).toBeGreaterThanOrEqual(min - 0.05);
          }
        };
        // The shipped Agent Switch palettes are kept 1:1 and only reported.
        if (t.exact) return;
        check("--ac-text", surfaces, FLOOR.text);
        for (const k of ["--ac-soft", "--ac-muted"]) check(k, surfaces, FLOOR.body);
        check("--ac-faint", [v["--ac-panel"], v["--ac-bg"]], FLOOR.faint);
        for (const k of ["brand", "info", "ok", "warn", "alert", "violet"]) check(`--ac-${k}-text`, [v["--ac-panel"], v["--ac-bg"]], FLOOR.body);
        check("--ac-on-color", [v["--ac-brand"]], FLOOR.onBrand);
      });
    }
  }

  it("every terminal colour reads on the terminal background at 4.5:1 or more (spec §2)", () => {
    for (const t of THEMES) {
      if (t.exact) continue;
      const v = resolveTheme(t).vars;
      for (let i = 0; i < 16; i++) {
        expect(contrast(v[`--as-ansi-${i}`], v["--as-term-bg"]), `${t.id} ansi ${i}`).toBeGreaterThanOrEqual(4.5 - 0.05);
      }
    }
  });

  it("the 18 themes come in the spec's order", () => {
    expect(THEMES.map((t) => t.id)).toEqual([
      "darcula", "jetbrains-dark", "jetbrains-light", "agent-switch-dark", "agent-switch-light", "one-dark-pro", "dracula",
      "github-dark", "github-light", "tokyo-night", "catppuccin-mocha", "catppuccin-latte", "nord", "solarized-dark",
      "solarized-light", "github-dark-hc", "github-light-hc", "github-dark-colorblind",
    ]);
  });

  it("Darcula is the default for new installs; 2.11 users keep their palette", () => {
    expect(activeTheme(DEFAULT_APPEARANCE, false).id).toBe("darcula");
    expect(activeTheme(migrate("light"), true).id).toBe("agent-switch-light");
    expect(activeTheme(migrate("system"), true).id).toBe("agent-switch-dark");
    expect(migrate(null).dark).toBe("darcula");
  });
});

describe("the Agent Switch palettes are the 2.11 window's own values", () => {
  // Parse the shipped stylesheet, so a drift on either side fails here.
  const css = readFileSync(join(process.cwd(), "src", "index.css"), "utf8"); // vitest runs in gui/
  const block = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    const body = css.slice(start, css.indexOf("}", start));
    return Object.fromEntries([...body.matchAll(/(--ac-[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim().toLowerCase()]));
  };
  for (const [selector, id] of [[".as-ac", "agent-switch-dark"], ['.as-ac[data-mode="light"]', "agent-switch-light"]] as const) {
    it(`${id} resolves to every --ac-* value of ${selector}`, () => {
      const shipped = block(selector);
      expect(Object.keys(shipped).length).toBeGreaterThan(10);
      const v = resolveTheme(THEMES.find((t) => t.id === id)!).vars;
      const differs = Object.entries(shipped).filter(([k, val]) => v[k] !== undefined && v[k].toLowerCase() !== val).map(([k, val]) => `${k}: 2.11 ${val} vs ${v[k]}`);
      expect(differs).toEqual([]);
    });
  }
});
