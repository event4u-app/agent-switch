/**
 * Sign in again without risking the profile: the provider signs in into a
 * staging config dir, the account found there is compared with the one the
 * profile belongs to, and only a match is copied into the profile. A different
 * account, an unfinished sign-in or any error leaves the profile as it was —
 * nothing is written and nothing has to be rolled back: a rollback can fail
 * half-way and leave the wrong token in the store.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { ROOT, readJson } from "./profiles.js";
import { ProviderId, provider } from "./providers.js";
import type { CredentialStore } from "./credentials.js";

/** `login` exit code for "signed in to a different account; nothing was saved". */
export const WRONG_ACCOUNT_EXIT = 4;

export interface Account {
  email: string | null;
  /** Claude's `organizationUuid`; null where the provider has none. */
  org: string | null;
}

/** The account a config dir is signed in to, read from files that hold no secret. */
export function accountIn(providerId: ProviderId, dir: string): Account {
  if (providerId === "claude") {
    const a = readJson(path.join(dir, ".claude.json"))?.oauthAccount;
    const email = typeof a?.emailAddress === "string" && a.emailAddress ? a.emailAddress : null;
    const org = typeof a?.organizationUuid === "string" && a.organizationUuid ? a.organizationUuid : null;
    return { email, org };
  }
  const p = provider(providerId);
  return { email: p.readIdentity(p.configDirFor(dir)), org: null };
}

export type Verdict = "commit" | "wrong-account" | "unreadable" | "unfinished";

/**
 * Whether a staged sign-in may be saved. A profile without an account yet takes
 * any; otherwise the email must match (case-insensitive) and, where both sides
 * name one, the organization too. A sign-in whose account cannot be read is not
 * saved over a known account.
 */
export function judgeSignIn(expected: Account, staged: Account, signedIn: boolean): Verdict {
  if (!signedIn) return "unfinished";
  if (!expected.email) return "commit";
  if (!staged.email) return "unreadable";
  if (staged.email.toLowerCase() !== expected.email.toLowerCase()) return "wrong-account";
  if (expected.org && staged.org && expected.org !== staged.org) return "wrong-account";
  return "commit";
}

const STAGING = () => path.join(ROOT, "staging");

/** A fresh, private staging dir for one sign-in of `providerId/name`. */
export function makeStaging(providerId: ProviderId, name: string, pid = process.pid): string {
  const dir = path.join(STAGING(), `${providerId}-${name}-${pid}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** Whether the sign-in left a credential in `dir`. */
export function signedInAt(providerId: ProviderId, dir: string, store: CredentialStore): boolean {
  if (providerId === "claude") return store.read(dir) !== null;
  return !!readJson(path.join(provider(providerId).configDirFor(dir), "auth.json"))?.tokens;
}

/** Remove a staging dir and the OS credential entry the sign-in made for it. */
export function discardStaging(providerId: ProviderId, dir: string, store: CredentialStore): void {
  if (providerId === "claude") {
    try {
      store.removeEntry(dir);
    } catch {
      /* best-effort: the dir below is still removed */
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  try {
    fs.rmdirSync(STAGING()); // only when empty
  } catch {
    /* other sign-ins still staged */
  }
}

/** Staging dirs whose sign-in process is gone (killed mid-sign-in). */
export function sweepStaleStaging(store: CredentialStore, alive: (pid: number) => boolean = pidAlive): string[] {
  const root = STAGING();
  if (!fs.existsSync(root)) return [];
  const swept: string[] = [];
  for (const entry of fs.readdirSync(root)) {
    const m = /^(claude|codex|antigravity)-.+-(\d+)$/.exec(entry);
    if (!m || alive(Number(m[2]))) continue;
    discardStaging(m[1] as ProviderId, path.join(root, entry), store);
    swept.push(entry);
  }
  return swept;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

function writeAtomic(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/**
 * Copy a confirmed sign-in from `staging` into the profile's config dir. Claude
 * goes through the same seed `import` uses (clear the stale Keychain entry, then a
 * plaintext credential Claude Code migrates on first use — ADR-003) plus the
 * `oauthAccount` block; the profile's other settings are kept. Codex: `auth.json`.
 * The caller holds the profile's lock.
 */
export function commitStaged(providerId: ProviderId, staging: string, profileConfig: string, store: CredentialStore): void {
  fs.mkdirSync(profileConfig, { recursive: true, mode: 0o700 });
  if (providerId === "claude") {
    const credential = store.read(staging);
    if (credential === null) throw new Error("the staged credential is no longer readable");
    const account = readJson(path.join(staging, ".claude.json"))?.oauthAccount;
    const configFile = path.join(profileConfig, ".claude.json");
    const config = (fs.existsSync(configFile) && readJson(configFile)) || {};
    if (account) config.oauthAccount = account;
    store.clearStale(profileConfig);
    writeAtomic(path.join(profileConfig, ".credentials.json"), credential);
    writeAtomic(configFile, JSON.stringify(config, null, 2) + "\n");
    return;
  }
  const p = provider(providerId);
  const src = path.join(p.configDirFor(staging), "auth.json");
  writeAtomic(path.join(p.configDirFor(profileConfig), "auth.json"), fs.readFileSync(src, "utf8"));
}
