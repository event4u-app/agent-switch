/**
 * Theme selection (light / dark / system), persisted in localStorage and
 * applied by stamping `data-theme` on <html>. "system" resolves against the OS
 * preference and follows live changes. `resolveTheme` is pure for testing.
 */

export type Theme = "light" | "dark" | "system";
export const THEMES: Theme[] = ["light", "dark", "system"];
const KEY = "agent-switch-theme";

/** Resolve a setting to the concrete palette to render. */
export function resolveTheme(theme: Theme, prefersDark: boolean): "light" | "dark" {
  if (theme === "system") return prefersDark ? "dark" : "light";
  return theme;
}

export function getTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* no/blocked localStorage → default */
  }
  return "system";
}

function prefersDark(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;
}

let mql: MediaQueryList | null = null;
function onSystemChange() {
  if (getTheme() === "system") document.documentElement.dataset.theme = resolveTheme("system", prefersDark());
}

/** Persist + apply a theme. While "system" is active, follow OS changes. */
export function applyTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* no/blocked localStorage → apply without persisting */
  }
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = resolveTheme(theme, prefersDark());
  }
  if (typeof matchMedia !== "undefined") {
    if (!mql) {
      mql = matchMedia("(prefers-color-scheme: dark)");
      mql.addEventListener("change", onSystemChange);
    }
  }
}
