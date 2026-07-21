/**
 * `agent-switch gui` — launch the desktop tray GUI.
 *
 * The GUI is a native (Tauri) binary. Rather than ship it through npm, this
 * downloads the prebuilt artifact from the matching GitHub Release on first
 * use, caches it under ~/.agent-switch/gui/<version>/, and launches it. A
 * release-downloaded, cached binary avoids the browser-download Gatekeeper
 * quarantine, and reuses the artifacts the release already publishes.
 *
 * Per platform the release carries a runnable artifact:
 *   - macOS: `*.app.tar.gz` (the .app bundle) → extract, `open`.
 *   - Linux: `*.AppImage`                     → chmod +x, run.
 *   - Windows: `*-setup.exe` (NSIS installer) → run (installs; no portable exe).
 *
 * The platform→asset resolution is pure and tested; download/extract/launch
 * touch the filesystem + network.
 */

import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/** The repo whose GitHub Releases carry the GUI artifacts. */
const UPDATE_REPO = "event4u-app/agent-switch";
const CACHE_ROOT = path.join(os.homedir(), ".agent-switch", "gui");

/** The running CLI's version, from the package's own package.json. */
function currentVersion(): string {
  try {
    const pkg = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    return JSON.parse(fs.readFileSync(pkg, "utf8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export type GuiKind = "app" | "appimage" | "win-setup";

/** The release-asset pattern + handling for the host platform+arch, or null
 *  when unsupported. Pure. */
export function guiAssetSpec(
  platform: string = process.platform,
  arch: string = process.arch,
): { match: RegExp; kind: GuiKind } | null {
  if (platform === "darwin") return { match: /\.app\.tar\.gz$/, kind: "app" };
  if (platform === "linux" && arch === "x64") return { match: /\.AppImage$/i, kind: "appimage" };
  if (platform === "win32" && arch === "x64") return { match: /-setup\.exe$/i, kind: "win-setup" };
  return null;
}

/** Program + args to launch a prepared artifact. Pure. */
export function guiLaunchArgv(kind: GuiKind, target: string): { program: string; args: string[] } {
  if (kind === "app") return { program: "open", args: ["-n", target] };
  return { program: target, args: [] }; // AppImage runs directly; win-setup runs the installer
}

interface Asset {
  name: string;
  url: string;
}

/** Find a matching GUI asset on the release for `version`, falling back to the
 *  latest release. Returns null when neither has one. */
async function findAsset(version: string, match: RegExp): Promise<Asset | null> {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "@event4u/agent-switch gui-launch" };
  for (const ref of [`tags/${version}`, "latest"]) {
    let res: Response;
    try {
      res = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/${ref}`, { headers });
    } catch {
      continue;
    }
    if (!res.ok) continue;
    const rel = (await res.json()) as { assets?: { name: string; browser_download_url: string }[] };
    const a = (rel.assets ?? []).find((x) => match.test(x.name));
    if (a) return { name: a.name, url: a.browser_download_url };
  }
  return null;
}

/** Download `url` to `dest` (follows redirects via global fetch). */
async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { headers: { "User-Agent": "@event4u/agent-switch gui-launch" } });
  if (!res.ok) throw new Error(`download failed: ${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
}

/** Ensure the GUI artifact for the host is downloaded + prepared under the
 *  version cache, and return the path to launch. */
async function ensureGuiArtifact(spec: { match: RegExp; kind: GuiKind }): Promise<string> {
  const version = currentVersion();
  const dir = path.join(CACHE_ROOT, version);
  const launchName = spec.kind === "app" ? "agent-switch.app" : spec.kind === "appimage" ? "agent-switch.AppImage" : "agent-switch-setup.exe";
  const launchPath = path.join(dir, launchName);
  if (fs.existsSync(launchPath)) return launchPath; // already cached

  const asset = await findAsset(version, spec.match);
  if (!asset) {
    throw new Error(
      `no GUI artifact for ${process.platform}/${process.arch} on the ${version} (or latest) release.\n` +
        `Download an installer from https://github.com/${UPDATE_REPO}/releases instead.`,
    );
  }
  fs.mkdirSync(dir, { recursive: true });
  console.log(`Downloading the GUI (${asset.name})…`);

  if (spec.kind === "app") {
    const tgz = path.join(dir, "app.tar.gz");
    await download(asset.url, tgz);
    // Extract the .app bundle, then locate it (the tarball name may vary).
    const r = spawnSync("tar", ["-xzf", tgz, "-C", dir], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`extract failed: ${r.stderr || r.status}`);
    fs.rmSync(tgz, { force: true });
    const appDir = fs.readdirSync(dir).find((n) => n.endsWith(".app"));
    if (!appDir) throw new Error("extracted archive contained no .app bundle");
    if (appDir !== launchName) fs.renameSync(path.join(dir, appDir), launchPath);
    return launchPath;
  }

  await download(asset.url, launchPath);
  if (spec.kind === "appimage") fs.chmodSync(launchPath, 0o755);
  return launchPath;
}

/** Launch the desktop GUI (downloading + caching it on first use). */
export async function launchGui(): Promise<void> {
  const spec = guiAssetSpec();
  if (!spec) {
    throw new Error(`the desktop GUI has no prebuilt artifact for ${process.platform}/${process.arch} — build it from source with \`task gui:build\`.`);
  }
  const target = await ensureGuiArtifact(spec);
  const { program, args } = guiLaunchArgv(spec.kind, target);
  const child = spawn(program, args, { detached: true, stdio: "ignore" });
  child.unref();
}
