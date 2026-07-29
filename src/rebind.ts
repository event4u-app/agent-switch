/**
 * `rebind` — the ONE sanctioned write path into Claude Code's credential store
 * (ADR-003). It points a *running* profile's store at another account so the
 * live Claude session adopts it on its next message — no relaunch, any terminal.
 *
 * Mechanism proven by the Phase-0 spikes against CC 2.1.218 (macOS): a swap of
 * the hashed Keychain entry under Claude Code's own lock is picked up by the
 * running session (r02); the lock is a real mutex and a MOVE keeps one token
 * family in one live store (r03).
 *
 * Scope of THIS slice (macOS Keychain only): `rebind` refuses on Linux/Windows —
 * the `.credentials.json` backend (spike R0.1) is not yet validated there.
 *
 * Move-semantics + safety: the target account's credential is moved INTO the
 * running profile's store and the target's own store is emptied, so the family
 * is live in exactly one store. Both original credentials are stashed in a
 * per-profile binding-marker BEFORE any mutation, so `--restore` fully reverses
 * it and a crash leaves a recoverable marker. Nothing is deleted without a stash.
 *
 * Deferred to later Phase-2 slices (see road-to-live-rebind.md), not built here:
 * live pid/process auto-detection, a global cross-profile binding registry +
 * global lock, provenance-fingerprint mismatch states, a rollback feature-flag /
 * circuit-breaker, and the Linux/Win backend.
 */

import { execFileSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as nodePath from "node:path";

import { fetchProfile } from "./api.js";
import * as keychain from "./keychain.js";
import { withProperLock } from "./locks.js";
import { configDir, ROOT, readRebindKillSwitch, writeRebindKillSwitch, type RebindKillSwitch } from "./profiles.js";
import { freshenToken } from "./token-freshen.js";

/** <10 min to expiry → refuse (2× Claude Code's own 5-min refresh buffer). */
export const FRESHEN_FLOOR_MS = 10 * 60 * 1000;
const MARKER_NAME = ".agent-switch-rebind.json";
const LENT_SUFFIX = ".rebind-lent";
const QUARANTINE_SUFFIX = ".rebind-quarantine";
/** Claude Code's own per-profile config file — carries the `oauthAccount` stamp. */
const CC_CONFIG_NAME = ".claude.json";

/** Circuit-breaker trip point: N consecutive `rebind()` failures → auto-disable. */
export const REBIND_FAILURE_LIMIT = 3;

/**
 * Global cross-profile binding registry (Council finding 2). The per-profile
 * marker cannot enforce the GLOBAL "one account bound to at most one profile"
 * invariant — two concurrent `rebind`s could bind one account to two profiles.
 * This registry (keyed by the target account/profile name) is read-checked and
 * written under a GLOBAL lock acquired OUTER to Claude Code's per-profile lock.
 */
const REGISTRY_NAME = ".agent-switch-rebind-registry.json";
/** Lock TARGET for the registry (withProperLock guards `<target>.lock`). */
const REGISTRY_LOCK_BASENAME = ".agent-switch-rebind-registry";

export interface RegistryEntry {
  runningProfile: string; // the running profile this account is currently bound INTO
  boundAt: string;
}
export type BindingRegistry = Record<string, RegistryEntry>;

/** Per-profile record of an active rebind — stashes both originals for restore. */
export interface BindingMarker {
  boundToProfile: string; // the profile whose account the running profile now serves
  boundAt: string;
  runningOwnCredential: string; // the running profile's own credential (to restore it)
  targetOrigCredential: string; // the target profile's own credential (to restore it)
  targetFileMoved: boolean; // whether the target's .credentials.json was moved aside
  /** The running profile's OWN `.claude.json` `oauthAccount` stamp, snapshotted
   *  before the swap. Claude Code overwrites that stamp with the BORROWED
   *  account's identity while the rebind is live; restore puts this back.
   *  Optional: markers written before this field existed restore without it. */
  runningOwnIdentity?: unknown;
}

/** Injectable side-effects so the write path is unit-testable without real IO. */
export interface RebindDeps {
  platform: NodeJS.Platform;
  now: () => number;
  serviceNameFor: (configDir: string) => string;
  kcGet: (service: string) => string | null;
  kcAdd: (service: string, value: string) => boolean;
  kcDelete: (service: string) => boolean;
  readFile: (path: string) => string | null;
  writeFile: (path: string, data: string) => void;
  removeFile: (path: string) => void;
  renameFile: (from: string, to: string) => void;
  exists: (path: string) => boolean;
  withLock: <T>(target: string, fn: () => T | Promise<T>) => Promise<T>;
  /** Read/persist the rebind rollback + circuit-breaker state (ADR-003). */
  readRebindState: () => RebindKillSwitch;
  writeRebindState: (s: RebindKillSwitch) => void;
  /** Delegate a token refresh to Claude Code for the target's config dir when its
   *  token is spent (`claude doctor`, no session/quota; ADR-004). */
  freshen: (configDir: string) => void;
  /** Raw `claude --version` output (e.g. "2.1.220 (Claude Code)"), or null when
   *  the binary can't be run. Feeds the CC-version-skew canary (R0.6). */
  claudeVersion: () => string | null;
  /** Authoritative account id behind a credential, or null when it cannot be
   *  established (offline, endpoint unreachable, token rejected). Consulted ONLY
   *  when the local fingerprint is inconclusive — see {@link compareAccounts}. */
  resolveAccount: (cred: string) => Promise<string | null>;
}

/**
 * Account ids already resolved in this process, keyed by a hash of the access
 * token (never the token itself). Only successes are cached, so an offline
 * failure is retried rather than remembered as "unknown".
 */
const resolvedAccounts = new Map<string, string>();

/**
 * Resolve the account behind a credential against Anthropic's profile endpoint —
 * the same read-only GET Claude Code itself uses. This is the ONLY way to tell
 * two accounts apart: a Claude Code credential carries no account claim at all
 * (just tokens, scopes, subscription tier), so nothing local identifies its owner.
 */
async function resolveAccountViaApi(cred: string): Promise<string | null> {
  const tok = accessToken(cred);
  if (!tok) return null;
  const key = crypto.createHash("sha256").update(tok).digest("hex");
  const hit = resolvedAccounts.get(key);
  if (hit) return hit;
  let profile: any = null;
  try {
    profile = await fetchProfile(tok);
  } catch {
    return null;
  }
  const account = profile?.account ?? null;
  const id = [account?.uuid, account?.email_address, account?.email].find((v) => typeof v === "string" && v.length > 0);
  if (typeof id !== "string") return null;
  resolvedAccounts.set(key, id);
  return id;
}

export function defaultDeps(): RebindDeps {
  return {
    platform: process.platform,
    now: () => Date.now(),
    serviceNameFor: keychain.serviceNameFor,
    kcGet: keychain.getPassword,
    kcAdd: keychain.addPassword,
    kcDelete: keychain.deletePassword,
    readFile: (p) => {
      try {
        return fs.readFileSync(p, "utf8");
      } catch {
        return null;
      }
    },
    writeFile: (p, data) => fs.writeFileSync(p, data, { mode: 0o600 }),
    removeFile: (p) => {
      try {
        fs.rmSync(p, { force: true });
      } catch {
        /* best-effort */
      }
    },
    renameFile: (from, to) => fs.renameSync(from, to),
    exists: (p) => fs.existsSync(p),
    withLock: withProperLock,
    readRebindState: readRebindKillSwitch,
    writeRebindState: writeRebindKillSwitch,
    freshen: (cfg) => {
      freshenToken(cfg);
    },
    claudeVersion: () => {
      try {
        return execFileSync("claude", ["--version"], { encoding: "utf8", timeout: 5000 }).trim() || null;
      } catch {
        return null;
      }
    },
    resolveAccount: resolveAccountViaApi,
  };
}

function credFile(cfgDir: string): string {
  return nodePath.join(cfgDir, ".credentials.json");
}
function markerFile(cfgDir: string): string {
  return nodePath.join(cfgDir, MARKER_NAME);
}

function accessToken(cred: string | null): string | null {
  if (!cred) return null;
  try {
    return JSON.parse(cred)?.claudeAiOauth?.accessToken ?? null;
  } catch {
    return null;
  }
}
function expiresAt(cred: string | null): number | null {
  if (!cred) return null;
  try {
    const v = JSON.parse(cred)?.claudeAiOauth?.expiresAt;
    return typeof v === "number" ? v : null;
  } catch {
    return null;
  }
}

/** Read a profile's live credential: Keychain first, then the plaintext file. */
function readCred(cfgDir: string, d: RebindDeps): string | null {
  return d.kcGet(d.serviceNameFor(cfgDir)) ?? d.readFile(credFile(cfgDir));
}

// ---------- identity stamp (`.claude.json` oauthAccount) ----------

function ccConfigFile(cfgDir: string): string {
  return nodePath.join(cfgDir, CC_CONFIG_NAME);
}

/**
 * The `oauthAccount` block Claude Code stamps into a config dir's `.claude.json`
 * whenever it fetches the account profile. This is the field `agent-switch list`
 * reports as the profile's owner (providers.ts `readIdentity`).
 */
function readStampedIdentity(cfgDir: string, d: RebindDeps): unknown | null {
  const raw = d.readFile(ccConfigFile(cfgDir));
  if (!raw) return null;
  try {
    const stamp = JSON.parse(raw)?.oauthAccount;
    return stamp && typeof stamp === "object" ? stamp : null;
  } catch {
    return null;
  }
}

/**
 * Put a profile's OWN identity stamp back into its `.claude.json`.
 *
 * While a profile is rebound, Claude Code fetches the BORROWED account's profile
 * under the running profile's config dir and stamps that account into this dir's
 * `oauthAccount`. Nothing used to un-stamp it, so a restored profile kept
 * reporting the lender's e-mail in `list` forever — the profile looked like it
 * belonged to the wrong account long after the credential was correct again.
 *
 * Claude Code guards `.claude.json` writes with a lock on the FILE (locks.ts),
 * not on the config dir, so the read-modify-write runs under that file lock —
 * acquired INSIDE the caller's dir lock (distinct targets, no reentrancy).
 * Best-effort by design: this runs on the recovery path, so a missing, corrupt,
 * or already-correct config file is skipped and never throws.
 */
async function restoreStampedIdentity(cfgDir: string, own: unknown, d: RebindDeps): Promise<boolean> {
  if (!own || typeof own !== "object") return false;
  const file = ccConfigFile(cfgDir);
  try {
    return await d.withLock(file, () => {
      const raw = d.readFile(file);
      if (!raw) return false;
      const cfg = JSON.parse(raw);
      if (!cfg || typeof cfg !== "object") return false;
      if (stableStringify(cfg.oauthAccount ?? null) === stableStringify(own)) return false;
      cfg.oauthAccount = own;
      d.writeFile(file, JSON.stringify(cfg, null, 2) + "\n");
      return true;
    });
  } catch {
    return false;
  }
}

// ---------- global binding registry (Council finding 2) ----------

function registryFile(): string {
  return nodePath.join(ROOT, REGISTRY_NAME);
}
/** Lock target for the global registry (outer to CC's per-profile lock). */
function registryLockTarget(): string {
  return nodePath.join(ROOT, REGISTRY_LOCK_BASENAME);
}

/** Read the global binding registry (corrupt / absent → empty). */
function readRegistry(d: RebindDeps): BindingRegistry {
  const raw = d.readFile(registryFile());
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const out: BindingRegistry = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        const e = v as Partial<RegistryEntry> | null;
        if (e && typeof e.runningProfile === "string" && typeof e.boundAt === "string") {
          out[k] = { runningProfile: e.runningProfile, boundAt: e.boundAt };
        }
      }
      return out;
    }
  } catch {
    /* corrupt registry → treat as empty */
  }
  return {};
}

function writeRegistry(reg: BindingRegistry, d: RebindDeps): void {
  d.writeFile(registryFile(), JSON.stringify(reg, null, 2) + "\n");
}

/** Read the whole registry (test/observability helper). */
export function readBindingRegistry(d: RebindDeps = defaultDeps()): BindingRegistry {
  return readRegistry(d);
}

// ---------- provenance fingerprint (Council finding 5) ----------

/** Deterministic JSON: object keys sorted recursively, so the hash is stable. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify((value as Record<string, unknown>)[k])).join(",") + "}";
}

/**
 * Stable account identity for a credential. Prefers an explicit stable claim in
 * `claudeAiOauth` (account/subscription id, email); otherwise a sha256 of the
 * `claudeAiOauth` object EXCLUDING the volatile token material
 * (`accessToken`/`refreshToken`/`expiresAt`) — so a token ROTATION keeps the same
 * fingerprint while a different ACCOUNT changes it. `id` is null only when the
 * credential is missing / unparseable / has no `claudeAiOauth` object.
 */
export function accountFingerprint(cred: string | null): { id: string | null } {
  if (!cred) return { id: null };
  let oauth: Record<string, unknown> | null;
  try {
    const parsed = JSON.parse(cred);
    oauth = parsed && typeof parsed.claudeAiOauth === "object" ? (parsed.claudeAiOauth as Record<string, unknown>) : null;
  } catch {
    return { id: null };
  }
  if (!oauth) return { id: null };

  // Prefer a stable identity claim, in precedence order.
  const account = (oauth.account ?? null) as Record<string, unknown> | null;
  const org = (oauth.organization ?? null) as Record<string, unknown> | null;
  const candidates: unknown[] = [
    oauth.accountUuid,
    account?.uuid,
    account?.account_uuid,
    oauth.accountId,
    account?.email_address,
    oauth.emailAddress,
    oauth.email,
    oauth.subscriptionId,
    oauth.organizationUuid,
    org?.uuid,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return { id: "claim:" + c };
  }

  // Fallback: hash the account-stable subset of the oauth object.
  // refreshTokenExpiresAt moves on every refresh-token rotation, so it is
  // token material, not account identity — including it made a rotated
  // credential of the SAME account fingerprint as "different".
  const rest: Record<string, unknown> = { ...oauth };
  delete rest.accessToken;
  delete rest.refreshToken;
  delete rest.expiresAt;
  delete rest.refreshTokenExpiresAt;
  const digest = crypto.createHash("sha256").update(stableStringify(rest), "utf8").digest("hex").slice(0, 16);
  return { id: "sha256:" + digest };
}

type FingerprintBranch = "same" | "rotated" | "different" | "unparseable" | "indeterminate";

/** Classify `actual` (what a store holds NOW) against `recorded` (what we expect). */
function fingerprintCompare(recorded: string | null, actual: string | null): FingerprintBranch {
  const rid = accountFingerprint(recorded).id;
  const aid = accountFingerprint(actual).id;
  if (rid === null || aid === null) return "unparseable";
  if (rid !== aid) return "different";
  return accessToken(recorded) === accessToken(actual) ? "same" : "rotated";
}

/**
 * The provenance verdict the write path acts on: {@link fingerprintCompare},
 * escalated to the account endpoint where the local answer cannot be trusted.
 *
 * Why the escalation exists: the local "rotated" verdict means *same fingerprint,
 * different access token*. That is conclusive only when the fingerprint came from
 * a stable account CLAIM. Real Claude Code credentials carry NO claim, so the
 * fallback hash covers only `scopes` + `subscriptionType` + `rateLimitTier` — every
 * account on the same plan tier hashes IDENTICALLY. A re-login to a DIFFERENT
 * account of the same tier was therefore indistinguishable from a token rotation,
 * and "rotated" authorizes moving a credential (swap) or writing it into another
 * profile's store (restore) — i.e. the blind spot let a foreign account's
 * credential be handed to the wrong profile.
 *
 * `"indeterminate"` when the accounts cannot be established (offline, endpoint
 * unreachable): callers must refuse WITHOUT mutating any store. Guessing "rotated"
 * there is precisely the unsafe assumption this replaces.
 */
async function compareAccounts(recorded: string | null, actual: string | null, d: RebindDeps): Promise<FingerprintBranch> {
  const local = fingerprintCompare(recorded, actual);
  if (local !== "rotated") return local;
  // A claim-backed fingerprint already proves the account — no lookup needed.
  if (accountFingerprint(recorded).id?.startsWith("claim:")) return "rotated";
  const [rid, aid] = await Promise.all([d.resolveAccount(recorded as string), d.resolveAccount(actual as string)]);
  if (!rid || !aid) return "indeterminate";
  return rid === aid ? "rotated" : "different";
}

/** The active binding on a running profile's config dir, or null. */
export function readBinding(cfgDir: string, d: RebindDeps = defaultDeps()): BindingMarker | null {
  const raw = d.readFile(markerFile(cfgDir));
  if (!raw) return null;
  try {
    const m = JSON.parse(raw);
    if (m && typeof m.boundToProfile === "string" && typeof m.runningOwnCredential === "string" && typeof m.targetOrigCredential === "string") {
      return m as BindingMarker;
    }
  } catch {
    /* corrupt marker → treat as none */
  }
  return null;
}

export class RebindError extends Error {}

/**
 * A guard REFUSAL: rebind declined before/without mutating any credential store
 * (wrong platform, not logged in, spent token, registry conflict, provenance
 * mismatch, …). Distinct from a real swap FAILURE so the circuit-breaker only
 * counts genuine write-path breakage — three refusals of a user retrying the
 * same doomed switch must never disable rebind entirely (that was the failure
 * mode: "already rebound" ×3 → breaker tripped → switching dead until --reset).
 */
export class RebindRefused extends RebindError {}

export interface RebindResult {
  boundToProfile: string;
  uxNote: string;
}

// ---------- credential-store contract canary (Council finding 3) ----------

/**
 * Pinned Keychain service-name shape from the Phase-0 spikes (see keychain.ts):
 * `"Claude Code-credentials-" + sha256(NFC(configDir)).hex[:8]`. rebind's whole
 * swap targets the entry under this name — if Claude Code's naming drifted, the
 * swap would read/write the wrong (or a non-existent) entry.
 */
export const PINNED_SERVICE_NAME_RE = /^Claude Code-credentials-[0-9a-f]{8}$/;

/**
 * Fail loud if Claude Code's credential-store naming contract drifted from what
 * the Phase-0 spikes pinned. Runs BEFORE any read or mutation in {@link rebind} —
 * a drift here means the swap could target the wrong Keychain entry, so we refuse
 * rather than mutate blind. Deliberately bounded: it checks the keychain-naming
 * shape only (the core Phase-0 contract), never Claude Code's version or install.
 *
 * Drift-response matrix (drift type → action → user message):
 *   keychain-name format changed → rebind disabled pending re-verification →
 *   "re-run the Phase-0 spikes to re-pin the contract before rebinding".
 */
export function canaryCheck(cfgDir: string, d: RebindDeps): void {
  const svc = d.serviceNameFor(cfgDir);
  if (!PINNED_SERVICE_NAME_RE.test(svc)) {
    throw new RebindError(
      `credential-store canary tripped: keychain-name format changed (${svc}) → ` +
        `rebind disabled pending re-verification (Claude Code's credential layout may have changed; ` +
        `re-run the Phase-0 spikes to re-pin the contract before rebinding).`,
    );
  }
}

// ---------- CC-version-skew canary (Council finding 4 / R0.6) ----------

/**
 * Claude Code versions whose credential-store contract the Phase-0 spikes
 * (R0.1–R0.4) actually verified. rebind's whole mechanism relies on CC's
 * *undocumented, internal* store contract (keychain-name shape, refresh-lock
 * protocol, cache TTL), which can change on ANY CC release — and CC auto-updates.
 * So the pin is a **verified set**, not a range: only add a version here after
 * re-running the Phase-0 spikes against it. (No major.minor tolerance — there is
 * no evidence CC applies semver semantics to its internal keychain contract.)
 */
export const PINNED_CC_VERSIONS: ReadonlySet<string> = new Set(["2.1.218"]);

/** Env var an operator sets, AFTER manually re-running the Phase-0 spikes
 *  against the running CC version, to proceed without a code release. It bypasses
 *  ONLY the verified-set membership check — never the keychain-name canary. */
export const CC_VERSION_OVERRIDE_ENV = "AGENT_SWITCH_CC_VERSION_OVERRIDE";

/** Canonical `major.minor.patch` from `claude --version` output
 *  ("2.1.220 (Claude Code)" → "2.1.220"); null when no semver is present. Pure. */
export function parseCCVersion(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(/\b(\d+\.\d+\.\d+)\b/);
  return m ? m[1] : null;
}

/**
 * Pure verified-set gate for the running CC version (R0.6). Fail-closed:
 *  - unparsable / undetectable version → refuse (indistinguishable from risk);
 *  - an `override` naming the SAME running version → pass (set-membership only);
 *  - version in the verified set → pass; otherwise → refuse with a re-verify path.
 * Kept pure (no deps, no env) so every branch is unit-tested directly.
 */
export function versionGuard(
  running: string | null,
  pinned: ReadonlySet<string> = PINNED_CC_VERSIONS,
  override: string | null = null,
): { ok: true } | { ok: false; reason: string } {
  const v = parseCCVersion(running);
  if (!v) {
    return {
      ok: false,
      reason: `could not determine the running Claude Code version (\`claude --version\` failed or was unparsable) — rebind refuses (fail-closed).`,
    };
  }
  if (override && parseCCVersion(override) === v) return { ok: true };
  if (pinned.has(v)) return { ok: true };
  return {
    ok: false,
    reason:
      `Claude Code ${v} is not in rebind's verified set {${[...pinned].join(", ")}}. ` +
      `rebind's credential-store contract is only proven for those versions, and a CC auto-update may have changed it. ` +
      `Re-run the Phase-0 spikes against ${v}, then set ${CC_VERSION_OVERRIDE_ENV}=${v} to proceed (or add ${v} to PINNED_CC_VERSIONS).`,
  };
}

/**
 * Fail loud if the running Claude Code version is not one the Phase-0 spikes
 * verified (R0.6). Runs BEFORE any read or mutation in {@link rebind}, alongside
 * the keychain-name {@link canaryCheck} — a version the contract was never proven
 * against is a config-drift stop, not a rebind failure, so it does not advance the
 * circuit-breaker. The env override ({@link CC_VERSION_OVERRIDE_ENV}) bypasses only
 * the set-membership check.
 */
export function versionCanaryCheck(d: RebindDeps): void {
  const r = versionGuard(d.claudeVersion(), PINNED_CC_VERSIONS, process.env[CC_VERSION_OVERRIDE_ENV] ?? null);
  if (!r.ok) throw new RebindError(`credential-store canary tripped: ${r.reason}`);
}

/**
 * Rebind the running profile `profile` to serve `account`'s credential. macOS
 * only; both must be logged-in claude profiles. Throws {@link RebindError} on any
 * precondition failure — the store is never touched unless every guard passes.
 *
 * Wrapped by the ADR-003 rollback/circuit-breaker: a tripped or manually-disabled
 * kill-switch hard-refuses here; every failure of {@link performRebind} advances
 * the breaker (auto-disable at {@link REBIND_FAILURE_LIMIT}), and success resets
 * it. `--restore` is deliberately exempt — it is the recovery path.
 */
export async function rebind(
  opts: { account: string; profile: string },
  d: RebindDeps = defaultDeps(),
): Promise<RebindResult> {
  // Council finding 3: verify Claude Code's credential-store naming contract has
  // not drifted BEFORE any read or mutation (incl. the kill-switch read). A drift
  // hard-refuses here, independent of the circuit-breaker — it is a config-drift
  // stop, not a rebind failure.
  canaryCheck(configDir("claude", opts.profile), d);
  // R0.6: also refuse if the running CC version is outside the Phase-0-verified
  // set — the store contract is unproven there. Overridable per-version via env
  // after manual re-verification; never advances the breaker (config-drift stop).
  versionCanaryCheck(d);
  const ks = d.readRebindState();
  if (ks.disabled) {
    throw new RebindError(
      `rebind is disabled — the circuit-breaker tripped after ${ks.consecutiveFailures} consecutive failure(s). ` +
        `Re-enable with \`agent-switch rebind --reset\` once the underlying issue is resolved. ` +
        `(\`rebind --restore\` still works — it is the recovery path.)`,
    );
  }
  try {
    const result = await performRebind(opts, d);
    if (ks.consecutiveFailures !== 0) d.writeRebindState({ disabled: false, consecutiveFailures: 0 });
    return result;
  } catch (e) {
    // A guard REFUSAL never advances the breaker — nothing was mutated, and a
    // user retrying a refused switch must not talk the breaker into disabling
    // rebind. Only genuine write-path failures count.
    if (e instanceof RebindRefused) throw e;
    const consecutiveFailures = ks.consecutiveFailures + 1;
    const disabled = consecutiveFailures >= REBIND_FAILURE_LIMIT;
    d.writeRebindState({ disabled, consecutiveFailures });
    if (disabled) {
      const base = e instanceof Error ? e.message : String(e);
      throw new RebindError(
        `${base}\n\nCircuit-breaker tripped: ${consecutiveFailures} consecutive rebind failures — rebind is now DISABLED. ` +
          `Re-enable with \`agent-switch rebind --reset\`.`,
      );
    }
    throw e;
  }
}

/** The actual rebind write path (preconditions → global lock → CC lock → swap). */
async function performRebind(opts: { account: string; profile: string }, d: RebindDeps): Promise<RebindResult> {
  const { account, profile } = opts;

  if (d.platform !== "darwin") {
    throw new RebindRefused(
      `rebind is validated on macOS only — the Linux/Windows credential backend (spike R0.1) is not yet proven, so rebind refuses on ${d.platform}.`,
    );
  }
  if (account === profile) {
    throw new RebindRefused(`cannot rebind "${profile}" to itself`);
  }

  const pConfig = configDir("claude", profile);
  const aConfig = configDir("claude", account);

  // Already rebound → RE-SWITCH: put both profiles back on their own accounts
  // first, then bind to the new target. Dead-ending in "already rebound" made
  // every second switch from the GUI fail (and, before the RebindRefused split,
  // three such refusals tripped the breaker and disabled switching entirely).
  // restore runs BEFORE any lock below (the mkdir locks are not reentrant).
  if (readBinding(pConfig, d)) {
    await restoreRebind({ profile }, d);
  }

  const pCred = readCred(pConfig, d);
  let aCred = readCred(aConfig, d);
  if (!pCred) throw new RebindRefused(`running profile "${profile}" has no readable credential — is it logged in?`);
  if (!aCred) throw new RebindRefused(`target profile "${account}" has no readable credential — is it logged in?`);

  if (accessToken(pCred) && accessToken(pCred) === accessToken(aCred)) {
    throw new RebindRefused(`profile "${profile}" is already running "${account}"'s account — nothing to do.`);
  }

  let exp = expiresAt(aCred);
  if (exp !== null && exp - d.now() < FRESHEN_FLOOR_MS) {
    // Target token is spent / near-spent. Rather than send the operator to the
    // CLI, delegate the refresh to Claude Code (`claude doctor` — no session, no
    // quota; ADR-004): it rotates the token under its own lock, in its own store.
    // rebind still never mints a token itself — it asks the owner process to.
    // Re-read the target credential and re-check the floor afterwards.
    d.freshen(aConfig);
    aCred = readCred(aConfig, d);
    if (!aCred) {
      throw new RebindRefused(`target profile "${account}" has no readable credential after a refresh attempt — is it logged in?`);
    }
    exp = expiresAt(aCred);
    if (exp !== null && exp - d.now() < FRESHEN_FLOOR_MS) {
      const mins = Math.max(0, Math.round((exp - d.now()) / 60000));
      throw new RebindRefused(
        `target "${account}"'s token still expires in ${mins} min after a refresh attempt — the login may be expired. ` +
          `Run \`agent-switch run ${account}\` to re-authenticate, then retry.`,
      );
    }
  }

  const pSvc = d.serviceNameFor(pConfig);
  const aSvc = d.serviceNameFor(aConfig);
  const aFile = credFile(aConfig);

  // Lock order: GLOBAL registry lock (outer) → Claude Code's per-profile lock
  // (inner) → swap. The registry check + record + swap all run under BOTH locks,
  // so a concurrent rebind cannot bind the same account into a second profile.
  await d.withLock(registryLockTarget(), async () => {
    await d.withLock(pConfig, async () => {
      // Global invariant (Council finding 2): one account → at most one profile.
      // Read-check the registry now; RECORD it only once every swap guard below
      // has passed, so a quarantine/refuse leaves no phantom registry entry.
      const reg = readRegistry(d);
      const existing = reg[account];
      if (existing && existing.runningProfile !== profile) {
        throw new RebindRefused(
          `account "${account}" is already bound into running profile "${existing.runningProfile}" ` +
            `(one account → one profile). Restore it first: ` +
            `\`agent-switch rebind --restore --profile ${existing.runningProfile}\`.`,
        );
      }

      // Provenance re-read under the lock (Council finding 5): compare what the
      // target store holds NOW against the credential we read before locking.
      const liveTarget = readCred(aConfig, d);
      const branch = await compareAccounts(aCred, liveTarget, d);
      if (branch === "unparseable") {
        throw new RebindRefused(
          `target "${account}"'s live credential is missing or unparseable at swap time — refusing (no credential mutation).`,
        );
      }
      if (branch === "indeterminate") {
        throw new RebindRefused(
          `target "${account}"'s token changed since rebind started and its account could not be verified ` +
            `(the profile endpoint is unreachable — offline?). A rotation and a re-login to a DIFFERENT account ` +
            `look identical locally, so rebind refuses rather than risk moving a foreign account's credential. ` +
            `No credential was touched — retry once the account can be verified.`,
        );
      }
      if (branch === "different") {
        // Someone re-logged the target profile between our read and the swap.
        // Do NOT move its (now foreign) credential — quarantine it and abort.
        d.writeFile(aFile + QUARANTINE_SUFFIX, liveTarget as string);
        throw new RebindRefused(
          `target "${account}" now holds a DIFFERENT account than when rebind started — someone re-logged it. ` +
            `Quarantined the unexpected credential to ${aFile + QUARANTINE_SUFFIX}; no swap performed.`,
        );
      }
      // "rotated": a background refresh replaced the token in place — move the
      // FRESH credential (same account), not the stale pre-lock read.
      const credToMove = branch === "rotated" ? (liveTarget as string) : aCred;

      // All guards passed — commit the global binding record.
      reg[account] = { runningProfile: profile, boundAt: new Date(d.now()).toISOString() };
      writeRegistry(reg, d);

      // 1. Recovery point BEFORE any store mutation: stash both originals.
      const marker: BindingMarker = {
        boundToProfile: account,
        boundAt: new Date(d.now()).toISOString(),
        runningOwnCredential: pCred,
        targetOrigCredential: credToMove,
        targetFileMoved: false,
        // Snapshot the running profile's OWN identity stamp before the swap: from
        // here on Claude Code will overwrite it with the borrowed account's.
        runningOwnIdentity: readStampedIdentity(pConfig, d) ?? undefined,
      };
      // 2. Empty the target's store so its family is live in exactly one store:
      //    delete its Keychain entry and move its plaintext file aside (never
      //    delete — a rename is reversible).
      if (d.exists(aFile)) {
        d.renameFile(aFile, aFile + LENT_SUFFIX);
        marker.targetFileMoved = true;
      }
      d.writeFile(markerFile(pConfig), JSON.stringify(marker, null, 2) + "\n");
      d.kcDelete(aSvc);
      // 3. Point the running profile's store at the target account.
      if (!d.kcAdd(pSvc, credToMove)) {
        throw new RebindError(`failed to write the Keychain entry for "${profile}" — swap aborted (marker left for --restore).`);
      }
    });
  });

  return {
    boundToProfile: account,
    uxNote:
      `Rebound "${profile}" → "${account}". A running Claude session adopts it on its next message ` +
      `(fresh process: instant; long-lived session: within ~30s, the Keychain read-cache). ` +
      `Restore with: agent-switch rebind --restore --profile ${profile}`,
  };
}

export interface RestoreResult {
  restoredProfile: string;
  wasBoundTo: string;
}

/** Reverse an active rebind on `profile`: restore both profiles' own credentials. */
export async function restoreRebind(
  opts: { profile: string },
  d: RebindDeps = defaultDeps(),
): Promise<RestoreResult> {
  const { profile } = opts;
  if (d.platform !== "darwin") {
    throw new RebindRefused(`rebind --restore is macOS only (nothing to restore on ${d.platform}).`);
  }
  const pConfig = configDir("claude", profile);
  const marker = readBinding(pConfig, d);
  if (!marker) throw new RebindRefused(`no active rebind on profile "${profile}".`);

  const aConfig = configDir("claude", marker.boundToProfile);
  const pSvc = d.serviceNameFor(pConfig);
  const aSvc = d.serviceNameFor(aConfig);
  const aFile = credFile(aConfig);
  const pFile = credFile(pConfig);

  // Same lock order as rebind: GLOBAL registry lock (outer) → CC's per-profile
  // lock (inner). Restore is exempt from the kill-switch by design — it is the
  // recovery path and must work even when `rebind` is disabled.
  await d.withLock(registryLockTarget(), async () => {
    await d.withLock(pConfig, async () => {
      // Provenance (Council finding 5): the running store should still hold the
      // account we bound INTO it. If someone re-logged the running profile, its
      // store now holds a DIFFERENT account — never clobber that fresh login.
      const liveRunning = readCred(pConfig, d);
      const branch = await compareAccounts(marker.targetOrigCredential, liveRunning, d);
      if (branch === "unparseable") {
        throw new RebindRefused(
          `running profile "${profile}"'s live credential is missing or unparseable — refusing restore (no mutation). ` +
            `The binding marker is left in place for manual recovery.`,
        );
      }
      if (branch === "indeterminate") {
        throw new RebindRefused(
          `running profile "${profile}"'s token changed since the rebind and its account could not be verified ` +
            `(the profile endpoint is unreachable — offline?). A rotation and a re-login to a DIFFERENT account ` +
            `look identical locally, so restore refuses rather than risk writing a foreign credential into ` +
            `"${marker.boundToProfile}"'s store. Nothing was touched; the marker is left in place — retry when online.`,
        );
      }
      if (branch === "different") {
        d.writeFile(pFile + QUARANTINE_SUFFIX, liveRunning as string);
        throw new RebindRefused(
          `running profile "${profile}" now holds a DIFFERENT account than the one it was rebound to — someone re-logged it. ` +
            `Quarantined the unexpected credential to ${pFile + QUARANTINE_SUFFIX}; restore aborted to avoid clobbering it. ` +
            `Resolve manually, then remove ${MARKER_NAME} from the profile's config dir.`,
        );
      }
      // "same" / "rotated" → the bound account is still there → restore normally.
      // Restore the running profile to its own account.
      d.kcAdd(pSvc, marker.runningOwnCredential);
      // Restore the target profile's own store. On "rotated" the live credential
      // is the same account with a FRESHER (rotated) refresh token — hand that
      // back instead of the stale stash, or the target profile logs out.
      d.kcAdd(aSvc, branch === "rotated" ? (liveRunning as string) : marker.targetOrigCredential);
      if (marker.targetFileMoved && d.exists(aFile + LENT_SUFFIX)) {
        d.renameFile(aFile + LENT_SUFFIX, aFile);
      }
      // The credential is the running profile's own again — so must be the identity
      // Claude Code stamped into its `.claude.json` while it served the other account.
      await restoreStampedIdentity(pConfig, marker.runningOwnIdentity, d);
      d.removeFile(markerFile(pConfig));
      // Release the global binding-registry entry for the bound account.
      const reg = readRegistry(d);
      if (reg[marker.boundToProfile]) {
        delete reg[marker.boundToProfile];
        writeRegistry(reg, d);
      }
    });
  });

  return { restoredProfile: profile, wasBoundTo: marker.boundToProfile };
}
