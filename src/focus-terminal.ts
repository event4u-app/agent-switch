/**
 * "Focus terminal" for a session running in the user's own terminal (spec §6.5,
 * road-to-agent-switch-v3-central Phase 5): find the session's process, its
 * tty, and the terminal tab that owns that tty, and bring it to the front.
 * macOS only (Terminal.app and iTerm2, through AppleScript). When macOS refuses
 * the Automation permission (error -1743) the user is told how to allow it —
 * the error is explained, never swallowed.
 */

import { spawnSync } from "node:child_process";

export class FocusFailed extends Error {
  constructor(message: string, readonly fix?: string) {
    super(message);
  }
}

/** `/dev/ttys003` for a pid, or null. */
export function ttyOf(pid: number): string | null {
  const r = spawnSync("ps", ["-o", "tty=", "-p", String(pid)], { encoding: "utf8", timeout: 1000 });
  const t = (r.stdout ?? "").trim();
  return t && t !== "??" && t !== "?" ? (t.startsWith("/dev/") ? t : `/dev/${t}`) : null;
}

/** The terminal a session runs in: its name as the user knows it, and the app
 *  "Focus terminal" can drive (Terminal.app and iTerm2 only), else null. */
export interface TerminalApp {
  name: string;
  app: "Terminal" | "iTerm2" | null;
}

/** Process names (`comm`) of the terminals people run agents in, first match wins.
 *  An editor's terminal names the editor; the user's own tmux names tmux, whose
 *  server is not a child of the terminal it is shown in. */
const TERMINALS: [RegExp, TerminalApp][] = [
  [/Terminal\.app|\/Terminal$/, { name: "Terminal.app", app: "Terminal" }],
  [/iTerm/, { name: "iTerm2", app: "iTerm2" }],
  [/Ghostty|(^|\/)ghostty$/, { name: "Ghostty", app: null }],
  [/Warp\.app/, { name: "Warp", app: null }],
  [/WezTerm|(^|\/)wezterm-gui$/, { name: "WezTerm", app: null }],
  [/kitty/, { name: "kitty", app: null }],
  [/Alacritty|(^|\/)alacritty$/, { name: "Alacritty", app: null }],
  [/Hyper\.app/, { name: "Hyper", app: null }],
  [/Visual Studio Code|Code Helper|(^|\/)code$/, { name: "VS Code", app: null }],
  [/Cursor\.app|Cursor Helper/, { name: "Cursor", app: null }],
  [/gnome-terminal/, { name: "GNOME Terminal", app: null }],
  [/konsole/, { name: "Konsole", app: null }],
  [/xfce4-terminal/, { name: "Xfce Terminal", app: null }],
  [/(^|\/)tmux/, { name: "tmux", app: null }],
];

function psLine(pid: number): string {
  return spawnSync("ps", ["-o", "ppid=,comm=", "-p", String(pid)], { encoding: "utf8", timeout: 1000 }).stdout ?? "";
}

/** Walk up from `pid` to the terminal that owns it. `ps` answers "ppid comm" for one pid (tests stub it). */
export function terminalOf(pid: number, ps: (pid: number) => string = psLine): TerminalApp | null {
  let cur = pid;
  for (let i = 0; i < 12 && cur > 1; i++) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(ps(cur).trim());
    if (!m) return null;
    const hit = TERMINALS.find(([re]) => re.test(m[2]));
    if (hit) return { ...hit[1] };
    cur = Number(m[1]);
  }
  return null;
}

/** The AppleScript that selects the tab owning `tty`. Pure; the tty is checked before it is put in. */
export function focusScript(app: "Terminal" | "iTerm2", tty: string): string {
  if (!/^\/dev\/ttys?\d{1,4}$/.test(tty)) throw new FocusFailed(`not a terminal device: ${tty}`);
  if (app === "Terminal") {
    return `tell application "Terminal"
  repeat with w in windows
    repeat with t in tabs of w
      if tty of t is "${tty}" then
        set selected of t to true
        set index of w to 1
        activate
        return "ok"
      end if
    end repeat
  end repeat
end tell
return "not found"`;
  }
  return `tell application "iTerm2"
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        if tty of s is "${tty}" then
          select t
          select s
          tell w to select
          activate
          return "ok"
        end if
      end repeat
    end repeat
  end repeat
end tell
return "not found"`;
}

/** osascript output → done, or a FocusFailed that says why and how to fix it. Pure. */
export function interpret(status: number | null, stdout: string, stderr: string, app: string): void {
  if (/-1743/.test(stderr)) {
    throw new FocusFailed(
      `macOS does not let Agent Switch control ${app} yet (error -1743)`,
      `System Settings › Privacy & Security › Automation › allow Agent Switch (or your terminal) to control ${app}`,
    );
  }
  if (status !== 0) throw new FocusFailed(`${app} could not be asked: ${stderr.trim().split("\n")[0] || `exit ${status}`}`);
  if (stdout.trim() !== "ok") throw new FocusFailed(`no ${app} tab owns that terminal any more`);
}

export function focusSession(pid: number): { app: string; tty: string } {
  if (process.platform !== "darwin") throw new FocusFailed("focusing a terminal tab works on macOS only");
  const tty = ttyOf(pid);
  if (!tty) throw new FocusFailed("the session has no terminal (it may run in an app or in the background)");
  const found = terminalOf(pid);
  const app = found?.app;
  if (!app) throw new FocusFailed(`the session runs in ${found ? found.name : "a terminal"}, which Agent Switch cannot focus (Terminal.app and iTerm2 are supported)`);
  const r = spawnSync("osascript", ["-e", focusScript(app, tty)], { encoding: "utf8", timeout: 5000 });
  interpret(r.status, r.stdout ?? "", r.stderr ?? "", app);
  return { app, tty };
}
