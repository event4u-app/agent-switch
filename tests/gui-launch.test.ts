import { test } from "node:test";
import assert from "node:assert/strict";

import { guiAssetSpec, guiLaunchArgv, guiProcessSignature, guiRunningIn } from "../src/gui-launch.js";

test("guiAssetSpec maps platform+arch to the release-asset pattern + handling", () => {
  const mac = guiAssetSpec("darwin", "arm64");
  assert.equal(mac?.kind, "app");
  assert.ok(mac?.match.test("agent-switch_universal.app.tar.gz"));
  assert.ok(guiAssetSpec("darwin", "x64")?.match.test("agent-switch_universal.app.tar.gz")); // universal, both arches

  const linux = guiAssetSpec("linux", "x64");
  assert.equal(linux?.kind, "appimage");
  assert.ok(linux?.match.test("agent-switch_1.0.2_amd64.AppImage"));

  const win = guiAssetSpec("win32", "x64");
  assert.equal(win?.kind, "win-setup");
  assert.ok(win?.match.test("agent-switch_1.0.2_x64-setup.exe"));
});

test("guiAssetSpec returns null for unsupported platform/arch", () => {
  assert.equal(guiAssetSpec("linux", "arm64"), null);
  assert.equal(guiAssetSpec("win32", "arm64"), null);
  assert.equal(guiAssetSpec("freebsd", "x64"), null);
});

test("guiAssetSpec patterns don't match the wrong artifact", () => {
  // macOS wants the .app bundle tarball, not the .dmg installer.
  assert.ok(!guiAssetSpec("darwin", "arm64")!.match.test("agent-switch_1.0.2_universal.dmg"));
  // Windows wants the setup exe, not the .msi.
  assert.ok(!guiAssetSpec("win32", "x64")!.match.test("agent-switch_1.0.2_x64_en-US.msi"));
});

test("guiLaunchArgv opens the .app on macOS (no -n → activates the running instance), runs the binary directly otherwise", () => {
  // No `-n`: `open` activates an already-running app instead of forcing a
  // second copy — the OS-level half of the single-instance guarantee.
  assert.deepEqual(guiLaunchArgv("app", "/c/agent-switch.app"), { program: "open", args: ["/c/agent-switch.app"] });
  assert.deepEqual(guiLaunchArgv("appimage", "/c/agent-switch.AppImage"), { program: "/c/agent-switch.AppImage", args: [] });
  assert.deepEqual(guiLaunchArgv("win-setup", "C:/c/agent-switch-setup.exe"), { program: "C:/c/agent-switch-setup.exe", args: [] });
});

test("guiProcessSignature identifies the running GUI process per kind", () => {
  assert.equal(guiProcessSignature("app"), "agent-switch.app/Contents/MacOS/agent-switch");
  assert.equal(guiProcessSignature("appimage"), "agent-switch.AppImage");
  assert.equal(guiProcessSignature("win-setup"), "agent-switch.exe");
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
