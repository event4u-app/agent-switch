/** Profile roots, state file, and shared helpers. */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const HOME = os.homedir();
export const ROOT = process.env.AGENT_SWITCH_HOME ?? path.join(HOME, ".agent-switch");
export const STATE_FILE = path.join(ROOT, "state.json");
export const DEFAULT_CONFIG_DIR = path.join(HOME, ".claude");
export const DEFAULT_CONFIG_JSON = path.join(HOME, ".claude.json");

export interface State {
  active: string | null;
}

export function die(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

export function ensureRoot(): void {
  fs.mkdirSync(ROOT, { recursive: true, mode: 0o700 });
}

export function readState(): State {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as State;
  } catch {
    return { active: null };
  }
}

export function writeState(state: State): void {
  ensureRoot();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
}

export function profileDir(name: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) die(`invalid profile name "${name}" (use a-z, 0-9, -, _)`);
  return path.join(ROOT, name);
}

/**
 * The CLAUDE_CONFIG_DIR of a profile.
 *
 * IMPORTANT: on macOS, Claude Code derives its keychain service name by
 * hashing the *exact, unresolved* string of the env var (NFC-normalized).
 * This function is the single source of that string — never pass a
 * resolved/realpath variant to `claude` or to keychain.serviceNameFor().
 */
export function configDir(name: string): string {
  return path.join(profileDir(name), "config");
}

export function browserDir(name: string): string {
  return path.join(profileDir(name), "browser");
}

export function profileExists(name: string): boolean {
  return fs.existsSync(configDir(name));
}

export function listProfiles(): string[] {
  if (!fs.existsSync(ROOT)) return [];
  return fs
    .readdirSync(ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(ROOT, e.name, "config")))
    .map((e) => e.name)
    .sort();
}

export function requireProfile(name: string | undefined, cmd: string): string {
  if (!name) die(`usage: agent-switch ${cmd} <profile>`);
  if (!profileExists(name)) {
    die(`profile "${name}" not found. Existing: ${listProfiles().join(", ") || "(none)"}`);
  }
  return name;
}

/** Read the account email from a profile's .claude.json (oauthAccount block). */
export function accountEmail(name: string): string | null {
  const cfg = path.join(configDir(name), ".claude.json");
  try {
    const json = JSON.parse(fs.readFileSync(cfg, "utf8"));
    return json?.oauthAccount?.emailAddress ?? null;
  } catch {
    return null;
  }
}

export function readJson(p: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}
