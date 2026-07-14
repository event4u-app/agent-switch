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

import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { ProviderId } from "./providers.js";
import { configDir, profileDir } from "./profiles.js";

export type LaunchStrategy = "env" | "user-data-dir" | "env+user-data-dir";

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
 * Registered launchable GUI apps. Per-client roadmaps add entries (each owns its
 * verification + caveats); the foundation provides the mechanism.
 *
 * claude-desktop: the account is a Chromium web session, isolated per profile
 * by a distinct `--user-data-dir` (distinct single-instance lock ⇒ parallel
 * accounts). The profile's own data dir is used — the default
 * `~/Library/Application Support/Claude` install is never touched.
 */
export const APPS: readonly AppDescriptor[] = [
  {
    id: "claude-desktop",
    displayName: "Claude Desktop",
    bundleId: "com.anthropic.claudefordesktop",
    provider: "claude",
    strategy: "user-data-dir",
  },
  {
    // Codex IDE extension: the editor reads CODEX_HOME from its process env, so
    // isolation is the env strategy (reuses the codex profile's config dir).
    // Targets VS Code; other editors are a future addition.
    id: "codex-ide",
    displayName: "Codex (VS Code)",
    bundleId: "com.microsoft.VSCode",
    provider: "codex",
    strategy: "env",
    envVar: "CODEX_HOME",
  },
];

export function findApp(id: string, registry: readonly AppDescriptor[] = APPS): AppDescriptor | null {
  return registry.find((a) => a.id === id) ?? null;
}

/** The per-profile Electron user-data dir for a "user-data-dir" app.
 *  `path.join` keeps separators OS-correct (the string-concat version broke the
 *  Windows CI: `\`-joined profileDir + `/`-appended tail = mixed separators). */
export function guiDataDir(app: AppDescriptor, name: string): string {
  return path.join(profileDir(app.provider, name), "gui", app.id);
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
  const wantsEnv = app.strategy === "env" || app.strategy === "env+user-data-dir";
  const wantsUdd = app.strategy === "user-data-dir" || app.strategy === "env+user-data-dir";
  if (wantsEnv && !app.envVar) {
    throw new Error(`app "${app.id}" uses an env strategy but declares no envVar`);
  }
  // `open -n [--env VAR=<configDir>] -b <bundle> [--args --user-data-dir=<guiDir>]`.
  // Some apps isolate two independent layers at once (e.g. Codex desktop: its
  // agent config via CODEX_HOME + its web session via --user-data-dir).
  const args = ["-n"];
  if (wantsEnv) args.push("--env", `${app.envVar}=${configDir(app.provider, name)}`);
  args.push("-b", app.bundleId);
  if (wantsUdd) args.push("--args", `--user-data-dir=${guiDataDir(app, name)}`);
  return { program: "open", args };
}

/** Best-effort: is the app installed? (macOS bundle-id lookup; false elsewhere.) */
export function isInstalled(app: AppDescriptor): boolean {
  if (process.platform !== "darwin") return false;
  const r = spawnSync("mdfind", [`kMDItemCFBundleIdentifier == '${app.bundleId}'`], { encoding: "utf8" });
  return r.status === 0 && r.stdout.trim().length > 0;
}
