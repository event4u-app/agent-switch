/**
 * macOS Keychain access for Claude Code credentials.
 *
 * Contract knowledge adopted from claude-swap (session.py, macos_keychain.py),
 * which references claude-code's own envUtils.ts / macOsKeychainHelpers.ts:
 *
 * - Default install: service "Claude Code-credentials", account = username.
 * - With CLAUDE_CONFIG_DIR set, Claude Code hashes the *raw, unresolved* env
 *   var value, NFC-normalized: service = "Claude Code-credentials-" +
 *   sha256(NFC(dir)).hex[:8]. Hash exactly the string that gets exported.
 * - Claude Code reads the keychain BEFORE the plaintext .credentials.json
 *   fallback — a stale hashed entry shadows a fresh file seed, so delete the
 *   hashed entry before seeding a profile.
 * - This is an internal contract of Claude Code, not a public API. Everything
 *   here is best-effort and must degrade gracefully if the naming changes.
 */

import { execFileSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as os from "node:os";

export const DEFAULT_SERVICE = "Claude Code-credentials";

export function isMac(): boolean {
  return process.platform === "darwin";
}

/** Keychain service name Claude Code derives for a CLAUDE_CONFIG_DIR. */
export function serviceNameFor(configDir: string): string {
  const normalized = configDir.normalize("NFC");
  const digest = crypto.createHash("sha256").update(normalized, "utf8").digest("hex").slice(0, 8);
  return `${DEFAULT_SERVICE}-${digest}`;
}

function security(args: string[]): string | null {
  try {
    return execFileSync("security", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    return null;
  }
}

/** Read a generic password; null if missing/off-macOS/denied. */
export function getPassword(service: string): string | null {
  if (!isMac()) return null;
  const out = security(["find-generic-password", "-a", os.userInfo().username, "-w", "-s", service]);
  return out === null ? null : out.replace(/\n$/, "");
}

/** Best-effort delete of a generic password entry. */
export function deletePassword(service: string): boolean {
  if (!isMac()) return false;
  return (
    security(["delete-generic-password", "-a", os.userInfo().username, "-s", service]) !== null
  );
}

/** The live credential of the default ~/.claude install (keychain, macOS). */
export function readDefaultCredential(): string | null {
  return getPassword(DEFAULT_SERVICE);
}
