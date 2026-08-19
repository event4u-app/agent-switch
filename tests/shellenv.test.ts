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

// ---------- single-load guard wiring ----------------------------------------
//
// The wrapper is the only place every interactive start funnels through, so
// these pin the three properties the guard depends on: it is asked, it can
// speak, and it can only ever block on its own exit code.

test("every wrapper asks the guard on the same command that resolves the dir", () => {
  for (const shell of ["zsh", "bash", "fish", "powershell"] as const) {
    const script = shellenvScript(shell);
    for (const binary of ["claude", "codex", "agy"]) {
      const provider = binary === "claude" ? "claude" : binary === "codex" ? "codex" : "antigravity";
      assert.ok(
        script.includes(`agent-switch dir --provider ${provider} --guard`),
        `${shell}/${binary} must resolve the dir and the guard in ONE invocation`,
      );
    }
  }
});

test("no wrapper swallows stderr — the guard has to be able to speak", () => {
  // The old snippets redirected `dir` output with 2>/dev/null, which would
  // eat the guard's message. Only the binary-existence probe may redirect.
  for (const shell of ["zsh", "bash", "fish", "powershell"] as const) {
    const script = shellenvScript(shell);
    for (const line of script.split("\n")) {
      if (!line.includes("agent-switch dir")) continue;
      assert.doesNotMatch(line, /2>\/dev\/null|2>\$null/, `${shell}: ${line.trim()}`);
    }
  }
});

test("wrappers block on the guard's exit code and on nothing else", () => {
  const posix = shellenvScript("zsh");
  assert.match(posix, /rc=\$\?/);
  assert.match(posix, /if \[ \$rc -eq 86 \]; then return \$rc; fi/);
  // No generic failure branch — a broken/missing agent-switch must fall through.
  assert.doesNotMatch(posix, /\$rc -ne 0/);

  assert.match(shellenvScript("fish"), /test \$rc -eq 86/);
  assert.match(shellenvScript("powershell"), /\$LASTEXITCODE -eq 86/);
});

test("an uninstalled agent-switch falls straight through to the real binary", () => {
  assert.match(shellenvScript("zsh"), /command -v agent-switch >\/dev\/null 2>&1 \|\| \{ command claude "\$@"; return; \}/);
  assert.match(shellenvScript("fish"), /if not type -q agent-switch/);
  assert.match(shellenvScript("powershell"), /if \(-not \(Get-Command agent-switch -ErrorAction SilentlyContinue\)\)/);
});
