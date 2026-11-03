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

/** Walk up from `pid` to the terminal app that owns it. */
export function terminalAppOf(pid: number): "Terminal" | "iTerm2" | null {
  let cur = pid;
  for (let i = 0; i < 12 && cur > 1; i++) {
    const r = spawnSync("ps", ["-o", "ppid=,comm=", "-p", String(cur)], { encoding: "utf8", timeout: 1000 });
    const m = /^\s*(\d+)\s+(.*)$/.exec((r.stdout ?? "").trim());
    if (!m) return null;
    if (/Terminal\.app|\/Terminal$/.test(m[2])) return "Terminal";
    if (/iTerm/.test(m[2])) return "iTerm2";
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
  const app = terminalAppOf(pid);
  if (!app) throw new FocusFailed("the session runs in a terminal Agent Switch cannot focus (Terminal.app and iTerm2 are supported)");
  const r = spawnSync("osascript", ["-e", focusScript(app, tty)], { encoding: "utf8", timeout: 5000 });
  interpret(r.status, r.stdout ?? "", r.stderr ?? "", app);
  return { app, tty };
}
