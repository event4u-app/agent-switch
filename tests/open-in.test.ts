import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { plan, menu, confine, OpenRefused, defaultTarget, readOpenSettings, writeOpenSettings, openSettingsFile, type Env } from "../src/open-in.js";

const env = (platform: NodeJS.Platform, onPath: string[] = [], apps: string[] = []): Env => ({
  platform,
  onPath: (c) => (onPath.includes(c) ? `/usr/local/bin/${c}` : null),
  macApp: (n) => (apps.includes(n) ? `/Applications/${n}.app` : null),
});

test("plan: the tool's own launcher with an argv, never a URL scheme", () => {
  assert.deepEqual(plan("vscode", "/w", env("darwin", ["code"])), { target: "vscode", program: "/usr/local/bin/code", args: ["/w"] });
  assert.deepEqual(plan("vscode", "/w", env("linux", ["code"]), "/w/a.ts", 12), { target: "vscode", program: "/usr/local/bin/code", args: ["/w", "-g", "/w/a.ts:12"] });
  assert.deepEqual(plan("phpstorm", "/w", env("linux", ["phpstorm"]), "/w/a.php", 3), { target: "phpstorm", program: "/usr/local/bin/phpstorm", args: ["/w", "--line", "3", "/w/a.php"] });
  assert.deepEqual(plan("phpstorm", "/w", env("darwin", [], ["PhpStorm"])), { target: "phpstorm", program: "open", args: ["-na", "PhpStorm", "--args", "/w"] });
  assert.deepEqual(plan("finder", "/w", env("darwin")), { target: "finder", program: "open", args: ["/w"] });
  assert.deepEqual(plan("terminal", "/w", env("darwin")), { target: "terminal", program: "open", args: ["-a", "Terminal", "/w"] });
  assert.equal(plan("cursor", "/w", env("linux")), null, "not installed: not offered");
  for (const t of ["vscode", "cursor", "phpstorm", "idea", "finder", "terminal"] as const) {
    const p = plan(t, "/w", env("darwin", ["code", "cursor", "phpstorm", "idea"], ["Terminal"]));
    if (p) assert.ok(!p.args.some((a) => /^[a-z]+:\/\//.test(a)), `${t} passes no URL`);
  }
});

test("menu lists every target and marks what is installed", () => {
  const m = menu(env("linux", ["code", "xdg-open"]));
  assert.deepEqual(m.filter((e) => e.installed).map((e) => e.target), ["vscode", "finder"]);
});

test("confine: only paths inside the session's folder, symlinks resolved", () => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "asw-open-")));
  fs.mkdirSync(path.join(root, "src"));
  fs.symlinkSync(os.tmpdir(), path.join(root, "out"));
  assert.equal(confine(root), root);
  assert.equal(confine(root, "src"), path.join(root, "src"));
  assert.throws(() => confine(root, "../"), OpenRefused);
  assert.throws(() => confine(root, "out"), OpenRefused, "a link out of the folder is refused");
});

test("default target: the repo's, else the global one, else the first installed editor; settings are private", () => {
  const installed = menu(env("linux", ["code", "phpstorm", "xdg-open"]));
  const s = { default: "phpstorm" as const, perRepo: { "/r": "vscode" as const }, lastUsed: null };
  assert.equal(defaultTarget(s, "/r", installed), "vscode");
  assert.equal(defaultTarget(s, "/other", installed), "phpstorm");
  assert.equal(defaultTarget({ ...s, default: "cursor" }, null, installed), "vscode", "a default that is not installed falls back");
  const f = openSettingsFile(fs.mkdtempSync(path.join(os.tmpdir(), "asw-open-")));
  writeOpenSettings(f, s);
  assert.deepEqual(readOpenSettings(f), s);
  if (process.platform !== "win32") assert.equal(fs.statSync(f).mode & 0o777, 0o600);
  fs.writeFileSync(f, JSON.stringify({ default: "rm -rf", perRepo: { "/r": "evil" } }));
  assert.deepEqual(readOpenSettings(f), { default: null, perRepo: {}, lastUsed: null });
});

test("focus terminal: the script only takes a real tty; -1743 is explained with the fix, not swallowed", async () => {
  const { focusScript, interpret, FocusFailed } = await import("../src/focus-terminal.js");
  assert.match(focusScript("Terminal", "/dev/ttys003"), /tty of t is "\/dev\/ttys003"/);
  assert.match(focusScript("iTerm2", "/dev/ttys12"), /sessions of t/);
  assert.throws(() => focusScript("Terminal", '/dev/ttys1" & do shell script "x'), FocusFailed);
  try {
    interpret(1, "", "execution error: Not authorized to send Apple events to Terminal. (-1743)", "Terminal");
    assert.fail("should throw");
  } catch (e: any) {
    assert.ok(e instanceof FocusFailed);
    assert.match(e.message, /-1743/);
    assert.match(String(e.fix), /Privacy & Security › Automation/);
  }
  assert.throws(() => interpret(0, "not found", "", "Terminal"), /no Terminal tab/);
  assert.doesNotThrow(() => interpret(0, "ok\n", "", "Terminal"));
});
