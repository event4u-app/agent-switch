import { test } from "node:test";
import assert from "node:assert/strict";

import { detectShell, shellenvScript } from "../src/shellenv.js";

// Shell detection is pure over (requested, env, platform), so it is fully
// unit-testable without a real shell. The generated snippets are syntax-checked
// against real bash/zsh/fish in CI; here we pin the routing + shape.

test("detectShell honors an explicit request over the environment", () => {
  assert.equal(detectShell("fish", { SHELL: "/bin/zsh" }, "linux"), "fish");
  assert.equal(detectShell("bash", {}, "win32"), "bash");
  assert.equal(detectShell("pwsh", {}, "linux"), "powershell"); // alias
});

test("detectShell defaults to PowerShell on win32", () => {
  assert.equal(detectShell(undefined, {}, "win32"), "powershell");
});

test("detectShell reads $SHELL on POSIX and falls back to zsh", () => {
  assert.equal(detectShell(undefined, { SHELL: "/usr/bin/fish" }, "linux"), "fish");
  assert.equal(detectShell(undefined, { SHELL: "/bin/bash" }, "darwin"), "bash");
  assert.equal(detectShell(undefined, { SHELL: "/bin/zsh" }, "linux"), "zsh");
  assert.equal(detectShell(undefined, {}, "linux"), "zsh"); // unset $SHELL
});

test("detectShell rejects an unknown shell", () => {
  assert.throws(() => detectShell("tcsh", {}, "linux"), /unknown shell/);
});

test("each snippet defines a claude wrapper and asw, in that shell's grammar", () => {
  const posix = shellenvScript("zsh");
  assert.ok(posix.includes("claude() {") && posix.includes("asw() {"));
  assert.ok(posix.includes('command claude "$@"')); // POSIX escapes recursion via `command`

  const fish = shellenvScript("fish");
  assert.ok(fish.includes("function claude") && fish.includes("function asw"));
  assert.ok(fish.includes("$argv")); // fish argument list, not "$@"

  const ps = shellenvScript("powershell");
  assert.ok(ps.includes("function claude {") && ps.includes("function asw {"));
  assert.ok(ps.includes("Get-Command claude -CommandType Application")); // avoids recursion
  assert.ok(ps.includes("@args"));
});

test("bash and zsh share the POSIX snippet", () => {
  assert.equal(shellenvScript("bash"), shellenvScript("zsh"));
});
