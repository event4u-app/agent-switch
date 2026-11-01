/**
 * Per-profile macOS keychain isolation for the Antigravity CLI (`agy`).
 *
 * `agy` stores its OAuth login token in the macOS keychain via the Go library
 * zalando/go-keyring, under a FIXED key (service "gemini" / account
 * "antigravity") on the session's DEFAULT keychain. go-keyring shells out to
 * `/usr/bin/security` by absolute path with no keychain argument, so there is no
 * shim and no per-call override — the only lever is which keychain is "default".
 *
 * Verified behaviour (the load-bearing fact this module relies on): the keychain
 * default + search list that `/usr/bin/security` reads are resolved from
 * `$HOME/Library/Preferences/com.apple.security.plist` — they are HOME-SCOPED.
 * So by pointing HOME at the profile's config dir (which agent-switch already
 * does for antigravity) AND seeding a keychain + default/search-list under that
 * HOME's `Library/`, each profile gets its OWN keychain with agy's fixed-key
 * entry — fully isolated, concurrent across profiles, and WITHOUT touching the
 * user's real login keychain or global session state.
 *
 * This is why redirecting HOME alone produced macOS's "no keychain found to
 * secure 'antigravity'" dialog: the profile HOME had no keychain yet. Seeding
 * one here is the fix.
 */

import { spawnSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { addPassword, getPassword } from "./keychain.js";

/** The per-profile keychain file, under the profile HOME's `Library/Keychains`.
 *  Named `login.keychain-db` so the isolated HOME looks like a normal macOS home
 *  and `security` resolves it without complaint. */
export function agyKeychainPath(home: string): string {
  return path.join(home, "Library", "Keychains", "login.keychain-db");
}

/** Login-keychain service holding the profile keychain's password. Hashes the
 *  keychain path so the name is stable per profile and leaks no profile name. */
export function agyPasswordService(home: string): string {
  const digest = crypto.createHash("sha256").update(agyKeychainPath(home).normalize("NFC"), "utf8").digest("hex").slice(0, 16);
  return `agent-switch.agy.${digest}`;
}

export interface AgyKeychainDeps {
  platform: NodeJS.Platform;
  exists(p: string): boolean;
  mkdir(p: string): void;
  /** `security` against the profile HOME; true on exit 0. */
  security(args: string[]): boolean;
  /** Read/write the user's REAL login keychain (real HOME, not the profile's). */
  getStored(service: string): string | null;
  store(service: string, value: string): boolean;
  randomPassword(): string;
}

function defaultDeps(home: string): AgyKeychainDeps {
  // CFFIXED_USER_HOME is set alongside HOME: macOS CoreFoundation preference
  // resolution (what `security` uses for the HOME-scoped default/search list)
  // prefers CFFIXED_USER_HOME over HOME, so an ambient value would silently
  // redirect the keychain out of the profile and break isolation. Pin it too.
  const env = { ...process.env, HOME: home, CFFIXED_USER_HOME: home };
  return {
    platform: process.platform,
    exists: fs.existsSync,
    mkdir: (p) => fs.mkdirSync(p, { recursive: true, mode: 0o700 }),
    security: (args) => spawnSync("security", args, { env, stdio: "ignore", timeout: 10000 }).status === 0,
    getStored: getPassword,
    store: addPassword,
    randomPassword: () => crypto.randomBytes(32).toString("hex"),
  };
}

/** Store a fresh password and read it back; null when the login keychain did not take it. */
function storeNew(svc: string, d: AgyKeychainDeps): string | null {
  const pw = d.randomPassword();
  return d.store(svc, pw) && d.getStored(svc) === pw ? pw : null;
}

/**
 * The password to unlock an EXISTING profile keychain with, migrating it off
 * the empty password when possible. The new password is stored (and read back)
 * before the keychain is changed, so a failure at any point leaves either the
 * old empty password working or the new one stored — never a keychain nobody
 * can unlock. A keychain the empty password does not open is never touched.
 */
function passwordForExisting(kc: string, svc: string, d: AgyKeychainDeps): string {
  const stored = d.getStored(svc);
  if (stored !== null && d.security(["unlock-keychain", "-p", stored, kc])) return stored;
  if (!d.security(["unlock-keychain", "-p", "", kc])) return stored ?? "";
  // A stored password the keychain does not take yet = a migration that stopped halfway.
  const next = stored ?? storeNew(svc, d);
  if (next === null) return "";
  if (!d.security(["set-keychain-password", "-o", "", "-p", next, kc])) return "";
  return next;
}

/**
 * Ensure the profile HOME has an unlocked keychain set as its (HOME-scoped)
 * default + sole search-list entry, so a subsequent `agy` launched with this
 * HOME reads/writes its go-keyring token there. Idempotent and best-effort:
 * macOS-only, and never throws — if setup fails, agy simply falls back to its
 * own prompt rather than crashing the launch.
 *
 * The keychain gets a random password kept in the user's login keychain (D5):
 * the profile keychain file alone no longer opens agy's token. Where that
 * password cannot be stored, the empty password stays — `doctor` reports it.
 */
export function ensureAgyKeychain(home: string, deps: AgyKeychainDeps = defaultDeps(home)): void {
  const d = deps;
  if (d.platform !== "darwin") return;
  try {
    const kc = agyKeychainPath(home);
    const svc = agyPasswordService(home);
    d.mkdir(path.dirname(kc));
    // com.apple.security.plist (the HOME-scoped default/search-list store) lives here.
    d.mkdir(path.join(home, "Library", "Preferences"));

    let pw: string;
    if (d.exists(kc)) {
      pw = passwordForExisting(kc, svc, d);
    } else {
      pw = d.getStored(svc) ?? storeNew(svc, d) ?? "";
      d.security(["create-keychain", "-p", pw, kc]);
    }
    // Point this HOME's default + search list at the profile keychain (HOME-scoped
    // writes — the real session is untouched).
    d.security(["default-keychain", "-d", "user", "-s", kc]);
    d.security(["list-keychains", "-d", "user", "-s", kc]);
    d.security(["unlock-keychain", "-p", pw, kc]);
    // No `-t`/`-l`: disable the auto-lock timeout and lock-on-sleep so agy's next
    // read within a session never triggers a re-unlock prompt.
    d.security(["set-keychain-settings", kc]);
  } catch {
    /* best-effort: never block the launch on keychain setup */
  }
}

/** `none` = no profile keychain yet · `empty` = no stored password, so still on
 *  the empty one · `protected` = a password is stored in the login keychain. */
export type AgyKeychainState = "none" | "empty" | "protected";

export function agyKeychainState(
  home: string,
  exists: (p: string) => boolean = fs.existsSync,
  getStored: (service: string) => string | null = getPassword,
): AgyKeychainState {
  if (!exists(agyKeychainPath(home))) return "none";
  return getStored(agyPasswordService(home)) === null ? "empty" : "protected";
}
