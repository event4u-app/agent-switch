/**
 * Config-only cross-machine export/import (SAFE subset).
 *
 * Moves a profile's SHARED config — settings.json, keybindings.json, CLAUDE.md,
 * and the skills/, commands/, agents/ trees — between machines as a single
 * self-describing JSON bundle (base64-encoded file bodies). It handles NO
 * credentials: the allowlist is the exact `SHARED_ITEMS` set from `share.ts`,
 * and the account-scoped deny-set (`.claude.json`, `.credentials.json`,
 * `plugins/`, `sessions/`, `ide/`, `statsig/`) is excluded by construction —
 * we only ever walk allowlisted top-level names, and both export and import
 * additionally assert the top-level segment against the allowlist/deny-set.
 *
 * A `--full` variant that would bundle live OAuth tokens is deliberately NOT
 * implemented (see {@link assertNotFull}) — it is an account-takeover vector.
 *
 * Threat-model controls implemented here (untrusted bundle on import):
 *   - path shape guard: no absolute paths, no `..` traversal, no empty/`.`
 *     segments, top-level segment must be an allowlisted `SHARED_ITEMS` name.
 *   - path-confinement (zip-slip): the resolved real path must stay inside the
 *     target config dir.
 *   - bounded input: at most {@link MAX_ENTRIES} entries and {@link MAX_FILE_BYTES}
 *     per decoded file.
 *   - deny-set is never written even if present in the bundle (rejected).
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { SHARED_ITEMS } from "./share.js";

/** The single source of the allowlist — the same names `share.ts` links. */
const ALLOW = new Set(SHARED_ITEMS);

/** Account-/instance-scoped top-level names that must never be in a bundle.
 *  Kept in sync with the deny-set documented in `share.ts`'s header. Disjoint
 *  from ALLOW, so `!ALLOW.has(top)` already excludes these — asserted anyway
 *  for a clearer error and defense-in-depth. */
const DENY_SET = new Set([".claude.json", ".credentials.json", "plugins", "sessions", "ide", "statsig"]);

/** Bound untrusted input: refuse a bundle with more entries than this. */
export const MAX_ENTRIES = 5000;
/** Bound untrusted input: refuse a single decoded file larger than this. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export interface ConfigBundle {
  version: 1;
  /** Relative POSIX path → base64-encoded file body. */
  files: Record<string, string>;
}

export const FULL_REFUSAL =
  "--full (bundling live OAuth tokens) is intentionally not implemented — it is an account-takeover vector; export is config-only by design.";

/** Refuse the `--full` (credential-bundling) variant. Throws so callers can
 *  surface it via `die`; kept here because it is a config-transfer policy. */
export function assertNotFull(full: boolean): void {
  if (full) throw new Error(FULL_REFUSAL);
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function topSegment(relPosix: string): string {
  return relPosix.split("/")[0];
}

/** Add one file's body to the bundle, keyed by its POSIX-relative path. The
 *  top-level allowlist/deny-set assertion is redundant (we only walk allowlisted
 *  trees) but enforced regardless. */
function addFile(root: string, rel: string, out: Record<string, string>): void {
  const posix = toPosix(rel);
  const top = topSegment(posix);
  if (DENY_SET.has(top) || !ALLOW.has(top)) return; // excluded by construction — assert anyway
  out[posix] = fs.readFileSync(path.join(root, rel)).toString("base64");
}

/** Recursively collect files under an allowlisted directory tree. Follows
 *  symlinks to their real target (a `share on` link) so the bundle carries
 *  content, not a link we cannot reproduce on another machine; skips dangling
 *  links. */
function walkDir(root: string, relDir: string, out: Record<string, string>): void {
  const absDir = path.join(root, relDir);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const rel = `${relDir}/${entry.name}`;
    const abs = path.join(root, rel);
    let st: fs.Stats;
    try {
      st = fs.statSync(abs); // statSync (not lstat) follows a shared-mode link to its target
    } catch {
      continue; // dangling / unreadable
    }
    if (st.isDirectory()) walkDir(root, rel, out);
    else if (st.isFile()) addFile(root, rel, out);
  }
}

/**
 * Walk ONLY the SHARED_ITEMS allowlist (files + directory trees, recursively)
 * under `configDir`, base64-encode each file, and return a JSON bundle string.
 * The deny-set is never read (we only walk allowlisted names). Absent items are
 * skipped.
 */
export function exportConfig(configDir: string): string {
  const files: Record<string, string> = {};
  for (const name of SHARED_ITEMS) {
    const abs = path.join(configDir, name);
    let st: fs.Stats;
    try {
      st = fs.statSync(abs); // follow a top-level shared-mode link to its target
    } catch {
      continue; // absent / dangling
    }
    if (st.isFile()) addFile(configDir, name, files);
    else if (st.isDirectory()) walkDir(configDir, name, files);
  }
  const bundle: ConfigBundle = { version: 1, files };
  return JSON.stringify(bundle);
}

/**
 * Parse a config bundle and write its config-only files under `configDir`.
 * Returns the list of written relative paths. Rejects (throws) on any control
 * violation — an absolute path, `..` traversal, a non-allowlisted or deny-set
 * top-level segment, a path escaping the config dir, or an over-limit bundle.
 * Never writes a credential/deny-set path even if present.
 */
export function importConfig(configDir: string, bundleJson: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bundleJson);
  } catch {
    throw new Error("invalid config bundle: not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid config bundle: expected an object");
  }
  const b = parsed as Partial<ConfigBundle>;
  if (b.version !== 1) throw new Error(`unsupported config bundle version ${String((b as { version?: unknown }).version)} (expected 1)`);
  if (!b.files || typeof b.files !== "object" || Array.isArray(b.files)) {
    throw new Error("invalid config bundle: missing 'files' map");
  }

  const entries = Object.entries(b.files as Record<string, unknown>);
  if (entries.length > MAX_ENTRIES) {
    throw new Error(`config bundle has ${entries.length} entries (> ${MAX_ENTRIES}) — refusing`);
  }

  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const root = fs.realpathSync(configDir); // resolve symlinks once for the confinement check
  const coarseB64Limit = 4 * Math.ceil(MAX_FILE_BYTES / 3) + 4;
  const written: string[] = [];

  for (const [rawPath, value] of entries) {
    if (typeof value !== "string") throw new Error(`invalid bundle entry "${rawPath}": value is not a base64 string`);

    // (a) path shape guards — normalize any backslashes to POSIX for the checks.
    const rel = rawPath.replace(/\\/g, "/");
    if (path.isAbsolute(rawPath) || rel.startsWith("/")) {
      throw new Error(`refusing absolute path in bundle: "${rawPath}"`);
    }
    const segments = rel.split("/");
    if (segments.some((s) => s === "..")) throw new Error(`refusing path traversal ('..') in bundle: "${rawPath}"`);
    if (segments.some((s) => s === "" || s === ".")) throw new Error(`refusing malformed path in bundle: "${rawPath}"`);
    const top = segments[0];
    if (DENY_SET.has(top)) throw new Error(`refusing deny-set path in bundle: "${rawPath}" (account-scoped, never imported)`);
    if (!ALLOW.has(top)) throw new Error(`refusing non-allowlisted path in bundle: "${rawPath}"`);

    // bounded input: coarse check on the base64 length before allocating, then
    // a precise check on the decoded size.
    if (value.length > coarseB64Limit) throw new Error(`refusing oversized file "${rawPath}" (> ${MAX_FILE_BYTES} bytes)`);
    const buf = Buffer.from(value, "base64");
    if (buf.length > MAX_FILE_BYTES) throw new Error(`refusing oversized file "${rawPath}" (> ${MAX_FILE_BYTES} bytes)`);

    // (b) path-confinement / zip-slip: the resolved real path must stay inside root.
    const dest = path.resolve(root, rel);
    if (dest !== root && !dest.startsWith(root + path.sep)) {
      throw new Error(`refusing path escaping the config dir: "${rawPath}"`);
    }

    // (c) write the decoded body (mkdir -p parent).
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf, { mode: 0o600 });
    written.push(rel);
  }
  return written;
}
