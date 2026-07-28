#!/usr/bin/env bash
# Make `agent-switch` on PATH resolve to THIS repo's dev build.
#
#   dev-link.sh run-shim '<cmd>'  # run <cmd> with the dev build FIRST on PATH —
#                                 # the global install is NEVER touched (no
#                                 # backup, no restore, nothing to lose on a
#                                 # crash/kill). Preferred for gui:dev.
#   dev-link.sh link              # globally link the dev build (backs up an install)
#   dev-link.sh unlink            # remove our dev link, restore the backed-up install
#   dev-link.sh run '<cmd>'       # link, run <cmd>, restore on exit (legacy; prefer run-shim)
#
# link/unlink details — three cases the bin can be in:
#   - already resolves into this repo  → nothing to do (a prior link); left as is.
#   - a foreign install                → moved aside, we npm link, restored after.
#   - absent                           → we npm link, removed after.
# `npm link` fails EEXIST when the bin is occupied; `--force` would delete it
# with no way back — this moves it aside instead.
#
# IMPORTANT (the lost-install bug): `npm link` does not only claim the bin —
# it REPLACES the global package payload at lib/node_modules/@event4u/agent-switch,
# and `npm unlink -g` DELETES it. Backing up only the bin symlink therefore
# restored a symlink pointing into a deleted directory (a dangling bin = "no
# installed version"). link/unlink now back up and restore the payload dir too.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NPM_PREFIX="$(npm prefix -g)"
GLOBAL_BIN="${AGENT_SWITCH_DEV_BIN:-$NPM_PREFIX/bin/agent-switch}"
GLOBAL_PKG="${AGENT_SWITCH_DEV_PKG:-$NPM_PREFIX/lib/node_modules/@event4u/agent-switch}"
BIN_BACKUP="${GLOBAL_BIN}.pre-dev-backup"
PKG_BACKUP="${GLOBAL_PKG}.pre-dev-backup"
LINKED_BY_US=0
SHIM_DIR=""

# True when the given path resolves (through every symlink hop) into this repo.
resolves_into_repo() {
  local rp
  rp="$(node -e 'try{process.stdout.write(require("fs").realpathSync(process.argv[1]))}catch{process.exit(1)}' "$1" 2>/dev/null)" || return 1
  case "$rp" in "$REPO"/*) return 0 ;; *) return 1 ;; esac
}

is_dev_link() { resolves_into_repo "$GLOBAL_BIN"; }

exists() { [ -e "$1" ] || [ -L "$1" ]; }

ensure_linked() {
  if is_dev_link; then
    echo "dev-link: agent-switch already resolves to this repo — leaving it as is"
    return 0
  fi
  # Back up the bin AND the global package payload: npm link overwrites the
  # payload dir and npm unlink -g deletes it — the bin symlink alone would
  # come back dangling.
  if exists "$GLOBAL_PKG" && ! resolves_into_repo "$GLOBAL_PKG"; then
    if ! exists "$PKG_BACKUP"; then
      mv -f "$GLOBAL_PKG" "$PKG_BACKUP"
      echo "dev-link: backed up the installed package payload"
    fi
  fi
  if exists "$GLOBAL_BIN"; then
    if ! exists "$BIN_BACKUP"; then
      mv -f "$GLOBAL_BIN" "$BIN_BACKUP"
      echo "dev-link: backed up the installed agent-switch bin"
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
  if exists "$GLOBAL_BIN" && is_dev_link; then rm -f "$GLOBAL_BIN"; fi
  # Payload first, then the bin that points into it.
  if exists "$PKG_BACKUP"; then
    exists "$GLOBAL_PKG" && rm -rf "$GLOBAL_PKG"
    mv -f "$PKG_BACKUP" "$GLOBAL_PKG"
  fi
  if exists "$BIN_BACKUP"; then
    exists "$GLOBAL_BIN" && rm -f "$GLOBAL_BIN"
    mv -f "$BIN_BACKUP" "$GLOBAL_BIN"
  fi
  if exists "$GLOBAL_BIN"; then
    # Never restore silently into a broken state: a bin whose target is gone
    # means the payload was lost before this fix existed.
    if node -e 'require("fs").realpathSync(process.argv[1])' "$GLOBAL_BIN" 2>/dev/null; then
      echo "dev-link: restored the installed agent-switch"
    else
      echo "dev-link: WARNING — the restored bin is dangling (payload missing)." >&2
      echo "dev-link: reinstall with: npm install -g @event4u/agent-switch" >&2
    fi
  fi
}

cleanup_shim() {
  [ -n "$SHIM_DIR" ] && rm -rf "$SHIM_DIR"
}

case "${1:-}" in
  run-shim)
    shift
    [ -n "${1:-}" ] || { echo "dev-link run-shim: need a command" >&2; exit 2; }
    [ -e "$REPO/dist/index.js" ] || { echo "dev-link run-shim: dist/index.js missing — run npm run build first" >&2; exit 2; }
    # Shadow, don't replace: a throw-away dir holding only the dev bin goes
    # FIRST on PATH for the child command. The global install stays untouched,
    # so there is nothing to restore — a crash or kill -9 can't lose anything.
    SHIM_DIR="$(mktemp -d "${TMPDIR:-/tmp}/agent-switch-dev-shim.XXXXXX")"
    ln -s "$REPO/dist/index.js" "$SHIM_DIR/agent-switch"
    trap cleanup_shim EXIT INT TERM
    echo "dev-link: dev build shadows agent-switch via PATH shim ($SHIM_DIR) — global install untouched"
    PATH="$SHIM_DIR:$PATH" bash -c "$*"
    ;;
  link)
    ensure_linked
    ;;
  unlink)
    if exists "$BIN_BACKUP" || exists "$PKG_BACKUP"; then
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
    echo "usage: dev-link.sh {run-shim <cmd>|link|unlink|run <cmd>}" >&2
    exit 2
    ;;
esac
