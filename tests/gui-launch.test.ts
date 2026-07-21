import { test } from "node:test";
import assert from "node:assert/strict";

import { guiAssetSpec, guiLaunchArgv } from "../src/gui-launch.js";

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

test("guiLaunchArgv opens the .app on macOS, runs the binary directly otherwise", () => {
  assert.deepEqual(guiLaunchArgv("app", "/c/agent-switch.app"), { program: "open", args: ["-n", "/c/agent-switch.app"] });
  assert.deepEqual(guiLaunchArgv("appimage", "/c/agent-switch.AppImage"), { program: "/c/agent-switch.AppImage", args: [] });
  assert.deepEqual(guiLaunchArgv("win-setup", "C:/c/agent-switch-setup.exe"), { program: "C:/c/agent-switch-setup.exe", args: [] });
});
