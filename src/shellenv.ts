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
 */

import { allProviders } from "./providers.js";

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
  local dir
  dir="$(command agent-switch dir --provider ${id} 2>/dev/null)"
  if [ -n "$dir" ]; then
    ${envVar}="$dir" command ${binary} "$@"
  else
    command ${binary} "$@"
  fi
}`;
}

function fishWrapper(binary: string, envVar: string, id: string): string {
  return `function ${binary}
    set -l dir (command agent-switch dir --provider ${id} 2>/dev/null)
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
    $dir = (& agent-switch dir --provider ${id} 2>$null)
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
