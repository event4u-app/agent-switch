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

test("menu says where each target was found: the app bundle and its launcher (Settings › Open in)", () => {
  const m = menu(env("darwin", ["phpstorm", "code"], ["PhpStorm", "Visual Studio Code"]));
  const by = (t: string) => m.find((e) => e.target === t)!;
  assert.equal(by("phpstorm").app, "/Applications/PhpStorm.app");
  assert.equal(by("phpstorm").launcher, "/usr/local/bin/phpstorm");
  assert.equal(by("vscode").launcher, "/usr/local/bin/code");
  assert.equal(by("cursor").app, null, "not installed: nothing to show");
  assert.equal(by("cursor").launcher, null);
  assert.equal(by("finder").app, null, "a system target names no path it did not look up");
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
  const s = { default: "phpstorm" as const, perRepo: { "/r": "vscode" as const }, lastUsed: null, terminal: "iterm" as const };
  assert.equal(defaultTarget(s, "/r", installed), "vscode");
  assert.equal(defaultTarget(s, "/other", installed), "phpstorm");
  assert.equal(defaultTarget({ ...s, default: "cursor" }, null, installed), "vscode", "a default that is not installed falls back");
  const f = openSettingsFile(fs.mkdtempSync(path.join(os.tmpdir(), "asw-open-")));
  writeOpenSettings(f, s);
  assert.deepEqual(readOpenSettings(f), s);
  if (process.platform !== "win32") assert.equal(fs.statSync(f).mode & 0o777, 0o600);
  fs.writeFileSync(f, JSON.stringify({ default: "rm -rf", perRepo: { "/r": "evil" }, terminal: "rm -rf" }));
  assert.deepEqual(readOpenSettings(f), { default: null, perRepo: {}, lastUsed: null, terminal: null });
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

test("terminal of a session: the app is read from the process tree, not guessed", async () => {
  const { terminalOf } = await import("../src/focus-terminal.js");
  // pid → "ppid comm": claude ← zsh ← login ← the terminal app.
  const tree = (app: string) => {
    const rows: Record<number, string> = { 40: "  30 claude", 30: "  20 -zsh", 20: "  10 login", 10: `   1 ${app}` };
    return (pid: number) => rows[pid] ?? "";
  };
  assert.deepEqual(terminalOf(40, tree("/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal")), { name: "Terminal.app", app: "Terminal" });
  assert.deepEqual(terminalOf(40, tree("/Applications/iTerm.app/Contents/MacOS/iTerm2")), { name: "iTerm2", app: "iTerm2" });
  assert.deepEqual(terminalOf(40, tree("/Applications/Ghostty.app/Contents/MacOS/ghostty")), { name: "Ghostty", app: null });
  assert.deepEqual(terminalOf(40, tree("/Applications/Warp.app/Contents/MacOS/stable")), { name: "Warp", app: null });
  assert.deepEqual(terminalOf(40, tree("/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)")), { name: "VS Code", app: null });
  assert.deepEqual(terminalOf(40, tree("tmux")), { name: "tmux", app: null });
  assert.equal(terminalOf(40, tree("/usr/libexec/some-daemon")), null, "an unknown parent names no app");
  assert.equal(terminalOf(40, () => ""), null);
});

test("terminal facts: only a live Claude session in Terminal.app or iTerm2 on macOS can be focused", async () => {
  const { terminalFacts } = await import("../src/commands/open-in.js");
  const iterm = () => ({ name: "iTerm2", app: "iTerm2" as const });
  assert.deepEqual(terminalFacts("claude", 40, "darwin", iterm), { running: true, terminal: "iTerm2", focusable: true });
  const ghostty = terminalFacts("claude", 40, "darwin", () => ({ name: "Ghostty", app: null }));
  assert.equal(ghostty.terminal, "Ghostty");
  assert.equal(ghostty.focusable, false);
  assert.match(ghostty.why!, /Ghostty/);
  assert.deepEqual(terminalFacts("claude", null, "darwin", iterm), { running: false, terminal: null, focusable: false, why: "it is not running" });
  const linux = terminalFacts("claude", 40, "linux", () => ({ name: "kitty", app: null }));
  assert.equal(linux.terminal, "kitty");
  assert.equal(linux.focusable, false);
  const codex = terminalFacts("codex", null, "darwin", iterm);
  assert.equal(codex.running, null, "Codex names no process per session, so whether it runs is not known");
  assert.equal(codex.focusable, false);
  assert.match(codex.why!, /Codex/);
});
