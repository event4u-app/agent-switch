/**
 * "Open in…" for a session (road-to-agent-switch-v3-central Phase 5, spec §7.7).
 *
 * Every target opens the session's worktree root (or one file in it) with the
 * tool's own launcher — never a URL scheme. Only the executables named below
 * are ever started, always with an argv, and only on a path that resolves
 * (symlinks included) inside the session's known folder. Targets that are not
 * installed are left out of the menu.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type TargetId = "vscode" | "cursor" | "phpstorm" | "idea" | "finder" | "terminal";
export const TARGET_IDS: readonly TargetId[] = ["vscode", "cursor", "phpstorm", "idea", "finder", "terminal"];

interface Launcher {
  /** A launcher on PATH, tried first. */
  cli?: string;
  /** macOS app bundle names, tried with `open -a` when no CLI is on PATH. */
  macApps?: string[];
  label: string;
  kind: "editor" | "files" | "terminal";
}

const LAUNCHERS: Record<TargetId, Launcher> = {
  vscode: { cli: "code", macApps: ["Visual Studio Code"], label: "VS Code", kind: "editor" },
  cursor: { cli: "cursor", macApps: ["Cursor"], label: "Cursor", kind: "editor" },
  phpstorm: { cli: "phpstorm", macApps: ["PhpStorm"], label: "PhpStorm", kind: "editor" },
  idea: { cli: "idea", macApps: ["IntelliJ IDEA", "IntelliJ IDEA CE", "IntelliJ IDEA Ultimate"], label: "IntelliJ IDEA", kind: "editor" },
  finder: { label: process.platform === "darwin" ? "Finder" : process.platform === "win32" ? "Explorer" : "Files", kind: "files" },
  terminal: { macApps: ["Terminal"], label: "Terminal", kind: "terminal" },
};

export interface Env {
  platform: NodeJS.Platform;
  onPath(cmd: string): string | null;
  macApp(name: string): string | null;
}

export const realEnv: Env = {
  platform: process.platform,
  onPath(cmd) {
    const r = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { encoding: "utf8" });
    return r.status === 0 ? r.stdout.split("\n")[0].trim() || null : null;
  },
  macApp(name) {
    for (const dir of ["/Applications", path.join(os.homedir(), "Applications"), "/Applications/JetBrains Toolbox"]) {
      const p = path.join(dir, `${name}.app`);
      if (fs.existsSync(p)) return p;
    }
    return null;
  },
};

export interface Plan {
  target: TargetId;
  program: string;
  args: string[];
}

export class OpenRefused extends Error {}

/** The folder a target may open: the canonical path, which must sit inside `root`. */
export function confine(root: string, wanted: string = root): string {
  const r = fs.realpathSync(root);
  const w = fs.realpathSync(path.resolve(r, wanted));
  if (w !== r && !w.startsWith(r + path.sep)) throw new OpenRefused(`${wanted} is outside the session's folder`);
  return w;
}

/**
 * How to open `dir` (optionally `file` at `line`) with `target`, or null when
 * that target is not installed. Pure given `env`.
 */
export function plan(target: TargetId, dir: string, env: Env, file?: string, line?: number): Plan | null {
  const l = LAUNCHERS[target];
  const at = file ? (line ? `${file}:${line}` : file) : null;
  if (target === "finder") {
    if (env.platform === "darwin") return { target, program: "open", args: file ? ["-R", file] : [dir] };
    if (env.platform === "win32") return { target, program: "explorer.exe", args: [file ? `/select,${file}` : dir] };
    return env.onPath("xdg-open") ? { target, program: "xdg-open", args: [dir] } : null;
  }
  if (target === "terminal") {
    if (env.platform === "darwin") return { target, program: "open", args: ["-a", "Terminal", dir] };
    for (const t of ["x-terminal-emulator", "gnome-terminal", "konsole"]) if (env.onPath(t)) return { target, program: t, args: t === "konsole" ? ["--workdir", dir] : [`--working-directory=${dir}`] };
    return null;
  }
  const cli = l.cli ? env.onPath(l.cli) : null;
  if (cli) {
    if (target === "vscode" || target === "cursor") return { target, program: cli, args: at ? [dir, "-g", at] : [dir] };
    return { target, program: cli, args: file && line ? [dir, "--line", String(line), file] : file ? [dir, file] : [dir] };
  }
  if (env.platform === "darwin") {
    for (const name of l.macApps ?? []) {
      if (env.macApp(name)) return { target, program: "open", args: ["-na", name, "--args", ...(file && line && target !== "vscode" && target !== "cursor" ? ["--line", String(line), file] : [dir])] };
    }
  }
  return null;
}

export interface MenuEntry {
  target: TargetId;
  label: string;
  kind: Launcher["kind"];
  installed: boolean;
}

/** Every target with whether it can open here. Pure given `env`. */
export function menu(env: Env, dir = "/"): MenuEntry[] {
  return TARGET_IDS.map((t) => ({ target: t, label: LAUNCHERS[t].label, kind: LAUNCHERS[t].kind, installed: plan(t, dir, env) !== null }));
}

// ---------- default and last used ----------

export interface OpenSettings {
  /** The global default target. */
  default: TargetId | null;
  /** Per repository (main checkout path) overrides. */
  perRepo: Record<string, TargetId>;
  lastUsed: TargetId | null;
}

export const openSettingsFile = (root: string) => path.join(root, "open-in.json");

export function readOpenSettings(file: string): OpenSettings {
  try {
    const o = JSON.parse(fs.readFileSync(file, "utf8"));
    const ok = (t: unknown): t is TargetId => typeof t === "string" && (TARGET_IDS as readonly string[]).includes(t);
    return {
      default: ok(o.default) ? o.default : null,
      perRepo: Object.fromEntries(Object.entries(o.perRepo ?? {}).filter(([, v]) => ok(v))) as Record<string, TargetId>,
      lastUsed: ok(o.lastUsed) ? o.lastUsed : null,
    };
  } catch {
    return { default: null, perRepo: {}, lastUsed: null };
  }
}

export function writeOpenSettings(file: string, s: OpenSettings): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n", { mode: 0o600 });
}

/** The target ⌘O opens: the repo's own default, else the global one, else the first installed editor. Pure. */
export function defaultTarget(s: OpenSettings, repo: string | null, installed: readonly MenuEntry[]): TargetId | null {
  const usable = (t: TargetId | null | undefined) => !!t && installed.some((e) => e.target === t && e.installed);
  if (repo && usable(s.perRepo[repo])) return s.perRepo[repo];
  if (usable(s.default)) return s.default;
  return installed.find((e) => e.kind === "editor" && e.installed)?.target ?? null;
}
