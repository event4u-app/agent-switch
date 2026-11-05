/**
 * `agent-switch claude-settings` — manage ~/.claude/settings.json once and
 * apply it to every Claude profile (src/claude-settings.ts has the merge).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { configDir, die, listProfiles } from "../profiles.js";
import { masked, mergeSettings, parsePath, profileExtras, readJson, setPath, shareable, SNAPSHOT, syncProfileSettings, toggleListEntries, withLock, writeGlobal, type SettingsJson, type SettingsObj, type SyncResult } from "../claude-settings.js";
import { CLAUDE_HOME } from "./shared.js";

export const GLOBAL_SETTINGS = path.join(CLAUDE_HOME, "settings.json");
const LISTS = new Set(["allow", "deny", "ask"]);
const USAGE = "usage: agent-switch claude-settings [status|sync|set <path> <json>|unset <path>|rule allow|deny|ask <rule>… on|off] [--json]";

/** Apply the global settings to every Claude profile; returns name → result. Never throws. */
export function syncAllClaudeSettings(globalFile = GLOBAL_SETTINGS): { name: string; result: SyncResult | "error"; error?: string }[] {
  return listProfiles("claude").map((name) => {
    try {
      return { name, result: syncProfileSettings(globalFile, configDir("claude", name)) };
    } catch (e) {
      return { name, result: "error" as const, error: (e as Error).message };
    }
  });
}

function status(globalFile: string) {
  const exists = fs.existsSync(globalFile);
  const global = exists ? readJson(globalFile) : null;
  const { value, withheld } = shareable(global ?? {});
  const profiles = listProfiles("claude").map((name) => {
    const dir = configDir("claude", name);
    const file = path.join(dir, "settings.json");
    try {
      if (fs.lstatSync(file).isSymbolicLink()) return { name, state: "linked", extras: [] as string[] };
    } catch {
      /* absent */
    }
    const own = fs.existsSync(file) ? readJson(file) : {};
    if (own === null) return { name, state: "invalid", extras: [] };
    const merged = mergeSettings(value, own, readJson(path.join(dir, SNAPSHOT))).value;
    return { name, state: JSON.stringify(merged) === JSON.stringify(own) ? "in-sync" : "pending", extras: profileExtras(own, value) };
  });
  // Account-scoped values are masked: the app shows this file, and screens get shared.
  return { file: globalFile, exists, valid: !exists || global !== null, settings: masked(global ?? {}), withheld, profiles };
}

function parseValue(raw: string | undefined): SettingsJson {
  if (raw === undefined) die("usage: agent-switch claude-settings set <path> <json-value>");
  try {
    return JSON.parse(raw);
  } catch {
    return raw; // a bare word is a string: `set model opus`
  }
}

function pathArg(raw: string | undefined, usage: string): string[] {
  if (!raw) die(usage);
  try {
    return parsePath(raw);
  } catch (e) {
    die((e as Error).message);
  }
}

function report(rows: ReturnType<typeof syncAllClaudeSettings>): void {
  for (const r of rows) console.log(`  ${r.name}: ${r.result}${r.error ? ` (${r.error})` : ""}`);
}

export function cmdClaudeSettings(sub: string | undefined, args: string[], flags: Record<string, string | boolean>, globalFile = GLOBAL_SETTINGS): void {
  const json = !!flags.json;
  if (sub === undefined || sub === "status") {
    const s = status(globalFile);
    if (json) return void console.log(JSON.stringify(s));
    console.log(`${s.file}${s.exists ? "" : " (missing)"}${s.valid ? "" : " — not valid JSON"}`);
    if (s.withheld.length) console.log(`  kept out of profiles (account-scoped): ${s.withheld.join(", ")}`);
    for (const p of s.profiles) console.log(`  ${p.name}: ${p.state}${p.extras.length ? ` · own: ${p.extras.join(", ")}` : ""}`);
    return;
  }
  if (sub === "sync") {
    const rows = syncAllClaudeSettings(globalFile);
    if (json) return void console.log(JSON.stringify({ profiles: rows }));
    console.log(`Applied ${globalFile} to every Claude profile:`);
    return report(rows);
  }

  let change: (current: SettingsObj) => SettingsObj;
  if (sub === "set") {
    const at = pathArg(args[0], "usage: agent-switch claude-settings set <path> <json-value>");
    const value = parseValue(args[1]);
    change = (c) => setPath(c, at, value);
  } else if (sub === "unset") {
    const at = pathArg(args[0], "usage: agent-switch claude-settings unset <path>");
    change = (c) => setPath(c, at, undefined);
  } else if (sub === "rule") {
    const list = args[0];
    const onOff = args[args.length - 1];
    const rules = args.slice(1, -1);
    if (!list || !LISTS.has(list) || rules.length === 0 || (onOff !== "on" && onOff !== "off")) die("usage: agent-switch claude-settings rule allow|deny|ask <rule>… on|off");
    change = (c) => toggleListEntries(c, ["permissions", list], rules, onOff === "on");
  } else die(USAGE);

  // Read, change and write under one lock, so two quick edits cannot overwrite each other.
  const written = withLock(globalFile, () => {
    const current = fs.existsSync(globalFile) ? readJson(globalFile) : {};
    if (current === null) return false;
    writeGlobal(globalFile, change(current));
    return true;
  });
  if (!written) die(`${globalFile} is not valid JSON — fix it first, nothing was changed`);
  const rows = syncAllClaudeSettings(globalFile);
  if (json) return void console.log(JSON.stringify({ profiles: rows }));
  console.log(`Updated ${globalFile}; applied to every Claude profile:`);
  report(rows);
}
