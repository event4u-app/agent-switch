/**
 * Automatic re-verification of Claude Code's credential-store contract for a CC
 * version outside rebind's pinned set (R0.6 follow-up).
 *
 * rebind relies on three internal CC facts (scripts/spikes/README.md § Per-CC-
 * version canary): keychain naming, the refresh-lock protocol, the keychain read
 * cache. CC auto-updates, so instead of blocking every switch until someone pins
 * the new version by hand, this reads the installed CC bundle and checks that each
 * fact still has the shape rebind was proven against. Every check fails CLOSED: a
 * pattern that cannot be found is a refusal, never a pass — a minifier change only
 * costs a manual re-pin, never a blind write into the wrong store.
 *
 * This is a static check. It cannot observe runtime behaviour, which is why the
 * pinned set (live-verified) stays the primary gate and this is only the fallback.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as nodePath from "node:path";

import { STALENESS_MS, TOUCH_INTERVAL_MS } from "./locks.js";
import { ROOT } from "./profiles.js";

export type ContractFact = "binary" | "version" | "keychain-naming" | "legacy-lock" | "lock-timing" | "cache-ttl";

export interface ContractFinding {
  fact: ContractFact;
  ok: boolean;
  detail: string;
}

export interface ContractVerdict {
  ok: boolean;
  findings: ContractFinding[];
}

/** Longest keychain read cache rebind's pickup latency was accepted with. */
export const MAX_CACHE_TTL_MS = 30_000;

const ID = "[\\w$]+";
const NUM = "(\\d+(?:\\.\\d+)?(?:e\\d+)?)";
const HASH_RE = new RegExp(`${ID}\\("sha256"\\)\\.update\\(${ID}\\)\\.digest\\("hex"\\)\\.(?:substring|slice)\\(0,8\\)`, "g");
const LEGACY_LOCK_RE = new RegExp(`\`\\$\\{await ${ID}\\(${ID}\\)\\.catch\\(\\(\\)=>${ID}\\)\\}\\.lock\``, "g");
const CACHE_READ_RE = new RegExp(`Date\\.now\\(\\)-${ID}\\.cachedAt<(${ID})`, "g");

/** Anchors whose surroundings carry every fact; the binary is reduced to windows around them. */
const ANCHORS = ["Version: ", '"-credentials"', ".oauth_refresh.lock", "legacy_lock", ".cachedAt<", "}.lock`"];
const WINDOW = 5000;
const MAX_HITS_PER_ANCHOR = 200;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function near(text: string, at: number, radius: number): string {
  return text.slice(Math.max(0, at - radius), at + radius);
}

function finding(fact: ContractFact, ok: boolean, detail: string): ContractFinding {
  return { fact, ok, detail };
}

function checkVersion(text: string, version: string): ContractFinding {
  const ok = new RegExp(`Version: ${escapeRe(version)}(?![\\d.])`).test(text);
  return finding("version", ok, ok ? `bundle is ${version}` : `scanned bundle is not ${version} (stale binary on PATH?)`);
}

function checkNaming(text: string): ContractFinding {
  for (const m of text.matchAll(HASH_RE)) {
    const w = near(text, m.index!, 1000);
    if (w.includes('"-credentials"') && w.includes('.normalize("NFC")') && w.includes("`Claude Code${")) {
      return finding("keychain-naming", true, `"Claude Code-credentials-" + sha256(NFC(dir))[:8]`);
    }
  }
  return finding("keychain-naming", false, `no "Claude Code-credentials-<sha256(NFC(dir))[:8]>" derivation found`);
}

function checkLegacyLock(text: string): ContractFinding {
  for (const m of text.matchAll(LEGACY_LOCK_RE)) {
    if (text.slice(m.index!, m.index! + 2000).includes("legacy_lock")) {
      return finding("legacy-lock", true, "OAuth refresh still acquires <config_dir>.lock");
    }
  }
  return finding("legacy-lock", false, "OAuth refresh no longer provably takes <config_dir>.lock — our lock may not exclude it");
}

function checkLockTiming(text: string): ContractFinding {
  let i = -1;
  while ((i = text.indexOf(".oauth_refresh.lock", i + 1)) !== -1) {
    const w = text.slice(i, i + 300);
    const stale = w.match(new RegExp(`stale:${NUM}`));
    const update = w.match(new RegExp(`update:${NUM}`));
    if (!stale || !update) continue;
    const s = Number(stale[1]);
    const u = Number(update[1]);
    // CC's touch must keep a live holder fresh under OUR staleness rule, and CC's
    // stale window must outlast OUR touch — else either side could steal a live lock.
    const ok = u <= STALENESS_MS / 2 && s >= 2 * TOUCH_INTERVAL_MS;
    return finding(
      "lock-timing",
      ok,
      `CC lock stale ${s} ms / touch ${u} ms vs ours stale ${STALENESS_MS} ms / touch ${TOUCH_INTERVAL_MS} ms`,
    );
  }
  return finding("lock-timing", false, "OAuth refresh lock options (stale/update) not found");
}

function checkCacheTtl(text: string): ContractFinding {
  for (const m of text.matchAll(CACHE_READ_RE)) {
    if (!near(text, m.index!, 1500).includes("find-generic-password")) continue;
    const def = text.match(new RegExp(`(?:var|let|const) ${escapeRe(m[1])}=${NUM}[,;]`));
    if (!def) return finding("cache-ttl", false, `keychain cache TTL constant ${m[1]} not resolvable`);
    const ttl = Number(def[1]);
    const ok = ttl <= MAX_CACHE_TTL_MS;
    return finding("cache-ttl", ok, `keychain read cache ${ttl} ms (max ${MAX_CACHE_TTL_MS} ms)`);
  }
  return finding("cache-ttl", false, "keychain read-cache check not found");
}

/** Pure analysis of a (possibly reduced) CC bundle text for the running `version`. */
export function analyzeCCContract(text: string, version: string): ContractVerdict {
  const findings = [checkVersion(text, version), checkNaming(text), checkLegacyLock(text), checkLockTiming(text), checkCacheTtl(text)];
  return { ok: findings.every((f) => f.ok), findings };
}

/** Windows around every anchor, plus the cache-TTL constant's definition, as one string. */
function reduceBinary(buf: Buffer): string {
  const windows: string[] = [];
  const collect = (needle: string) => {
    let i = -1;
    let hits = 0;
    while ((i = buf.indexOf(needle, i + 1, "latin1")) !== -1 && hits++ < MAX_HITS_PER_ANCHOR) {
      windows.push(buf.toString("latin1", Math.max(0, i - WINDOW), i + WINDOW));
    }
  };
  ANCHORS.forEach(collect);
  // The TTL constant can live far from its use site — fetch its definition explicitly.
  for (const m of windows.join("\n").matchAll(CACHE_READ_RE)) {
    collect(`var ${m[1]}=`);
    collect(`let ${m[1]}=`);
  }
  return windows.join("\n");
}

/** The real file behind `claude` on PATH, or null when it cannot be found. */
function locateClaudeBinary(): string | null {
  try {
    const onPath = execFileSync("/usr/bin/which", ["claude"], { encoding: "utf8", timeout: 5000 }).trim();
    return onPath ? fs.realpathSync(onPath) : null;
  } catch {
    return null;
  }
}

interface CacheEntry {
  path: string;
  size: number;
  mtimeMs: number;
  verdict: ContractVerdict;
}

function readCache(file: string): Record<string, CacheEntry> {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, CacheEntry>;
  } catch {
    return {};
  }
}

export interface VerifyOptions {
  /** Explicit binary path; `null` = not installed; omitted = resolve `claude` on PATH. */
  binaryPath?: string | null;
  cacheFile?: string;
  readBinary?: (path: string) => Buffer;
}

/**
 * Verify the installed CC bundle for `version`. The verdict is cached per version
 * and invalidated when the binary's path, size or mtime changes, so the ~300 MB
 * scan runs once per CC update, not once per switch.
 */
export function verifyCCBinary(version: string, opts: VerifyOptions = {}): ContractVerdict {
  const bin = opts.binaryPath === undefined ? locateClaudeBinary() : opts.binaryPath;
  if (!bin) return { ok: false, findings: [finding("binary", false, "claude binary not found on PATH")] };

  let stat: fs.Stats;
  try {
    stat = fs.statSync(bin);
  } catch {
    return { ok: false, findings: [finding("binary", false, `cannot stat ${bin}`)] };
  }

  const cacheFile = opts.cacheFile ?? nodePath.join(ROOT, ".cc-contract-cache.json");
  const cache = readCache(cacheFile);
  const hit = cache[version];
  if (hit && hit.path === bin && hit.size === stat.size && hit.mtimeMs === stat.mtimeMs) return hit.verdict;

  let verdict: ContractVerdict;
  try {
    verdict = analyzeCCContract(reduceBinary((opts.readBinary ?? fs.readFileSync)(bin)), version);
  } catch (err) {
    return { ok: false, findings: [finding("binary", false, `cannot read ${bin}: ${(err as Error).message}`)] };
  }

  cache[version] = { path: bin, size: stat.size, mtimeMs: stat.mtimeMs, verdict };
  try {
    fs.mkdirSync(nodePath.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2) + "\n");
  } catch {
    /* cache is an optimisation — a write failure only means the next switch rescans */
  }
  return verdict;
}
