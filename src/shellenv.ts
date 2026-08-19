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

function posixWrapper(binary: string, envVar: string, id: string): string {
  return `${binary}() {
  local dir rc
  command -v agent-switch >/dev/null 2>&1 || { command ${binary} "$@"; return; }
  dir="$(command agent-switch dir --provider ${id} --guard)"
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
    if not type -q agent-switch
        command ${binary} $argv
        return
    end
    set -l dir (command agent-switch dir --provider ${id} --guard)
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
    if (-not (Get-Command agent-switch -ErrorAction SilentlyContinue)) { & $exe.Source @args; return }
    $dir = (& agent-switch dir --provider ${id} --guard)
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

function build(header: string, wrappers: string[], asw: string): string {
  return [header, ...wrappers, asw].join("\n");
}

export function shellenvScript(shell: Shell): string {
  const providers = allProviders();

  if (shell === "fish") {
    const header = `# agent-switch shell integration — add to ~/.config/fish/config.fish:  agent-switch shellenv --shell fish | source`;
    const asw = `# Convenience: "asw" lists all; "asw work" switches claude; "asw codex work" switches a provider
function asw
    if test (count $argv) -eq 0
        command agent-switch list
    else if contains -- $argv[1] claude codex antigravity
        command agent-switch use $argv[2] --provider $argv[1]
    else
        command agent-switch use $argv
    end
end`;
    return build(header, providers.map((p) => fishWrapper(p.binary, p.envVar, p.id)), asw);
  }

  if (shell === "powershell") {
    const header = `# agent-switch shell integration — add to $PROFILE:  agent-switch shellenv --shell powershell | Out-String | Invoke-Expression`;
    const asw = `# Convenience: "asw" lists all; "asw work" switches claude; "asw codex work" switches a provider
function asw {
    if ($args.Count -eq 0) { command agent-switch list; return }
    if (@('claude','codex','antigravity') -contains $args[0]) { & agent-switch use $args[1] --provider $args[0] }
    else { & agent-switch use @args }
}`;
    return build(header, providers.map((p) => powershellWrapper(p.binary, p.envVar, p.id)), asw);
  }

  // zsh + bash share the POSIX snippet.
  const header = `# agent-switch shell integration — add to your rc file:  eval "$(agent-switch shellenv)"`;
  const asw = `# Convenience: "asw" lists all; "asw work" switches claude; "asw codex work" switches a provider
asw() {
  if [ $# -eq 0 ]; then command agent-switch list; return; fi
  case "$1" in
    claude|codex|antigravity) command agent-switch use "$2" --provider "$1" ;;
    *) command agent-switch use "$@" ;;
  esac
}`;
  return build(header, providers.map((p) => posixWrapper(p.binary, p.envVar, p.id)), asw);
}
