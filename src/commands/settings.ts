/**
 * Notification and preference commands: notify, os-notify, keep-signed-in,
 * notifications, gui-settings, activity.
 */

import { die, readOsNotifications, setOsNotifications, readKeepSignedIn, setKeepSignedIn } from "../profiles.js";
import { readActivity, ACTIVITY_MAX_LINES } from "../activity.js";
import { readGuiSettings, writeGuiSettings, applyGuiSetting, type GuiSettingUpdate } from "../gui-settings.js";
import { appendNotification, readNotifications, clearNotifications, NotificationKind } from "../notifications.js";
import { logActivity } from "./shared.js";

const NOTIFICATION_KINDS: NotificationKind[] = ["success", "error", "warning", "info"];

/** `agent-switch notify --kind <k> --title <t> --message <m> [--json]` — record
 *  an event in the shared notification log. The GUI uses this for its own
 *  limit-fetch failures; the daemon appends directly via the module. `--json`
 *  echoes the created notification (or `null` when it was deduplicated). */
export function cmdNotify(flags: Record<string, string | boolean>): void {
  const kind = typeof flags.kind === "string" ? flags.kind : "info";
  const title = typeof flags.title === "string" ? flags.title : "";
  const message = typeof flags.message === "string" ? flags.message : "";
  if (!NOTIFICATION_KINDS.includes(kind as NotificationKind)) {
    die(`usage: agent-switch notify --kind <${NOTIFICATION_KINDS.join("|")}> --title <t> --message <m> [--json]`);
  }
  if (!title && !message) die("agent-switch notify needs at least --title or --message");
  // --repeat: each occurrence is its own moment (a session waiting again), so
  // an identical notice is not collapsed into the last one.
  const created = appendNotification({ kind: kind as NotificationKind, title, message }, undefined, undefined, !flags.repeat);
  if (flags.json) console.log(JSON.stringify(created));
}

/** `agent-switch os-notify [on|off|status] [--json]` — toggle whether the
 *  background daemon fires OS desktop notifications itself (for timeliness when
 *  the GUI is closed). Default off. */
export function cmdOsNotify(sub: string | undefined, json = false): void {
  if (sub === "on" || sub === "off") setOsNotifications(sub === "on");
  else if (sub && sub !== "status") die("usage: agent-switch os-notify [on|off|status] [--json]");
  const enabled = readOsNotifications();
  if (json) console.log(JSON.stringify({ enabled }));
  else {
    console.log(`Daemon OS notifications ${enabled ? "ON" : "OFF"}.`);
    if (enabled && process.platform === "darwin") console.log("On macOS the daemon shows none itself — the Agent Switch app shows them while it runs.");
  }
}

/** `agent-switch keep-signed-in [on|off|status] [--json]` — whether the
 *  service lets Claude Code refresh a lapsed login (token-freshen.ts). Default
 *  on; Claude only — Codex and Antigravity refresh only when their own CLI runs. */
export function cmdKeepSignedIn(sub: string | undefined, json = false): void {
  if (sub === "on" || sub === "off") {
    const on = sub === "on";
    if (readKeepSignedIn() !== on) {
      setKeepSignedIn(on);
      logActivity("settings", null, `keep accounts signed in ${on ? "on" : "off"}`, "user changed it");
    }
  } else if (sub && sub !== "status") die("usage: agent-switch keep-signed-in [on|off|status] [--json]");
  const enabled = readKeepSignedIn();
  if (json) console.log(JSON.stringify({ enabled }));
  else console.log(`Keep accounts signed in ${enabled ? "ON" : "OFF"} (Claude accounts; needs the background service).`);
}

/** `agent-switch notifications [clear] [--json]` — list the recent
 *  notifications (newest first) or clear the log. */
export function cmdNotifications(sub: string | undefined, json = false): void {
  if (sub === "clear") {
    clearNotifications();
    console.log(json ? "[]" : "Notifications cleared.");
    return;
  }
  const list = [...readNotifications()].reverse(); // newest first
  if (json) {
    console.log(JSON.stringify(list));
    return;
  }
  if (list.length === 0) {
    console.log("No notifications.");
    return;
  }
  for (const n of list) {
    const when = new Date(n.ts).toLocaleString();
    console.log(`[${when}] ${n.kind.toUpperCase()} ${n.title}${n.message ? ` — ${n.message}` : ""}`);
  }
}

/** `gui-settings [--json]` · `gui-settings set pet-welcomed` ·
 *  `gui-settings set autostart enabled|disabled --by first-run|user` ·
 *  `gui-settings set autostart-degraded --reason <text>|none`. The GUI's
 *  file-backed preferences (see gui-settings.ts); prints the result as JSON. */
export function cmdGuiSettings(sub: string | undefined, args: string[], flags: Record<string, string | boolean>): void {
  const usageLine = "usage: agent-switch gui-settings [--json] | gui-settings set pet-welcomed | set autostart enabled|disabled --by first-run|user | set autostart-degraded --reason <text>|none";
  if (sub === undefined || sub === "get" || sub === "status") {
    console.log(JSON.stringify(readGuiSettings(), null, 2));
    return;
  }
  if (sub !== "set") die(usageLine);
  const [key, value] = args;
  let u: GuiSettingUpdate;
  if (key === "pet-welcomed") u = { key };
  else if (key === "autostart" && (value === "enabled" || value === "disabled")) {
    const by = flags.by === "first-run" || flags.by === "user" ? flags.by : die(usageLine);
    u = { key, state: value, by };
  } else if (key === "autostart-degraded") {
    const reason = typeof flags.reason === "string" ? flags.reason : die(usageLine);
    u = { key, reason: reason === "none" ? null : reason };
  } else die(usageLine);
  const before = readGuiSettings();
  let after;
  try {
    after = applyGuiSetting(before, u);
  } catch (e) {
    die((e as Error).message);
  }
  writeGuiSettings(after);
  if (u.key === "autostart" && JSON.stringify(after.autostart) !== JSON.stringify(before.autostart)) {
    logActivity("autostart", null, `start at login ${u.state}`, u.by === "user" ? "user changed it in the desktop app" : "first-run default, confirmed with the OS");
  }
  if (u.key === "autostart-degraded" && u.reason) {
    logActivity("autostart", null, "start at login could not be confirmed", "first-run default; retried next launch", false);
  }
  console.log(JSON.stringify(after, null, 2));
}

export function cmdActivity(flags: Record<string, string | boolean>): void {
  const limit = typeof flags.limit === "string" ? Number(flags.limit) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) die("--limit must be a whole number of at least 1");
  const entries = readActivity(limit ?? (flags.json ? undefined : 50));
  if (flags.json) {
    console.log(JSON.stringify({ entries, capacity: ACTIVITY_MAX_LINES }, null, 2));
    return;
  }
  if (entries.length === 0) {
    console.log("No activity recorded yet.");
    return;
  }
  for (const e of entries) {
    console.log(`${e.at}  ${e.ok ? " " : "!"} ${e.kind.padEnd(10)} ${e.target ?? "-"}  ${e.action} — ${e.reason}`);
  }
}
