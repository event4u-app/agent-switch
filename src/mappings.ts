/**
 * Directory → (provider, profile) mappings for automatic per-repo account
 * selection across all three CLI assistants.
 *
 * `agent-switch dir --provider <id>` resolves the current working directory to
 * the nearest mapped ancestor for that provider, so each shell wrapper
 * (`claude`/`codex`/`gemini`) picks the right account per repository without
 * switching. Precedence in the wrapper: directory mapping > active-for-provider
 * > default.
 *
 * Keys are normalized (expanded, absolute, symlink-resolved; win32 drive-letter
 * canonicalized) paths; values are `{ provider, name }`. A path may map a
 * different profile per provider, so the stored value is keyed by provider:
 * `{ "<path>": { claude: "<name>", codex: "<name>", ... } }`.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { ROOT, ensureRoot } from "./profiles.js";
import { ProviderId } from "./providers.js";

const MAPPINGS_FILE = path.join(ROOT, "mappings.json");

/** provider → profile name, for one directory. */
export type DirMapping = Partial<Record<ProviderId, string>>;

/**
 * Windows path canonicalization for mapping keys. NTFS is case-insensitive and
 * drive letters appear in both cases (`C:\` vs `c:\`), so a mapping keyed under
 * one case must match a lookup in the other. Uppercase the drive letter (the
 * Windows convention). Pure — no FS access — so it is unit-tested cross-platform.
 * No-op off win32.
 */
export function canonicalizeWin32(resolved: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== "win32") return resolved;
  return resolved.replace(/^([a-z]):/, (_m, d: string) => d.toUpperCase() + ":");
}

export function normalizePath(p: string): string {
  let resolved = path.resolve(p);
  try {
    resolved = fs.realpathSync(resolved);
  } catch {
    /* keep unresolved if the path doesn't exist */
  }
  return canonicalizeWin32(resolved);
}

export function loadMappings(): Record<string, DirMapping> {
  let data: any;
  try {
    data = JSON.parse(fs.readFileSync(MAPPINGS_FILE, "utf8"));
  } catch {
    return {};
  }
  const raw = data && typeof data.mappings === "object" ? data.mappings : {};
  const out: Record<string, DirMapping> = {};
  for (const [key, value] of Object.entries(raw)) {
    // v1: value was a bare profile name (Claude). v2: value is a provider map.
    if (typeof value === "string") out[key] = { claude: value };
    else if (value && typeof value === "object") out[key] = value as DirMapping;
  }
  return out;
}

function save(mappings: Record<string, DirMapping>): void {
  ensureRoot();
  fs.writeFileSync(MAPPINGS_FILE, JSON.stringify({ schema: 2, mappings }, null, 2) + "\n", {
    mode: 0o600,
  });
}

export function setMapping(dir: string, providerId: ProviderId, name: string): string {
  const key = normalizePath(dir);
  const mappings = loadMappings();
  mappings[key] = { ...mappings[key], [providerId]: name };
  save(mappings);
  return key;
}

/** Remove a directory's mapping — one provider, or the whole entry. */
export function removeMapping(dir: string, providerId?: ProviderId): boolean {
  const key = normalizePath(dir);
  const mappings = loadMappings();
  if (!(key in mappings)) return false;
  if (providerId) {
    if (!(providerId in mappings[key])) return false;
    delete mappings[key][providerId];
    if (Object.keys(mappings[key]).length === 0) delete mappings[key];
  } else {
    delete mappings[key];
  }
  save(mappings);
  return true;
}

/** Nearest mapped ancestor of `dir` (inclusive) for a provider; null if none. */
export function resolveMapping(
  dir: string,
  providerId: ProviderId,
): { path: string; name: string } | null {
  const mappings = loadMappings();
  let current = normalizePath(dir);
  for (;;) {
    const entry = mappings[current];
    if (entry && entry[providerId]) return { path: current, name: entry[providerId]! };
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** Drop mappings pointing at a removed (provider, name). Returns removed keys. */
export function pruneMappings(providerId: ProviderId, name: string): string[] {
  const mappings = loadMappings();
  const removed: string[] = [];
  for (const [key, entry] of Object.entries(mappings)) {
    if (entry[providerId] === name) {
      delete entry[providerId];
      if (Object.keys(entry).length === 0) delete mappings[key];
      removed.push(key);
    }
  }
  if (removed.length > 0) save(mappings);
  return removed;
}

/** All mappings as flat rows for display. */
export function mappingRows(): { path: string; provider: ProviderId; name: string }[] {
  const rows: { path: string; provider: ProviderId; name: string }[] = [];
  for (const [key, entry] of Object.entries(loadMappings())) {
    for (const [provider, name] of Object.entries(entry)) {
      rows.push({ path: key, provider: provider as ProviderId, name: name as string });
    }
  }
  return rows.sort((a, b) => a.path.localeCompare(b.path) || a.provider.localeCompare(b.provider));
}
