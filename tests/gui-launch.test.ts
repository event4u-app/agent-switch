import { test } from "node:test";
import assert from "node:assert/strict";

import {
  bundleVersionFromPlist,
  cachedBundleFits,
  guiAssetSpec,
  guiCacheVersion,
  guiLaunchArgv,
  guiProcessSignature,
  guiRunningIn,
  newestCachedVersion,
  pickReleaseAsset,
  pidAlive,
  waitForExit,
} from "../src/gui-launch.js";

test("guiAssetSpec maps platform+arch to the release-asset pattern + handling", () => {
  const mac = guiAssetSpec("darwin", "arm64");
  assert.equal(mac?.kind, "app");
  assert.ok(mac?.match.test("agent-switch_universal.app.tar.gz"));
  assert.ok(guiAssetSpec("darwin", "x64")?.match.test("agent-switch_universal.app.tar.gz")); // universal, both arches

  const linux = guiAssetSpec("linux", "x64");
  assert.equal(linux?.kind, "appimage");
  assert.ok(linux?.match.test("agent-switch_1.0.2_amd64.AppImage"));

  const win = guiAssetSpec("win32", "x64");
  assert.equal(win?.kind, "win-exe");
  assert.ok(win?.match.test("agent-switch_2.8.2_x64-portable.exe"));
});

test("guiAssetSpec returns null for unsupported platform/arch", () => {
  assert.equal(guiAssetSpec("linux", "arm64"), null);
  assert.equal(guiAssetSpec("win32", "arm64"), null);
  assert.equal(guiAssetSpec("freebsd", "x64"), null);
});

test("guiAssetSpec patterns don't match the wrong artifact", () => {
  // macOS wants the .app bundle tarball, not the .dmg installer.
  assert.ok(!guiAssetSpec("darwin", "arm64")!.match.test("agent-switch_1.0.2_universal.dmg"));
  // Windows wants the portable exe — never an installer (.msi or NSIS setup).
  assert.ok(!guiAssetSpec("win32", "x64")!.match.test("agent-switch_1.0.2_x64_en-US.msi"));
  assert.ok(!guiAssetSpec("win32", "x64")!.match.test("agent-switch_1.0.2_x64-setup.exe"));
});

test("guiLaunchArgv opens the .app on macOS (no -n → activates the running instance), runs the binary directly otherwise", () => {
  // No `-n`: `open` activates an already-running app instead of forcing a
  // second copy — the OS-level half of the single-instance guarantee.
  assert.deepEqual(guiLaunchArgv("app", "/c/agent-switch.app"), { program: "open", args: ["/c/agent-switch.app"] });
  assert.deepEqual(guiLaunchArgv("appimage", "/c/agent-switch.AppImage"), { program: "/c/agent-switch.AppImage", args: [] });
  assert.deepEqual(guiLaunchArgv("win-exe", "C:/c/agent-switch.exe"), { program: "C:/c/agent-switch.exe", args: [] });
});

test("guiProcessSignature identifies the running GUI process per kind", () => {
  assert.equal(guiProcessSignature("app"), "agent-switch.app/Contents/MacOS/agent-switch");
  assert.equal(guiProcessSignature("appimage"), "agent-switch.AppImage");
  assert.equal(guiProcessSignature("win-exe"), "agent-switch.exe");
});

test("guiRunningIn detects a running instance in a process-list snapshot", () => {
  const psWithApp = [
    "/sbin/launchd",
    "/Users/x/.agent-switch/gui/1.7.0/agent-switch.app/Contents/MacOS/agent-switch",
    "node /opt/homebrew/lib/node_modules/@event4u/agent-switch/dist/index.js gui",
  ].join("\n");
  assert.equal(guiRunningIn(guiProcessSignature("app"), psWithApp), true);

  // The Node CLI's own command line must NOT be mistaken for a running GUI.
  const psCliOnly = "node /opt/homebrew/lib/node_modules/@event4u/agent-switch/dist/index.js";
  assert.equal(guiRunningIn(guiProcessSignature("app"), psCliOnly), false);

  const psWithAppImage = "/tmp/x/agent-switch.AppImage\n/usr/bin/gnome-shell";
  assert.equal(guiRunningIn(guiProcessSignature("appimage"), psWithAppImage), true);
  assert.equal(guiRunningIn(guiProcessSignature("appimage"), "/usr/bin/gnome-shell"), false);
});

test("waitForExit: returns once the process is gone, polling in between", async () => {
  let polls = 0;
  const slept: number[] = [];
  const exited = await waitForExit(42, {
    alive: () => ++polls < 4,
    sleep: async (ms) => void slept.push(ms),
    stepMs: 100,
  });
  assert.equal(exited, true);
  assert.deepEqual(slept, [100, 100, 100]);
});

test("waitForExit: gives up after the timeout when the process never quits", async () => {
  let slept = 0;
  const exited = await waitForExit(42, { alive: () => true, sleep: async (ms) => void (slept += ms), stepMs: 100, timeoutMs: 1_000 });
  assert.equal(exited, false);
  assert.equal(slept, 1_000);
});

test("pidAlive: this process is alive, an unused pid is not", () => {
  assert.equal(pidAlive(process.pid), true);
  assert.equal(pidAlive(2 ** 22 + 12345), false);
});

test("guiCacheVersion files an artifact under the release it came from, never the requested one", () => {
  assert.equal(guiCacheVersion("2.6.3"), "2.6.3");
  assert.equal(guiCacheVersion("v2.7.0"), "2.7.0");
  assert.equal(guiCacheVersion(" 2.7.0 "), "2.7.0");
});

test("bundleVersionFromPlist reads CFBundleShortVersionString from an Info.plist", () => {
  const plist = `<?xml version="1.0"?><plist><dict>
    <key>CFBundleName</key><string>agent-switch</string>
    <key>CFBundleShortVersionString</key>
    <string>2.6.3</string></dict></plist>`;
  assert.equal(bundleVersionFromPlist(plist), "2.6.3");
  assert.equal(bundleVersionFromPlist("<plist><dict></dict></plist>"), null);
  assert.equal(bundleVersionFromPlist(""), null);
});

test("cachedBundleFits: a cached app whose own version differs from its folder is stale", () => {
  assert.equal(cachedBundleFits("2.7.0", "2.7.0"), true);
  // the bug: the latest-release fallback (2.6.3) filed under 2.7.0 → endless update prompt
  assert.equal(cachedBundleFits("2.7.0", "2.6.3"), false);
  // unreadable bundle version → keep it (cannot tell), never discard blindly
  assert.equal(cachedBundleFits("2.7.0", null), true);
});

test("pickReleaseAsset takes the newest release that carries the asset, skipping one still building", () => {
  const mac = /\.app\.tar\.gz$/;
  const releases = [
    // 2.8.1 is published but its macOS job is still running: no .app yet.
    { tag_name: "2.8.1", assets: [{ name: "agent-switch_2.8.1_amd64.AppImage", browser_download_url: "u/2.8.1/appimage" }] },
    { tag_name: "2.8.0", draft: true, assets: [{ name: "agent-switch_universal.app.tar.gz", browser_download_url: "u/draft" }] },
    { tag_name: "2.7.9", assets: [{ name: "agent-switch_universal.app.tar.gz", browser_download_url: "u/2.7.9/app" }] },
    { tag_name: "2.7.8", assets: [{ name: "agent-switch_universal.app.tar.gz", browser_download_url: "u/2.7.8/app" }] },
  ];
  assert.deepEqual(pickReleaseAsset(releases, mac), { name: "agent-switch_universal.app.tar.gz", url: "u/2.7.9/app", tag: "2.7.9" });
  assert.equal(pickReleaseAsset([], mac), null);
  assert.equal(pickReleaseAsset([{ tag_name: "1.0.0", assets: [] }], mac), null);
});

test("newestCachedVersion orders by version, not by string", () => {
  assert.equal(newestCachedVersion(["2.7.1", "2.10.0", "2.9.3", "junk", "1.2.1"]), "2.10.0");
  assert.equal(newestCachedVersion(["junk"]), null);
  assert.equal(newestCachedVersion([]), null);
});
