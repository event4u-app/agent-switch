/**
 * One settings.json for every Claude profile. `~/.claude/settings.json` is the
 * source; each profile's own settings.json receives it on every change and
 * before every launch. A link cannot do this: Claude Code writes its settings
 * by temp file + rename, which replaces a symlinked file with a copy (see
 * share.ts), and a profile that already had its own file was never linked.
 *
 * Merge, owner decision 2026-11-05 ("global wins"):
 *   - a value set globally replaces the profile's value;
 *   - objects merge key by key; lists are united (global entries first), so an
 *     "always allow" Claude saved in a profile survives;
 *   - what only the profile has stays;
 *   - what the global file dropped since the last sync is dropped from the
 *     profile too, but only where the profile still holds the value it got from
 *     the global file — a profile's own edit is never deleted. The last applied
 *     global lives next to the profile's settings as SNAPSHOT.
 * Account-scoped keys (MCP servers, token-, secret- and key-shaped names, also
 * inside `env`) never travel; the sharing guard in share.ts applies the same rule.
 */

import * as fs from "node:fs";
import * as path from "node:path";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Obj = { [k: string]: Json };

export const SNAPSHOT = ".agent-switch-global-settings.json";
const SENSITIVE = /^(mcpServers$|.*(token|secret|api[_-]?key|credential|oauth|password).*)/i;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The global settings without account-scoped keys, and the names left out. Pure. */
export function shareable(global: Obj): { value: Obj; withheld: string[] } {
  const withheld: string[] = [];
  const value: Obj = {};
  for (const [k, v] of Object.entries(global)) {
    if (SENSITIVE.test(k)) {
      withheld.push(k);
      continue;
    }
    if (k === "env" && isObj(v)) {
      const env: Obj = {};
      for (const [ek, ev] of Object.entries(v)) {
        if (SENSITIVE.test(ek)) withheld.push(`env.${ek}`);
        else env[ek] = ev;
      }
      value.env = env;
      continue;
    }
    value[k] = v;
  }
  return { value, withheld };
}

function mergeList(g: Json[], p: Json[], prev: Json[] | undefined): Json[] {
  const dropped = (prev ?? []).filter((x) => !g.some((y) => same(x, y)));
  const out = [...g];
  for (const x of p) {
    if (out.some((y) => same(x, y))) continue;
    if (dropped.some((y) => same(x, y))) continue;
    out.push(x);
  }
  return out;
}

/** The profile's settings after applying `global`, given the global last applied (`prev`). Pure. */
export function mergeSettings(global: Obj, profile: Obj, prev: Obj | null): Obj {
  const out: Obj = { ...profile };
  for (const [k, g] of Object.entries(global)) {
    const p = profile[k];
    const pv = prev?.[k];
    if (isObj(g) && isObj(p)) out[k] = mergeSettings(g, p, isObj(pv) ? pv : null);
    else if (Array.isArray(g) && Array.isArray(p)) out[k] = mergeList(g, p, Array.isArray(pv) ? pv : undefined);
    else out[k] = g;
  }
  for (const [k, pv] of Object.entries(prev ?? {})) {
    if (k in global || !(k in out)) continue;
    const p = out[k];
    if (same(p, pv)) delete out[k];
    else if (isObj(p) && isObj(pv)) out[k] = mergeSettings({}, p, pv);
    else if (Array.isArray(p) && Array.isArray(pv)) out[k] = p.filter((x) => !pv.some((y) => same(x, y)));
  }
  return out;
}

/** Keys (dotted, one level into objects) where the profile differs from what the global file sets. Pure. */
export function profileExtras(merged: Obj, global: Obj): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(merged)) {
    const g = global[k];
    if (g === undefined) out.push(k);
    else if (isObj(v) && isObj(g)) for (const [ik, iv] of Object.entries(v)) {
      if (!(ik in g)) out.push(`${k}.${ik}`);
      else if (Array.isArray(iv) && Array.isArray(g[ik])) {
        const n = iv.filter((x) => !(g[ik] as Json[]).some((y) => same(x, y))).length;
        if (n > 0) out.push(`${k}.${ik} (+${n})`);
      }
    }
  }
  return out;
}

export function readJson(file: string): Obj | null {
  try {
    const v = JSON.parse(fs.readFileSync(file, "utf8"));
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
}

function writeJson(file: string, value: Obj): void {
  let mode = 0o600;
  try {
    mode = fs.statSync(file).mode & 0o777;
  } catch {
    /* new file */
  }
  const tmp = `${file}.agent-switch-${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", { mode });
  fs.renameSync(tmp, file);
}

export type SyncResult = "updated" | "in-sync" | "linked" | "invalid" | "no-global";

/**
 * Apply the global settings to one profile config dir. A settings.json that
 * resolves to the global file itself is left alone; an unparseable one is
 * reported, never overwritten.
 */
export function syncProfileSettings(globalFile: string, configDir: string): SyncResult {
  const global = readJson(globalFile);
  if (!global) return "no-global";
  const file = path.join(configDir, "settings.json");
  try {
    if (fs.existsSync(file) && fs.realpathSync(file) === fs.realpathSync(globalFile)) return "linked";
  } catch {
    /* dangling link: treated as absent below */
  }
  let isLink = false;
  try {
    isLink = fs.lstatSync(file).isSymbolicLink();
  } catch {
    /* absent */
  }
  const exists = fs.existsSync(file);
  const profile = exists ? readJson(file) : {};
  if (profile === null) return "invalid";
  const { value } = shareable(global);
  const snap = path.join(configDir, SNAPSHOT);
  const merged = mergeSettings(value, profile, readJson(snap));
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const changed = !exists || !same(merged, profile);
  if (changed) {
    // A dangling or foreign link would be written through; replace it with the profile's own file.
    if (isLink) fs.unlinkSync(file);
    writeJson(file, merged);
  }
  writeJson(snap, value);
  return changed ? "updated" : "in-sync";
}

/** A dotted path's segments; `env.FOO` → ["env", "FOO"]. */
const segs = (p: string) => p.split(".").filter(Boolean);

/** `global` with `value` at `dotted` (undefined removes it; empty parents go too). Pure. */
export function setPath(global: Obj, dotted: string, value: Json | undefined): Obj {
  const [head, ...tail] = segs(dotted);
  if (!head) throw new Error("empty settings path");
  const out: Obj = { ...global };
  if (tail.length === 0) {
    if (value === undefined) delete out[head];
    else out[head] = value;
    return out;
  }
  const child = setPath(isObj(out[head]) ? (out[head] as Obj) : {}, tail.join("."), value);
  if (Object.keys(child).length === 0) delete out[head];
  else out[head] = child;
  return out;
}

/** `global` with `rule` added to or removed from the list at `dotted`. Pure. */
export function toggleListEntry(global: Obj, dotted: string, rule: string, on: boolean): Obj {
  let cur: Json | undefined = global;
  for (const s of segs(dotted)) cur = isObj(cur) ? cur[s] : undefined;
  const list = Array.isArray(cur) ? cur.filter((x) => x !== rule) : [];
  return setPath(global, dotted, on ? [...list, rule] : list.length ? list : undefined);
}

/** Write the global settings file (temp + rename, keeping its mode). */
export function writeGlobal(globalFile: string, value: Obj): void {
  fs.mkdirSync(path.dirname(globalFile), { recursive: true, mode: 0o700 });
  // A dotfiles setup may link ~/.claude/settings.json; the rename must land on the link's target.
  writeJson(fs.existsSync(globalFile) ? fs.realpathSync(globalFile) : globalFile, value);
}

export const isSensitiveKey = (k: string) => SENSITIVE.test(k);
