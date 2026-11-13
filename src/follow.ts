/**
 * Every profile follows its source (owner decision 2026-11-11, council-reviewed).
 *
 * A Claude profile follows `~/.claude` (or the profile `share on --source` named);
 * a Claude Desktop profile follows the regular Desktop install (or the profile
 * `app-settings copy --from` named). Whatever changes in the source — settings,
 * plugins, rules, skills, commands, Desktop extensions and MCP config — becomes
 * the target's desired state at once and is applied as soon as that is safe:
 *
 *   - before every start through agent-switch, for that profile;
 *   - on `agent-switch sync`, which agent-config runs after `install` / `upgrade`;
 *   - every few minutes from the engine, which also delivers what had to wait.
 *
 * Ownership, so a target's own things survive:
 *   - settings.json: the global-wins merge of claude-settings.ts, unchanged;
 *   - skills/, commands/, agents/, CLAUDE.md, keybindings.json: linked to the
 *     source when the target has none of its own (share.ts);
 *   - rules/: managed copies. A file agent-switch copied follows the source,
 *     including its removal; a file the target has on its own stays;
 *   - plugins: replayed with `claude plugin` under the target's config dir, never
 *     copied. Plugins only the target has stay; agent-switch uninstalls only a
 *     plugin it installed itself. A version `claude plugin update` cannot match
 *     is reported as `differs`, never claimed as in step;
 *   - Desktop: the config merge of desktop-settings.ts, and the extension
 *     folders entry by entry. Only while that profile's app is closed: when it
 *     is open, or when agent-switch cannot tell, the update waits.
 *
 * `confirmNew` (default off: everything is applied automatically) holds new
 * plugins and new Desktop extensions until `agent-switch sync approve`; updates
 * of what a target already has always go through.
 * Logins and account-bound settings never travel (claude-settings.ts,
 * desktop-settings.ts).
 */

import { spawnSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { findApp, guiDataDir } from "./apps.js";
import { syncProfileSettings } from "./claude-settings.js";
import { DEFAULT_DATA_DIR, desktopLayout, mergeDesktopConfig, readJson } from "./desktop-settings.js";
import { runState, type RunState } from "./launchers.js";
import { configDir, listProfiles, readBinaryPath, ROOT } from "./profiles.js";
import { provider, resolveBinary } from "./providers.js";
import { linkMissing, sharedSourceOf } from "./share.js";

export const FOLLOW_FILE = "follow.json";
export const DEFAULT_SOURCE = "default";
/** Rules are copied, not linked: a target keeps rules of its own beside them. */
export const FOLLOWED_TREES = ["rules"] as const;

export type FollowKind = "claude" | "claude-desktop";
export const FOLLOW_KINDS: readonly FollowKind[] = ["claude", "claude-desktop"];

export type TargetState =
  | "applied" //            everything from the source is in place
  | "pending-app-running" // the Desktop app is open (or may be); applied once it is closed
  | "pending-approval" //   new plugins or extensions wait for `sync approve`
  | "differs" //            applied, but a plugin version could not be matched
  | "failed" //             something went wrong; detail says what
  | "off" //                this target does not follow
  | "unsynced"; //          no sync has run for it yet

export interface Relation {
  source: string;
  enabled: boolean;
}

export interface TargetRecord {
  state: TargetState;
  detail: string;
  at: string;
  /** Fingerprint of the source as last applied in full. */
  applied?: string;
  /** Fingerprint of the source plugin inventory as last replayed. */
  pluginsApplied?: string;
  /** Plugins agent-switch installed in this target (uninstalled with the source's). */
  ownedPlugins?: string[];
  /** Copied tree files → the hash agent-switch wrote. */
  ownedFiles?: Record<string, string>;
  /** Desktop folder entries agent-switch put there, per folder. */
  ownedEntries?: Record<string, string[]>;
  /** New items held by confirmNew: `plugin:<id>` / `extension:<folder>/<name>`. */
  awaiting?: string[];
}

export interface FollowFile {
  schema: 1;
  confirmNew: boolean;
  relations: Record<string, Relation>;
  targets: Record<string, TargetRecord>;
  approved: Record<string, string[]>;
}

const emptyFile = (): FollowFile => ({ schema: 1, confirmNew: false, relations: {}, targets: {}, approved: {} });

export const targetKey = (kind: FollowKind, profile: string): string => `${kind}/${profile}`;

function followPath(root: string): string {
  return path.join(root, FOLLOW_FILE);
}

/** The registry. A file written by a newer schema is never overwritten. */
export function readFollow(root = ROOT): FollowFile {
  try {
    const raw = JSON.parse(fs.readFileSync(followPath(root), "utf8"));
    if (raw?.schema !== 1) {
      if (typeof raw?.schema === "number" && raw.schema > 1) throw new Error(`${FOLLOW_FILE} was written by a newer agent-switch (schema ${raw.schema}) — update agent-switch.`);
      return emptyFile();
    }
    return {
      schema: 1,
      confirmNew: raw.confirmNew === true,
      relations: raw.relations ?? {},
      targets: raw.targets ?? {},
      approved: raw.approved ?? {},
    };
  } catch (err: any) {
    if (err?.code === "ENOENT" || err instanceof SyntaxError) return emptyFile();
    throw err;
  }
}

export function writeFollow(f: FollowFile, root = ROOT): void {
  fs.mkdirSync(root, { recursive: true });
  const file = followPath(root);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(f, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** One sync at a time. A lock older than ten minutes belongs to a run that died. */
const LOCK_STALE_MS = 10 * 60_000;

function withLock<T>(root: string, fn: () => T): T | null {
  const lock = path.join(root, `${FOLLOW_FILE}.lock`);
  fs.mkdirSync(root, { recursive: true });
  try {
    fs.mkdirSync(lock);
  } catch {
    try {
      if (Date.now() - fs.statSync(lock).mtimeMs < LOCK_STALE_MS) return null;
      fs.rmSync(lock, { recursive: true, force: true });
      fs.mkdirSync(lock);
    } catch {
      return null;
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}


export interface FollowEnv {
  root: string;
  claudeHome: string;
  desktopDefault: string | null;
  profiles: string[];
  claudeDir: (profile: string) => string;
  desktopDir: (profile: string) => string | null;
  claude: PluginRunner;
  runState: (userDataDir: string) => RunState;
  now: () => Date;
}

export function liveEnv(): FollowEnv {
  const app = findApp("claude-desktop");
  return {
    root: ROOT,
    claudeHome: provider("claude").defaultConfigDir(),
    desktopDefault: DEFAULT_DATA_DIR["claude-desktop"] ?? null,
    profiles: listProfiles("claude"),
    claudeDir: (p) => configDir("claude", p),
    desktopDir: (p) => (app ? guiDataDir(app, p) : null),
    claude: claudeRunner,
    runState,
    now: () => new Date(),
  };
}

/** The relation a target has: recorded, else inferred (a share link's source, else the default). */
export function relationOf(f: FollowFile, env: FollowEnv, kind: FollowKind, profile: string): Relation {
  const rec = f.relations[targetKey(kind, profile)];
  if (rec) return rec;
  if (kind === "claude") {
    const linked = sharedSourceOf(env.claudeDir(profile));
    const from = linked ? env.profiles.find((p) => p !== profile && path.resolve(env.claudeDir(p)) === path.resolve(linked)) : undefined;
    return { source: from ?? DEFAULT_SOURCE, enabled: true };
  }
  return { source: DEFAULT_SOURCE, enabled: true };
}

function sourceDir(env: FollowEnv, kind: FollowKind, source: string): string | null {
  if (kind === "claude") return source === DEFAULT_SOURCE ? env.claudeHome : env.claudeDir(source);
  return source === DEFAULT_SOURCE ? env.desktopDefault : env.desktopDir(source);
}

/** Record who a target follows (`share on --source`, `app-settings copy --from`). */
export function setRelation(kind: FollowKind, profile: string, rel: Partial<Relation>, root = ROOT): Relation {
  const f = readFollow(root);
  const key = targetKey(kind, profile);
  const next = { source: f.relations[key]?.source ?? DEFAULT_SOURCE, enabled: f.relations[key]?.enabled ?? true, ...rel };
  if (next.source === profile) throw new Error(`${key} cannot follow itself.`);
  f.relations[key] = next;
  writeFollow(f, root);
  return next;
}

export function setConfirmNew(on: boolean, root = ROOT): void {
  const f = readFollow(root);
  f.confirmNew = on;
  writeFollow(f, root);
}

/** Approve what a target (or every target) holds back; the next sync applies it. */
export function approve(key: string | null, root = ROOT): string[] {
  const f = readFollow(root);
  const done: string[] = [];
  for (const [k, t] of Object.entries(f.targets)) {
    if (key !== null && k !== key) continue;
    for (const item of t.awaiting ?? []) {
      const list = (f.approved[k] ??= []);
      if (!list.includes(item)) list.push(item);
      done.push(`${k} ${item}`);
    }
  }
  writeFollow(f, root);
  return done;
}

/** Targets in an order where a source profile is brought up to date before the
 *  profiles that follow it. A target in a cycle is returned in `cyclic`. */
export function orderTargets(f: FollowFile, env: FollowEnv, kind: FollowKind): { order: string[]; cyclic: string[] } {
  const order: string[] = [];
  const cyclic: string[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (p: string, chain: string[]): boolean => {
    if (state.get(p) === "done") return true;
    if (state.get(p) === "visiting") return false;
    state.set(p, "visiting");
    const rel = relationOf(f, env, kind, p);
    const ok = rel.source === DEFAULT_SOURCE || !env.profiles.includes(rel.source) || visit(rel.source, [...chain, p]);
    state.set(p, "done");
    if (ok) order.push(p);
    else cyclic.push(p);
    return ok;
  };
  for (const p of env.profiles) visit(p, []);
  return { order, cyclic };
}


const sha = (b: Buffer | string): string => crypto.createHash("sha256").update(b).digest("hex");

function hashFile(file: string): string | null {
  try {
    return sha(fs.readFileSync(file));
  } catch {
    return null;
  }
}

/** Relative paths of the regular files under dir (symlinks followed), sorted. */
function walk(dir: string, rel = ""): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    const r = rel ? path.join(rel, e.name) : e.name;
    let st: fs.Stats;
    try {
      st = fs.statSync(path.join(dir, r));
    } catch {
      continue;
    }
    if (st.isDirectory()) out.push(...walk(dir, r));
    else if (st.isFile()) out.push(r);
  }
  return out.sort();
}

function hashTree(dir: string): string {
  return sha(walk(dir).map((r) => `${r}\0${hashFile(path.join(dir, r))}`).join("\n"));
}


/**
 * Bring `dst` up to date with `src`, file by file. A file agent-switch copied
 * before (in `owned`) follows the source — an edit made in the target is kept
 * once as `<file>.pre-follow`, then replaced; one the source removed is removed.
 * A file the target has on its own stays. A `dst` that is a link is shared
 * already and left alone.
 */
export function syncTree(src: string, dst: string, owned: Record<string, string>): { owned: Record<string, string>; changed: string[]; kept: string[] } {
  const next: Record<string, string> = {};
  const changed: string[] = [];
  const kept: string[] = [];
  try {
    if (fs.lstatSync(dst).isSymbolicLink()) return { owned, changed, kept };
  } catch {
    /* absent: created below */
  }
  const files = walk(src);
  for (const rel of files) {
    const from = path.join(src, rel);
    const to = path.join(dst, rel);
    const want = hashFile(from);
    if (want === null) continue;
    const have = hashFile(to);
    if (have === want) {
      next[rel] = want;
      continue;
    }
    if (have !== null && !(rel in owned)) {
      kept.push(rel);
      continue;
    }
    if (have !== null && have !== owned[rel]) fs.copyFileSync(to, `${to}.pre-follow`);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    next[rel] = want;
    changed.push(rel);
  }
  const present = new Set(files);
  for (const [rel, hash] of Object.entries(owned)) {
    if (present.has(rel)) continue;
    const to = path.join(dst, rel);
    if (hashFile(to) === hash) {
      fs.rmSync(to, { force: true });
      changed.push(`-${rel}`);
    }
  }
  return { owned: next, changed, kept };
}


export interface PluginEntry {
  version: string | null;
  sha: string | null;
}

export interface PluginInventory {
  plugins: Record<string, PluginEntry>;
  /** Marketplace name → the argument `claude plugin marketplace add` takes. */
  markets: Record<string, string | null>;
}

/** The user-scope plugins and the marketplaces of one config dir. */
export function readInventory(dir: string): PluginInventory {
  const installed = (readJson(path.join(dir, "plugins", "installed_plugins.json"))?.plugins ?? {}) as Record<string, unknown>;
  const plugins: Record<string, PluginEntry> = {};
  for (const [id, list] of Object.entries(installed)) {
    const user = Array.isArray(list) ? list.find((e: any) => e?.scope === "user") : null;
    if (!user) continue;
    plugins[id] = { version: typeof user.version === "string" ? user.version : null, sha: typeof user.gitCommitSha === "string" ? user.gitCommitSha : null };
  }
  const known = (readJson(path.join(dir, "plugins", "known_marketplaces.json")) ?? {}) as Record<string, any>;
  const markets: Record<string, string | null> = {};
  for (const [name, m] of Object.entries(known)) markets[name] = marketSpec(m?.source);
  return { plugins, markets };
}

function marketSpec(src: any): string | null {
  if (!src || typeof src !== "object") return null;
  if (src.source === "github" && typeof src.repo === "string") return src.repo;
  if ((src.source === "git" || src.source === "url") && typeof src.url === "string") return src.url;
  if ((src.source === "directory" || src.source === "file") && typeof src.path === "string") return src.path;
  return null;
}

export function inventoryFingerprint(inv: PluginInventory): string {
  const ids = Object.keys(inv.plugins).sort();
  return sha(JSON.stringify(ids.map((id) => [id, inv.plugins[id], inv.markets[marketOf(id)] ?? null])));
}

const marketOf = (id: string): string => id.slice(id.lastIndexOf("@") + 1);

export type PluginRunner = (configDir: string, args: string[]) => { ok: boolean; out: string };

/** `claude plugin …` under the target's config dir. */
export const claudeRunner: PluginRunner = (dir, args) => {
  const bin = resolveBinary("claude", readBinaryPath("claude"));
  const r = spawnSync(bin, ["plugin", ...args], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: dir },
    encoding: "utf8",
    timeout: 180_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? String(r.error.message) : ""}`.trim();
  return { ok: r.status === 0, out };
};

export interface PluginOutcome {
  owned: string[];
  awaiting: string[];
  done: string[];
  differs: string[];
  failed: string[];
}

/**
 * Make the target's plugins match the source's: add missing marketplaces,
 * install missing plugins (held back by `confirmNew` unless approved), update
 * ones whose version differs, uninstall the ones agent-switch installed and the
 * source no longer has. Plugins only the target has stay.
 */
export function reconcilePlugins(
  src: PluginInventory,
  targetDir: string,
  owned: string[],
  opts: { confirmNew: boolean; approved: string[]; run: PluginRunner },
): PluginOutcome {
  const have = readInventory(targetDir);
  const out: PluginOutcome = { owned: [...owned], awaiting: [], done: [], differs: [], failed: [] };
  const run = (args: string[]): boolean => {
    const r = opts.run(targetDir, args);
    if (!r.ok) out.failed.push(`${args.join(" ")}: ${r.out.split("\n").pop() ?? "failed"}`);
    return r.ok;
  };
  const marketsReady = new Set(Object.keys(have.markets));
  const refreshed = new Set<string>();
  const ensureMarket = (m: string): boolean => {
    if (marketsReady.has(m)) return true;
    const spec = src.markets[m];
    if (!spec) {
      out.failed.push(`marketplace ${m}: the source names no location agent-switch can add`);
      return false;
    }
    if (!run(["marketplace", "add", spec])) return false;
    marketsReady.add(m);
    refreshed.add(m);
    return true;
  };

  for (const [id, want] of Object.entries(src.plugins)) {
    const got = have.plugins[id];
    if (!got) {
      if (opts.confirmNew && !opts.approved.includes(`plugin:${id}`)) {
        out.awaiting.push(`plugin:${id}`);
        continue;
      }
      if (!ensureMarket(marketOf(id))) continue;
      if (run(["install", id])) {
        out.done.push(`installed ${id}`);
        if (!out.owned.includes(id)) out.owned.push(id);
      }
      continue;
    }
    if (got.version === want.version && got.sha === want.sha) continue;
    const m = marketOf(id);
    if (!refreshed.has(m) && marketsReady.has(m)) {
      run(["marketplace", "update", m]);
      refreshed.add(m);
    }
    if (run(["update", id])) out.done.push(`updated ${id}`);
  }
  for (const id of owned) {
    if (id in src.plugins) continue;
    if (!(id in have.plugins) || run(["uninstall", id])) {
      out.owned = out.owned.filter((x) => x !== id);
      if (id in have.plugins) out.done.push(`uninstalled ${id}`);
    }
  }
  const after = readInventory(targetDir);
  for (const [id, want] of Object.entries(src.plugins)) {
    const got = after.plugins[id];
    if (!got || out.awaiting.includes(`plugin:${id}`)) continue;
    if (got.version !== want.version || (want.sha && got.sha !== want.sha)) out.differs.push(`${id} ${got.version ?? "?"} (source ${want.version ?? "?"})`);
  }
  return out;
}


export function desktopFingerprint(appId: string, dir: string): string {
  const layout = desktopLayout(appId);
  if (!layout) return "";
  const parts = layout.merged.map((n) => `${n}\0${hashFile(path.join(dir, n))}`);
  for (const d of layout.replaced) parts.push(`${d}/\0${hashTree(path.join(dir, d))}`);
  return sha(parts.join("\n"));
}

function entries(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter((n) => !n.startsWith(".")).sort();
  } catch {
    return [];
  }
}

function entryHash(p: string): string | null {
  try {
    return fs.statSync(p).isDirectory() ? hashTree(p) : hashFile(p);
  } catch {
    return null;
  }
}

/** Replace one entry of a folder without leaving it half-copied. */
function replaceEntry(from: string, to: string): void {
  const tmp = path.join(path.dirname(to), `.${path.basename(to)}.follow-tmp`);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.cpSync(from, tmp, { recursive: true });
  fs.rmSync(to, { recursive: true, force: true });
  fs.renameSync(tmp, to);
}

export interface DesktopOutcome {
  ownedEntries: Record<string, string[]>;
  awaiting: string[];
  done: string[];
}

/**
 * Apply a Desktop source to a closed target: the config files merged
 * (desktop-settings.ts), the extension folders entry by entry. An entry only
 * the target has stays; one agent-switch put there and the source dropped goes.
 * The first time a config file changes, the target's version is kept as
 * `<file>.pre-follow`.
 */
export function applyDesktop(
  appId: string,
  fromDir: string,
  toDir: string,
  ownedEntries: Record<string, string[]>,
  opts: { confirmNew: boolean; approved: string[] },
): DesktopOutcome {
  const layout = desktopLayout(appId);
  const out: DesktopOutcome = { ownedEntries: {}, awaiting: [], done: [] };
  if (!layout) return out;
  fs.mkdirSync(toDir, { recursive: true, mode: 0o700 });
  for (const name of layout.merged) {
    const src = readJson(path.join(fromDir, name));
    if (!src) continue;
    const file = path.join(toDir, name);
    const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    const next = JSON.stringify(mergeDesktopConfig(src, (before !== null ? readJson(file) : null) ?? {}), null, 2) + "\n";
    if (next === before) continue;
    if (before !== null && !fs.existsSync(`${file}.pre-follow`)) fs.writeFileSync(`${file}.pre-follow`, before, { mode: 0o600 });
    fs.writeFileSync(file, next, { mode: 0o600 });
    out.done.push(`merged ${name}`);
  }
  for (const folder of layout.replaced) {
    const srcDir = path.join(fromDir, folder);
    const dstDir = path.join(toDir, folder);
    const mine = ownedEntries[folder] ?? [];
    const kept: string[] = [];
    const srcEntries = entries(srcDir);
    for (const name of srcEntries) {
      const from = path.join(srcDir, name);
      const to = path.join(dstDir, name);
      const exists = fs.existsSync(to);
      if (!exists && opts.confirmNew && !opts.approved.includes(`extension:${folder}/${name}`)) {
        out.awaiting.push(`extension:${folder}/${name}`);
        continue;
      }
      if (!exists || entryHash(from) !== entryHash(to)) {
        fs.mkdirSync(dstDir, { recursive: true });
        replaceEntry(from, to);
        out.done.push(`${exists ? "updated" : "added"} ${folder}/${name}`);
      }
      kept.push(name);
    }
    for (const name of mine) {
      if (srcEntries.includes(name)) continue;
      fs.rmSync(path.join(dstDir, name), { recursive: true, force: true });
      out.done.push(`removed ${folder}/${name}`);
    }
    if (kept.length) out.ownedEntries[folder] = kept;
  }
  return out;
}


export interface SyncOptions {
  /** Replay plugins even when the source inventory did not change. */
  force?: boolean;
}

function record(env: FollowEnv, prev: TargetRecord | undefined, patch: Partial<TargetRecord> & { state: TargetState; detail: string }): TargetRecord {
  return { ...prev, ...patch, at: env.now().toISOString() };
}

export function syncClaudeTarget(f: FollowFile, env: FollowEnv, profile: string, opts: SyncOptions = {}): TargetRecord {
  const key = targetKey("claude", profile);
  const prev = f.targets[key];
  const rel = relationOf(f, env, "claude", profile);
  if (!rel.enabled) return record(env, prev, { state: "off", detail: "does not follow" });
  const src = sourceDir(env, "claude", rel.source);
  const dst = env.claudeDir(profile);
  if (!src || !fs.existsSync(src)) {
    // No ~/.claude yet (a fresh machine, a CI runner): nothing to pass on. A
    // source profile that is gone is a real fault.
    if (rel.source === DEFAULT_SOURCE) return record(env, prev, { state: "applied", detail: "the source has nothing yet" });
    return record(env, prev, { state: "failed", detail: `source ${rel.source} has no config dir` });
  }
  const notes: string[] = [];
  try {
    const settings = path.join(src, "settings.json");
    if (fs.existsSync(settings)) syncProfileSettings(settings, dst);
    notes.push(...linkMissing(src, dst));
    let ownedFiles = prev?.ownedFiles ?? {};
    for (const tree of FOLLOWED_TREES) {
      const prefix = `${tree}/`;
      const mine = Object.fromEntries(Object.entries(ownedFiles).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), v]));
      const r = syncTree(path.join(src, tree), path.join(dst, tree), mine);
      ownedFiles = { ...Object.fromEntries(Object.entries(ownedFiles).filter(([k]) => !k.startsWith(prefix))), ...Object.fromEntries(Object.entries(r.owned).map(([k, v]) => [prefix + k, v])) };
      if (r.changed.length) notes.push(`${tree}: ${r.changed.length} file(s)`);
    }
    const inv = readInventory(src);
    const fp = inventoryFingerprint(inv);
    const approved = f.approved[key] ?? [];
    let plugins: PluginOutcome | null = null;
    const pendingApproval = (prev?.awaiting ?? []).some((a) => approved.includes(a));
    const wantsReplay = opts.force || prev?.pluginsApplied !== fp || pendingApproval || prev?.state === "failed" || prev?.state === "pending-approval";
    if (wantsReplay) plugins = reconcilePlugins(inv, dst, prev?.ownedPlugins ?? [], { confirmNew: f.confirmNew, approved, run: env.claude });
    const base = { ownedFiles };
    if (!plugins) {
      // Plugins were not replayed: what they last reported (approval, version) still holds.
      const held = prev?.pluginsApplied === fp && (prev.state === "pending-approval" || prev.state === "differs");
      if (held) return record(env, prev, { ...base, state: prev!.state, detail: prev!.detail });
      return record(env, prev, { ...base, state: "applied", detail: notes.join("; ") || "in step" });
    }
    notes.push(...plugins.done);
    const patch = { ...base, ownedPlugins: plugins.owned, awaiting: plugins.awaiting };
    if (plugins.failed.length) return record(env, prev, { ...patch, state: "failed", detail: [...notes, ...plugins.failed].join("; ") });
    if (approved.length) f.approved[key] = approved.filter((a) => plugins!.awaiting.includes(a));
    const applied = { ...patch, pluginsApplied: fp };
    if (plugins.awaiting.length) return record(env, prev, { ...applied, state: "pending-approval", detail: `waiting for approval: ${plugins.awaiting.join(", ")}` });
    if (plugins.differs.length) return record(env, prev, { ...applied, state: "differs", detail: `version not matched: ${plugins.differs.join(", ")}` });
    return record(env, prev, { ...applied, state: "applied", detail: notes.join("; ") || "in step" });
  } catch (err: any) {
    return record(env, prev, { state: "failed", detail: String(err?.message ?? err) });
  }
}

export function syncDesktopTarget(f: FollowFile, env: FollowEnv, profile: string, opts: { force?: boolean; create?: boolean } = {}): TargetRecord | null {
  const appId = "claude-desktop";
  const key = targetKey(appId, profile);
  const prev = f.targets[key];
  const rel = relationOf(f, env, appId, profile);
  if (!rel.enabled) return record(env, prev, { state: "off", detail: "does not follow" });
  const dst = env.desktopDir(profile);
  if (!dst || (!opts.create && !fs.existsSync(dst))) return null; // never opened on this profile: nothing to update
  const src = sourceDir(env, appId, rel.source);
  if (!src || !fs.existsSync(src)) {
    if (rel.source === DEFAULT_SOURCE) return record(env, prev, { state: "applied", detail: "the source has nothing yet" });
    return record(env, prev, { state: "failed", detail: `source ${rel.source} has no Claude Desktop data` });
  }
  const approved = f.approved[key] ?? [];
  const fp = desktopFingerprint(appId, src);
  const approvalWaiting = (prev?.awaiting ?? []).some((a) => approved.includes(a));
  if (!opts.force && prev?.applied === fp && !approvalWaiting && prev.state !== "pending-app-running") return prev;
  const running = env.runState(dst);
  if (running !== "closed") {
    return record(env, prev, { state: "pending-app-running", detail: running === "running" ? "Claude Desktop is open on this profile — applied once it is closed" : "cannot tell whether Claude Desktop is open — applied before the next start through agent-switch" });
  }
  try {
    const r = applyDesktop(appId, src, dst, prev?.ownedEntries ?? {}, { confirmNew: f.confirmNew, approved });
    if (approved.length) f.approved[key] = approved.filter((a) => r.awaiting.includes(a));
    const patch = { ownedEntries: r.ownedEntries, awaiting: r.awaiting, applied: fp };
    if (r.awaiting.length) return record(env, prev, { ...patch, state: "pending-approval", detail: `waiting for approval: ${r.awaiting.join(", ")}` });
    return record(env, prev, { ...patch, state: "applied", detail: r.done.join("; ") || "in step" });
  } catch (err: any) {
    return record(env, prev, { state: "failed", detail: String(err?.message ?? err) });
  }
}


export interface SyncReport {
  ran: boolean;
  confirmNew: boolean;
  targets: { key: string; source: string; state: TargetState; detail: string }[];
}

/** Bring every target (or one profile's) up to date. `ran: false` when another sync holds the lock. */
export function syncAll(env: FollowEnv = liveEnv(), opts: SyncOptions & { profile?: string; kinds?: FollowKind[] } = {}): SyncReport {
  const out = withLock(env.root, () => {
    const f = readFollow(env.root);
    const kinds = opts.kinds ?? FOLLOW_KINDS;
    for (const kind of kinds) {
      const { order, cyclic } = orderTargets(f, env, kind);
      for (const p of cyclic) {
        if (opts.profile && p !== opts.profile) continue;
        f.targets[targetKey(kind, p)] = record(env, f.targets[targetKey(kind, p)], { state: "failed", detail: "its source follows it back (a cycle) — point one of them elsewhere" });
      }
      for (const p of order) {
        if (opts.profile && p !== opts.profile) continue;
        const r = kind === "claude" ? syncClaudeTarget(f, env, p, opts) : syncDesktopTarget(f, env, p, { force: opts.force });
        if (r) f.targets[targetKey(kind, p)] = r;
      }
    }
    writeFollow(f, env.root);
    return report(f, env, true);
  });
  return out ?? report(readFollow(env.root), env, false);
}

/** Before a Desktop start through agent-switch: apply what waits for this profile. */
export function syncDesktopBeforeLaunch(profile: string, env: FollowEnv = liveEnv()): TargetRecord | null {
  return withLock(env.root, () => {
    const f = readFollow(env.root);
    const r = syncDesktopTarget(f, env, profile, { create: true });
    if (r) f.targets[targetKey("claude-desktop", profile)] = r;
    writeFollow(f, env.root);
    return r;
  });
}

export function report(f: FollowFile, env: FollowEnv, ran: boolean): SyncReport {
  const targets: SyncReport["targets"] = [];
  for (const kind of FOLLOW_KINDS) {
    for (const p of env.profiles) {
      const key = targetKey(kind, p);
      const t = f.targets[key];
      const rel = relationOf(f, env, kind, p);
      if (!t && kind === "claude-desktop") continue;
      targets.push({ key, source: rel.source, state: rel.enabled ? (t?.state ?? "unsynced") : "off", detail: rel.enabled ? (t?.detail ?? "") : "does not follow" });
    }
  }
  return { ran, confirmNew: f.confirmNew, targets };
}
