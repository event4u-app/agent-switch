/**
 * `agent-switch gui` — launch the desktop tray GUI.
 *
 * The GUI is a native (Tauri) binary, so it can't run "as JS". Instead the
 * prebuilt binary ships as a per-platform optional-dependency npm package
 * (`@event4u/agent-switch-<platform>`, the esbuild pattern), installed
 * automatically alongside the CLI. Because it arrives via npm — not a
 * browser-downloaded DMG/exe — it carries no quarantine flag, so it launches
 * without the Gatekeeper / SmartScreen "unverified developer" block.
 *
 * The platform→package / artifact / launch-argv resolution is pure and tested;
 * only {@link launchGui} touches the filesystem and spawns a process.
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";

const require = createRequire(import.meta.url);

/** The optional-dependency package carrying the GUI binary for a platform+arch,
 *  or null when the platform is unsupported. macOS ships a universal binary, so
 *  one darwin package serves both arches. Pure. */
export function guiPackageFor(platform: string = process.platform, arch: string = process.arch): string | null {
  if (platform === "darwin") return "@event4u/agent-switch-darwin";
  if (platform === "win32" && arch === "x64") return "@event4u/agent-switch-win32-x64";
  if (platform === "linux" && arch === "x64") return "@event4u/agent-switch-linux-x64";
  return null;
}

/** The artifact file name inside a platform package. macOS ships the `.app`
 *  bundle (launched via `open`), Windows the `.exe`, Linux the raw binary. Pure. */
export function guiArtifactName(platform: string = process.platform): string | null {
  if (platform === "darwin") return "agent-switch.app";
  if (platform === "win32") return "agent-switch.exe";
  if (platform === "linux") return "agent-switch";
  return null;
}

/** Program + args to launch the artifact at `artifactPath`. macOS uses `open`
 *  (the artifact is an .app bundle); elsewhere the binary is executed directly.
 *  Pure — the launch convention split out for testing. */
export function guiLaunchArgv(platform: string, artifactPath: string): { program: string; args: string[] } {
  if (platform === "darwin") return { program: "open", args: ["-n", artifactPath] };
  return { program: artifactPath, args: [] };
}

/** Absolute path to the GUI artifact for the host, or null when the platform
 *  package isn't installed / the artifact is missing. */
export function resolveGuiArtifact(platform: string = process.platform, arch: string = process.arch): string | null {
  const pkg = guiPackageFor(platform, arch);
  const artifact = guiArtifactName(platform);
  if (!pkg || !artifact) return null;
  let pkgDir: string;
  try {
    pkgDir = path.dirname(require.resolve(`${pkg}/package.json`));
  } catch {
    return null; // optional dependency not installed for this platform
  }
  const p = path.join(pkgDir, "bin", artifact);
  return fs.existsSync(p) ? p : null;
}

/** Launch the desktop GUI, detached so the CLI returns immediately. Throws a
 *  helpful error when the platform is unsupported or the package is absent. */
export function launchGui(): void {
  const pkg = guiPackageFor();
  if (!pkg) {
    throw new Error(`the desktop GUI has no prebuilt binary for ${process.platform}/${process.arch} — build it from source with \`task gui:build\`.`);
  }
  const artifact = resolveGuiArtifact();
  if (!artifact) {
    throw new Error(
      `GUI binary not found — the platform package "${pkg}" is not installed.\n` +
        `Reinstall the CLI so npm pulls it: \`npm install -g @event4u/agent-switch\`.`,
    );
  }
  // On POSIX the raw binary needs the executable bit (npm can drop it).
  if (process.platform !== "win32" && process.platform !== "darwin") {
    try {
      fs.chmodSync(artifact, 0o755);
    } catch {
      /* best-effort */
    }
  }
  const { program, args } = guiLaunchArgv(process.platform, artifact);
  const child = spawn(program, args, { detached: true, stdio: "ignore" });
  child.unref();
}
