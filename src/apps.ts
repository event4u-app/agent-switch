/**
 * GUI/desktop app launch layer (foundation).
 *
 * Extends agent-switch's per-profile isolation beyond the CLIs to GUI clients
 * (Claude Desktop, Codex UI, …). Two isolation strategies:
 *
 *   - "env"            — export the provider's config-dir env var (the same
 *                        mechanism the CLIs use) when launching the GUI, so a
 *                        surface that reads e.g. CODEX_HOME isolates the same
 *                        way. Reuses the existing profile config dir.
 *   - "user-data-dir"  — pass Chromium's `--user-data-dir` to an Electron app,
 *                        giving each profile its own fully isolated data dir
 *                        (cookies/session). Uses a dedicated per-profile dir.
 *
 * `buildLaunch` is pure (path + argv construction only) so both strategies are
 * unit-testable. The registry starts EMPTY on purpose: concrete apps are
 * registered by the per-client roadmaps (claude-desktop, codex-ui), not here.
 */

import { spawnSync } from "node:child_process";
import { ProviderId } from "./providers.js";
import { configDir, profileDir } from "./profiles.js";

export type LaunchStrategy = "env" | "user-data-dir";

export interface AppDescriptor {
  /** Stable id, e.g. "claude-desktop". */
  readonly id: string;
  readonly displayName: string;
  /** macOS bundle identifier, used to launch + detect the app. */
  readonly bundleId: string;
  /** Which agent-switch provider's profiles this app belongs to. */
  readonly provider: ProviderId;
  readonly strategy: LaunchStrategy;
  /** For the "env" strategy: the env var to export (e.g. "CODEX_HOME"). */
  readonly envVar?: string;
}

/**
 * Registered launchable GUI apps. EMPTY by design — the per-client roadmaps add
 * entries (and own each app's verification + caveats). The foundation only
 * provides the mechanism.
 */
export const APPS: readonly AppDescriptor[] = [];

export function findApp(id: string, registry: readonly AppDescriptor[] = APPS): AppDescriptor | null {
  return registry.find((a) => a.id === id) ?? null;
}

/** The per-profile Electron user-data dir for a "user-data-dir" app. */
export function guiDataDir(app: AppDescriptor, name: string): string {
  return `${profileDir(app.provider, name)}/gui/${app.id}`;
}

export interface LaunchSpec {
  program: string;
  args: string[];
}

/**
 * Build the launch command for an app + profile (pure). macOS `open`:
 *   - env:            open -n --env <VAR>=<profileConfigDir> -b <bundleId>
 *   - user-data-dir:  open -n -b <bundleId> --args --user-data-dir=<guiDataDir>
 * `-n` forces a new instance; distinct dir ⇒ distinct single-instance lock ⇒
 * profiles run in parallel. Throws on a misconfigured descriptor.
 */
export function buildLaunch(app: AppDescriptor, name: string): LaunchSpec {
  if (app.strategy === "env") {
    if (!app.envVar) throw new Error(`app "${app.id}" uses the env strategy but declares no envVar`);
    return {
      program: "open",
      args: ["-n", "--env", `${app.envVar}=${configDir(app.provider, name)}`, "-b", app.bundleId],
    };
  }
  return {
    program: "open",
    args: ["-n", "-b", app.bundleId, "--args", `--user-data-dir=${guiDataDir(app, name)}`],
  };
}

/** Best-effort: is the app installed? (macOS bundle-id lookup; false elsewhere.) */
export function isInstalled(app: AppDescriptor): boolean {
  if (process.platform !== "darwin") return false;
  const r = spawnSync("mdfind", [`kMDItemCFBundleIdentifier == '${app.bundleId}'`], { encoding: "utf8" });
  return r.status === 0 && r.stdout.trim().length > 0;
}
