/**
 * The terminal app agent-switch opens (road-to-a-chat-that-reads-well Phase 4).
 * Detection follows `browsers.ts`: macOS app bundles, PATH binaries elsewhere.
 * Every plan is a program with an argv — never a shell line and never a URL
 * scheme. Verified live on macOS 26 for Terminal and iTerm2 (AppleScript);
 * the other argv follow each terminal's documented CLI and are not exercised
 * by this repository's CI.
 */

import type { Env } from "./open-in.js";

export type TerminalId = "terminal" | "iterm" | "ghostty" | "warp" | "wezterm" | "kitty" | "alacritty" | "gnome-terminal" | "konsole" | "xfce4-terminal" | "x-terminal-emulator";

interface Def {
  id: TerminalId;
  name: string;
  /** macOS bundle names, tried in order. */
  mac?: string[];
  /** The binary on PATH (Linux, or a macOS CLI). */
  bin?: string;
}

const DEFS: Def[] = [
  { id: "terminal", name: "Terminal", mac: ["Terminal"] },
  { id: "iterm", name: "iTerm2", mac: ["iTerm"] },
  { id: "ghostty", name: "Ghostty", mac: ["Ghostty"], bin: "ghostty" },
  { id: "warp", name: "Warp", mac: ["Warp"] },
  { id: "wezterm", name: "WezTerm", mac: ["WezTerm"], bin: "wezterm" },
  { id: "kitty", name: "kitty", mac: ["kitty"], bin: "kitty" },
  { id: "alacritty", name: "Alacritty", mac: ["Alacritty"], bin: "alacritty" },
  { id: "gnome-terminal", name: "GNOME Terminal", bin: "gnome-terminal" },
  { id: "konsole", name: "Konsole", bin: "konsole" },
  { id: "xfce4-terminal", name: "Xfce Terminal", bin: "xfce4-terminal" },
  { id: "x-terminal-emulator", name: "System terminal", bin: "x-terminal-emulator" },
];

export const TERMINAL_IDS: readonly TerminalId[] = DEFS.map((d) => d.id);

export interface TerminalInfo {
  id: TerminalId;
  name: string;
  installed: boolean;
}

const def = (id: TerminalId) => DEFS.find((d) => d.id === id)!;

/** Where `id` lives here: a macOS bundle name, a binary path, or null. Pure given `env`. */
function locate(id: TerminalId, env: Env): { app: string | null; bin: string | null } {
  const d = def(id);
  if (env.platform === "darwin") {
    // Terminal.app ships with macOS; it lives under /System, which macApp does not search.
    if (id === "terminal") return { app: "Terminal", bin: null };
    for (const name of d.mac ?? []) if (env.macApp(name)) return { app: name, bin: null };
    return { app: null, bin: null };
  }
  if (env.platform === "win32") return { app: null, bin: null };
  return { app: null, bin: d.bin ? env.onPath(d.bin) : null };
}

/** Every terminal this platform knows, with whether it is installed. Pure given `env`. */
export function terminals(env: Env): TerminalInfo[] {
  return DEFS.filter((d) => (env.platform === "darwin" ? !!d.mac : env.platform !== "win32" && !!d.bin)).map((d) => {
    const l = locate(d.id, env);
    return { id: d.id, name: d.name, installed: !!(l.app || l.bin) };
  });
}

/** The chosen terminal when it is installed, else the platform's first installed one. Pure given `env`. */
export function pickTerminal(chosen: TerminalId | null | undefined, env: Env): TerminalId | null {
  const list = terminals(env).filter((t) => t.installed);
  return list.find((t) => t.id === chosen)?.id ?? list[0]?.id ?? null;
}

export interface TermPlan {
  program: string;
  args: string[];
}

/** AppleScript string literal. */
const as = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
/** POSIX single quote, for the one shell line a terminal is asked to run. */
const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Open a new window of `id` in `dir`, or null when it is not installed. Pure given `env`. */
export function openDirPlan(id: TerminalId, dir: string, env: Env): TermPlan | null {
  const l = locate(id, env);
  if (!l.app && !l.bin) return null;
  if (l.app) {
    if (id === "ghostty") return { program: "open", args: ["-na", l.app, "--args", `--working-directory=${dir}`] };
    if (id === "wezterm") return { program: "open", args: ["-na", l.app, "--args", "start", "--cwd", dir] };
    if (id === "kitty") return { program: "open", args: ["-na", l.app, "--args", "--directory", dir] };
    if (id === "alacritty") return { program: "open", args: ["-na", l.app, "--args", "--working-directory", dir] };
    // Terminal, iTerm2 and Warp open a folder handed to them as a new window there.
    return { program: "open", args: ["-a", l.app, dir] };
  }
  const bin = l.bin!;
  if (id === "konsole") return { program: bin, args: ["--workdir", dir] };
  if (id === "wezterm") return { program: bin, args: ["start", "--cwd", dir] };
  if (id === "kitty") return { program: bin, args: ["--directory", dir] };
  if (id === "alacritty" || id === "ghostty") return { program: bin, args: [`--working-directory=${dir}`] };
  return { program: bin, args: [`--working-directory=${dir}`] };
}

/**
 * Run `command` (one shell line agent-switch built) in a new window of `id`,
 * starting in `dir`. Null when `id` cannot be asked to run a command (Warp has
 * no such CLI) or is not installed — the caller then uses another terminal or
 * prints the line. Pure given `env`.
 */
export function runPlan(id: TerminalId, dir: string, command: string, env: Env): TermPlan | null {
  const l = locate(id, env);
  if (!l.app && !l.bin) return null;
  const line = `cd ${sq(dir)} && ${command}`;
  if (id === "terminal") return { program: "osascript", args: ["-e", `tell application "Terminal"\nactivate\ndo script ${as(line)}\nend tell`] };
  if (id === "iterm") return { program: "osascript", args: ["-e", `tell application "iTerm"\nactivate\ncreate window with default profile command ${as(`/bin/sh -c ${sq(line)}`)}\nend tell`] };
  if (id === "warp") return null;
  const sh = ["/bin/sh", "-c", line];
  if (l.app) {
    if (id === "ghostty") return { program: "open", args: ["-na", l.app, "--args", `--working-directory=${dir}`, "-e", ...sh] };
    if (id === "wezterm") return { program: "open", args: ["-na", l.app, "--args", "start", "--cwd", dir, "--", ...sh] };
    if (id === "kitty") return { program: "open", args: ["-na", l.app, "--args", "--directory", dir, ...sh] };
    if (id === "alacritty") return { program: "open", args: ["-na", l.app, "--args", "--working-directory", dir, "-e", ...sh] };
    return null;
  }
  const bin = l.bin!;
  if (id === "konsole") return { program: bin, args: ["--workdir", dir, "-e", ...sh] };
  if (id === "wezterm") return { program: bin, args: ["start", "--cwd", dir, "--", ...sh] };
  if (id === "kitty") return { program: bin, args: ["--directory", dir, ...sh] };
  if (id === "alacritty" || id === "ghostty") return { program: bin, args: [`--working-directory=${dir}`, "-e", ...sh] };
  if (id === "gnome-terminal") return { program: bin, args: [`--working-directory=${dir}`, "--", ...sh] };
  return { program: bin, args: [`--working-directory=${dir}`, "-e", ...sh] };
}

export const terminalName = (id: TerminalId) => def(id).name;
