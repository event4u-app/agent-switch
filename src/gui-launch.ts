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

/** The cache folder for an artifact taken from release `tag`. Pure. */
export function guiCacheVersion(tag: string): string {
  return tag.trim().replace(/^[vV]/, "");
}

/** `CFBundleShortVersionString` from an Info.plist (XML), or null. Pure. */
export function bundleVersionFromPlist(xml: string): string | null {
  const m = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(xml);
  return m ? m[1].trim() : null;
}

/** Whether a cached app may be reused for `version`. A bundle reporting another
 *  version would be compared against releases as that version forever, so it is
 *  stale; an unreadable version is kept, since nothing proves it wrong. Pure. */
export function cachedBundleFits(version: string, bundleVersion: string | null): boolean {
  return bundleVersion === null || guiCacheVersion(bundleVersion) === guiCacheVersion(version);
}

function appBundleVersion(appPath: string): string | null {
  try {
    return bundleVersionFromPlist(fs.readFileSync(path.join(appPath, "Contents", "Info.plist"), "utf8"));
  } catch {
    return null;
  }
}

/** Program + args to launch a prepared artifact. Pure.
 *  macOS uses `open` WITHOUT `-n`: a bare `open` activates the already-running
 *  app instead of forcing a second copy, so it is the OS-level half of the
 *  single-instance guarantee (`isGuiRunning` is the other half). */
export function guiLaunchArgv(kind: GuiKind, target: string): { program: string; args: string[] } {
  if (kind === "app") return { program: "open", args: [target] };
  return { program: target, args: [] }; // AppImage runs directly; win-setup runs the installer
}

/** Substring that identifies a RUNNING GUI process for this kind inside a
 *  process-list snapshot. Specific enough not to match the Node CLI itself
 *  (whose command line is `node …/dist/index.js`). Pure. */
export function guiProcessSignature(kind: GuiKind): string {
  if (kind === "app") return "agent-switch.app/Contents/MacOS/agent-switch"; // the running .app binary
  if (kind === "appimage") return "agent-switch.AppImage";
  return "agent-switch.exe"; // win: the installed app process (not the -setup installer)
}

/** Whether `signature` appears in a process-list snapshot. Pure. */
export function guiRunningIn(signature: string, processList: string): boolean {
  return processList.includes(signature);
}

/** Live process-list snapshot for the host (full command line per process). */
function processListSnapshot(platform: string = process.platform): string {
  try {
    if (platform === "win32") {
      return spawnSync("tasklist", [], { encoding: "utf8" }).stdout ?? "";
    }
    return spawnSync("ps", ["ax", "-o", "command="], { encoding: "utf8" }).stdout ?? "";
  } catch {
    return ""; // ps/tasklist unavailable → treat as "not detectably running"
  }
}

/** Whether the desktop GUI is already running on this host. Used to enforce
 *  the single-instance rule before spawning a second copy. */
export function isGuiRunning(): boolean {
  const spec = guiAssetSpec();
  if (!spec) return false;
  return guiRunningIn(guiProcessSignature(spec.kind), processListSnapshot());
}

interface Asset {
  name: string;
  url: string;
}

/** Find a matching GUI asset on the release for `version`, falling back to the
 *  latest release. Returns null when neither has one. */
async function findAsset(version: string, match: RegExp): Promise<(Asset & { tag: string }) | null> {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "@event4u/agent-switch gui-launch" };
  for (const ref of [`tags/${version}`, "latest"]) {
    let res: Response;
    try {
      res = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/${ref}`, { headers });
    } catch {
      continue;
    }
    if (!res.ok) continue;
    const rel = (await res.json()) as { tag_name?: string; assets?: { name: string; browser_download_url: string }[] };
    const a = (rel.assets ?? []).find((x) => match.test(x.name));
    if (a) return { name: a.name, url: a.browser_download_url, tag: rel.tag_name ?? version };
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
  const launchName = spec.kind === "app" ? "agent-switch.app" : spec.kind === "appimage" ? "agent-switch.AppImage" : "agent-switch-setup.exe";
  const cached = (v: string): string | null => {
    const p = path.join(CACHE_ROOT, v, launchName);
    if (!fs.existsSync(p)) return null;
    if (spec.kind === "app" && !cachedBundleFits(v, appBundleVersion(p))) {
      fs.rmSync(path.join(CACHE_ROOT, v), { recursive: true, force: true });
      return null;
    }
    return p;
  };
  const hit = cached(version);
  if (hit) return hit;

  const asset = await findAsset(version, spec.match);
  if (!asset) {
    throw new Error(
      `no GUI artifact for ${process.platform}/${process.arch} on the ${version} (or latest) release.\n` +
        `Download an installer from https://github.com/${UPDATE_REPO}/releases instead.`,
    );
  }
  // The fallback to the latest release (this version's build still running, or
  // none) is filed under ITS version: filed under ours, the older app would be
  // reused forever and report itself as outdated.
  const assetVersion = guiCacheVersion(asset.tag);
  if (assetVersion !== guiCacheVersion(version)) {
    console.log(`Release ${version} has no GUI build yet — using ${assetVersion}.`);
    const older = cached(assetVersion);
    if (older) return older;
  }
  const dir = path.join(CACHE_ROOT, assetVersion);
  const launchPath = path.join(dir, launchName);
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

/** Whether a process id is still alive. EPERM means it exists under another
 *  user, which still counts as alive. */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Poll until `pid` has exited or `timeoutMs` passed; true when it exited. */
export async function waitForExit(
  pid: number,
  opts: { alive?: (pid: number) => boolean; sleep?: (ms: number) => Promise<void>; timeoutMs?: number; stepMs?: number } = {},
): Promise<boolean> {
  const alive = opts.alive ?? pidAlive;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const step = opts.stepMs ?? 200;
  for (let waited = 0; waited < (opts.timeoutMs ?? 30_000); waited += step) {
    if (!alive(pid)) return true;
    await sleep(step);
  }
  return !alive(pid);
}

/** Launch the desktop GUI (downloading + caching it on first use).
 *  Single-instance: if a GUI is already running, no second copy is started —
 *  returns "already-running" so the caller can say so. */
export async function launchGui(): Promise<"launched" | "already-running"> {
  const spec = guiAssetSpec();
  if (!spec) {
    throw new Error(`the desktop GUI has no prebuilt artifact for ${process.platform}/${process.arch} — build it from source with \`task gui:build\`.`);
  }
  if (isGuiRunning()) return "already-running";
  const target = await ensureGuiArtifact(spec);
  const { program, args } = guiLaunchArgv(spec.kind, target);
  const child = spawn(program, args, { detached: true, stdio: "ignore" });
  child.unref();
  return "launched";
}
