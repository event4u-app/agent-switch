/**
 * Best-effort OS desktop notifications for the background daemon, so an
 * auto-switch is visible even when the GUI is closed. Per-platform native
 * command, no external dependency:
 *   - macOS   → `osascript -e 'display notification …'`
 *   - Linux   → `notify-send <title> <body>`
 *   - Windows → PowerShell balloon tip via System.Windows.Forms.NotifyIcon
 *
 * `buildOsNotifyCommand` is pure (command construction only) so it is unit
 * testable; `osNotify` wraps it with a fire-and-forget spawn that never throws.
 */

import { spawnSync } from "node:child_process";

export interface OsNotifyCommand {
  program: string;
  args: string[];
}

/** AppleScript string literal escaping: backslash and double-quote only. */
function escAppleScript(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** PowerShell single-quoted string literal escaping: double the single quote. */
function escPowerShellSingle(s: string): string {
  return s.replace(/'/g, "''");
}

/**
 * Build the native notify command for a platform, or null when unsupported.
 * `platform` matches `process.platform` values (`darwin` / `linux` / `win32`).
 */
export function buildOsNotifyCommand(platform: string, title: string, body: string): OsNotifyCommand | null {
  if (platform === "darwin") {
    const script = `display notification "${escAppleScript(body)}" with title "${escAppleScript(title)}"`;
    return { program: "osascript", args: ["-e", script] };
  }
  if (platform === "linux") {
    // notify-send treats the first arg as summary, the second as body.
    return { program: "notify-send", args: [title, body] };
  }
  if (platform === "win32") {
    const t = escPowerShellSingle(title);
    const b = escPowerShellSingle(body);
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms;",
      "$n = New-Object System.Windows.Forms.NotifyIcon;",
      "$n.Icon = [System.Drawing.SystemIcons]::Information;",
      "$n.Visible = $true;",
      `$n.ShowBalloonTip(5000, '${t}', '${b}', [System.Windows.Forms.ToolTipIcon]::Info);`,
      "Start-Sleep -Milliseconds 6000; $n.Dispose();",
    ].join(" ");
    return { program: "powershell", args: ["-NoProfile", "-Command", script] };
  }
  return null;
}

/**
 * Fire a desktop notification via the OS. Returns true when the command was
 * dispatched successfully, false on an unsupported platform or any failure
 * (the caller treats a false as "not shown" and leaves the in-app log as the
 * record). Never throws.
 */
export function osNotify(title: string, body: string, platform: string = process.platform): boolean {
  const cmd = buildOsNotifyCommand(platform, title, body);
  if (!cmd) return false;
  try {
    const r = spawnSync(cmd.program, cmd.args, { stdio: "ignore", timeout: 10_000 });
    return r.status === 0;
  } catch {
    return false;
  }
}
