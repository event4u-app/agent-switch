/**
 * Shell integration snippets, per shell — a wrapper for each provider binary
 * (`claude`, `codex`, `agy`) plus `asw`.
 *
 * Each binary wrapper injects that provider's isolation env var from the
 * resolved profile (`agent-switch dir --provider <id>`: mapping >
 * active-for-provider > default). The wrapper must call the REAL binary, not
 * recurse — each shell has its own escape (`command` on POSIX/fish,
 * `Get-Command -CommandType Application` on PowerShell). cmd.exe has no clean
 * function-wrapper story, so there is no cmd snippet — `agent-switch run <name>
 * [--provider p]` is the cmd.exe path.
 *
 * `asw` convenience: bare `asw` lists all providers' profiles; `asw <name>`
 * switches the active Claude profile; `asw <provider> <name>` switches that
 * provider's.
 *
 * SINGLE-LOAD GUARD. The wrapper is the one place every interactive start
 * funnels through, so it is where the guard has to sit. `dir --guard` keeps the
 * config path on stdout (unchanged) and writes the human message to stderr, so
 * one invocation both feeds the wrapper and talks to the user — no second
 * process launch per command.
 *
 * The wrapper blocks on EXACTLY ONE exit code (86, GUARD_REFUSED_EXIT) and on
 * nothing else. That asymmetry is deliberate and load-bearing: a missing,
 * older, or broken `agent-switch` exits 127 / 1 / 2 and the wrapper carries on
 * to the real binary. This tool must never become the reason a user cannot
 * reach their assistant.
 *
 * Each wrapper first checks that `agent-switch` exists at all and otherwise
 * calls the real binary straight away. That check replaces the old
 * `2>/dev/null`: the guard has to be able to SPEAK on stderr, so the blanket
 * redirect had to go, and without the existence check an uninstalled
 * `agent-switch` would print "command not found" on every single invocation.
 * A side effect worth having: a genuinely broken agent-switch now surfaces its
 * error instead of silently degrading the shell onto the default config dir.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { allProviders } from "./providers.js";
import { GUARD_REFUSED_EXIT } from "./single-load.js";

export type Shell = "zsh" | "bash" | "fish" | "powershell";

export const SHELLS: readonly Shell[] = ["zsh", "bash", "fish", "powershell"];

/** Resolve the target shell: explicit request wins, else detect from the
 *  environment / platform. Windows defaults to PowerShell; POSIX reads $SHELL. */
export function detectShell(
  requested?: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Shell {
  if (requested) {
    const r = requested.toLowerCase();
    if (r === "pwsh" || r === "powershell") return "powershell";
    if ((SHELLS as readonly string[]).includes(r)) return r as Shell;
    throw new Error(`unknown shell "${requested}" (choose: ${SHELLS.join(", ")})`);
  }
  if (platform === "win32") return "powershell";
  const sh = env.SHELL ?? "";
  if (sh.includes("fish")) return "fish";
  if (sh.includes("bash")) return "bash";
  if (sh.includes("zsh")) return "zsh";
  return "zsh"; // sensible POSIX default when $SHELL is unset
}

// The CLI the running app activated (`agent-switch activate` writes its path to
// <home>/active-cli), so a dev build and an installed app each bring their own;
// a missing or vanished path falls back to agent-switch on PATH.
const POSIX_BIN = `__agent_switch_bin() {
  local p
  p="$(cat "\${AGENT_SWITCH_HOME:-$HOME/.agent-switch}/active-cli" 2>/dev/null)"
  if [ -n "$p" ] && [ -x "$p" ]; then printf '%s\\n' "$p"
  elif command -v agent-switch >/dev/null 2>&1; then printf 'agent-switch\\n'
  fi
}
__agent_switch() {
  local as
  as="$(__agent_switch_bin)"
  command "\${as:-agent-switch}" "$@"
}`;

const FISH_BIN = `function __agent_switch_bin
    set -l home $HOME/.agent-switch
    set -q AGENT_SWITCH_HOME; and set home $AGENT_SWITCH_HOME
    if test -r $home/active-cli
        set -l p (cat $home/active-cli)
        if test -x "$p"
            echo $p
            return
        end
    end
    type -q agent-switch; and echo agent-switch
end
function __agent_switch
    set -l as (__agent_switch_bin)
    test -n "$as"; or set as agent-switch
    command $as $argv
end`;

const POWERSHELL_BIN = `function __agent_switch_bin {
    $home_ = if ($env:AGENT_SWITCH_HOME) { $env:AGENT_SWITCH_HOME } else { Join-Path $HOME '.agent-switch' }
    $p = Get-Content -Path (Join-Path $home_ 'active-cli') -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($p -and (Test-Path $p)) { return $p }
    if (Get-Command agent-switch -ErrorAction SilentlyContinue) { return 'agent-switch' }
    return $null
}
function __agent_switch {
    $as = __agent_switch_bin
    if (-not $as) { $as = 'agent-switch' }
    if ($as -like '*.js') { & node $as @args } else { & $as @args }
}`;

function posixWrapper(binary: string, envVar: string, id: string): string {
  return `${binary}() {
  local dir rc as
  as="$(__agent_switch_bin)"
  [ -n "$as" ] || { command ${binary} "$@"; return; }
  dir="$(command "$as" dir --provider ${id} --guard)"
  rc=$?
  if [ $rc -eq ${GUARD_REFUSED_EXIT} ]; then return $rc; fi
  if [ -n "$dir" ]; then
    ${envVar}="$dir" command ${binary} "$@"
  else
    command ${binary} "$@"
  fi
}`;
}

function fishWrapper(binary: string, envVar: string, id: string): string {
  return `function ${binary}
    set -l as (__agent_switch_bin)
    if test -z "$as"
        command ${binary} $argv
        return
    end
    set -l dir (command $as dir --provider ${id} --guard)
    set -l rc $status
    if test $rc -eq ${GUARD_REFUSED_EXIT}
        return $rc
    end
    if test -n "$dir"
        ${envVar}=$dir command ${binary} $argv
    else
        command ${binary} $argv
    end
end`;
}

function powershellWrapper(binary: string, envVar: string, id: string): string {
  return `function ${binary} {
    $exe = Get-Command ${binary} -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $exe) { Write-Error '${binary} not found on PATH.'; return }
    $as = __agent_switch_bin
    if (-not $as) { & $exe.Source @args; return }
    $dir = (__agent_switch dir --provider ${id} --guard)
    if ($LASTEXITCODE -eq ${GUARD_REFUSED_EXIT}) { return }
    if ($dir) {
        $prev = Get-Item -Path Env:\\${envVar} -ErrorAction SilentlyContinue
        $env:${envVar} = $dir
        try { & $exe.Source @args } finally { if ($prev) { $env:${envVar} = $prev.Value } else { Remove-Item Env:\\${envVar} -ErrorAction SilentlyContinue } }
    } else {
        & $exe.Source @args
    }
}`;
}

function build(header: string, bin: string, wrappers: string[], asw: string): string {
  return [header, bin, ...wrappers, asw].join("\n");
}

export function shellenvScript(shell: Shell): string {
  const providers = allProviders();

  if (shell === "fish") {
    const header = `# agent-switch shell integration — add to ~/.config/fish/config.fish:  agent-switch shellenv --shell fish | source`;
    const asw = `# Convenience: "asw" lists all; "asw work" switches claude; "asw codex work" switches a provider
function asw
    if test (count $argv) -eq 0
        __agent_switch list
    else if contains -- $argv[1] claude codex antigravity
        __agent_switch use $argv[2] --provider $argv[1]
    else
        __agent_switch use $argv
    end
end`;
    return build(header, FISH_BIN, providers.map((p) => fishWrapper(p.binary, p.envVar, p.id)), asw);
  }

  if (shell === "powershell") {
    const header = `# agent-switch shell integration — add to $PROFILE:  agent-switch shellenv --shell powershell | Out-String | Invoke-Expression`;
    const asw = `# Convenience: "asw" lists all; "asw work" switches claude; "asw codex work" switches a provider
function asw {
    if ($args.Count -eq 0) { __agent_switch list; return }
    if (@('claude','codex','antigravity') -contains $args[0]) { __agent_switch use $args[1] --provider $args[0] }
    else { __agent_switch use @args }
}`;
    return build(header, POWERSHELL_BIN, providers.map((p) => powershellWrapper(p.binary, p.envVar, p.id)), asw);
  }

  // zsh + bash share the POSIX snippet.
  const header = `# agent-switch shell integration — add to your rc file:  eval "$(agent-switch shellenv)"`;
  const asw = `# Convenience: "asw" lists all; "asw work" switches claude; "asw codex work" switches a provider
asw() {
  if [ $# -eq 0 ]; then __agent_switch list; return; fi
  case "$1" in
    claude|codex|antigravity) __agent_switch use "$2" --provider "$1" ;;
    *) __agent_switch use "$@" ;;
  esac
}`;
  return build(header, POSIX_BIN, providers.map((p) => posixWrapper(p.binary, p.envVar, p.id)), asw);
}

/** The line that loads the integration, per shell (same as the docs table). */
export const SHELLENV_LINE: Record<Shell, string> = {
  zsh: 'eval "$(agent-switch shellenv)"',
  bash: 'eval "$(agent-switch shellenv)"',
  fish: "agent-switch shellenv --shell fish | source",
  powershell: "agent-switch shellenv --shell powershell | Out-String | Invoke-Expression",
};

/** The startup file `shellenv install` writes to. macOS opens login shells,
 *  which read ~/.bash_profile rather than ~/.bashrc. For PowerShell only the
 *  shell knows its profile — Windows PowerShell 5.1 and a Documents folder
 *  redirected to OneDrive both live elsewhere — so it is asked first. */
export function rcFileFor(
  shell: Shell,
  home: string,
  platform: NodeJS.Platform = process.platform,
  askProfile: () => string | null = powershellProfile,
): string {
  if (shell === "zsh") return path.join(home, ".zshrc");
  if (shell === "bash") return path.join(home, platform === "darwin" ? ".bash_profile" : ".bashrc");
  if (shell === "fish") return path.join(home, ".config", "fish", "config.fish");
  return askProfile() ?? path.join(home, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1");
}

/** `$PROFILE` from pwsh, then Windows PowerShell; null when neither answers. */
export function powershellProfile(): string | null {
  for (const exe of ["pwsh", "powershell"]) {
    const r = spawnSync(exe, ["-NoProfile", "-NonInteractive", "-Command", "$PROFILE"], { encoding: "utf8", timeout: 5000, windowsHide: true });
    const out = r.status === 0 ? r.stdout.trim() : "";
    if (out) return out;
  }
  return null;
}

export interface ShellenvInstall {
  shell: Shell;
  file: string;
  alreadyInstalled: boolean;
}

/** Append the loader line to the shell's startup file, once. `present` says
 *  whether any known startup file already loads it (the doctor check). */
export function installShellIntegration(shell: Shell, home: string, present: boolean): ShellenvInstall {
  const file = rcFileFor(shell, home);
  if (present) return { shell, file, alreadyInstalled: true };
  const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const sep = before === "" || before.endsWith("\n") ? "" : "\n";
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${before}${sep}\n# agent-switch shell integration\n${SHELLENV_LINE[shell]}\n`);
  return { shell, file, alreadyInstalled: false };
}
