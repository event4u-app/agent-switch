/**
 * `agent-switch claude-settings` — manage ~/.claude/settings.json once and
 * apply it to every Claude profile (src/claude-settings.ts has the merge).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { configDir, die, listProfiles } from "../profiles.js";
import { mergeSettings, profileExtras, readJson, setPath, shareable, SNAPSHOT, syncProfileSettings, toggleListEntry, writeGlobal, type SyncResult } from "../claude-settings.js";
import { CLAUDE_HOME } from "./shared.js";

export const GLOBAL_SETTINGS = path.join(CLAUDE_HOME, "settings.json");
const LISTS = new Set(["allow", "deny", "ask"]);

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
      if (exists && fs.existsSync(file) && fs.realpathSync(file) === fs.realpathSync(globalFile)) return { name, state: "linked", extras: [] as string[] };
    } catch {
      /* dangling */
    }
    const own = fs.existsSync(file) ? readJson(file) : {};
    if (own === null) return { name, state: "invalid", extras: [] };
    const merged = mergeSettings(value, own, readJson(path.join(dir, SNAPSHOT)));
    return { name, state: JSON.stringify(merged) === JSON.stringify(own) ? "in-sync" : "pending", extras: profileExtras(own, value) };
  });
  return { file: globalFile, exists, valid: !exists || global !== null, settings: global ?? {}, withheld, profiles };
}

function parseValue(raw: string | undefined): unknown {
  if (raw === undefined) die("usage: agent-switch claude-settings set <path> <json-value>");
  try {
    return JSON.parse(raw);
  } catch {
    return raw; // a bare word is a string: `set model opus`
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

  const current = fs.existsSync(globalFile) ? readJson(globalFile) : {};
  if (current === null) die(`${globalFile} is not valid JSON — fix it first, nothing was changed`);
  let next = current;
  if (sub === "set") next = setPath(current, args[0] ?? die("usage: agent-switch claude-settings set <path> <json-value>"), parseValue(args[1]) as never);
  else if (sub === "unset") next = setPath(current, args[0] ?? die("usage: agent-switch claude-settings unset <path>"), undefined);
  else if (sub === "rule") {
    const [list, rule, onOff] = args;
    if (!list || !LISTS.has(list) || !rule || (onOff !== "on" && onOff !== "off")) die("usage: agent-switch claude-settings rule allow|deny|ask <rule> on|off");
    next = toggleListEntry(current, `permissions.${list}`, rule, onOff === "on");
  } else die("usage: agent-switch claude-settings [status|sync|set <path> <json>|unset <path>|rule allow|deny|ask <rule> on|off] [--json]");

  writeGlobal(globalFile, next);
  const rows = syncAllClaudeSettings(globalFile);
  if (json) return void console.log(JSON.stringify({ profiles: rows }));
  console.log(`Updated ${globalFile}; applied to every Claude profile:`);
  report(rows);
}
