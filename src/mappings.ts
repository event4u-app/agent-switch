/**
 * Directory → (provider, profile) mappings for automatic per-repo account
 * selection across all three CLI assistants.
 *
 * `agent-switch dir --provider <id>` resolves the current working directory to
 * the nearest mapped ancestor for that provider, so each shell wrapper
 * (`claude`/`codex`/`agy`) picks the right account per repository without
 * switching. Precedence in the wrapper: directory mapping > active-for-provider
 * > default.
 *
 * Keys are normalized (expanded, absolute, symlink-resolved; win32 drive-letter
 * canonicalized) paths; values are `{ provider, name }`. A path may map a
 * different profile per provider, so the stored value is keyed by provider:
 * `{ "<path>": { claude: "<name>", codex: "<name>", ... } }`.
 *
 * A rule can be paused without losing it: `paused` lists `{ "<path>": [provider] }`
 * next to `mappings`, and resolution skips a paused rule as if it were absent.
 *
 * Remote bindings (`remotes`, keyed `host/owner` or `host/owner/repo`) match a
 * repository by its `origin` URL instead of its folder. They count at the
 * depth of the repository root: walking up from the start folder, a folder
 * rule wins at the same depth, so a remote beats a rule on a parent folder but
 * never one on the repo itself or inside it. The longest key matches first.
 */

import { spawnSync } from "node:child_process";
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

type Paused = Record<string, ProviderId[]>;

function readFile(): any {
  try {
    return JSON.parse(fs.readFileSync(MAPPINGS_FILE, "utf8"));
  } catch {
    return null;
  }
}

function loadPaused(): Paused {
  const raw = readFile()?.paused;
  if (!raw || typeof raw !== "object") return {};
  const out: Paused = {};
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value)) out[key] = value.filter((v): v is ProviderId => typeof v === "string");
  }
  return out;
}

const isPaused = (paused: Paused, key: string, providerId: ProviderId) => !!paused[key]?.includes(providerId);

export function loadMappings(): Record<string, DirMapping> {
  const data = readFile();
  if (!data) return {};
  const raw = data && typeof data.mappings === "object" ? data.mappings : {};
  const out: Record<string, DirMapping> = {};
  for (const [key, value] of Object.entries(raw)) {
    // v1: value was a bare profile name (Claude). v2: value is a provider map.
    if (typeof value === "string") out[key] = { claude: value };
    else if (value && typeof value === "object") out[key] = value as DirMapping;
  }
  return out;
}

export function loadRemotes(): Record<string, DirMapping> {
  const raw = readFile()?.remotes;
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, DirMapping> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value && typeof value === "object") out[key] = value as DirMapping;
  }
  return out;
}

/** Write mappings; paused flags of rules that no longer exist are dropped. */
function save(mappings: Record<string, DirMapping>, paused: Paused = loadPaused(), remotes: Record<string, DirMapping> = loadRemotes()): void {
  ensureRoot();
  const kept: Paused = {};
  for (const [key, providers] of Object.entries(paused)) {
    const live = providers.filter((p) => mappings[key]?.[p]);
    if (live.length > 0) kept[key] = live;
  }
  const body = {
    schema: 2,
    mappings,
    ...(Object.keys(kept).length > 0 ? { paused: kept } : {}),
    ...(Object.keys(remotes).length > 0 ? { remotes } : {}),
  };
  fs.writeFileSync(MAPPINGS_FILE, JSON.stringify(body, null, 2) + "\n", { mode: 0o600 });
}

/** A remote URL as `[host, ...path segments]`, lower case, without `.git`;
 *  null for a local path or a URL with no owner. Pure. */
export function parseRemote(url: string): string[] | null {
  const u = url.trim();
  let host: string;
  let rest: string;
  const scheme = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:]+)(?::\d+)?(\/.*)?$/i.exec(u);
  const scp = /^(?:[^@/:]+@)?([^/:]+):(?!\/)(.+)$/.exec(u);
  if (scheme) [host, rest] = [scheme[1], scheme[2] ?? ""];
  else if (scp) [host, rest] = [scp[1], scp[2]];
  else return null;
  const segs = rest.replace(/\.git\/?$/i, "").split("/").filter(Boolean);
  if (segs.length === 0) return null;
  return [host, ...segs].map((x) => x.toLowerCase());
}

/** The stored form of a binding target: `host/owner[/repo]`, or a remote URL
 *  reduced to it. Null when it names no owner. */
export function normalizeRemoteKey(input: string): string | null {
  const t = input.trim();
  const parsed = /:\/\/|^[^/]*:/.test(t) ? parseRemote(t) : t.replace(/\.git\/?$/i, "").split("/").filter(Boolean).map((x) => x.toLowerCase());
  return parsed && parsed.length >= 2 ? parsed.join("/") : null;
}

function git(cwd: string, args: string[]): string | null {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout: 1000, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" } });
  return r.status === 0 && !r.error ? r.stdout.trim() : null;
}

/** The repository root of `dir` and its `origin` (else first) remote, parsed. */
function repoRemote(dir: string): { root: string; segs: string[] } | null {
  // The root is resolved from `dir` itself: git prints its own spelling of the
  // path, which on Windows can be the long form of an 8.3 temp dir and would
  // then never match the path it was asked about.
  const up = git(dir, ["rev-parse", "--show-cdup"]);
  if (up === null) return null;
  const top = path.join(dir, up);
  const name = git(dir, ["config", "--get", "remote.origin.url"]) !== null ? "origin" : git(dir, ["remote"])?.split("\n")[0];
  const url = name ? git(dir, ["config", "--get", `remote.${name}.url`]) : null;
  const segs = url ? parseRemote(url) : null;
  return segs ? { root: normalizePath(top), segs } : null;
}

export function setRemoteMapping(remote: string, providerId: ProviderId, name: string): string {
  const key = normalizeRemoteKey(remote);
  if (!key) throw new Error(`"${remote}" is not host/owner[/repo] or a remote URL`);
  const remotes = loadRemotes();
  remotes[key] = { ...remotes[key], [providerId]: name };
  save(loadMappings(), loadPaused(), remotes);
  return key;
}

/** Remove a remote binding — one provider, or the whole entry. */
export function removeRemoteMapping(remote: string, providerId?: ProviderId): boolean {
  const key = normalizeRemoteKey(remote);
  const remotes = loadRemotes();
  if (!key || !(key in remotes)) return false;
  if (providerId) {
    if (!(providerId in remotes[key])) return false;
    delete remotes[key][providerId];
    if (Object.keys(remotes[key]).length === 0) delete remotes[key];
  } else {
    delete remotes[key];
  }
  save(loadMappings(), loadPaused(), remotes);
  return true;
}

/** All remote bindings as flat rows for display. */
export function remoteRows(): { remote: string; provider: ProviderId; name: string }[] {
  const rows: { remote: string; provider: ProviderId; name: string }[] = [];
  for (const [key, entry] of Object.entries(loadRemotes())) {
    for (const [provider, name] of Object.entries(entry)) rows.push({ remote: key, provider: provider as ProviderId, name: name as string });
  }
  return rows.sort((a, b) => a.remote.localeCompare(b.remote) || a.provider.localeCompare(b.provider));
}

/** Pause or resume one folder rule. False when the folder has no rule for the provider. */
export function setPaused(dir: string, providerId: ProviderId, on: boolean): boolean {
  const key = normalizePath(dir);
  const mappings = loadMappings();
  if (!mappings[key]?.[providerId]) return false;
  const paused = loadPaused();
  const rest = (paused[key] ?? []).filter((p) => p !== providerId);
  paused[key] = on ? [...rest, providerId] : rest;
  save(mappings, paused);
  return true;
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

/** Nearest rule for `dir` (inclusive) and a provider: a folder rule, or a
 *  remote binding at the repository root (`remote` set); null if none. */
export function resolveMapping(
  dir: string,
  providerId: ProviderId,
): { path: string; name: string; remote?: string } | null {
  const mappings = loadMappings();
  const paused = loadPaused();
  const remotes = loadRemotes();
  // Only a remote binding for this provider is worth the git calls on the start path.
  const repo = Object.values(remotes).some((e) => e[providerId]) ? repoRemote(dir) : null;
  let current = normalizePath(dir);
  for (;;) {
    const entry = mappings[current];
    if (entry && entry[providerId] && !isPaused(paused, current, providerId)) return { path: current, name: entry[providerId]! };
    if (repo && current === repo.root) {
      for (let n = repo.segs.length; n >= 2; n--) {
        const key = repo.segs.slice(0, n).join("/");
        const name = remotes[key]?.[providerId];
        if (name) return { path: current, name, remote: key };
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** Drop folder rules and remote bindings pointing at a removed (provider,
 *  name). Returns removed keys. */
export function pruneMappings(providerId: ProviderId, name: string): string[] {
  const mappings = loadMappings();
  const remotes = loadRemotes();
  const removed: string[] = [];
  for (const table of [mappings, remotes]) {
    for (const [key, entry] of Object.entries(table)) {
      if (entry[providerId] === name) {
        delete entry[providerId];
        if (Object.keys(entry).length === 0) delete table[key];
        removed.push(key);
      }
    }
  }
  if (removed.length > 0) save(mappings, loadPaused(), remotes);
  return removed;
}

/** All mappings as flat rows for display. */
export function mappingRows(): { path: string; provider: ProviderId; name: string; paused: boolean }[] {
  const rows: { path: string; provider: ProviderId; name: string; paused: boolean }[] = [];
  const paused = loadPaused();
  for (const [key, entry] of Object.entries(loadMappings())) {
    for (const [provider, name] of Object.entries(entry)) {
      rows.push({ path: key, provider: provider as ProviderId, name: name as string, paused: isPaused(paused, key, provider as ProviderId) });
    }
  }
  return rows.sort((a, b) => a.path.localeCompare(b.path) || a.provider.localeCompare(b.provider));
}
