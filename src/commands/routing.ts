/**
 * Which profile a start resolves to: dir, map, unmap, mappings, guard, picks, pool.
 */

import {
  configDir,
  die,
  identity,
  listProfiles,
  profileExists,
  requireProfile,
  activeFor,
  isDisabled,
  sharesDefaultLogin,
  readBinaryPath,
  readGuard,
  readStrategy,
  setStrategy,
  setGuard,
} from "../profiles.js";
import { spawnSync } from "node:child_process";

import { ProviderId, PROVIDER_IDS, provider, resolveBinary } from "../providers.js";
import { readProtection } from "../protection.js";
import {
  POOL_PREFIX,
  addPoolMember,
  createPool,
  deletePool,
  findPool,
  isPoolRef,
  poolIdOf,
  readPools,
  removePoolMember,
  renamePool,
  suggestPoolsFromLabels,
} from "../pools.js";
import { START_STRATEGIES, resolveForDir, type StartStrategy } from "../dir-resolve.js";
import { appendPick, readPicks, PICKS_MAX_LINES } from "../picks.js";
import { GUARD_POLICIES, GUARD_REFUSED_EXIT, GuardPolicy, OVERRIDE_ENV, isGuardPolicy } from "../single-load.js";
import { mappingRows, removeMapping, resolveMapping, setMapping, setPaused, normalizePath } from "../mappings.js";
import { liveSessionPids } from "../api.js";
import { cachedUsage, checkSingleLoad, launch, logActivity, parseMemberArg, tildePath } from "./shared.js";

/** Profile names are validated by `profileDir`, which exits on a bad name —
 *  a pool ref or a stale mapping must never kill the shell wrapper's hot path. */
function profileExistsSafe(providerId: ProviderId, name: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(name) && profileExists(providerId, name);
}

export function resolveDir(
  providerId: ProviderId,
  plain = false,
  cwd = process.cwd(),
  exclude: readonly string[] = [],
): { name: string | null; why: string[]; blocked?: string; note?: string } {
  const r = resolveForDir({
    providerId,
    mapping: plain ? null : resolveMapping(process.cwd(), providerId),
    names: listProfiles(providerId),
    threshold: (n) => readProtection(providerId, n).thresholdPct,
    active: activeFor(providerId),
    exists: (n) => profileExistsSafe(providerId, n),
    signedIn: (n) => identity(providerId, n) !== null,
    // An excluded account is out for THIS start only — the caller just saw it
    // fail (a limit, an outage) and asks for another one.
    disabled: (n) => isDisabled(providerId, n) || exclude.includes(n),
    sharesDefaultLogin: (n) => profileExistsSafe(providerId, n) && sharesDefaultLogin(providerId, n),
    pool: (id) => findPool(id),
    usage: (n) => cachedUsage(providerId, n),
    // Only providers that write a live-session signal can report one. A start
    // from inside a session on that profile (its env var inherited) is a child,
    // not a second load, so the profile does not count as busy for it.
    live: (n) => {
      const p = provider(providerId);
      const dir = configDir(providerId, n);
      return p.hasLiveSessionSignal && process.env[p.envVar] !== dir && liveSessionPids(dir).length > 0;
    },
    guard: readGuard(),
    strategy: readStrategy(providerId),
    now: Date.now(),
    displayPath: tildePath,
  });
  // The resolver says "disabled" for any account it may not use; name the
  // caller's exclusion as such so `picks` does not read like a setting changed.
  return exclude.length === 0 ? r : { ...r, why: r.why.map((w) => w.replace(/^Skipped (\S+?\/(\S+)): disabled$/, (m, key, n) => (exclude.includes(n) && !isDisabled(providerId, n) ? `Skipped ${key}: excluded by the caller` : m))) };
}

/**
 * Resolve which profile a shell wrapper should load: directory mapping (nearest
 * ancestor of CWD) > active-for-provider. Empty output → the wrapper falls back
 * to the default config dir.
 *
 * With `--guard`, stdout is unchanged (the wrapper still reads the path from
 * it) and notes go to STDERR. Only a folder rule that cannot be served exits
 * {@link GUARD_REFUSED_EXIT}; a busy account never does — the resolver moves to
 * a free one or shares the best. The distinct exit code lets the wrapper block
 * on that refusal without ever blocking on a missing or older `agent-switch`.
 */
export function cmdDir(providerId: ProviderId, guarded = false, json = false, plain = false, exclude: readonly string[] = []): void {
  const r = resolveDir(providerId, plain, process.cwd(), exclude);
  if (json) {
    console.log(
      JSON.stringify(
        {
          profile: r.name ? `${providerId}/${r.name}` : null,
          configDir: r.name ? configDir(providerId, r.name) : null,
          why: r.why,
          ...(r.blocked ? { blocked: r.blocked } : {}),
          ...(r.note ? { note: r.note } : {}),
        },
        null,
        2,
      ),
    );
    if (r.blocked) process.exit(GUARD_REFUSED_EXIT);
    return;
  }
  // A wrapped start is a real pick — record it for `agent-switch picks`.
  if (guarded) appendPick({ provider: providerId, chosen: r.name ? `${providerId}/${r.name}` : null, why: r.why, blocked: r.blocked, note: r.note });
  // A folder rule that cannot be served refuses — starting on an account
  // outside the rule is the one outcome the rule exists to prevent.
  if (r.blocked) {
    console.error(`agent-switch: not starting here — ${r.blocked}.`);
    process.exit(GUARD_REFUSED_EXIT);
  }
  const name = r.name;
  if (!name) return;
  console.log(configDir(providerId, name));
  if (!guarded) return;
  // The resolver already moved off a busy account where a free one exists, so
  // a wrapped start that lands on a busy account has no better option: it is
  // shared, never refused. One line says so.
  if (r.note) {
    console.error(`agent-switch: ${r.note}.`);
    return;
  }
  const guard = checkSingleLoad(providerId, name);
  if (guard.verdict === "allow") return;
  const n = guard.inspection.sessions.length;
  console.error(`agent-switch: ${providerId}/${name} already has ${n} live session${n === 1 ? "" : "s"} — starting another one on it.`);
}

export function cmdMap(providerId: ProviderId, name?: string, dir?: string, flags: Record<string, string | boolean> = {}): void {
  if (flags.pause || flags.resume) {
    // `map --pause [dir]`: the positional is the folder, there is no profile.
    const target = name ?? process.cwd();
    const on = !!flags.pause;
    if (!setPaused(target, providerId, on)) die(`no mapping for ${target} (${providerId})`);
    console.log(on
      ? `Paused the ${providerId} rule for ${normalizePath(target)} — it stays listed but no longer picks the account. Resume: agent-switch map --resume ${target}`
      : `Resumed the ${providerId} rule for ${normalizePath(target)}.`);
    return;
  }
  if (name && isPoolRef(name)) {
    const pool = findPool(poolIdOf(name));
    if (!pool) die(`no pool "${poolIdOf(name)}" — create it with: agent-switch pool create <name>`);
    const key = setMapping(dir ?? process.cwd(), providerId, `${POOL_PREFIX}${pool.id}`);
    console.log(`Mapped ${key} -> pool ${pool.id} (${providerId})`);
    console.log(`\`${provider(providerId).binary}\` here starts on the ${providerId} member of "${pool.name}" with the most fresh headroom. See why: agent-switch dir --json`);
    return;
  }
  const n = requireProfile(providerId, name, `map [--provider ${providerId}] <profile|pool:<id>> [dir]`);
  const key = setMapping(dir ?? process.cwd(), providerId, n);
  console.log(`Mapped ${key} -> ${providerId}/${n}`);
  console.log(`\`${provider(providerId).binary}\` in this directory (and subdirectories) now uses this profile.`);
}

export function cmdUnmap(providerId: ProviderId | undefined, dir?: string): void {
  const target = dir ?? process.cwd();
  if (removeMapping(target, providerId)) console.log(`Removed mapping for ${target}${providerId ? ` (${providerId})` : ""}`);
  else die(`no mapping for ${target}${providerId ? ` (${providerId})` : ""}`);
}

export function cmdMappings(json = false): void {
  const rows = mappingRows();
  if (json) {
    console.log(JSON.stringify(rows.map((r) => ({ path: r.path, provider: r.provider, target: r.name, paused: r.paused }))));
    return;
  }
  if (rows.length === 0) {
    console.log("No directory mappings. Create one with: agent-switch map <profile> [dir]");
    return;
  }
  for (const r of rows) {
    const line = isPoolRef(r.name) ? `${r.path} -> ${r.name} (${r.provider})` : `${r.path} -> ${r.provider}/${r.name}`;
    console.log(r.paused ? `${line}  [paused]` : line);
  }
}

/**
 * `agent-switch guard [block|warn|off]` — read or set the single-load policy.
 * The bare form also reports what is loaded RIGHT NOW, because "what is my
 * policy" and "is anything currently doubled" are the same question in practice.
 */
export function cmdGuard(value?: string, json = false): void {
  if (value !== undefined) {
    if (!isGuardPolicy(value)) {
      die(`unknown guard policy "${value}" (choose: ${GUARD_POLICIES.join(", ")})`);
    }
    setGuard(value);
    logActivity("guard", null, `set ${value}`, "user ran `agent-switch guard`");
  }
  const policy = readGuard();

  // Every profile of every provider that can report a live session.
  const rows: { provider: ProviderId; name: string; sessions: number }[] = [];
  for (const pid of PROVIDER_IDS) {
    if (!provider(pid).hasLiveSessionSignal) continue;
    for (const n of listProfiles(pid)) {
      const count = liveSessionPids(configDir(pid, n)).length;
      if (count > 0) rows.push({ provider: pid, name: n, sessions: count });
    }
  }

  if (json) {
    console.log(JSON.stringify({ policy, loaded: rows }, null, 2));
    return;
  }

  const explain: Record<GuardPolicy, string> = {
    block: "a second session moves to a free profile, and shares the best one when none is free",
    warn: "a second session is reported, then allowed",
    off: "no check at all",
  };
  console.log(`Single-load guard: ${policy} — ${explain[policy]}.`);

  if (rows.length === 0) {
    console.log("No profile is currently loaded by a live session.");
  } else {
    console.log("");
    for (const r of rows) {
      const doubled = r.sessions > 1;
      const mark = doubled ? "⚠️ " : "  ";
      const detail = doubled ? `loaded ${r.sessions}× — no free profile was left` : "1 live session";
      console.log(`${mark} ${`${r.provider}/${r.name}`.padEnd(24)} ${detail}`);
    }
  }

  const inert = PROVIDER_IDS.filter((pid) => !provider(pid).hasLiveSessionSignal && listProfiles(pid).length > 0);
  if (inert.length > 0) {
    console.log("");
    console.log(`Not covered: ${inert.join(", ")} — these CLIs do not register a running session on disk,`);
    console.log("so agent-switch has no way to tell a second load from a first.");
  }
  if (policy !== "off") {
    console.log("");
    console.log(`Override once: ${OVERRIDE_ENV}=1 <binary>    ·    Change: agent-switch guard <${GUARD_POLICIES.join("|")}>`);
  }
}

export function cmdPicks(flags: Record<string, string | boolean>): void {
  const limit = typeof flags.limit === "string" ? Number(flags.limit) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) die("--limit must be a whole number of at least 1");
  const entries = readPicks(limit ?? (flags.json ? undefined : 20));
  if (flags.json) return void console.log(JSON.stringify({ entries, capacity: PICKS_MAX_LINES }, null, 2));
  if (entries.length === 0) return void console.log("No picks recorded yet. A start through the shell wrapper records one.");
  for (const e of entries) {
    const what = e.blocked ? `refused — ${e.blocked}` : (e.chosen ?? `${e.provider} default install`);
    console.log(`${e.at}  ${what}${e.note ? `  (${e.note})` : ""}`);
    for (const w of e.why) console.log(`    ${w}`);
  }
}

function poolMappings(id: string): string[] {
  return mappingRows().filter((r) => r.name === `${POOL_PREFIX}${id}`).map((r) => `${r.path} (${r.provider})`);
}

export function cmdPool(sub: string | undefined, args: string[], flags: Record<string, string | boolean>): void {
  const usageLine =
    "usage: agent-switch pool [list] [--json] | pool create <name> | pool rename <id> <name> | pool delete <id> | pool add <id> <provider/name> | pool remove <id> <provider/name> | pool suggest [--confirm] [--json]";
  const json = !!flags.json;
  const out = (v: unknown, text: string) => console.log(json ? JSON.stringify(v, null, 2) : text);
  try {
    switch (sub) {
      case undefined:
      case "list": {
        const pools = readPools().map((p) => ({ ...p, rules: poolMappings(p.id) }));
        if (json) return void console.log(JSON.stringify(pools, null, 2));
        if (pools.length === 0) return void console.log("No pools. Pools are optional — create one with: agent-switch pool create <name>");
        for (const p of pools) {
          console.log(`${p.id}  "${p.name}"  ${p.members.length ? p.members.join(", ") : "(no members)"}${p.rules.length ? `  · folders: ${p.rules.join(", ")}` : ""}`);
        }
        return;
      }
      case "create": {
        if (!args[0]) die(usageLine);
        const p = createPool(args.join(" "));
        logActivity("pool", p.id, "created", "user ran `agent-switch pool create`");
        return out(p, `Created pool ${p.id} ("${p.name}"). Add members: agent-switch pool add ${p.id} <provider/name>`);
      }
      case "rename": {
        if (!args[0] || !args[1]) die(usageLine);
        const p = renamePool(args[0], args.slice(1).join(" "));
        logActivity("pool", p.id, `renamed to "${p.name}"`, "user ran `agent-switch pool rename`");
        return out(p, `Pool ${p.id} is now called "${p.name}" (its id and folder rules are unchanged).`);
      }
      case "delete": {
        if (!args[0]) die(usageLine);
        const rules = poolMappings(args[0]);
        if (rules.length > 0) die(`pool "${args[0]}" is used by folder rules: ${rules.join(", ")}. Remove them first (agent-switch unmap <dir>).`);
        deletePool(args[0]);
        logActivity("pool", args[0], "deleted", "user ran `agent-switch pool delete`");
        return out({ deleted: args[0] }, `Deleted pool ${args[0]}. Its profiles are untouched.`);
      }
      case "add":
      case "remove": {
        if (!args[0]) die(usageLine);
        const m = parseMemberArg(args[1], usageLine);
        if (sub === "add") requireProfile(m.provider, m.name, "pool add");
        const key = `${m.provider}/${m.name}`;
        const p = sub === "add" ? addPoolMember(args[0], key) : removePoolMember(args[0], key);
        logActivity("pool", p.id, `${sub === "add" ? "added" : "removed"} ${key}`, `user ran \`agent-switch pool ${sub}\``);
        return out(p, `${sub === "add" ? "Added" : "Removed"} ${key} ${sub === "add" ? "to" : "from"} pool ${p.id}.`);
      }
      case "suggest": {
        const proposals = suggestPoolsFromLabels();
        if (!flags.confirm) {
          if (json) return void console.log(JSON.stringify({ preview: true, proposals }, null, 2));
          if (proposals.length === 0) return void console.log("No labelled profiles — nothing to suggest.");
          console.log("Preview — nothing is created until you run `agent-switch pool suggest --confirm`:");
          for (const p of proposals) console.log(`  ${p.id}  ${p.members.join(", ")}${p.exists ? "  (exists — skipped)" : ""}`);
          return;
        }
        const created: string[] = [];
        for (const prop of proposals) {
          if (prop.exists) continue;
          const pool = createPool(prop.name);
          for (const m of prop.members) addPoolMember(pool.id, m);
          created.push(pool.id);
          logActivity("pool", pool.id, `created from label ${prop.name}`, "user confirmed `agent-switch pool suggest`");
        }
        return out({ created }, created.length ? `Created pools: ${created.join(", ")}.` : "Nothing to create.");
      }
      default:
        die(usageLine);
    }
  } catch (e) {
    die((e as Error).message);
  }
}

/**
 * `agent-switch exec [--provider P] [--exclude a,b] [--plain] -- <args…>` — the
 * shellenv wrapper for callers that are not a shell. A tool that spawns
 * `codex exec …` as a subprocess never runs the wrapper function, so it always
 * lands on the default login; `agent-switch exec --provider codex -- exec …`
 * resolves the account exactly like a wrapped start (folder rule > balanced
 * pick > active), records the pick, and runs the binary with the provider's
 * env var set. Exit code, stdin/stdout/stderr pass straight through.
 *
 * No usable account → the binary runs on its own default login, as the wrapper
 * does, with one line on stderr saying so. A folder rule that cannot be served
 * refuses with {@link GUARD_REFUSED_EXIT}.
 */
export function cmdExec(a: { providerId: ProviderId; exclude: string[]; plain: boolean; args: string[] }): void {
  const r = resolveDir(a.providerId, a.plain, process.cwd(), a.exclude);
  appendPick({ provider: a.providerId, chosen: r.name ? `${a.providerId}/${r.name}` : null, why: r.why, blocked: r.blocked, note: r.note });
  if (r.blocked) {
    console.error(`agent-switch: not starting here — ${r.blocked}.`);
    process.exit(GUARD_REFUSED_EXIT);
  }
  const p = provider(a.providerId);
  if (!r.name) {
    console.error(`agent-switch: no usable ${a.providerId} account${a.exclude.length ? ` besides ${a.exclude.join(", ")}` : ""} — starting on ${p.binary}'s own default login.`);
    const res = spawnSync(resolveBinary(p.binary, readBinaryPath(a.providerId)), a.args, { stdio: "inherit" });
    process.exit(res.status ?? 1);
  }
  if (r.note) console.error(`agent-switch: ${r.note}.`);
  process.exit(launch(p, r.name, a.args));
}

/** `agent-switch strategy [balance|fill] [--provider P] [--json]` — how a start
 *  with no folder rule picks its account. `balance` (default) spreads starts by
 *  what each account would lose at its reset; `fill` stays on the preferred
 *  account until it reaches its limit. */
export function cmdStrategy(providerId: ProviderId, sub: string | undefined, json = false): void {
  if (sub !== undefined && sub !== "status") {
    if (!(START_STRATEGIES as readonly string[]).includes(sub)) die("usage: agent-switch strategy [balance|fill|status] [--provider P] [--json]");
    const next = sub as StartStrategy;
    if (readStrategy(providerId) !== next) {
      setStrategy(providerId, next);
      logActivity("settings", null, `${providerId} start strategy ${next}`, "user changed it");
    }
  }
  const strategy = readStrategy(providerId);
  if (json) {
    console.log(JSON.stringify({ provider: providerId, strategy }));
    return;
  }
  console.log(
    strategy === "fill"
      ? `${providerId}: fill — new starts stay on the preferred account until it reaches its limit, then go to the one with the most headroom.`
      : `${providerId}: balance — new starts go to the account that would lose the most at its next reset.`,
  );
}
