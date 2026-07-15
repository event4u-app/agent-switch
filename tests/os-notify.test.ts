import { test } from "node:test";
import assert from "node:assert/strict";

import { buildOsNotifyCommand, osNotify } from "../src/os-notify.js";

test("buildOsNotifyCommand: macOS uses osascript with an escaped display-notification script", () => {
  const cmd = buildOsNotifyCommand("darwin", "Auto-switch", "moved to privat");
  assert.ok(cmd);
  assert.equal(cmd.program, "osascript");
  assert.equal(cmd.args[0], "-e");
  assert.match(cmd.args[1], /display notification "moved to privat" with title "Auto-switch"/);
});

test("buildOsNotifyCommand: macOS escapes quotes and backslashes in the script", () => {
  const cmd = buildOsNotifyCommand("darwin", 'a"b', "c\\d");
  assert.ok(cmd);
  // the embedded literals are escaped so the AppleScript string stays well-formed
  assert.match(cmd.args[1], /title "a\\"b"/);
  assert.match(cmd.args[1], /notification "c\\\\d"/);
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
