/**
 * Per-OS credential access — a read-only abstraction over where Claude Code
 * keeps a profile's OAuth credential.
 *
 * By design there is NO `write()`: agent-switch never writes Claude Code's
 * credential storage. The only supported way to place a credential is seeding
 * a plaintext `.credentials.json` file inside the config dir (see `import`),
 * which Claude Code then migrates into its own store on first use.
 *
 * Backends:
 *   - darwin  → Keychain (hashed service per config dir), then the plaintext
 *               file as a fallback. Claude Code reads in this same order, so a
 *               stale hashed entry can shadow a file seed — hence `clearStale`.
 *   - linux   → plaintext `.credentials.json` under CLAUDE_CONFIG_DIR only.
 *   - win32   → plaintext `.credentials.json` under CLAUDE_CONFIG_DIR only.
 *
 * Everything degrades gracefully: an unreadable credential returns null, and
 * removal/clear are best-effort.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as keychain from "./keychain.js";

export interface CredentialStore {
  /** Live credential for a profile's config dir; null if unreadable. */
  read(configDir: string): string | null;
  /** The default `~/.claude` install's live credential, for import seeding. */
  readDefault(defaultConfigDir: string): string | null;
  /**
   * Best-effort removal of any OS-managed credential entry for a config dir.
   * darwin deletes the hashed Keychain entry; elsewhere there is nothing to
   * remove (the credential is a file inside the profile dir, deleted with it).
   * Returns true only if an OS-managed entry was actually removed.
   */
  removeEntry(configDir: string): boolean;
  /**
   * Clear any stale OS-managed entry before seeding a profile. On darwin,
   * Claude Code reads the Keychain before the plaintext file, so a leftover
   * hashed entry at this exact path would shadow the seed. No-op elsewhere.
   */
  clearStale(configDir: string): void;
}

/** The plaintext credential file every OS uses as the seed / fallback. */
function readCredentialFile(configDir: string): string | null {
  try {
    return fs.readFileSync(path.join(configDir, ".credentials.json"), "utf8");
  } catch {
    return null;
  }
}

/** linux/win32: credentials live only as a plaintext file under CLAUDE_CONFIG_DIR. */
class FileCredentialStore implements CredentialStore {
  read(configDir: string): string | null {
    return readCredentialFile(configDir);
  }
  readDefault(defaultConfigDir: string): string | null {
    return readCredentialFile(defaultConfigDir);
  }
  removeEntry(): boolean {
    return false; // no OS store; the file is removed with the profile dir
  }
  clearStale(): void {
    /* no OS store to shadow the seed */
  }
}

/** darwin: Keychain first (hashed service), then the plaintext file fallback. */
class DarwinCredentialStore implements CredentialStore {
  read(configDir: string): string | null {
    return keychain.getPassword(keychain.serviceNameFor(configDir)) ?? readCredentialFile(configDir);
  }
  readDefault(defaultConfigDir: string): string | null {
    // The default install uses the un-suffixed service; file as parity fallback.
    return keychain.readDefaultCredential() ?? readCredentialFile(defaultConfigDir);
  }
  removeEntry(configDir: string): boolean {
    return keychain.deletePassword(keychain.serviceNameFor(configDir));
  }
  clearStale(configDir: string): void {
    keychain.deletePassword(keychain.serviceNameFor(configDir));
  }
}

/** The credential store for a platform (defaults to the host platform). */
export function credentialStore(platform: NodeJS.Platform = process.platform): CredentialStore {
  return platform === "darwin" ? new DarwinCredentialStore() : new FileCredentialStore();
}
