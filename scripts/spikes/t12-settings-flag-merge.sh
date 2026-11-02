#!/usr/bin/env bash
# T12 / S3 — does `claude --settings <file>` ADD to the user's own settings or
# REPLACE them? (road-to-agent-switch-v3-central, Phase 0.) The v3 host injects
# its hooks with `--settings`; that only works if the user's own hooks keep
# firing next to them.
#
# One `claude -p` turn in a scratch project that carries its own
# `.claude/settings.json` (project scope) and `.claude/settings.local.json`
# (local scope), each with a Stop hook that writes a marker; a third Stop hook
# comes in through `--settings`. The profile's own settings.json is read as it
# is and never written. A second run passes `--setting-sources project` to show
# the user can still narrow sources on purpose.
#
# Usage: CLAUDE_CONFIG_DIR=<logged-in profile config> scripts/spikes/t12-settings-flag-merge.sh
set -uo pipefail
: "${CLAUDE_CONFIG_DIR:?point CLAUDE_CONFIG_DIR at a logged-in profile config dir}"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT
mkdir -p "$SCRATCH/proj/.claude"

hook() { node -e 'console.log(JSON.stringify({hooks:{Stop:[{hooks:[{type:"command",command:`echo ${process.argv[1]} >> "${process.argv[2]}"`}]}]}}))' "$1" "$SCRATCH/markers"; }
hook project > "$SCRATCH/proj/.claude/settings.json"
hook local > "$SCRATCH/proj/.claude/settings.local.json"
hook flag > "$SCRATCH/flag.json"

run() { # $1 = label, rest = extra args
  local label=$1; shift
  : > "$SCRATCH/markers"
  (cd "$SCRATCH/proj" && claude -p "Reply with the single word ok." --settings "$SCRATCH/flag.json" "$@" >/dev/null 2>&1)
  echo "{\"run\":\"$label\",\"fired\":$(node -e 'console.log(JSON.stringify(require("fs").readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean).sort()))' "$SCRATCH/markers")}"
}

echo "{\"claude\":\"$(claude --version | head -1)\"}"
run all-sources
run project-only --setting-sources project
