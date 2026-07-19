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
import * as fs from "node:fs";
import * as path from "node:path";

/** The per-profile keychain file, under the profile HOME's `Library/Keychains`.
 *  Named `login.keychain-db` so the isolated HOME looks like a normal macOS home
 *  and `security` resolves it without complaint. */
export function agyKeychainPath(home: string): string {
  return path.join(home, "Library", "Keychains", "login.keychain-db");
}

/**
 * Ensure the profile HOME has an unlocked keychain set as its (HOME-scoped)
 * default + sole search-list entry, so a subsequent `agy` launched with this
 * HOME reads/writes its go-keyring token there. Idempotent and best-effort:
 * macOS-only, and never throws — if setup fails, agy simply falls back to its
 * own prompt rather than crashing the launch.
 */
export function ensureAgyKeychain(home: string): void {
  if (process.platform !== "darwin") return;
  try {
    const kc = agyKeychainPath(home);
    fs.mkdirSync(path.dirname(kc), { recursive: true, mode: 0o700 });
    // com.apple.security.plist (the HOME-scoped default/search-list store) lives here.
    fs.mkdirSync(path.join(home, "Library", "Preferences"), { recursive: true, mode: 0o700 });

    // CFFIXED_USER_HOME is set alongside HOME: macOS CoreFoundation preference
    // resolution (what `security` uses for the HOME-scoped default/search list)
    // prefers CFFIXED_USER_HOME over HOME, so an ambient value would silently
    // redirect the keychain out of the profile and break isolation. Pin it too.
    const env = { ...process.env, HOME: home, CFFIXED_USER_HOME: home };
    const sec = (args: string[]) => spawnSync("security", args, { env, stdio: "ignore", timeout: 10000 });

    // Empty password: within agent-switch's threat model (it already stores
    // plaintext credentials per profile) and the keychain is inside the
    // per-profile dir. create is skipped once the file exists.
    if (!fs.existsSync(kc)) sec(["create-keychain", "-p", "", kc]);
    // Point this HOME's default + search list at the profile keychain (HOME-scoped
    // writes — the real session is untouched).
    sec(["default-keychain", "-d", "user", "-s", kc]);
    sec(["list-keychains", "-d", "user", "-s", kc]);
    sec(["unlock-keychain", "-p", "", kc]);
    // No `-t`/`-l`: disable the auto-lock timeout and lock-on-sleep so agy's next
    // read within a session never triggers a re-unlock prompt.
    sec(["set-keychain-settings", kc]);
  } catch {
    /* best-effort: never block the launch on keychain setup */
  }
}
