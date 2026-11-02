/**
 * Whether the app window is shown, as the app last said (`agent-switch
 * app-visibility visible|hidden`). Background work the user only sees in the
 * app — the PR refresh — pauses while it is hidden. No app, or a report older
 * than the window below, counts as visible, so the CLI and the tray keep working.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/** A "hidden" older than this is not trusted: the app may have crashed hidden. */
export const VISIBILITY_TTL_MS = 30 * 60_000;

export function visibilityFile(root: string): string {
  return path.join(root, "app-visibility.json");
}

export function writeVisibility(file: string, visible: boolean, now = new Date()): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify({ visible, at: now.toISOString() }) + "\n", { mode: 0o600 });
}

export function appHidden(file: string, nowMs = Date.now()): boolean {
  try {
    const o = JSON.parse(fs.readFileSync(file, "utf8"));
    return o.visible === false && nowMs - Date.parse(o.at) < VISIBILITY_TTL_MS;
  } catch {
    return false;
  }
}
