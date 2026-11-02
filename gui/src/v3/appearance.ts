/**
 * The persisted appearance (spec §2): which theme, which accent, whether the
 * terminal follows the theme. Stored under its own key; the 2.11 key
 * `agent-switch-theme` is read once, so an update changes nothing a user sees.
 */

import { DEFAULT_APPEARANCE, migrate, type Appearance } from "./themes/resolve.js";
import { THEMES } from "./themes/registry.js";

export const APPEARANCE_KEY = "agent-switch-appearance";
const OLD_KEY = "agent-switch-theme";

const known = (id: unknown): id is string => typeof id === "string" && THEMES.some((t) => t.id === id);

/** A stored value back into an Appearance, dropping anything unknown. Pure. */
export function parseAppearance(raw: string | null): Appearance | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    const mode = o.mode === "dark" || o.mode === "light" || o.mode === "system" ? o.mode : null;
    if (!mode) return null;
    return {
      mode,
      dark: known(o.dark) ? o.dark : DEFAULT_APPEARANCE.dark,
      light: known(o.light) ? o.light : DEFAULT_APPEARANCE.light,
      accent: o.accent === "agent-switch" ? "agent-switch" : "theme",
      terminalFollows: o.terminalFollows !== false,
    };
  } catch {
    return null;
  }
}

/**
 * The appearance to start with. A stored v3 choice wins; then the 2.11 mode
 * with the Agent Switch palette; then — for an install that already has
 * accounts but never picked a theme (2.11 followed the system and stored
 * nothing) — the Agent Switch palette following the system. Only a new install
 * gets Darcula. Pure.
 */
export function initialAppearance(stored: string | null, oldTheme: string | null, existingInstall: boolean): Appearance {
  const v3 = parseAppearance(stored);
  if (v3) return v3;
  if (oldTheme) return migrate(oldTheme);
  return existingInstall ? migrate("system") : DEFAULT_APPEARANCE;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function loadAppearance(existingInstall: boolean): Appearance {
  return initialAppearance(read(APPEARANCE_KEY), read(OLD_KEY), existingInstall);
}

export function saveAppearance(a: Appearance): void {
  try {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(a));
  } catch {
    /* no/blocked localStorage: this window keeps it */
  }
}
