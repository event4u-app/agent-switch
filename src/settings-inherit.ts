/**
 * Seed a Claude profile's permission allowlist from the user's GLOBAL Claude
 * settings (~/.claude/settings.json).
 *
 * agent-switch runs each profile under its own CLAUDE_CONFIG_DIR, so Claude Code
 * reads THAT profile's settings.json and never the global one. A freshly-`add`ed
 * profile therefore starts with none of the globally-approved command
 * permissions and re-prompts for each (`import` is unaffected — it copies the
 * whole ~/.claude, settings.json included). This copies (unions) the global
 * `permissions` into a profile — at create time, and via a backfill command for
 * existing profiles.
 *
 * Scope: ONLY `permissions` is inherited. Hooks are managed per-profile by
 * hooks.ts; theme / model / statusLine are deliberately profile-own. The global
 * file is only ever READ here — it is never modified, so a profile can never
 * clobber the source allowlist (unlike a shared symlink + `share sync`).
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { readSettings } from "./hooks.js";

type Settings = Record<string, any>;

export interface Permissions {
  allow?: string[];
  deny?: string[];
  ask?: string[];
  defaultMode?: string;
  [k: string]: unknown;
}

/** Union two string lists, global first, de-duplicated, order-preserving. */
function union(a: string[] = [], b: string[] = []): string[] {
  return [...new Set([...a, ...b])];
}

/**
 * Pure merge: the profile's permissions with the global allow/deny/ask lists
 * unioned in. A profile's own grants are never dropped; a profile scalar
 * (`defaultMode`) wins over the global. Returns null when the global carries no
 * permissions to inherit (caller then leaves the profile untouched).
 */
export function mergePermissions(
  globalPerms: Permissions | undefined,
  profilePerms: Permissions | undefined,
): Permissions | null {
  if (!globalPerms || typeof globalPerms !== "object") return null;
  // Nothing to inherit unless the global actually carries a grant list.
  const globalHasGrants =
    (globalPerms.allow?.length ?? 0) + (globalPerms.deny?.length ?? 0) + (globalPerms.ask?.length ?? 0) > 0;
  if (!globalHasGrants) return null;
  const p = profilePerms && typeof profilePerms === "object" ? profilePerms : {};
  const merged: Permissions = { ...p };
  const allow = union(globalPerms.allow, p.allow);
  if (allow.length) merged.allow = allow;
  const deny = union(globalPerms.deny, p.deny);
  if (deny.length) merged.deny = deny;
  const ask = union(globalPerms.ask, p.ask);
  if (ask.length) merged.ask = ask;
  const defaultMode = p.defaultMode ?? globalPerms.defaultMode;
  if (defaultMode !== undefined) merged.defaultMode = defaultMode;
  return merged;
}

/** Pure: a NEW profile settings object with the global permissions inherited.
 *  Returns the input unchanged when there is nothing to inherit. */
export function withInheritedPermissions(profileSettings: Settings, globalSettings: Settings): Settings {
  const merged = mergePermissions(globalSettings?.permissions, profileSettings?.permissions);
  if (!merged) return profileSettings;
  return { ...profileSettings, permissions: merged };
}

export interface InheritResult {
  changed: boolean;
  /** allow-rule count on the profile AFTER the merge. */
  allowCount: number;
  /** how many allow rules the merge added to the profile. */
  addedAllow: number;
}

/**
 * Seed `profileConfigDir/settings.json` permissions from
 * `globalConfigDir/settings.json`. Reads both, writes only the profile. Degraded
 * mode: a missing/garbage global settings file → no-op (readSettings returns
 * {}). The global file is never written. Idempotent — a second run over an
 * already-seeded profile reports `changed: false`.
 */
export function inheritPermissions(profileConfigDir: string, globalConfigDir: string): InheritResult {
  const globalSettings = readSettings(globalConfigDir);
  const before = readSettings(profileConfigDir);
  const next = withInheritedPermissions(before, globalSettings);
  const afterAllow = ((next.permissions as Permissions | undefined)?.allow ?? []).length;
  const beforeAllow = ((before.permissions as Permissions | undefined)?.allow ?? []).length;
  if (JSON.stringify(next) === JSON.stringify(before)) {
    return { changed: false, allowCount: afterAllow, addedAllow: 0 };
  }
  fs.mkdirSync(profileConfigDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    path.join(profileConfigDir, "settings.json"),
    JSON.stringify(next, null, 2) + "\n",
    { mode: 0o600 },
  );
  return { changed: true, allowCount: afterAllow, addedAllow: afterAllow - beforeAllow };
}
