import { test } from "node:test";
import assert from "node:assert/strict";

import { guiPackageFor, guiArtifactName, guiLaunchArgv } from "../src/gui-launch.js";

test("guiPackageFor maps platform+arch to the per-platform package (darwin universal)", () => {
  assert.equal(guiPackageFor("darwin", "arm64"), "@event4u/agent-switch-darwin");
  assert.equal(guiPackageFor("darwin", "x64"), "@event4u/agent-switch-darwin"); // universal — both arches
  assert.equal(guiPackageFor("win32", "x64"), "@event4u/agent-switch-win32-x64");
  assert.equal(guiPackageFor("linux", "x64"), "@event4u/agent-switch-linux-x64");
});

test("guiPackageFor returns null for unsupported platform/arch", () => {
  assert.equal(guiPackageFor("linux", "arm64"), null);
  assert.equal(guiPackageFor("win32", "arm64"), null);
  assert.equal(guiPackageFor("freebsd", "x64"), null);
});

test("guiArtifactName is the .app / .exe / bare binary per platform", () => {
  assert.equal(guiArtifactName("darwin"), "agent-switch.app");
  assert.equal(guiArtifactName("win32"), "agent-switch.exe");
  assert.equal(guiArtifactName("linux"), "agent-switch");
  assert.equal(guiArtifactName("freebsd"), null);
});

test("guiLaunchArgv opens the .app on macOS, execs the binary elsewhere", () => {
  assert.deepEqual(guiLaunchArgv("darwin", "/x/agent-switch.app"), { program: "open", args: ["-n", "/x/agent-switch.app"] });
  assert.deepEqual(guiLaunchArgv("win32", "C:/x/agent-switch.exe"), { program: "C:/x/agent-switch.exe", args: [] });
  assert.deepEqual(guiLaunchArgv("linux", "/x/agent-switch"), { program: "/x/agent-switch", args: [] });
});
