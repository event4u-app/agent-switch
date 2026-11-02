/**
 * v3 theme registry (proposal). Every theme is a palette taken from the
 * theme's own published source (link in `source`); the app's `--ac-*` tokens
 * are derived from it by `resolveTheme` (./resolve.ts). Where a palette has no
 * value for a role, or its value misses the contrast floor, the token is
 * derived and listed in the resolver's `derived` output — never silently.
 */

export type ThemeMode = "dark" | "light";
export type ThemeGroup = "agent-switch" | "jetbrains" | "popular" | "accessible";

export interface Palette {
  bg: string;
  panel: string;
  rail: string;
  raise?: string;
  line: string;
  line2?: string;
  text: string;
  soft?: string;
  muted?: string;
  faint?: string;
  /** The theme's own accent (primary button, selection, active tab). */
  brand: string;
  onBrand?: string;
  info: string;
  ok: string;
  warn: string;
  alert: string;
  violet: string;
  orange: string;
  teal: string;
  pink: string;
}

export interface TerminalPalette {
  bg: string;
  fg: string;
  cursor?: string;
  selection?: string;
  /** black red green yellow blue magenta cyan white, then the 8 bright ones. */
  ansi: [string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string];
}

export interface ThemeDef {
  id: string;
  name: string;
  mode: ThemeMode;
  group: ThemeGroup;
  /** One line under the name in the picker. */
  note: string;
  source: { label: string; url: string };
  /** Installs as published by the marketplace (VS Code), with the date read. */
  installs?: { count: number; label: string; url: string };
  ui: Palette;
  terminal: TerminalPalette & { origin: string };
  diff: { add: string; del: string };
  /** Palette roles the source has no value for, set by hand (named in the picker). */
  assumed?: (keyof Palette)[];
  /** Exact tokens that bypass derivation (the shipped Agent Switch palettes). */
  exact?: Record<string, string>;
}

/** The shipped 2.11 palette (`gui/src/index.css` `.as-ac`), 1:1. */
const AS_DARK_EXACT: Record<string, string> = {
  "--ac-bg": "#070b12", "--ac-panel": "#0d131d", "--ac-rail": "#0a1018", "--ac-raise": "#131c2a",
  "--ac-line": "#1c2738", "--ac-line2": "#2a3445", "--ac-text": "#e8eef7", "--ac-soft": "#c3cedd",
  "--ac-muted": "#93a1b5", "--ac-faint": "#6f7d92", "--ac-brand": "#ff8c2a", "--ac-brand-text": "#ff9d47",
  "--ac-brand-tint": "rgba(255, 140, 42, 0.16)", "--ac-brand-line": "rgba(255, 140, 42, 0.55)", "--ac-on-color": "#0d1522",
  "--ac-info": "#3ec5ff", "--ac-info-text": "#8adcff", "--ac-info-tint": "rgba(62, 197, 255, 0.13)",
  "--ac-ok": "#3ddc84", "--ac-ok-text": "#3ddc84", "--ac-ok-tint": "rgba(61, 220, 132, 0.14)",
  "--ac-warn": "#ffc14d", "--ac-warn-text": "#ffc14d", "--ac-warn-tint": "rgba(255, 193, 77, 0.14)",
  "--ac-alert": "#ff5d6c", "--ac-alert-text": "#ff8a95", "--ac-alert-tint": "rgba(255, 93, 108, 0.14)",
  "--ac-violet": "#c9a2ff", "--ac-violet-text": "#d9bdff", "--ac-violet-tint": "rgba(201, 162, 255, 0.14)", "--ac-violet-line": "rgba(201, 162, 255, 0.55)",
  "--ac-scrim": "rgba(3, 6, 10, 0.62)", "--ac-shadow": "0 18px 48px rgba(0, 0, 0, 0.45)",
  "--ac-id-orange": "#ff8c2a", "--ac-id-red": "#ff5d6c", "--ac-id-yellow": "#ffc14d", "--ac-id-green": "#3ddc84",
  "--ac-id-teal": "#2dd4bf", "--ac-id-blue": "#3ec5ff", "--ac-id-purple": "#c9a2ff", "--ac-id-pink": "#ff7ac6",
};
const AS_LIGHT_EXACT: Record<string, string> = {
  "--ac-bg": "#f3f5f9", "--ac-panel": "#ffffff", "--ac-rail": "#fafbfd", "--ac-raise": "#eef2f7",
  "--ac-line": "#dde3ec", "--ac-line2": "#c3ccd9", "--ac-text": "#0d1522", "--ac-soft": "#334155",
  "--ac-muted": "#536074", "--ac-faint": "#8592a5", "--ac-brand": "#f47a12", "--ac-brand-text": "#b4530a",
  "--ac-brand-tint": "rgba(244, 122, 18, 0.12)", "--ac-brand-line": "rgba(244, 122, 18, 0.6)", "--ac-on-color": "#0d1522",
  "--ac-info": "#0ea5e9", "--ac-info-text": "#0369a1", "--ac-info-tint": "rgba(14, 165, 233, 0.12)",
  "--ac-ok": "#16a34a", "--ac-ok-text": "#15803d", "--ac-ok-tint": "rgba(22, 163, 74, 0.12)",
  "--ac-warn": "#f5b324", "--ac-warn-text": "#92580a", "--ac-warn-tint": "rgba(245, 179, 36, 0.16)",
  "--ac-alert": "#e11d48", "--ac-alert-text": "#be123c", "--ac-alert-tint": "rgba(225, 29, 72, 0.1)",
  "--ac-violet": "#8b5cf6", "--ac-violet-text": "#6d28d9", "--ac-violet-tint": "rgba(139, 92, 246, 0.12)", "--ac-violet-line": "rgba(139, 92, 246, 0.6)",
  // Overlay, shadow and account colours too: the reference boards derived these and drifted from 2.11.
  "--ac-scrim": "rgba(13, 21, 34, 0.32)", "--ac-shadow": "0 18px 48px rgba(13, 21, 34, 0.18)",
  "--ac-id-orange": "#f47a12", "--ac-id-red": "#e11d48", "--ac-id-yellow": "#d99a06", "--ac-id-green": "#16a34a",
  "--ac-id-teal": "#0d9488", "--ac-id-blue": "#0284c7", "--ac-id-purple": "#7c3aed", "--ac-id-pink": "#db2777",
};

const IJ = "https://github.com/JetBrains/intellij-community/blob/master/platform/platform-resources/src";
const DARCULA_ANSI: TerminalPalette["ansi"] = [
  "#000000", "#F0524F", "#5C962C", "#A68A0D", "#3993D4", "#A771BF", "#00A3A3", "#808080",
  "#595959", "#FF4050", "#4FC414", "#E5BF00", "#1FB0FF", "#ED7EED", "#00E5E5", "#FFFFFF",
];
const IJ_LIGHT_ANSI: TerminalPalette["ansi"] = [
  "#000000", "#CE0505", "#067D17", "#B28C00", "#063FDB", "#B309B3", "#028E8E", "#929292",
  "#656565", "#FF1616", "#16B42C", "#ECC32C", "#2D61F0", "#E617E6", "#15C1C1", "#C9C9C9",
];
const PRIMER = "https://github.com/primer/primitives (v9.1.2, dist/css/functional/themes)";
const PRIMER_URL = "https://www.npmjs.com/package/@primer/primitives/v/9.1.2";

export const THEMES: ThemeDef[] = [
  {
    id: "darcula",
    name: "Darcula",
    mode: "dark",
    group: "jetbrains",
    note: "The JetBrains classic · default",
    source: { label: "intellij-community · darcula.theme.json + Darcula colour scheme", url: `${IJ}/themes/darcula.theme.json` },
    ui: {
      bg: "#2B2B2B", // editor / console background
      panel: "#313335", // gutter
      rail: "#313335", // gutter (sidebar = tool-window column)
      raise: "#3C3F41", // Panel.background (hover, tab strip, inputs)
      line: "#515151", // Separator
      line2: "#646464", // Component.borderColor
      text: "#BBBBBB", // Panel.foreground
      soft: "#A9B7C6", // editor text
      faint: "#777777", // Label.disabledForeground
      brand: "#CC7832", // keyword orange
      info: "#589DF6", // Link
      ok: "#629755", // FILESTATUS_ADDED
      warn: "#FFC66D", // function
      alert: "#F0524F", // console red
      violet: "#9876AA", // constant / field
      orange: "#CC7832",
      teal: "#00A3A3",
      pink: "#ED7EED",
    },
    terminal: { origin: "Darcula console colours (CONSOLE_*_OUTPUT)", bg: "#2B2B2B", fg: "#BBBBBB", cursor: "#BBBBBB", selection: "#214283", ansi: DARCULA_ANSI },
    diff: { add: "#294436", del: "#484A4A" },
  },
  {
    id: "jetbrains-dark",
    name: "JetBrains Dark",
    mode: "dark",
    group: "jetbrains",
    note: "New UI (expUI_dark), built on Darcula",
    source: { label: "intellij-community · expUI_dark.theme.json", url: `${IJ}/themes/expUI/expUI_dark.theme.json` },
    ui: {
      bg: "#1E1F22", panel: "#2B2D30", rail: "#2B2D30", raise: "#393B40", line: "#393B40", line2: "#4E5157",
      text: "#DFE1E5", soft: "#CED0D6", muted: "#9DA0A8", faint: "#6F737A",
      brand: "#3574F0", onBrand: "#FFFFFF", info: "#548AF7", ok: "#57965C", warn: "#D6AE58", alert: "#DB5C5C",
      violet: "#955AE0", orange: "#E08855", teal: "#238E82", pink: "#C4A0F3",
    },
    terminal: { origin: "Darcula console colours (New UI inherits Darcula)", bg: "#1E1F22", fg: "#BCBEC4", cursor: "#CED0D6", selection: "#2E436E", ansi: DARCULA_ANSI },
    diff: { add: "#273828", del: "#402929" },
  },
  {
    id: "jetbrains-light",
    name: "JetBrains Light",
    mode: "light",
    group: "jetbrains",
    note: "New UI (expUI_light) · pairs with Darcula",
    source: { label: "intellij-community · expUI_light.theme.json", url: `${IJ}/themes/expUI/expUI_light.theme.json` },
    ui: {
      bg: "#FFFFFF", panel: "#F7F8FA", rail: "#EBECF0", raise: "#EBECF0", line: "#DFE1E5", line2: "#C9CCD6",
      text: "#000000", soft: "#27282E", muted: "#5A5D6B", faint: "#818594",
      brand: "#3574F0", onBrand: "#FFFFFF", info: "#3369D6", ok: "#208A3C", warn: "#DF9303", alert: "#DB3B4B",
      violet: "#834DF0", orange: "#E56D17", teal: "#039BA1", pink: "#A177F4",
    },
    terminal: { origin: "IntelliJ Default console colours", bg: "#FFFFFF", fg: "#000000", cursor: "#000000", selection: "#A6D2FF", ansi: IJ_LIGHT_ANSI },
    diff: { add: "#C9DEC1", del: "#FAD4D8" },
  },
  {
    id: "agent-switch-dark",
    name: "Agent Switch Dark",
    mode: "dark",
    group: "agent-switch",
    note: "Today's palette (2.11), unchanged",
    source: { label: "gui/src/index.css · .as-ac", url: "https://github.com/event4u-app/agent-switch/blob/main/gui/src/index.css" },
    ui: {
      bg: "#070b12", panel: "#0d131d", rail: "#0a1018", raise: "#131c2a", line: "#1c2738", line2: "#2a3445",
      text: "#e8eef7", soft: "#c3cedd", muted: "#93a1b5", faint: "#6f7d92",
      brand: "#ff8c2a", onBrand: "#0d1522", info: "#3ec5ff", ok: "#3ddc84", warn: "#ffc14d", alert: "#ff5d6c",
      violet: "#c9a2ff", orange: "#ff8c2a", teal: "#2dd4bf", pink: "#ff7ac6",
    },
    terminal: {
      origin: "derived from the identity colours (2.11 has no ANSI palette)",
      bg: "#070b12", fg: "#c3cedd", cursor: "#ff8c2a", selection: "#1c2738",
      ansi: ["#131c2a", "#ff5d6c", "#3ddc84", "#ffc14d", "#3ec5ff", "#c9a2ff", "#2dd4bf", "#c3cedd", "#6f7d92", "#ff8a95", "#6ee7a8", "#ffd27f", "#8adcff", "#d9bdff", "#5eead4", "#e8eef7"],
    },
    diff: { add: "rgba(61, 220, 132, 0.14)", del: "rgba(255, 93, 108, 0.14)" },
    exact: AS_DARK_EXACT,
  },
  {
    id: "agent-switch-light",
    name: "Agent Switch Light",
    mode: "light",
    group: "agent-switch",
    note: "Today's light palette (2.11), unchanged",
    source: { label: "gui/src/index.css · .as-ac[data-mode=light]", url: "https://github.com/event4u-app/agent-switch/blob/main/gui/src/index.css" },
    ui: {
      bg: "#f3f5f9", panel: "#ffffff", rail: "#fafbfd", raise: "#eef2f7", line: "#dde3ec", line2: "#c3ccd9",
      text: "#0d1522", soft: "#334155", muted: "#536074", faint: "#8592a5",
      brand: "#f47a12", onBrand: "#0d1522", info: "#0ea5e9", ok: "#16a34a", warn: "#f5b324", alert: "#e11d48",
      violet: "#8b5cf6", orange: "#f47a12", teal: "#0d9488", pink: "#db2777",
    },
    terminal: {
      origin: "derived from the identity colours",
      bg: "#ffffff", fg: "#334155", cursor: "#f47a12", selection: "#dde3ec",
      ansi: ["#0d1522", "#be123c", "#15803d", "#92580a", "#0369a1", "#6d28d9", "#0d9488", "#8592a5", "#536074", "#e11d48", "#16a34a", "#b4530a", "#0284c7", "#7c3aed", "#0f766e", "#c3ccd9"],
    },
    diff: { add: "rgba(22, 163, 74, 0.12)", del: "rgba(225, 29, 72, 0.1)" },
    exact: AS_LIGHT_EXACT,
  },
  {
    id: "one-dark-pro",
    name: "One Dark Pro",
    mode: "dark",
    group: "popular",
    note: "Atom's look",
    source: { label: "Binaryify/OneDark-Pro · themes/OneDark-Pro.json", url: "https://github.com/Binaryify/OneDark-Pro" },
    installs: { count: 12870623, label: "VS Code Marketplace, read 2026-11-02", url: "https://marketplace.visualstudio.com/items?itemName=zhuangtongfa.Material-theme" },
    ui: {
      bg: "#21252b", panel: "#282c34", rail: "#21252b", line: "#3e4452", text: "#d7dae0", soft: "#abb2bf",
      brand: "#4aa5f0", onBrand: "#1d1f23", info: "#4dc4ff", ok: "#8cc265", warn: "#d18f52", alert: "#e05561",
      violet: "#c162de", orange: "#f0a45d", teal: "#42b3c2", pink: "#de73ff",
    },
    terminal: {
      origin: "terminal.ansi* from the theme", bg: "#282c34", fg: "#abb2bf",
      ansi: ["#3f4451", "#e05561", "#8cc265", "#d18f52", "#4aa5f0", "#c162de", "#42b3c2", "#d7dae0", "#4f5666", "#ff616e", "#a5e075", "#f0a45d", "#4dc4ff", "#de73ff", "#4cd1e0", "#e6e6e6"],
    },
    diff: { add: "rgba(140, 194, 101, 0.16)", del: "rgba(224, 85, 97, 0.16)" },
  },
  {
    id: "dracula",
    name: "Dracula",
    mode: "dark",
    group: "popular",
    note: "Purple accent, high contrast",
    source: { label: "dracula/visual-studio-code · src/dracula.yml", url: "https://github.com/dracula/visual-studio-code" },
    installs: { count: 11094231, label: "VS Code Marketplace, read 2026-11-02", url: "https://marketplace.visualstudio.com/items?itemName=dracula-theme.theme-dracula" },
    ui: {
      bg: "#21222C", panel: "#282A36", rail: "#21222C", raise: "#343746", line: "#44475A", text: "#F8F8F2", muted: "#6272A4",
      brand: "#BD93F9", onBrand: "#191A21", info: "#8BE9FD", ok: "#50FA7B", warn: "#F1FA8C", alert: "#FF5555",
      violet: "#BD93F9", orange: "#FFB86C", teal: "#8BE9FD", pink: "#FF79C6",
    },
    terminal: {
      origin: "COLOR0–15 from the theme", bg: "#282A36", fg: "#F8F8F2", selection: "#44475A",
      ansi: ["#21222C", "#FF5555", "#50FA7B", "#F1FA8C", "#BD93F9", "#FF79C6", "#8BE9FD", "#F8F8F2", "#6272A4", "#FF6E6E", "#69FF94", "#FFFFA5", "#D6ACFF", "#FF92DF", "#A4FFFF", "#FFFFFF"],
    },
    diff: { add: "rgba(80, 250, 123, 0.14)", del: "rgba(255, 85, 85, 0.16)" },
  },
  {
    id: "github-dark",
    name: "GitHub Dark",
    mode: "dark",
    group: "popular",
    note: "Primer colours, as on github.com",
    source: { label: "@primer/primitives 9.1.2 · dark.css", url: PRIMER_URL },
    installs: { count: 19978963, label: "GitHub Theme (all variants), devresourc.es 2026-09-04", url: "https://devresourc.es/blog/best-vscode-themes" },
    ui: {
      bg: "#010409", panel: "#0d1117", rail: "#010409", raise: "#151b23", line: "#3d444d", text: "#f0f6fc", muted: "#9198a1",
      brand: "#1f6feb", onBrand: "#ffffff", info: "#4493f8", ok: "#3fb950", warn: "#d29922", alert: "#f85149",
      violet: "#ab7df8", orange: "#db6d28", teal: "#39c5cf", pink: "#d2a8ff",
    },
    terminal: {
      origin: "--color-ansi-* from Primer", bg: "#0d1117", fg: "#f0f6fc",
      ansi: ["#2f3742", "#ff7b72", "#3fb950", "#d29922", "#58a6ff", "#be8fff", "#39c5cf", "#f0f6fc", "#656c76", "#ffa198", "#56d364", "#e3b341", "#79c0ff", "#d2a8ff", "#56d4dd", "#ffffff"],
    },
    diff: { add: "rgba(63, 185, 80, 0.15)", del: "rgba(248, 81, 73, 0.15)" },
  },
  {
    id: "github-light",
    name: "GitHub Light",
    mode: "light",
    group: "popular",
    note: "Primer colours, light",
    source: { label: "@primer/primitives 9.1.2 · light.css", url: PRIMER_URL },
    ui: {
      bg: "#ffffff", panel: "#f6f8fa", rail: "#eff2f5", line: "#d1d9e0", text: "#1f2328", muted: "#59636e",
      brand: "#0969da", onBrand: "#ffffff", info: "#0969da", ok: "#1a7f37", warn: "#9a6700", alert: "#d1242f",
      violet: "#8250df", orange: "#bc4c00", teal: "#1b7c83", pink: "#a475f9",
    },
    terminal: {
      origin: "--color-ansi-* from Primer", bg: "#ffffff", fg: "#1f2328",
      ansi: ["#1f2328", "#cf222e", "#116329", "#4d2d00", "#0969da", "#8250df", "#1b7c83", "#59636e", "#393f46", "#a40e26", "#1a7f37", "#633c01", "#218bff", "#a475f9", "#3192aa", "#818b98"],
    },
    diff: { add: "rgba(26, 127, 55, 0.12)", del: "rgba(209, 36, 47, 0.1)" },
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    mode: "dark",
    group: "popular",
    note: "Muted blue and violet",
    source: { label: "enkia/tokyo-night-vscode-theme · themes/tokyo-night-color-theme.json", url: "https://github.com/enkia/tokyo-night-vscode-theme" },
    installs: { count: 2897498, label: "VS Code Marketplace via devresourc.es 2026-09-04", url: "https://devresourc.es/blog/best-vscode-themes" },
    ui: {
      bg: "#16161e", panel: "#1a1b26", rail: "#16161e", raise: "#202330", line: "#2a2b3a", text: "#c0caf5", soft: "#a9b1d6", muted: "#787c99",
      brand: "#7aa2f7", onBrand: "#14141b", info: "#7dcfff", ok: "#73daca", warn: "#e0af68", alert: "#f7768e",
      violet: "#bb9af7", orange: "#e0af68", teal: "#73daca", pink: "#bb9af7",
    },
    terminal: {
      origin: "terminal.ansi* from the theme", bg: "#16161e", fg: "#a9b1d6", selection: "#515c7e",
      ansi: ["#363b54", "#f7768e", "#73daca", "#e0af68", "#7aa2f7", "#bb9af7", "#7dcfff", "#787c99", "#363b54", "#f7768e", "#73daca", "#e0af68", "#7aa2f7", "#bb9af7", "#7dcfff", "#acb0d0"],
    },
    diff: { add: "rgba(115, 218, 202, 0.13)", del: "rgba(247, 118, 142, 0.14)" },
    assumed: ["line"],
  },
  {
    id: "catppuccin-mocha",
    name: "Catppuccin Mocha",
    mode: "dark",
    group: "popular",
    note: "Pastel, dark",
    source: { label: "catppuccin/palette 1.8.0 · palette.json", url: "https://github.com/catppuccin/palette" },
    installs: { count: 1388160, label: "VS Code Marketplace via devresourc.es 2026-09-04", url: "https://devresourc.es/blog/best-vscode-themes" },
    ui: {
      bg: "#11111b", panel: "#1e1e2e", rail: "#181825", raise: "#313244", line: "#313244", line2: "#45475a",
      text: "#cdd6f4", soft: "#bac2de", muted: "#a6adc8", faint: "#7f849c",
      brand: "#cba6f7", onBrand: "#11111b", info: "#89b4fa", ok: "#a6e3a1", warn: "#f9e2af", alert: "#f38ba8",
      violet: "#cba6f7", orange: "#fab387", teal: "#94e2d5", pink: "#f5c2e7",
    },
    terminal: {
      origin: "ansiColors from palette.json", bg: "#1e1e2e", fg: "#cdd6f4", cursor: "#f5e0dc", selection: "#45475a",
      ansi: ["#45475a", "#f38ba8", "#a6e3a1", "#f9e2af", "#89b4fa", "#f5c2e7", "#94e2d5", "#a6adc8", "#585b70", "#f37799", "#89d88b", "#ebd391", "#74a8fc", "#f2aede", "#6bd7ca", "#bac2de"],
    },
    diff: { add: "rgba(166, 227, 161, 0.13)", del: "rgba(243, 139, 168, 0.14)" },
  },
  {
    id: "catppuccin-latte",
    name: "Catppuccin Latte",
    mode: "light",
    group: "popular",
    note: "Pastel, light",
    source: { label: "catppuccin/palette 1.8.0 · palette.json", url: "https://github.com/catppuccin/palette" },
    ui: {
      bg: "#dce0e8", panel: "#eff1f5", rail: "#e6e9ef", raise: "#ccd0da", line: "#ccd0da", line2: "#bcc0cc",
      text: "#4c4f69", soft: "#5c5f77", muted: "#6c6f85", faint: "#8c8fa1",
      brand: "#8839ef", onBrand: "#ffffff", info: "#1e66f5", ok: "#40a02b", warn: "#df8e1d", alert: "#d20f39",
      violet: "#8839ef", orange: "#fe640b", teal: "#179299", pink: "#ea76cb",
    },
    terminal: {
      origin: "ansiColors from palette.json", bg: "#eff1f5", fg: "#4c4f69", cursor: "#dc8a78", selection: "#bcc0cc",
      ansi: ["#5c5f77", "#d20f39", "#40a02b", "#df8e1d", "#1e66f5", "#ea76cb", "#179299", "#acb0be", "#6c6f85", "#de293e", "#49af3d", "#eea02d", "#456eff", "#fe85d8", "#2d9fa8", "#bcc0cc"],
    },
    diff: { add: "rgba(64, 160, 43, 0.13)", del: "rgba(210, 15, 57, 0.1)" },
  },
  {
    id: "nord",
    name: "Nord",
    mode: "dark",
    group: "popular",
    note: "Arctic, calm",
    source: { label: "nordtheme · nord.css (nord0–nord15)", url: "https://github.com/nordtheme/nord" },
    ui: {
      bg: "#2e3440", panel: "#3b4252", rail: "#2e3440", raise: "#434c5e", line: "#434c5e", line2: "#4c566a",
      text: "#eceff4", soft: "#d8dee9",
      brand: "#88c0d0", onBrand: "#2e3440", info: "#81a1c1", ok: "#a3be8c", warn: "#ebcb8b", alert: "#bf616a",
      violet: "#b48ead", orange: "#d08770", teal: "#8fbcbb", pink: "#b48ead",
    },
    terminal: {
      origin: "Nord terminal mapping (nord1/11/14/13/9/15/8/5; bright nord3…nord6)", bg: "#2e3440", fg: "#d8dee9",
      ansi: ["#3b4252", "#bf616a", "#a3be8c", "#ebcb8b", "#81a1c1", "#b48ead", "#88c0d0", "#e5e9f0", "#4c566a", "#bf616a", "#a3be8c", "#ebcb8b", "#81a1c1", "#b48ead", "#8fbcbb", "#eceff4"],
    },
    diff: { add: "rgba(163, 190, 140, 0.16)", del: "rgba(191, 97, 106, 0.18)" },
  },
  {
    id: "solarized-dark",
    name: "Solarized Dark",
    mode: "dark",
    group: "popular",
    note: "Ethan Schoonover's precision palette",
    source: { label: "altercation/solarized · README (base03…green)", url: "https://github.com/altercation/solarized" },
    ui: {
      bg: "#002b36", panel: "#073642", rail: "#002b36", line: "#0f4a58", text: "#93a1a1", soft: "#839496", muted: "#839496", faint: "#586e75",
      brand: "#268bd2", onBrand: "#fdf6e3", info: "#2aa198", ok: "#859900", warn: "#b58900", alert: "#dc322f",
      violet: "#6c71c4", orange: "#cb4b16", teal: "#2aa198", pink: "#d33682",
    },
    terminal: {
      origin: "official Solarized terminal mapping", bg: "#002b36", fg: "#839496",
      ansi: ["#073642", "#dc322f", "#859900", "#b58900", "#268bd2", "#d33682", "#2aa198", "#eee8d5", "#002b36", "#cb4b16", "#586e75", "#657b83", "#839496", "#6c71c4", "#93a1a1", "#fdf6e3"],
    },
    diff: { add: "rgba(133, 153, 0, 0.18)", del: "rgba(220, 50, 47, 0.18)" },
    assumed: ["line"],
  },
  {
    id: "solarized-light",
    name: "Solarized Light",
    mode: "light",
    group: "popular",
    note: "Same accents, light base",
    source: { label: "altercation/solarized · README (base03…green)", url: "https://github.com/altercation/solarized" },
    ui: {
      bg: "#eee8d5", panel: "#fdf6e3", rail: "#eee8d5", line: "#e4dcc3", text: "#073642", soft: "#586e75", muted: "#657b83", faint: "#93a1a1",
      brand: "#268bd2", onBrand: "#fdf6e3", info: "#268bd2", ok: "#859900", warn: "#b58900", alert: "#dc322f",
      violet: "#6c71c4", orange: "#cb4b16", teal: "#2aa198", pink: "#d33682",
    },
    terminal: {
      origin: "official Solarized terminal mapping", bg: "#fdf6e3", fg: "#657b83",
      ansi: ["#073642", "#dc322f", "#859900", "#b58900", "#268bd2", "#d33682", "#2aa198", "#eee8d5", "#002b36", "#cb4b16", "#586e75", "#657b83", "#839496", "#6c71c4", "#93a1a1", "#fdf6e3"],
    },
    diff: { add: "rgba(133, 153, 0, 0.16)", del: "rgba(220, 50, 47, 0.12)" },
    assumed: ["line"],
  },
  {
    id: "github-dark-hc",
    name: "GitHub Dark High Contrast",
    mode: "dark",
    group: "accessible",
    note: "High contrast, dark",
    source: { label: `${PRIMER.split(" ")[0]} · dark-high-contrast.css`, url: PRIMER_URL },
    ui: {
      bg: "#010409", panel: "#010409", rail: "#151b23", raise: "#151b23", line: "#b7bdc8", line2: "#b7bdc8", text: "#ffffff", muted: "#b7bdc8",
      brand: "#194fb1", onBrand: "#ffffff", info: "#74b9ff", ok: "#2bd853", warn: "#f0b72f", alert: "#ff9492",
      violet: "#d3abff", orange: "#fe9a2d", teal: "#39c5cf", pink: "#dbb7ff",
    },
    terminal: {
      origin: "--color-ansi-* from Primer", bg: "#010409", fg: "#ffffff",
      ansi: ["#2f3742", "#ff9492", "#28d751", "#f0b72f", "#71b7ff", "#cb9eff", "#39c5cf", "#f0f6fc", "#656c76", "#ffb1af", "#4ae168", "#f7c843", "#91cbff", "#dbb7ff", "#56d4dd", "#ffffff"],
    },
    diff: { add: "rgba(43, 216, 83, 0.2)", del: "rgba(255, 148, 146, 0.2)" },
  },
  {
    id: "github-light-hc",
    name: "GitHub Light High Contrast",
    mode: "light",
    group: "accessible",
    note: "High contrast, light",
    source: { label: `${PRIMER.split(" ")[0]} · light-high-contrast.css`, url: PRIMER_URL },
    ui: {
      bg: "#eff2f5", panel: "#ffffff", rail: "#e6eaef", raise: "#e6eaef", line: "#454c54", line2: "#454c54", text: "#010409", muted: "#454c54",
      brand: "#0349b4", onBrand: "#ffffff", info: "#023b95", ok: "#024c1a", warn: "#603700", alert: "#8a071e",
      violet: "#512598", orange: "#702c00", teal: "#1b7c83", pink: "#622cbc",
    },
    terminal: {
      origin: "--color-ansi-* from Primer", bg: "#ffffff", fg: "#010409",
      ansi: ["#010409", "#a0111f", "#024c1a", "#3f2200", "#0349b4", "#622cbc", "#1b7c83", "#59636e", "#393f46", "#86061d", "#055d20", "#4e2c00", "#1168e3", "#844ae7", "#3192aa", "#818b98"],
    },
    diff: { add: "rgba(2, 76, 26, 0.14)", del: "rgba(138, 7, 30, 0.12)" },
  },
  {
    id: "github-dark-colorblind",
    name: "GitHub Dark Colorblind",
    mode: "dark",
    group: "accessible",
    note: "Red/green → orange/blue (protan/deutan)",
    source: { label: `${PRIMER.split(" ")[0]} · dark-colorblind.css`, url: PRIMER_URL },
    ui: {
      bg: "#010409", panel: "#0d1117", rail: "#010409", raise: "#151b23", line: "#3d444d", text: "#f0f6fc", muted: "#9198a1",
      brand: "#1f6feb", onBrand: "#ffffff", info: "#4493f8", ok: "#58a6ff", warn: "#d29922", alert: "#db6d28",
      violet: "#ab7df8", orange: "#db6d28", teal: "#39c5cf", pink: "#d2a8ff",
    },
    terminal: {
      origin: "--color-ansi-* from Primer", bg: "#0d1117", fg: "#f0f6fc",
      ansi: ["#2f3742", "#f0883e", "#58a6ff", "#d29922", "#58a6ff", "#be8fff", "#39c5cf", "#f0f6fc", "#656c76", "#ffa657", "#79c0ff", "#e3b341", "#79c0ff", "#d2a8ff", "#56d4dd", "#ffffff"],
    },
    diff: { add: "rgba(88, 166, 255, 0.15)", del: "rgba(219, 109, 40, 0.16)" },
  },
];

export const DEFAULT_DARK = "darcula";
export const DEFAULT_LIGHT = "jetbrains-light";

export function themeById(id: string): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
