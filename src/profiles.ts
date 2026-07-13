/** Profile roots, per-provider state, layout migration, and shared helpers. */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ProviderId, PROVIDER_IDS, provider, isProviderId } from "./providers.js";
import { CredentialStore, credentialStore } from "./credentials.js";

export const HOME = os.homedir();
export const ROOT = process.env.AGENT_SWITCH_HOME ?? path.join(HOME, ".agent-switch");
export const STATE_FILE = path.join(ROOT, "state.json");

/** The active profile name per provider. */
export type ActiveMap = Record<ProviderId, string | null>;
export interface State {
  active: ActiveMap;
}

function emptyActive(): ActiveMap {
  return { claude: null, codex: null, gemini: null };
}

export function die(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

export function ensureRoot(): void {
  fs.mkdirSync(ROOT, { recursive: true, mode: 0o700 });
}

function validateName(name: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) die(`invalid profile name "${name}" (use a-z, 0-9, -, _)`);
}

export function profileDir(providerId: ProviderId, name: string): string {
  validateName(name);
  return path.join(ROOT, providerId, name);
}

/**
 * The value exported as the provider's isolation env var
 * (`<root>/<provider>/<name>/config`).
 *
 * IMPORTANT (macOS/claude): Claude Code derives its Keychain service name by
 * hashing the *exact, unresolved* CLAUDE_CONFIG_DIR string. This function is
 * the single source of that string — never pass a resolved/realpath variant.
 * Changing this path for an existing profile changes the hash (see
 * `migrateLegacyLayout`, which re-seeds the credential across the move).
 */
export function configDir(providerId: ProviderId, name: string): string {
  return path.join(profileDir(providerId, name), "config");
}

export function browserDir(providerId: ProviderId, name: string): string {
  return path.join(profileDir(providerId, name), "browser");
}

export function profileExists(providerId: ProviderId, name: string): boolean {
  return fs.existsSync(configDir(providerId, name));
}

/** Profile names for one provider (dirs with a `config/` subdir), sorted. */
export function listProfiles(providerId: ProviderId): string[] {
  const dir = path.join(ROOT, providerId);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, "config")))
    .map((e) => e.name)
    .sort();
}

/** Every profile across all providers. */
export function listAllProfiles(): { provider: ProviderId; name: string }[] {
  return PROVIDER_IDS.flatMap((p) => listProfiles(p).map((name) => ({ provider: p, name })));
}

export function requireProfile(providerId: ProviderId, name: string | undefined, cmd: string): string {
  if (!name) die(`usage: agent-switch ${cmd} <profile>`);
  if (!profileExists(providerId, name)) {
    const existing = listProfiles(providerId).join(", ") || "(none)";
    die(`profile "${name}" not found for ${providerId}. Existing: ${existing}`);
  }
  return name;
}

/** Best-effort account identity for a profile, via its provider. */
export function identity(providerId: ProviderId, name: string): string | null {
  const p = provider(providerId);
  return p.readIdentity(p.configDirFor(configDir(providerId, name)));
}

// ---------- state (per-provider active), with v1 → v2 migration ----------

export function readState(): State {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    // v1: { active: "<name>" } — a single Claude profile.
    if (typeof raw?.active === "string") {
      return { active: { ...emptyActive(), claude: raw.active } };
    }
    if (raw?.active && typeof raw.active === "object") {
      return { active: { ...emptyActive(), ...raw.active } };
    }
  } catch {
    /* absent / unparsable → default */
  }
  return { active: emptyActive() };
}

export function writeState(state: State): void {
  ensureRoot();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
}

export function activeFor(providerId: ProviderId): string | null {
  return readState().active[providerId];
}

export function setActive(providerId: ProviderId, name: string | null): void {
  const state = readState();
  state.active[providerId] = name;
  writeState(state);
}

// ---------- layout migration: v1 <ROOT>/<name> → <ROOT>/claude/<name> ----------

/**
 * One-time migration of v1 Claude profiles (`<ROOT>/<name>/config`) into the
 * provider-scoped layout (`<ROOT>/claude/<name>/config`). Copy-then-verify;
 * aborts a single profile on verify failure and keeps the original.
 *
 * The config-dir path change alters the macOS Keychain service hash, so the
 * credential is read from the old location and re-seeded as a plaintext
 * `.credentials.json` (the supported path — Claude Code re-migrates it into the
 * new hashed entry on first use). On linux/win the credential file simply moves
 * with the dir. Idempotent: once every legacy dir is under `<provider>/`, a
 * re-run does nothing. Returns the names migrated.
 */
/** One-time marker so migration is not re-scanned on every command launch. */
const LAYOUT_MARKER = path.join(ROOT, ".layout-v2");

export function migrateLegacyLayout(store: CredentialStore = credentialStore()): string[] {
  if (!fs.existsSync(ROOT)) return [];
  if (fs.existsSync(LAYOUT_MARKER)) return []; // already migrated — cheap early-out
  const moved: string[] = [];
  for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || isProviderId(entry.name)) continue; // already provider-scoped
    const oldProfile = path.join(ROOT, entry.name);
    const oldConfig = path.join(oldProfile, "config");
    if (!fs.existsSync(oldConfig)) continue; // not a v1 profile dir
    const newProfile = path.join(ROOT, "claude", entry.name);
    if (fs.existsSync(newProfile)) continue; // name clash → leave for the user to resolve

    // Capture the credential BEFORE the path (and thus the hash) changes.
    const cred = store.read(oldConfig);

    fs.mkdirSync(path.join(ROOT, "claude"), { recursive: true, mode: 0o700 });
    fs.cpSync(oldProfile, newProfile, { recursive: true });
    const newConfig = path.join(newProfile, "config");
    if (!fs.existsSync(newConfig)) {
      fs.rmSync(newProfile, { recursive: true, force: true }); // verify failed → abort this one
      continue;
    }

    // Re-seed the credential so the new-path hash resolves it (macOS); on
    // linux/win the file was copied already. Always OVERWRITE: `cred` was read
    // keychain-first, so it is the freshest known credential — a stale
    // `.credentials.json` relic that `cpSync` copied must not shadow it, or the
    // profile would migrate onto a dead token (round-2 review F2).
    if (cred) {
      store.clearStale(newConfig);
      fs.writeFileSync(path.join(newConfig, ".credentials.json"), cred, { mode: 0o600 });
    }

    store.removeEntry(oldConfig); // drop the stale old-path keychain entry (darwin)
    fs.rmSync(oldProfile, { recursive: true, force: true });
    moved.push(entry.name);
  }

  // Drop the marker only when no legacy profile dir remains (a name clash may
  // have left one for the user to resolve — then re-scan next time).
  const stillLegacy = fs
    .readdirSync(ROOT, { withFileTypes: true })
    .some((e) => e.isDirectory() && !isProviderId(e.name) && fs.existsSync(path.join(ROOT, e.name, "config")));
  if (!stillLegacy) {
    try {
      fs.writeFileSync(LAYOUT_MARKER, "2\n", { mode: 0o600 });
    } catch {
      /* best-effort — a missing marker only costs a re-scan */
    }
  }
  return moved;
}

export function readJson(p: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}
