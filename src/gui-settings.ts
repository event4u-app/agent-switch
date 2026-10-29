/**
 * GUI preferences that must outlive the webview's `localStorage` — the Pet
 * intro once-flag (D36) and the launch-at-login preference. The GUI can only
 * reach the filesystem through this CLI, so it reads and writes them with
 * `agent-switch gui-settings`; `doctor` reads the autostart preference from the
 * same file.
 *
 * Additive file (`<ROOT>/gui-settings.json`): absent keys mean "never decided",
 * so an upgrade starts with nothing stored and the GUI migrates its old
 * `localStorage` flags in once.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { ROOT, ensureRoot } from "./profiles.js";

export const GUI_SETTINGS_FILE = path.join(ROOT, "gui-settings.json");

/**
 * Launch-at-login preference. `unset` = nobody decided yet (the first-run
 * default may still apply). Only `user` can choose `disabled`, and a stored
 * choice is never overwritten by the first-run default.
 */
export type AutostartPref =
  | { state: "unset" }
  | { state: "enabled"; by: "first-run" | "user"; at: string }
  | { state: "disabled"; by: "user"; at: string };

export interface GuiSettings {
  petWelcomed: boolean;
  autostart: AutostartPref;
  /** Set when the first-run enable could not be confirmed with the OS; the GUI
   *  retries on the next launch and shows the state as `degraded`. */
  autostartDegraded: { at: string; reason: string } | null;
}

function normalizeAutostart(raw: unknown): AutostartPref {
  const r = (raw ?? {}) as Record<string, unknown>;
  const at = typeof r.at === "string" ? r.at : "";
  if (r.state === "enabled" && (r.by === "first-run" || r.by === "user")) return { state: "enabled", by: r.by, at };
  if (r.state === "disabled" && r.by === "user") return { state: "disabled", by: "user", at };
  return { state: "unset" };
}

export function readGuiSettings(file: string = GUI_SETTINGS_FILE): GuiSettings {
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8")) ?? {};
  } catch {
    /* absent / unparsable → nothing decided */
  }
  const d = raw.autostartDegraded as Record<string, unknown> | null | undefined;
  return {
    petWelcomed: raw.petWelcomed === true,
    autostart: normalizeAutostart(raw.autostart),
    autostartDegraded:
      d && typeof d === "object" && typeof d.reason === "string"
        ? { at: typeof d.at === "string" ? d.at : "", reason: d.reason }
        : null,
  };
}

export function writeGuiSettings(next: GuiSettings, file: string = GUI_SETTINGS_FILE): void {
  if (file === GUI_SETTINGS_FILE) ensureRoot();
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export type GuiSettingUpdate =
  | { key: "pet-welcomed" }
  | { key: "autostart"; state: "enabled" | "disabled"; by: "first-run" | "user" }
  | { key: "autostart-degraded"; reason: string | null };

/**
 * Apply one update. Guards the two invariants the roadmap pins: the pet intro
 * flag only ever goes false → true, and a first-run default never replaces a
 * stored choice (only `by: "user"` may overwrite one).
 */
export function applyGuiSetting(cur: GuiSettings, u: GuiSettingUpdate, now: Date = new Date()): GuiSettings {
  const at = now.toISOString();
  if (u.key === "pet-welcomed") return { ...cur, petWelcomed: true };
  if (u.key === "autostart-degraded") {
    return { ...cur, autostartDegraded: u.reason ? { at, reason: u.reason } : null };
  }
  if (u.state === "disabled" && u.by !== "user") throw new Error("only the user can turn launch-at-login off");
  if (u.by === "first-run" && cur.autostart.state !== "unset") return cur;
  const autostart: AutostartPref =
    u.state === "enabled" ? { state: "enabled", by: u.by, at } : { state: "disabled", by: "user", at };
  return { ...cur, autostart, autostartDegraded: null };
}
