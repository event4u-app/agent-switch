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

import * as fs from "node:fs";
import * as nodePath from "node:path";

import * as keychain from "./keychain.js";
import { withProperLock } from "./locks.js";
import { configDir } from "./profiles.js";

/** <10 min to expiry → refuse (2× Claude Code's own 5-min refresh buffer). */
export const FRESHEN_FLOOR_MS = 10 * 60 * 1000;
const MARKER_NAME = ".agent-switch-rebind.json";
const LENT_SUFFIX = ".rebind-lent";

/** Per-profile record of an active rebind — stashes both originals for restore. */
export interface BindingMarker {
  boundToProfile: string; // the profile whose account the running profile now serves
  boundAt: string;
  runningOwnCredential: string; // the running profile's own credential (to restore it)
  targetOrigCredential: string; // the target profile's own credential (to restore it)
  targetFileMoved: boolean; // whether the target's .credentials.json was moved aside
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

export interface RebindResult {
  boundToProfile: string;
  uxNote: string;
}

/**
 * Rebind the running profile `profile` to serve `account`'s credential. macOS
 * only; both must be logged-in claude profiles. Throws {@link RebindError} on any
 * precondition failure — the store is never touched unless every guard passes.
 */
export async function rebind(
  opts: { account: string; profile: string },
  d: RebindDeps = defaultDeps(),
): Promise<RebindResult> {
  const { account, profile } = opts;

  if (d.platform !== "darwin") {
    throw new RebindError(
      `rebind is validated on macOS only — the Linux/Windows credential backend (spike R0.1) is not yet proven, so rebind refuses on ${d.platform}.`,
    );
  }
  if (account === profile) {
    throw new RebindError(`cannot rebind "${profile}" to itself`);
  }

  const pConfig = configDir("claude", profile);
  const aConfig = configDir("claude", account);

  if (readBinding(pConfig, d)) {
    throw new RebindError(
      `profile "${profile}" is already rebound — run \`agent-switch rebind --restore --profile ${profile}\` first.`,
    );
  }

  const pCred = readCred(pConfig, d);
  const aCred = readCred(aConfig, d);
  if (!pCred) throw new RebindError(`running profile "${profile}" has no readable credential — is it logged in?`);
  if (!aCred) throw new RebindError(`target profile "${account}" has no readable credential — is it logged in?`);

  if (accessToken(pCred) && accessToken(pCred) === accessToken(aCred)) {
    throw new RebindError(`profile "${profile}" is already running "${account}"'s account — nothing to do.`);
  }

  const exp = expiresAt(aCred);
  if (exp !== null && exp - d.now() < FRESHEN_FLOOR_MS) {
    const mins = Math.max(0, Math.round((exp - d.now()) / 60000));
    throw new RebindError(
      `target "${account}"'s token expires in ${mins} min (< 10) — run \`agent-switch run ${account}\` to let Claude Code refresh it, then retry. rebind never mints or refreshes tokens itself.`,
    );
  }

  const pSvc = d.serviceNameFor(pConfig);
  const aSvc = d.serviceNameFor(aConfig);
  const aFile = credFile(aConfig);

  await d.withLock(pConfig, () => {
    // 1. Recovery point BEFORE any mutation: stash both originals.
    const marker: BindingMarker = {
      boundToProfile: account,
      boundAt: new Date(d.now()).toISOString(),
      runningOwnCredential: pCred,
      targetOrigCredential: aCred,
      targetFileMoved: false,
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
    if (!d.kcAdd(pSvc, aCred)) {
      throw new RebindError(`failed to write the Keychain entry for "${profile}" — swap aborted (marker left for --restore).`);
    }
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
    throw new RebindError(`rebind --restore is macOS only (nothing to restore on ${d.platform}).`);
  }
  const pConfig = configDir("claude", profile);
  const marker = readBinding(pConfig, d);
  if (!marker) throw new RebindError(`no active rebind on profile "${profile}".`);

  const aConfig = configDir("claude", marker.boundToProfile);
  const pSvc = d.serviceNameFor(pConfig);
  const aSvc = d.serviceNameFor(aConfig);
  const aFile = credFile(aConfig);

  await d.withLock(pConfig, () => {
    // Restore the running profile to its own account.
    d.kcAdd(pSvc, marker.runningOwnCredential);
    // Restore the target profile's own store.
    d.kcAdd(aSvc, marker.targetOrigCredential);
    if (marker.targetFileMoved && d.exists(aFile + LENT_SUFFIX)) {
      d.renameFile(aFile + LENT_SUFFIX, aFile);
    }
    d.removeFile(markerFile(pConfig));
  });

  return { restoredProfile: profile, wasBoundTo: marker.boundToProfile };
}
