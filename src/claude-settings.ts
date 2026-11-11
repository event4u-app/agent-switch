/**
 * One settings.json for every Claude profile. `~/.claude/settings.json` is the
 * source; each profile's own settings.json receives it on every change and
 * before every start that goes through agent-switch (launch, host start, and
 * the shell wrapper's `dir`). A link cannot do this: Claude Code writes its
 * settings by temp file + rename, which replaces a symlinked file with a copy
 * (see share.ts), and a profile that already had its own file was never linked.
 *
 * Merge, owner decision 2026-11-05 ("global wins"):
 *   - a value set globally replaces the profile's;
 *   - objects merge key by key; a list gets the global entries the profile
 *     lacks, appended, so an "always allow" Claude saved in a profile stays;
 *   - what only the profile has stays.
 * Undoing is exact because the sync remembers what it did (SNAPSHOT, per
 * profile): the list entries it ADDED, and for each value it wrote, the value
 * the profile had before. When the global file stops setting something, the
 * sync removes only the entries it added and puts the profile's earlier value
 * back — never a value or rule the profile had on its own, and never a value
 * the profile changed since.
 * Account-scoped settings never travel (ACCOUNT_KEYS / ACCOUNT_ENV): MCP
 * servers, login and auth settings, provider endpoints and credentials.
 * Commands inside hooks or a status line are copied as written.
 */

import * as fs from "node:fs";
import * as path from "node:path";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Obj = { [k: string]: Json };
export type SettingsObj = Obj;
export type SettingsJson = Json;

export const SNAPSHOT = ".agent-switch-global-settings.json";
/** The profile's file as it was before the first sync ever changed it. */
export const FIRST_BACKUP = "settings.json.pre-claude-settings";

/** Top-level settings that belong to one login or one machine's credentials. */
const ACCOUNT_KEYS = new Set([
  "mcpServers",
  "enabledMcpjsonServers",
  "disabledMcpjsonServers",
  "enableAllProjectMcpServers",
  "apiKeyHelper",
  "awsAuthRefresh",
  "awsCredentialExport",
  "otelHeadersHelper",
  "forceLoginMethod",
  "forceLoginOrgUUID",
]);
/** Environment variables that pick the account, the endpoint or carry credentials. */
const ACCOUNT_ENV = new Set([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_CUSTOM_HEADERS",
  "ANTHROPIC_BEDROCK_BASE_URL",
  "ANTHROPIC_VERTEX_BASE_URL",
  "ANTHROPIC_VERTEX_PROJECT_ID",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CONFIG_DIR",
  "GOOGLE_APPLICATION_CREDENTIALS",
]);
/** Credential-shaped names. `_TOKEN` only at the end: MAX_THINKING_TOKENS is a limit, not a secret. */
const SECRET_NAME = /(secret|password|passwd|credential|oauth|api[_-]?key|auth[_-]?token|access[_-]?token|_token$|^token$)/i;

/** True for a top-level settings key that must never leave its account. */
export function isAccountScopedKey(k: string): boolean {
  return ACCOUNT_KEYS.has(k) || SECRET_NAME.test(k);
}

/** True for an env entry that must never leave its account (a proxy with a password counts). */
export function isAccountScopedEnv(k: string, v: unknown): boolean {
  return ACCOUNT_ENV.has(k) || k.startsWith("AWS_") || SECRET_NAME.test(k) || (/_PROXY$/i.test(k) && typeof v === "string" && /\/\/[^/@\s]+@/.test(v));
}

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Key-order-independent JSON, so a reordered entry still counts as the same. */
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;
  return JSON.stringify(v) ?? "undefined";
}
const same = (a: unknown, b: unknown) => canon(a) === canon(b);
const has = (list: Json[], x: Json) => list.some((y) => same(x, y));

/** Own-property write: a key named `__proto__` stays an ordinary key. */
function put(o: Obj, k: string, v: Json): void {
  Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
}
const own = (o: Obj, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** The global settings without account-scoped entries, and the names left out. Pure. */
export function shareable(global: Obj): { value: Obj; withheld: string[] } {
  const withheld: string[] = [];
  const value: Obj = {};
  for (const [k, v] of Object.entries(global)) {
    if (isAccountScopedKey(k)) {
      withheld.push(k);
      continue;
    }
    if (k === "env" && isObj(v)) {
      const env: Obj = {};
      for (const [ek, ev] of Object.entries(v)) {
        if (isAccountScopedEnv(ek, ev)) withheld.push(`env.${ek}`);
        else put(env, ek, ev);
      }
      put(value, k, env);
      continue;
    }
    put(value, k, v);
  }
  return { value, withheld };
}

/** `global` with account-scoped values replaced, for showing the file in the app. Pure. */
export function masked(global: Obj): Obj {
  const out: Obj = {};
  for (const [k, v] of Object.entries(global)) {
    if (isAccountScopedKey(k)) put(out, k, "(hidden)");
    else if (k === "env" && isObj(v)) put(out, k, Object.fromEntries(Object.entries(v).map(([ek, ev]) => [ek, isAccountScopedEnv(ek, ev) ? "(hidden)" : ev])));
    else put(out, k, v);
  }
  return out;
}

/** What one sync did at one path: a value it wrote (and what was there before), or list entries it added. */
type Rec = { t: "v"; wrote: Json; prior?: Json } | { t: "l"; added: Json[]; created: boolean };
type Recs = Record<string, Rec>;
const keyOf = (p: string[]) => JSON.stringify(p);

function applyGlobal(g: Obj, p: Obj, pre: string[], st: Recs, next: Recs): void {
  for (const [k, gv] of Object.entries(g)) {
    const at = [...pre, k];
    const key = keyOf(at);
    const pv = own(p, k) ? p[k] : undefined;
    if (isObj(gv) && (pv === undefined || isObj(pv))) {
      const child: Obj = isObj(pv) ? pv : {};
      applyGlobal(gv, child, at, st, next);
      put(p, k, child);
      continue;
    }
    if (Array.isArray(gv) && (pv === undefined || Array.isArray(pv))) {
      const rec = st[key]?.t === "l" ? (st[key] as Extract<Rec, { t: "l" }>) : null;
      const added = rec?.added ?? [];
      // Entries this sync added earlier and the global list no longer has go; the profile's own stay.
      const list = (pv ?? []).filter((x) => !(has(added, x) && !has(gv, x)));
      const nowAdded = added.filter((x) => has(gv, x) && has(list, x));
      for (const x of gv) if (!has(list, x)) (list.push(x), nowAdded.push(x));
      put(p, k, list);
      next[key] = { t: "l", added: nowAdded, created: rec ? rec.created : pv === undefined };
      continue;
    }
    const rec = st[key]?.t === "v" ? (st[key] as Extract<Rec, { t: "v" }>) : null;
    const prior = rec ? ("prior" in rec ? { prior: rec.prior as Json } : {}) : pv === undefined ? {} : { prior: pv };
    put(p, k, gv);
    next[key] = { t: "v", wrote: gv, ...prior };
  }
}

/** Undo what `rec` did at `at` in `out`, unless the profile changed it since. Prunes objects left empty. */
function undo(out: Obj, at: string[], rec: Rec): void {
  const parents: Obj[] = [out];
  for (const k of at.slice(0, -1)) {
    const next = parents[parents.length - 1]![k];
    if (!isObj(next)) return;
    parents.push(next);
  }
  const parent = parents[parents.length - 1]!;
  const last = at[at.length - 1]!;
  if (!own(parent, last)) return;
  const cur = parent[last];
  if (rec.t === "v") {
    if (!same(cur, rec.wrote)) return; // the profile changed it: theirs now
    if ("prior" in rec) put(parent, last, rec.prior as Json);
    else delete parent[last];
  } else {
    if (!Array.isArray(cur)) return;
    const rest = cur.filter((x) => !has(rec.added, x));
    if (rest.length === 0 && rec.created) delete parent[last];
    else put(parent, last, rest);
  }
  for (let i = parents.length - 1; i > 0; i--) {
    if (Object.keys(parents[i]!).length > 0) break;
    delete parents[i - 1]![at[i - 1]!];
  }
}

/** A first-version snapshot (the bare global object): values count as written with no earlier value; list entries as the profile's own. */
function fromLegacy(g: Obj, pre: string[] = [], out: Recs = {}): Recs {
  for (const [k, v] of Object.entries(g)) {
    const at = [...pre, k];
    if (isObj(v)) fromLegacy(v, at, out);
    else if (Array.isArray(v)) out[keyOf(at)] = { t: "l", added: [], created: false };
    else out[keyOf(at)] = { t: "v", wrote: v };
  }
  return out;
}

function readState(snap: Obj | null): Recs {
  if (!snap) return {};
  if (snap.v === 2 && isObj(snap.recs)) return snap.recs as unknown as Recs;
  return fromLegacy(snap);
}

/** The profile's settings after applying `global`, and what to remember for next time. Pure. */
export function mergeSettings(global: Obj, profile: Obj, snapshot: Obj | null): { value: Obj; snapshot: Obj } {
  const st = readState(snapshot);
  const next: Recs = {};
  const out = structuredClone(profile);
  applyGlobal(global, out, [], st, next);
  for (const [key, rec] of Object.entries(st)) {
    if (key in next) continue;
    const at = JSON.parse(key) as string[];
    // Account-scoped entries are the profile's alone, whatever an older sync recorded.
    if (isAccountScopedKey(at[0]!) || (at[0] === "env" && at[1] !== undefined && isAccountScopedEnv(at[1], null))) continue;
    undo(out, at, rec);
  }
  return { value: out, snapshot: { v: 2, recs: next as unknown as Json } };
}

/** Keys (dotted, one level into objects) where the profile has more than the global file sets. Pure. */
export function profileExtras(profile: Obj, global: Obj): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(profile)) {
    const g = global[k];
    if (isAccountScopedKey(k)) continue;
    if (g === undefined) out.push(k);
    else if (isObj(v) && isObj(g))
      for (const [ik, iv] of Object.entries(v)) {
        if (!own(g, ik)) out.push(`${k}.${ik}`);
        else if (Array.isArray(iv) && Array.isArray(g[ik])) {
          const n = iv.filter((x) => !has(g[ik] as Json[], x)).length;
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

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Run `fn` holding `<file>.agent-switch.lock`. A lock older than 10 s is stale; waits up to 5 s. */
export function withLock<T>(file: string, fn: () => T): T {
  const lock = `${file}.agent-switch.lock`;
  fs.mkdirSync(path.dirname(lock), { recursive: true, mode: 0o700 });
  for (let waited = 0; ; waited += 25) {
    try {
      fs.closeSync(fs.openSync(lock, "wx"));
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 10_000) fs.unlinkSync(lock);
      } catch {
        /* released meanwhile */
      }
      if (waited >= 5_000) throw new Error(`${file} is being changed by another agent-switch process — try again`);
      sleep(25);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

export type SyncResult = "updated" | "in-sync" | "linked" | "invalid" | "no-global";

/**
 * Apply the global settings to one profile config dir. A settings.json that is
 * a link (to the global file, to another profile's under `share --source`, or
 * to a dotfiles copy) is left alone: it gets its settings where it points. An
 * unparseable file is reported, never overwritten. A missing or unparseable
 * global file changes nothing.
 */
export function syncProfileSettings(globalFile: string, configDir: string): SyncResult {
  const global = readJson(globalFile);
  if (!global) return "no-global";
  const file = path.join(configDir, "settings.json");
  try {
    if (fs.lstatSync(file).isSymbolicLink()) return "linked";
  } catch {
    /* absent */
  }
  const { value } = shareable(global);
  const snap = path.join(configDir, SNAPSHOT);
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  return withLock(file, () => {
    const firstRun = !fs.existsSync(snap);
    // Claude Code may save this file meanwhile; if it changed under us, merge again from the new content.
    for (let attempt = 0; attempt < 3; attempt++) {
      const raw = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
      let profile: Obj | null = {};
      if (raw !== null) {
        try {
          const v = JSON.parse(raw);
          profile = isObj(v) ? v : null;
        } catch {
          profile = null;
        }
      }
      if (profile === null) return "invalid";
      const merged = mergeSettings(value, profile, readJson(snap));
      const changed = raw === null || !same(merged.value, profile);
      if (changed && firstRun && raw !== null && !fs.existsSync(path.join(configDir, FIRST_BACKUP))) fs.copyFileSync(file, path.join(configDir, FIRST_BACKUP));
      const now = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
      if (now !== raw) continue;
      if (changed) writeJson(file, merged.value);
      writeJson(snap, merged.snapshot);
      return changed ? "updated" : "in-sync";
    }
    throw new Error(`${file} kept changing while agent-switch applied the settings — try again`);
  });
}

/** A settings path: `env.FOO`, or a JSON array (`["enabledPlugins","x@a.b"]`) for keys with dots. */
export function parsePath(arg: string): string[] {
  if (arg.trim().startsWith("[")) {
    const v = JSON.parse(arg);
    if (!Array.isArray(v) || v.length === 0 || !v.every((s) => typeof s === "string" && s !== "")) throw new Error("a JSON path is a non-empty array of non-empty strings");
    return v;
  }
  const segs = arg.split(".");
  if (segs.length === 0 || segs.some((s) => s === "")) throw new Error(`"${arg}" is not a settings path (use env.NAME, or a JSON array for keys with dots)`);
  return segs;
}

/** `global` with `value` at `at` (undefined removes it; empty parents go too). Pure. */
export function setPath(global: Obj, at: string[], value: Json | undefined): Obj {
  const [head, ...tail] = at;
  if (!head) throw new Error("empty settings path");
  const out: Obj = { ...global };
  if (tail.length === 0) {
    if (value === undefined) delete out[head];
    else put(out, head, value);
    return out;
  }
  const child = setPath(isObj(out[head]) ? (out[head] as Obj) : {}, tail, value);
  if (Object.keys(child).length === 0) delete out[head];
  else put(out, head, child);
  return out;
}

/** `global` with `rules` added to or removed from the list at `at`. Pure. */
export function toggleListEntries(global: Obj, at: string[], rules: string[], on: boolean): Obj {
  let cur: Json | undefined = global;
  for (const s of at) cur = isObj(cur) ? cur[s] : undefined;
  const list = Array.isArray(cur) ? cur.filter((x) => typeof x !== "string" || !rules.includes(x)) : [];
  const next = on ? [...list, ...rules.filter((r, i) => rules.indexOf(r) === i)] : list;
  return setPath(global, at, next.length ? next : undefined);
}

/** Write the global settings file (temp + rename, keeping its mode; through a dotfiles link). */
export function writeGlobal(globalFile: string, value: Obj): void {
  fs.mkdirSync(path.dirname(globalFile), { recursive: true, mode: 0o700 });
  writeJson(fs.existsSync(globalFile) ? fs.realpathSync(globalFile) : globalFile, value);
}
