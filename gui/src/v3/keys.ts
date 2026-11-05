/**
 * The v3 keyboard (spec §12). One table of actions with default bindings, a
 * matcher, and the rule that app shortcuts never take a key the CLI needs while
 * the terminal has focus: on macOS ⌘ never reaches the terminal, so ⌘ keys stay
 * as they are; on Linux and Windows Ctrl is the CLI's own (Ctrl+C, Ctrl+R, …),
 * so there the app's keys become Ctrl+Shift+… while the terminal is focused.
 * Every binding can be changed; changes are stored next to the appearance.
 */

export type Action =
  | "palette"
  | "newSession"
  | "nextNeed"
  | "switcher"
  | "toggleSessions"
  | "toggleSummary"
  | "openDefault"
  | "moveSession"
  | "stopTurn"
  | "settings"
  | "close"
  | "reopenTab"
  | `tab${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`;

/** `mod` is ⌘ on macOS and Ctrl elsewhere. */
export interface Binding {
  key: string;
  mod?: boolean;
  shift?: boolean;
  ctrl?: boolean;
}

export const DEFAULT_KEYS: Record<Action, Binding> = {
  palette: { key: "k", mod: true },
  newSession: { key: "n", mod: true },
  nextNeed: { key: "j", mod: true },
  switcher: { key: "Tab", ctrl: true },
  toggleSessions: { key: "b", mod: true },
  toggleSummary: { key: "i", mod: true },
  openDefault: { key: "o", mod: true },
  moveSession: { key: "m", mod: true, shift: true },
  stopTurn: { key: ".", mod: true },
  settings: { key: ",", mod: true },
  close: { key: "Escape" },
  // Like a browser or an IDE: the last closed tab comes back.
  reopenTab: { key: "t", mod: true, shift: true },
  ...(Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`tab${i + 1}`, { key: String(i + 1), mod: true }])) as Record<`tab${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`, Binding>),
};

export interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * Does this keystroke trigger `b` here? Pure. While the terminal has focus off
 * macOS, a `mod` binding needs Shift as well, and Escape and Ctrl+Tab belong to
 * the terminal.
 */
export function matches(e: KeyLike, b: Binding, platform: "mac" | "other", terminalFocused: boolean): boolean {
  if (terminalFocused && (b.key === "Escape" || (b.ctrl && b.key === "Tab"))) return false;
  const sameKey = e.key.toLowerCase() === b.key.toLowerCase();
  if (!sameKey || e.altKey) return false;
  if (b.mod) {
    const mod = platform === "mac" ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
    const shiftWanted = !!b.shift || (platform === "other" && terminalFocused);
    return mod && e.shiftKey === shiftWanted;
  }
  if (b.ctrl) return e.ctrlKey && !e.metaKey && e.shiftKey === !!b.shift;
  return !e.ctrlKey && !e.metaKey && e.shiftKey === !!b.shift;
}

/** The action a keystroke triggers, or null. Pure. */
export function actionFor(e: KeyLike, keys: Record<Action, Binding>, platform: "mac" | "other", terminalFocused: boolean): Action | null {
  for (const [a, b] of Object.entries(keys) as [Action, Binding][]) if (matches(e, b, platform, terminalFocused)) return a;
  return null;
}

/** The label a button shows: "⌘K", "Ctrl+K", "Ctrl+Shift+K" while the terminal has focus. Pure. */
export function label(b: Binding, platform: "mac" | "other", terminalFocused = false): string {
  const k = b.key.length === 1 ? b.key.toUpperCase() : b.key === "Escape" ? "Esc" : b.key;
  if (platform === "mac") return `${b.ctrl ? "⌃" : ""}${b.shift ? "⇧" : ""}${b.mod ? "⌘" : ""}${k}`;
  const parts = [b.mod || b.ctrl ? "Ctrl" : null, b.shift || (b.mod && terminalFocused) ? "Shift" : null, k].filter(Boolean);
  return parts.join("+");
}

export const KEYS_STORAGE = "agent-switch-keys";

/** Defaults with the user's rebinds on top; a rebind that collides with another action is dropped. Pure. */
export function withRebinds(raw: string | null): Record<Action, Binding> {
  const keys = { ...DEFAULT_KEYS };
  if (!raw) return keys;
  let o: Partial<Record<Action, Binding>>;
  try {
    o = JSON.parse(raw);
  } catch {
    return keys; // a broken store keeps the defaults
  }
  const rebinds = (Object.entries(o ?? {}) as [Action, Binding][])
    .filter(([a, b]) => a in DEFAULT_KEYS && b && typeof b.key === "string" && b.key)
    .map(([a, b]) => [a, { key: b.key, mod: !!b.mod, shift: !!b.shift, ctrl: !!b.ctrl }] as const);
  // Two passes, so the order of the stored rebinds never matters: apply all,
  // then put back the defaults of every rebind that lands on another action's key.
  for (const [a, b] of rebinds) keys[a] = b;
  const id = (b: Binding) => `${b.key.toLowerCase()}|${!!b.mod}|${!!b.shift}|${!!b.ctrl}`;
  for (const [a, b] of rebinds) {
    if ((Object.entries(keys) as [Action, Binding][]).some(([other, ob]) => other !== a && id(ob) === id(b))) keys[a] = DEFAULT_KEYS[a];
  }
  return keys;
}
