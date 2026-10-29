import { test } from "node:test";
import assert from "node:assert/strict";

import { buildOsNotifyCommand, osNotify } from "../src/os-notify.js";

test("buildOsNotifyCommand: macOS sends nothing — an osascript notification would show as Script Editor", () => {
  // Desktop notices on macOS come from the Agent Switch app itself, or from no one.
  assert.equal(buildOsNotifyCommand("darwin", "Auto-switch", "moved to privat"), null);
});

test("buildOsNotifyCommand: Linux uses notify-send with summary + body args (no shell)", () => {
  const cmd = buildOsNotifyCommand("linux", "Title", "Body");
  assert.deepEqual(cmd, { program: "notify-send", args: ["Title", "Body"] });
});

test("buildOsNotifyCommand: Windows uses a PowerShell balloon and escapes single quotes", () => {
  const cmd = buildOsNotifyCommand("win32", "it's", "done");
  assert.ok(cmd);
  assert.equal(cmd.program, "powershell");
  assert.ok(cmd.args.includes("-NoProfile"));
  assert.match(cmd.args.at(-1)!, /ShowBalloonTip/);
  assert.match(cmd.args.at(-1)!, /'it''s'/); // doubled single quote
});

test("buildOsNotifyCommand: unsupported platform returns null", () => {
  assert.equal(buildOsNotifyCommand("aix", "t", "b"), null);
});

test("osNotify returns false on an unsupported platform (never throws, no spawn)", () => {
  assert.equal(osNotify("t", "b", "aix"), false);
});
