import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";

import { plan, menu, type Env } from "../src/open-in.js";
import { openDirPlan, pickTerminal, runPlan, terminals } from "../src/terminals.js";

const env = (platform: NodeJS.Platform, onPath: string[] = [], apps: string[] = []): Env => ({
  platform,
  onPath: (c) => (onPath.includes(c) ? `/usr/bin/${c}` : null),
  macApp: (n) => (apps.includes(n) ? `/Applications/${n}.app` : null),
});

test("terminals: macOS lists the app terminals with Terminal always present; Linux the PATH ones; Windows none", () => {
  const mac = terminals(env("darwin", [], ["iTerm", "Ghostty"]));
  assert.deepEqual(mac.filter((t) => t.installed).map((t) => t.id), ["terminal", "iterm", "ghostty"]);
  assert.ok(mac.some((t) => t.id === "warp" && !t.installed));
  assert.ok(!mac.some((t) => t.id === "konsole"), "Linux-only terminals are not offered on macOS");
  const linux = terminals(env("linux", ["konsole", "kitty"]));
  assert.deepEqual(linux.filter((t) => t.installed).map((t) => t.id), ["kitty", "konsole"]);
  assert.ok(!linux.some((t) => t.id === "iterm" || t.id === "terminal"));
  assert.deepEqual(terminals(env("win32")), []);
});

test("pickTerminal: the chosen one while installed, else the first installed", () => {
  const e = env("darwin", [], ["iTerm"]);
  assert.equal(pickTerminal("iterm", e), "iterm");
  assert.equal(pickTerminal("ghostty", e), "terminal", "chosen but uninstalled → first installed");
  assert.equal(pickTerminal(null, e), "terminal");
  assert.equal(pickTerminal(null, env("linux")), null);
});

test("openDirPlan: an argv per terminal, the folder as its own argument, no URL scheme", () => {
  const mac = env("darwin", [], ["iTerm", "Ghostty", "Warp", "WezTerm", "kitty", "Alacritty"]);
  assert.deepEqual(openDirPlan("terminal", "/w", mac), { program: "open", args: ["-a", "Terminal", "/w"] });
  assert.deepEqual(openDirPlan("iterm", "/w", mac), { program: "open", args: ["-a", "iTerm", "/w"] });
  assert.deepEqual(openDirPlan("warp", "/w", mac), { program: "open", args: ["-a", "Warp", "/w"] });
  assert.deepEqual(openDirPlan("ghostty", "/w", mac), { program: "open", args: ["-na", "Ghostty", "--args", "--working-directory=/w"] });
  assert.deepEqual(openDirPlan("wezterm", "/w", mac), { program: "open", args: ["-na", "WezTerm", "--args", "start", "--cwd", "/w"] });
  assert.deepEqual(openDirPlan("konsole", "/w", env("linux", ["konsole"])), { program: "/usr/bin/konsole", args: ["--workdir", "/w"] });
  assert.deepEqual(openDirPlan("gnome-terminal", "/w", env("linux", ["gnome-terminal"])), { program: "/usr/bin/gnome-terminal", args: ["--working-directory=/w"] });
  assert.equal(openDirPlan("kitty", "/w", env("darwin")), null, "not installed");
  for (const id of ["terminal", "iterm", "ghostty", "warp", "wezterm", "kitty", "alacritty"] as const) {
    const p = openDirPlan(id, "/w", mac)!;
    assert.ok(!p.args.some((a) => /^[a-z]+:\/\//.test(a)), `${id} passes no URL`);
  }
});

test("runPlan: the command runs from the folder; quotes cannot break out of the AppleScript or shell string", () => {
  const mac = env("darwin", [], ["iTerm"]);
  const dir = `/w/it's "here"`;
  const cmd = `claude --resume "abc" ; echo 'x'`;
  const t = runPlan("terminal", dir, cmd, mac)!;
  assert.equal(t.program, "osascript");
  assert.match(t.args[1]!, /^tell application "Terminal"\nactivate\ndo script "cd '\/w\/it'\\\\''s \\"here\\"' && claude --resume \\"abc\\" ; echo 'x'"\nend tell$/);
  const i = runPlan("iterm", "/w", "echo hi", mac)!;
  assert.match(i.args[1]!, /create window with default profile command "\/bin\/sh -c 'cd '\\\\''\/w'\\\\'' && echo hi'"/);
  assert.equal(runPlan("warp", "/w", "echo", env("darwin", [], ["Warp"])), null, "Warp cannot be asked to run a command");
  assert.deepEqual(runPlan("kitty", "/w", "echo hi", env("linux", ["kitty"])), { program: "/usr/bin/kitty", args: ["--directory", "/w", "/bin/sh", "-c", "cd '/w' && echo hi"] });
});

test("open-in: the terminal target opens the chosen terminal and carries its name", () => {
  const mac = env("darwin", [], ["iTerm"]);
  assert.deepEqual(plan("terminal", "/w", mac, undefined, undefined, "iterm"), { target: "terminal", program: "open", args: ["-a", "iTerm", "/w"] });
  assert.equal(menu(mac, "/", "iterm").find((e) => e.target === "terminal")?.label, "iTerm2");
  assert.equal(menu(mac).find((e) => e.target === "terminal")?.label, "Terminal");
});

test("the AppleScript the run plans produce compiles (macOS only)", { skip: process.platform !== "darwin" }, () => {
  // iTerm's AppleScript terms come from its own dictionary: they compile only where
  // iTerm is installed — which is also the only place this plan is ever used.
  const ids = ["terminal", ...(fs.existsSync("/Applications/iTerm.app") ? (["iterm"] as const) : [])] as const;
  for (const id of ids) {
    const p = runPlan(id, `/tmp/it's "x"`, `echo "a" 'b'`, { platform: "darwin", onPath: () => null, macApp: () => "/Applications/iTerm.app" })!;
    // osacompile parses without running; the output goes to /dev/null.
    const r = spawnSync("osacompile", ["-o", "/dev/null", "-e", p.args[1]!], { encoding: "utf8" });
    assert.equal(r.status, 0, `${id}: ${r.stderr}`);
  }
});
