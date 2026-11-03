import { alpha, contrast, ensureContrast, mix } from "./color.js";
import { DEFAULT_DARK, DEFAULT_LIGHT, themeById, type ThemeDef } from "./registry.js";

/** Contrast floors every resolved theme meets: AA for body text (4.5), a
 *  higher bar for primary text so it always reads above secondary text. */
export const FLOOR = { text: 6, body: 4.5, faint: 4.5, onBrand: 4.5 } as const;

export type Accent = "theme" | "agent-switch";

/** xterm.js `minimumContrastRatio` for the dock. */
export const TERM_FLOOR = 4.5;

/** The persisted appearance preference (proposal; replaces `agent-switch-theme`). */
export interface Appearance {
  /** "dark"/"light" pin one theme; "system" follows the OS between the two. */
  mode: "dark" | "light" | "system";
  dark: string;
  light: string;
  accent: Accent;
  /** The terminal dock uses the theme's ANSI palette (off = the CLI's own colours). */
  terminalFollows: boolean;
}

export const DEFAULT_APPEARANCE: Appearance = {
  mode: "dark",
  dark: DEFAULT_DARK,
  light: DEFAULT_LIGHT,
  accent: "theme",
  terminalFollows: true,
};

/** Migration from 2.11's `agent-switch-theme` (light | dark | system):
 *  the mode is kept, the palette stays the shipped Agent Switch one, so an
 *  update never changes what a user already sees. New installs get Darcula. */
export function migrate(old: string | null): Appearance {
  if (old === "light" || old === "dark" || old === "system") {
    return { ...DEFAULT_APPEARANCE, mode: old, dark: "agent-switch-dark", light: "agent-switch-light" };
  }
  return DEFAULT_APPEARANCE;
}

export function activeTheme(a: Appearance, prefersDark: boolean): ThemeDef {
  const dark = a.mode === "dark" || (a.mode === "system" && prefersDark);
  return themeById(dark ? a.dark : a.light);
}

const AS_BRAND = { dark: "#ff8c2a", light: "#f47a12" } as const;

export interface Resolved {
  vars: Record<string, string>;
  /** Token names whose value was derived or adjusted rather than taken from the palette. */
  derived: string[];
}

/** Palette → the full `--ac-*` token set plus terminal tokens. */
export function resolveTheme(def: ThemeDef, accent: Accent = "theme"): Resolved {
  const dark = def.mode === "dark";
  const p = def.ui;
  const derived: string[] = (def.assumed ?? []).map((k) => `--ac-${k}`);
  const pick = (name: string, given: string | undefined, fallback: () => string): string => {
    if (given) return given;
    derived.push(name);
    return fallback();
  };
  /** Keep the palette colour if it meets `min`, else shift it just enough. */
  const floor = (name: string, color: string, bgs: string[], min: number): string => {
    const out = ensureContrast(color, bgs, min, dark);
    if (out.toLowerCase() !== color.toLowerCase()) derived.push(name);
    return out;
  };

  const surfaces = [p.bg, p.panel, p.rail];
  const raise = pick("--ac-raise", p.raise, () => mix(p.panel, p.text, dark ? 0.07 : 0.05));
  const line2 = pick("--ac-line2", p.line2, () => mix(p.line, p.text, 0.18));
  const soft = floor("--ac-soft", pick("--ac-soft", p.soft, () => mix(p.text, p.panel, 0.15)), surfaces, FLOOR.body);
  const muted = floor("--ac-muted", pick("--ac-muted", p.muted, () => mix(p.text, p.panel, 0.35)), [...surfaces, raise], FLOOR.body);
  const faint = floor("--ac-faint", pick("--ac-faint", p.faint, () => mix(p.text, p.panel, 0.55)), [p.panel, p.bg, raise], FLOOR.faint);
  const text = floor("--ac-text", p.text, surfaces, FLOOR.text);

  let brand = accent === "agent-switch" ? AS_BRAND[def.mode] : p.brand;
  const darkInk = dark ? p.bg : "#0d1522";
  let onBrand = accent === "theme" && p.onBrand ? p.onBrand : contrast(darkInk, brand) >= contrast("#ffffff", brand) ? darkInk : "#ffffff";
  if (accent === "agent-switch" || !p.onBrand) derived.push("--ac-on-color");
  if (contrast(onBrand, brand) < FLOOR.onBrand) {
    // Neither ink reaches AA on the palette's accent: deepen (white ink) or
    // lighten (dark ink) the button fill just enough. The accent colour stays
    // the theme's own for text, tints and lines.
    const light = contrast("#ffffff", brand) >= contrast(darkInk, brand);
    onBrand = light ? "#ffffff" : darkInk;
    brand = ensureContrast(brand, [onBrand], FLOOR.onBrand, !light);
    derived.push("--ac-brand");
  }
  const textOf = (name: string, c: string) => floor(`--ac-${name}-text`, c, [p.panel, p.bg, raise], FLOOR.body);
  const tint = dark ? 0.16 : 0.12;

  const vars: Record<string, string> = {
    "--ac-bg": p.bg,
    "--ac-panel": p.panel,
    "--ac-rail": p.rail,
    "--ac-raise": raise,
    "--ac-line": p.line,
    "--ac-line2": line2,
    "--ac-text": text,
    "--ac-soft": soft,
    "--ac-muted": muted,
    "--ac-faint": faint,
    "--ac-brand": brand,
    "--ac-brand-text": textOf("brand", brand),
    "--ac-brand-tint": alpha(brand, tint),
    "--ac-brand-line": alpha(brand, 0.58),
    "--ac-on-color": onBrand,
    "--ac-info": p.info,
    "--ac-info-text": textOf("info", p.info),
    "--ac-info-tint": alpha(p.info, tint - 0.02),
    "--ac-ok": p.ok,
    "--ac-ok-text": textOf("ok", p.ok),
    "--ac-ok-tint": alpha(p.ok, tint - 0.02),
    "--ac-warn": p.warn,
    "--ac-warn-text": textOf("warn", p.warn),
    "--ac-warn-tint": alpha(p.warn, tint - 0.02),
    "--ac-alert": p.alert,
    "--ac-alert-text": textOf("alert", p.alert),
    "--ac-alert-tint": alpha(p.alert, tint - 0.02),
    "--ac-violet": p.violet,
    "--ac-violet-text": textOf("violet", p.violet),
    "--ac-violet-tint": alpha(p.violet, tint - 0.02),
    "--ac-violet-line": alpha(p.violet, 0.55),
    "--ac-scrim": dark ? "rgba(0, 0, 0, 0.55)" : alpha(p.text, 0.28),
    "--ac-shadow": dark ? "0 18px 48px rgba(0, 0, 0, 0.45)" : `0 18px 48px ${alpha(p.text, 0.16)}`,
    "--ac-id-orange": p.orange,
    "--ac-id-red": p.alert,
    "--ac-id-yellow": p.warn,
    "--ac-id-green": p.ok,
    "--ac-id-teal": p.teal,
    "--ac-id-blue": p.info,
    "--ac-id-purple": p.violet,
    "--ac-id-pink": p.pink,
    "--as-term-bg": def.terminal.bg,
    "--as-term-fg": def.terminal.fg,
    "--as-term-cursor": def.terminal.cursor ?? def.terminal.fg,
    "--as-term-selection": def.terminal.selection ?? alpha(def.terminal.fg, 0.25),
    "--as-diff-add": def.diff.add,
    "--as-diff-del": def.diff.del,
    "--as-diff-del-line": alpha(p.alert, dark ? 0.16 : 0.12),
    "--as-diff-add-line": alpha(p.ok, dark ? 0.16 : 0.12),
  };
  // Same rule as xterm.js `minimumContrastRatio`: a colour the terminal can't
  // read on its own background (Solarized's bright black is its background) is
  // lifted to 3:1. The palette's values are kept everywhere else.
  const termDark = contrast(def.terminal.bg, "#000000") < contrast(def.terminal.bg, "#ffffff");
  def.terminal.ansi.forEach((c, i) => {
    vars[`--as-ansi-${i}`] = contrast(c, def.terminal.bg) >= TERM_FLOOR ? c : ensureContrast(c, [def.terminal.bg], TERM_FLOOR, termDark);
  });

  if (def.exact) {
    Object.assign(vars, def.exact);
    return { vars, derived: [] };
  }
  if (def.terminal.ansi.some((c) => contrast(c, def.terminal.bg) < TERM_FLOOR)) derived.push("--as-ansi-*");
  return { vars, derived: [...new Set(derived)] };
}

/** xterm.js theme object for the terminal dock. */
export function xtermTheme(def: ThemeDef) {
  const [black, red, green, yellow, blue, magenta, cyan, white, bBlack, bRed, bGreen, bYellow, bBlue, bMagenta, bCyan, bWhite] = def.terminal.ansi;
  return {
    background: def.terminal.bg,
    foreground: def.terminal.fg,
    cursor: def.terminal.cursor ?? def.terminal.fg,
    selectionBackground: def.terminal.selection,
    black, red, green, yellow, blue, magenta, cyan, white,
    brightBlack: bBlack, brightRed: bRed, brightGreen: bGreen, brightYellow: bYellow,
    brightBlue: bBlue, brightMagenta: bMagenta, brightCyan: bCyan, brightWhite: bWhite,
  };
}
