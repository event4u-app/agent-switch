#!/usr/bin/env bash
# T16 / S2 — can a `PermissionRequest` hook answer an approval for Claude Code,
# and what happens when it is slow? (road-to-agent-switch-v3-central, Phase 0;
# feeds D-approve.) The app's "Allow" would be such a hook waiting for the
# user's click.
#
# Each case is one `claude -p` turn in a scratch folder that asks to run
# `touch made-by-<case>` under the default permission mode, with a
# PermissionRequest hook injected via `--settings`:
#   allow   — the hook waits 1 s, then answers allow
#   deny    — the hook answers deny at once
#   timeout — the hook has `timeout: 2` and sleeps 6 s (the user never clicks)
#   none    — no hook (baseline: what -p does on its own)
# Records whether the file was created and how long the turn took.
#
# Usage: CLAUDE_CONFIG_DIR=<logged-in profile config> scripts/spikes/t16-permission-request-hook.sh
set -uo pipefail
: "${CLAUDE_CONFIG_DIR:?point CLAUDE_CONFIG_DIR at a logged-in profile config dir}"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

answer() { # $1 = allow|deny
  printf '%s' "{\"hookSpecificOutput\":{\"hookEventName\":\"PermissionRequest\",\"decision\":{\"behavior\":\"$1\",\"message\":\"answered by the T16 probe\"}}}"
}

settings() { # $1 = case
  local cmd timeout=""
  case "$1" in
    allow) cmd="sleep 1; echo '$(answer allow)'" ;;
    deny) cmd="echo '$(answer deny)'" ;;
    timeout) cmd="sleep 6; echo '$(answer allow)'"; timeout=2 ;;
    none) echo '{}'; return ;;
  esac
  node -e '
    const [cmd, timeout, log] = process.argv.slice(1);
    const h = { type: "command", command: `date +%s >> "${log}"; ${cmd}` };
    if (timeout) h.timeout = Number(timeout);
    console.log(JSON.stringify({ hooks: { PermissionRequest: [{ hooks: [h] }] } }));
  ' "$cmd" "$timeout" "$SCRATCH/fired-$1"
}

echo "{\"claude\":\"$(claude --version | head -1)\"}"
for c in none allow deny timeout; do
  mkdir -p "$SCRATCH/$c"
  settings "$c" > "$SCRATCH/settings-$c.json"
  t0=$(date +%s)
  (cd "$SCRATCH/$c" && claude -p "Run this exact Bash command and nothing else: touch made-by-$c . Then reply with the single word done." \
     --permission-mode default --settings "$SCRATCH/settings-$c.json" >/dev/null 2>&1)
  t1=$(date +%s)
  made=$([ -e "$SCRATCH/$c/made-by-$c" ] && echo true || echo false)
  fired=$([ -s "$SCRATCH/fired-$c" ] && echo true || echo false)
  echo "{\"case\":\"$c\",\"hookFired\":$fired,\"commandRan\":$made,\"seconds\":$((t1 - t0))}"
done
