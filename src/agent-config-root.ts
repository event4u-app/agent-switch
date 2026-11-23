/**
 * Which agent-config root a Claude profile uses: the shared global one
 * (agent-config's own default) unless the profile was explicitly switched to
 * its own. The switch is a marker file in the profile dir — never the
 * existence of `<profile>/agent-config`, which a failed start can leave behind.
 * The GUI's Rust side (gui/src-tauri/src/ac.rs) reads the same marker and path;
 * tests/fixtures/agent-config-root.json pins both sides to one contract.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import type { ProviderId } from "./providers.js";
import { profileDir } from "./profiles.js";

export const AGENT_CONFIG_ROOT_MARKER = "own-agent-config";
export const AGENT_CONFIG_ROOT_DIR = "agent-config";
export const AGENT_CONFIG_HOME_ENV = "EVENT4U_CONFIG_HOME";

export function usesOwnAgentConfigRoot(name: string): boolean {
  return fs.existsSync(path.join(profileDir("claude", name), AGENT_CONFIG_ROOT_MARKER));
}

/** The profile's own root when it is switched on, else null (the global root). */
export function agentConfigRootFor(name: string): string | null {
  return usesOwnAgentConfigRoot(name) ? path.join(profileDir("claude", name), AGENT_CONFIG_ROOT_DIR) : null;
}

/** Writes or removes only the marker: config and keys are never copied or deleted. */
export function setOwnAgentConfigRoot(name: string, on: boolean): void {
  const file = path.join(profileDir("claude", name), AGENT_CONFIG_ROOT_MARKER);
  if (!on) return void fs.rmSync(file, { force: true });
  fs.writeFileSync(file, `own agent-config root since ${new Date().toISOString()}\n`, { mode: 0o600 });
}

/** Env a new session of this profile starts with. Empty when off, so a value
 *  the caller inherited is left as it is. */
export function sessionAgentConfigEnv(providerId: ProviderId, name: string): Record<string, string> {
  if (providerId !== "claude") return {};
  const root = agentConfigRootFor(name);
  return root ? { [AGENT_CONFIG_HOME_ENV]: root } : {};
}
