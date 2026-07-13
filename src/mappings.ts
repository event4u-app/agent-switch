/**
 * Directory → profile mappings for automatic per-repo account selection.
 *
 * Adopted from claude-swap (mappings.py / PR #71): `agent-switch dir` resolves the
 * current working directory to the nearest mapped ancestor, so the `claude`
 * shell wrapper picks the right account per repository without switching.
 * Precedence in the wrapper: directory mapping > active profile > default.
 *
 * Keys are normalized (expanded, absolute, symlink-resolved) paths; values
 * are profile names (stable here — profiles are named directories, unlike
 * claude-swap's reusable slot numbers).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { ROOT, ensureRoot } from "./profiles.js";

const MAPPINGS_FILE = path.join(ROOT, "mappings.json");

export function normalizePath(p: string): string {
  let resolved = path.resolve(p);
  try {
    resolved = fs.realpathSync(resolved);
  } catch {
    /* keep unresolved if the path doesn't exist */
  }
  return resolved;
}

export function loadMappings(): Record<string, string> {
  try {
    const data = JSON.parse(fs.readFileSync(MAPPINGS_FILE, "utf8"));
    return data && typeof data.mappings === "object" ? data.mappings : {};
  } catch {
    return {};
  }
}

function save(mappings: Record<string, string>): void {
  ensureRoot();
  fs.writeFileSync(
    MAPPINGS_FILE,
    JSON.stringify({ schema: 1, mappings }, null, 2) + "\n",
    { mode: 0o600 },
  );
}

export function setMapping(dir: string, profile: string): string {
  const key = normalizePath(dir);
  const mappings = loadMappings();
  mappings[key] = profile;
  save(mappings);
  return key;
}

export function removeMapping(dir: string): boolean {
  const key = normalizePath(dir);
  const mappings = loadMappings();
  if (!(key in mappings)) return false;
  delete mappings[key];
  save(mappings);
  return true;
}

/** Nearest mapped ancestor of `dir` (inclusive); null if none. */
export function resolveMapping(dir: string): { path: string; profile: string } | null {
  const mappings = loadMappings();
  let current = normalizePath(dir);
  for (;;) {
    if (current in mappings) return { path: current, profile: mappings[current] };
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** Drop mappings pointing at a removed profile. Returns removed keys. */
export function pruneMappings(profile: string): string[] {
  const mappings = loadMappings();
  const removed = Object.keys(mappings).filter((k) => mappings[k] === profile);
  if (removed.length === 0) return [];
  for (const k of removed) delete mappings[k];
  save(mappings);
  return removed;
}
