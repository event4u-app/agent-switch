#!/usr/bin/env bash
# Plays the balanced-start demo against a seeded, throw-away home. Run by
# record.sh inside asciinema; the output is the real CLI's, with the temp home
# shown as ~ (the same rewrite the screenshot pipeline applies).
set -euo pipefail
: "${DEMO_HOME:?}" "${DEMO_CLI:?}"

as() { env -i PATH="$PATH" HOME="$DEMO_HOME" AGENT_SWITCH_HOME="$DEMO_HOME/.agent-switch" LANG=en_US.UTF-8 node "$DEMO_CLI" "$@" 2>&1 | sed "s|$DEMO_HOME|~|g"; }

say() { printf '\033[2m# %s\033[0m\n' "$1"; sleep 0.6; }
type_cmd() {
  printf '\033[1;32m$\033[0m '
  local s="$1" i
  for ((i = 0; i < ${#s}; i++)); do printf '%s' "${s:i:1}"; sleep 0.035; done
  printf '\n'; sleep 0.3
}

cd "$DEMO_HOME"
say "Two Claude accounts, both signed in. No logging in and out."
type_cmd "agent-switch list"
as list
sleep 1.6

say "work: 19% of its week left, resets in 5 days."
say "personal: 66% left, resets in 14 hours — use it or lose it."
type_cmd "agent-switch dir --json   # where would \`claude\` start right now?"
as dir --json | grep -v configDir
sleep 3.2

say "Client work always on the work account:"
type_cmd "agent-switch map work ~/dev/client-a"
as map work "$DEMO_HOME/dev/client-a"
type_cmd "cd ~/dev/client-a && agent-switch dir --json"
cd "$DEMO_HOME/dev/client-a"
as dir --json | grep -v configDir
sleep 3
