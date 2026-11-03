/** The v3 appearance: read, validated, migrated from 2.11's light/dark/system
 *  key on first run, and applied to <html> as the resolved `--ac-*` tokens. */

import { getAppearanceRaw, setAppearanceRaw } from "../../settings-store.js";
import { THEMES } from "../themes/registry.js";
import { DEFAULT_APPEARANCE, activeTheme, migrate, resolveTheme, type Appearance } from "../themes/resolve.js";

const known = new Set(THEMES.map((t) => t.id));

/** A stored value → a valid appearance; anything unusable → null. Pure. */
export function parseAppearance(raw: string | null): Appearance | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<Appearance>;
    if (o.mode !== "dark" && o.mode !== "light" && o.mode !== "system") return null;
    return {
      mode: o.mode,
      dark: typeof o.dark === "string" && known.has(o.dark) ? o.dark : DEFAULT_APPEARANCE.dark,
      light: typeof o.light === "string" && known.has(o.light) ? o.light : DEFAULT_APPEARANCE.light,
      accent: o.accent === "agent-switch" ? "agent-switch" : "theme",
      terminalFollows: o.terminalFollows !== false,
    };
  } catch {
    return null;
  }
}

function legacyTheme(): string | null {
  try {
    return localStorage.getItem("agent-switch-theme");
  } catch {
    return null;
  }
}

export function loadAppearance(): Appearance {
  return parseAppearance(getAppearanceRaw()) ?? migrate(legacyTheme());
}

export function saveAppearance(a: Appearance): void {
  setAppearanceRaw(JSON.stringify(a));
}

/** The resolved tokens of the active theme. Pure. */
export function themeVars(a: Appearance, prefersDark: boolean): { vars: Record<string, string>; mode: "dark" | "light" } {
  const def = activeTheme(a, prefersDark);
  return { vars: resolveTheme(def, a.accent).vars, mode: def.mode };
}

/** Stamp the tokens on <html>, so 2.11 overlays shown over the v3 window match. */
export function applyAppearance(a: Appearance, prefersDark: boolean, root: HTMLElement = document.documentElement): Record<string, string> {
  const { vars, mode } = themeVars(a, prefersDark);
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.dataset.theme = mode;
  return vars;
}
