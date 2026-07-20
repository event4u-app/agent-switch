#!/usr/bin/env bash
# Make `agent-switch` on PATH resolve to THIS repo's dev build, restoring any
# other globally-installed agent-switch afterwards.
#
#   dev-link.sh link          # ensure the dev build is linked (backs up a foreign install)
#   dev-link.sh unlink        # remove our dev link, restore the backed-up install
#   dev-link.sh run '<cmd>'   # ensure linked, run <cmd>, restore on exit (Ctrl-C included)
#
# Three cases the bin can be in:
#   - already resolves into this repo  → nothing to do (a prior link); left as is.
#   - a foreign install                → moved aside, we npm link, restored after.
#   - absent                           → we npm link, removed after.
# `npm link` fails EEXIST when the bin is occupied; `--force` would delete it
# with no way back — this moves it aside instead.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GLOBAL_BIN="${AGENT_SWITCH_DEV_BIN:-$(npm prefix -g)/bin/agent-switch}"
BACKUP="${GLOBAL_BIN}.pre-dev-backup"
LINKED_BY_US=0

# True when GLOBAL_BIN resolves (through every symlink hop) into this repo.
is_dev_link() {
  local rp
  rp="$(node -e 'try{process.stdout.write(require("fs").realpathSync(process.argv[1]))}catch{process.exit(1)}' "$GLOBAL_BIN" 2>/dev/null)" || return 1
  case "$rp" in "$REPO"/*) return 0 ;; *) return 1 ;; esac
}

exists() { [ -e "$GLOBAL_BIN" ] || [ -L "$GLOBAL_BIN" ]; }

ensure_linked() {
  if is_dev_link; then
    echo "dev-link: agent-switch already resolves to this repo — leaving it as is"
    return 0
  fi
  if exists; then
    if [ ! -e "$BACKUP" ] && [ ! -L "$BACKUP" ]; then
      mv -f "$GLOBAL_BIN" "$BACKUP"
      echo "dev-link: backed up the installed agent-switch"
    else
      rm -f "$GLOBAL_BIN" # a backup already exists — drop the stray
    fi
  fi
  (cd "$REPO" && npm link)
  LINKED_BY_US=1
}

# Undo only what THIS process set up (LINKED_BY_US) — never touch a pre-existing
# link we deliberately left alone.
restore_after_run() {
  [ "$LINKED_BY_US" = 1 ] || return 0
  restore_backup
}

restore_backup() {
  npm unlink -g @event4u/agent-switch >/dev/null 2>&1 || true
  if exists && is_dev_link; then rm -f "$GLOBAL_BIN"; fi
  if [ -e "$BACKUP" ] || [ -L "$BACKUP" ]; then
    exists && rm -f "$GLOBAL_BIN"
    mv -f "$BACKUP" "$GLOBAL_BIN"
    echo "dev-link: restored the installed agent-switch"
  fi
}

case "${1:-}" in
  link)
    ensure_linked
    ;;
  unlink)
    if [ -e "$BACKUP" ] || [ -L "$BACKUP" ]; then
      restore_backup
    else
      echo "dev-link: no backup to restore (a pre-existing link, if any, is left untouched)"
    fi
    ;;
  run)
    shift
    [ -n "${1:-}" ] || { echo "dev-link run: need a command" >&2; exit 2; }
    ensure_linked
    trap restore_after_run EXIT INT TERM
    bash -c "$*"
    ;;
  *)
    echo "usage: dev-link.sh {link|unlink|run <cmd>}" >&2
    exit 2
    ;;
esac
