/**
 * agent-config recommendation / upgrade banner — pure logic.
 *
 * The GUI recommends the companion CLI (`@event4u/agent-config`) and offers a
 * one-click install/upgrade. Detection and the install/upgrade spawns live in
 * `ipc.ts` (Tauri shell); this module holds the pure view-derivation so it is
 * unit-testable, and reuses the version math from `updates.ts`.
 */

import { isNewer } from "./updates.js";

export const AGENT_CONFIG_REPO = "event4u-app/agent-config";
export const AGENT_CONFIG_REPO_URL = "https://github.com/event4u-app/agent-config";

/** Installed state, as detected from `agent-config --version` + the latest
 *  published release. `null` fields mean "unknown" (not installed / offline). */
export interface AgentConfigStatus {
  installed: boolean;
  /** Installed version (from `agent-config --version`); null when not installed. */
  current: string | null;
  /** Latest published release tag; null when unknown (offline / no releases). */
  latest: string | null;
}

/** What the banner should render this frame. `visible: false` → render nothing. */
export type AgentConfigView =
  | { visible: false }
  | { visible: true; mode: "install" }
  | { visible: true; mode: "update"; current: string; latest: string }
  | { visible: true; mode: "installed"; current: string; latest: string | null };

/**
 * Decide whether and how to show the banner:
 *  - not installed              → `install` (promo copy + Install button)
 *  - installed + newer released → `update` (shows current → latest + Update button)
 *  - installed + up to date     → hidden, EXCEPT dev mode → `installed` (info only)
 *
 * Returns `{ visible: false }` while the status is still unknown (`null`) so the
 * banner never flashes before detection completes.
 */
export function deriveAgentConfigView(status: AgentConfigStatus | null, devMode: boolean): AgentConfigView {
  if (!status) return { visible: false };
  if (!status.installed) return { visible: true, mode: "install" };
  if (status.current && status.latest && isNewer(status.latest, status.current)) {
    return { visible: true, mode: "update", current: status.current, latest: status.latest };
  }
  return devMode && status.current
    ? { visible: true, mode: "installed", current: status.current, latest: status.latest }
    : { visible: false };
}

/** Extract a version from `agent-config --version` stdout. The CLI may print
 *  `agent-config 9.2.0`, `9.2.0`, or `v9.2.0`; take the first dotted-number
 *  token. Returns null when nothing parseable is present. */
export function parseAgentConfigVersion(stdout: string): string | null {
  const m = /(\d+\.\d+(?:\.\d+)?)/.exec(stdout);
  return m ? m[1] : null;
}
