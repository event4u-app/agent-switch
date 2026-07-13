/**
 * Shell integration snippets, per shell.
 *
 * Each snippet defines two things:
 *   - a `claude` wrapper that injects the active profile's CLAUDE_CONFIG_DIR
 *     (resolved by `agent-switch dir`: directory mapping > active profile);
 *   - `asw` convenience: `asw <name>` == `agent-switch use <name>`, bare `asw`
 *     == `agent-switch list`.
 *
 * The wrapper must call the REAL `claude`, not recurse into itself — each shell
 * has its own escape (`command` on POSIX/fish, `Get-Command -CommandType
 * Application` on PowerShell). cmd.exe has no clean function-wrapper story, so
 * there is no cmd snippet — `agent-switch run <name>` is the cmd.exe path.
 */

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

const POSIX = `# agent-switch shell integration — add to your rc file:  eval "$(agent-switch shellenv)"
claude() {
  local dir
  dir="$(command agent-switch dir 2>/dev/null)"
  if [ -n "$dir" ]; then
    CLAUDE_CONFIG_DIR="$dir" command claude "$@"
  else
    command claude "$@"
  fi
}
# Convenience: "asw work" == "agent-switch use work", "asw" == "agent-switch list"
asw() {
  if [ $# -eq 0 ]; then command agent-switch list; else command agent-switch use "$@"; fi
}`;

const FISH = `# agent-switch shell integration — add to ~/.config/fish/config.fish:  agent-switch shellenv --shell fish | source
function claude
    set -l dir (command agent-switch dir 2>/dev/null)
    if test -n "$dir"
        CLAUDE_CONFIG_DIR=$dir command claude $argv
    else
        command claude $argv
    end
end
# Convenience: "asw work" == "agent-switch use work", "asw" == "agent-switch list"
function asw
    if test (count $argv) -eq 0
        command agent-switch list
    else
        command agent-switch use $argv
    end
end`;

const POWERSHELL = `# agent-switch shell integration — add to $PROFILE:  agent-switch shellenv --shell powershell | Out-String | Invoke-Expression
function claude {
    $exe = Get-Command claude -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $exe) { Write-Error 'claude not found on PATH. Install Claude Code first.'; return }
    $dir = (& agent-switch dir 2>$null)
    if ($dir) {
        $prev = $env:CLAUDE_CONFIG_DIR
        $env:CLAUDE_CONFIG_DIR = $dir
        try { & $exe.Source @args } finally { $env:CLAUDE_CONFIG_DIR = $prev }
    } else {
        & $exe.Source @args
    }
}
# Convenience: "asw work" == "agent-switch use work", "asw" == "agent-switch list"
function asw {
    if ($args.Count -eq 0) { & agent-switch list } else { & agent-switch use @args }
}`;

export function shellenvScript(shell: Shell): string {
  switch (shell) {
    case "fish":
      return FISH;
    case "powershell":
      return POWERSHELL;
    case "zsh":
    case "bash":
      return POSIX;
  }
}
