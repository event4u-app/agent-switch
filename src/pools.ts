/**
 * Pools — explicit, user-created groups of profiles that a folder rule may point
 * at (`map pool:<id> [dir]`). Additive and opt-in: the store starts empty, an
 * upgrade creates nothing, and labels (Work/Personal/Other) and
 * `autoSwitch.tag` are never read or changed here. Membership is many-to-many
 * and keyed by `provider/name`; a pool may hold profiles of several providers,
 * and a lookup only ever considers members of the provider being started.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { ROOT, ensureRoot, labelFor, listAllProfiles, PROFILE_LABELS } from "./profiles.js";
import { ProviderId, isProviderId } from "./providers.js";

export const POOLS_FILE = path.join(ROOT, "pools.json");
export const POOL_PREFIX = "pool:";

export interface Pool {
  id: string;
  name: string;
  /** `provider/name` keys, insertion order. */
  members: string[];
  createdAt: string;
}

export function isPoolRef(v: string): boolean {
  return v.startsWith(POOL_PREFIX);
}

export function poolIdOf(ref: string): string {
  return ref.slice(POOL_PREFIX.length);
}

/** `claude/work` → `{ provider, name }`, or null when it is not a member key. */
export function parseMember(v: string): { provider: ProviderId; name: string } | null {
  const m = /^([a-z]+)\/([A-Za-z0-9_-]+)$/.exec(v);
  if (!m || !isProviderId(m[1])) return null;
  return { provider: m[1], name: m[2] };
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function readPools(file: string = POOLS_FILE): Pool[] {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(raw?.pools)) return [];
    return raw.pools
      .filter((p: any) => p && typeof p.id === "string" && typeof p.name === "string")
      .map((p: any) => ({
        id: p.id,
        name: p.name,
        members: Array.isArray(p.members) ? p.members.filter((m: unknown) => typeof m === "string" && parseMember(m)) : [],
        createdAt: typeof p.createdAt === "string" ? p.createdAt : "",
      }));
  } catch {
    return [];
  }
}

function save(pools: Pool[], file: string): void {
  if (file === POOLS_FILE) ensureRoot();
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ schema: 1, pools }, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function findPool(id: string, file: string = POOLS_FILE): Pool | null {
  return readPools(file).find((p) => p.id === id) ?? null;
}

function mustFind(pools: Pool[], id: string): Pool {
  const p = pools.find((x) => x.id === id);
  if (!p) throw new Error(`no pool "${id}" (pools: ${pools.map((x) => x.id).join(", ") || "none"})`);
  return p;
}

export function createPool(name: string, file: string = POOLS_FILE, now: Date = new Date()): Pool {
  const display = name.trim();
  const id = slugify(display);
  if (!id) throw new Error("pool name needs at least one letter or digit");
  const pools = readPools(file);
  if (pools.some((p) => p.id === id)) throw new Error(`a pool "${id}" already exists`);
  const pool: Pool = { id, name: display, members: [], createdAt: now.toISOString() };
  save([...pools, pool], file);
  return pool;
}

/** Renames the display name only — the id stays, so folder rules keep working. */
export function renamePool(id: string, name: string, file: string = POOLS_FILE): Pool {
  const pools = readPools(file);
  const p = mustFind(pools, id);
  if (!name.trim()) throw new Error("pool name must not be empty");
  p.name = name.trim();
  save(pools, file);
  return p;
}

export function deletePool(id: string, file: string = POOLS_FILE): void {
  const pools = readPools(file);
  mustFind(pools, id);
  save(pools.filter((p) => p.id !== id), file);
}

export function addPoolMember(id: string, member: string, file: string = POOLS_FILE): Pool {
  if (!parseMember(member)) throw new Error(`"${member}" is not a profile key (expected provider/name, e.g. claude/work)`);
  const pools = readPools(file);
  const p = mustFind(pools, id);
  if (!p.members.includes(member)) p.members.push(member);
  save(pools, file);
  return p;
}

export function removePoolMember(id: string, member: string, file: string = POOLS_FILE): Pool {
  const pools = readPools(file);
  const p = mustFind(pools, id);
  p.members = p.members.filter((m) => m !== member);
  save(pools, file);
  return p;
}

/** Keep memberships pointing at a profile across a rename / drop them on remove. */
export function renamePoolMember(from: string, to: string | null, file: string = POOLS_FILE): void {
  const pools = readPools(file);
  let changed = false;
  for (const p of pools) {
    if (!p.members.includes(from)) continue;
    p.members = p.members.filter((m) => m !== from);
    if (to && !p.members.includes(to)) p.members.push(to);
    changed = true;
  }
  if (changed) save(pools, file);
}

/**
 * "Suggest from tags": one proposed pool per label in use. A preview only —
 * nothing is stored until the user confirms (`pool suggest --confirm`), and a
 * proposal whose id already exists is marked so it is never overwritten.
 */
export function suggestPoolsFromLabels(
  profiles: { provider: ProviderId; name: string }[] = listAllProfiles(),
  label: (p: ProviderId, n: string) => string | null = labelFor,
  existing: Pool[] = readPools(),
): { id: string; name: string; members: string[]; exists: boolean }[] {
  const out: { id: string; name: string; members: string[]; exists: boolean }[] = [];
  for (const l of PROFILE_LABELS) {
    const members = profiles.filter((p) => label(p.provider, p.name) === l).map((p) => `${p.provider}/${p.name}`);
    if (members.length === 0) continue;
    const id = slugify(l);
    out.push({ id, name: l, members, exists: existing.some((p) => p.id === id) });
  }
  return out;
}
