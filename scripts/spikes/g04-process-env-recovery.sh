#!/usr/bin/env bash
# G0.4 — can we recover CLAUDE_CONFIG_DIR / CODEX_HOME + cwd from a running process
#         without elevated rights? (macOS: same-user via `ps -wwE`; Linux: /proc)
#
# IMPORTANT (found 2026-07-14 on macOS 15.7): the probe child MUST be a
# non-platform binary. Apple platform binaries (`sleep`, `bash`) have their
# environment blocked from `ps -E` even for the owning user — probing against
# `sleep` produced a FALSE NEGATIVE. `claude` and `codex` are node processes,
# so the probe uses a `node` child: it tests exactly the class of process the
# daemon will inspect.
#
# Tests the MECHANISM against a controlled child process (no claude needed),
# then additionally scans for real live claude/codex processes if any are running.
#
# Usage: ./g04-process-env-recovery.sh

set -euo pipefail
red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
info()  { printf '\033[36m[g0.4]\033[0m %s\n' "$*"; }

command -v node >/dev/null || { red "FAIL: node not found (needed as a realistic probe child)"; exit 1; }

OS="$(uname -s)"
MARKER="/tmp/asw-g04-marker-$$"
info "OS: $OS"

read_env() {  # read_env <pid> -> prints env as lines KEY=VALUE (best effort)
  local pid="$1"
  case "$OS" in
    Linux)  tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null ;;
    Darwin) ps -p "$pid" -wwE -o command= 2>/dev/null | tr ' ' '\n' | grep -E '^[A-Z_]+=' || true ;;
    *)      return 1 ;;
  esac
}
read_cwd() {  # read_cwd <pid>
  local pid="$1"
  case "$OS" in
    Linux)  readlink "/proc/$pid/cwd" 2>/dev/null ;;
    Darwin) lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n1 ;;
  esac
}

# ---------- controlled test (node child = same process class as claude/codex) ----------
CLAUDE_CONFIG_DIR="$MARKER" node -e 'setTimeout(() => {}, 15000)' &
PID=$!
sleep 0.5
GOT_ENV="$(read_env "$PID" | grep '^CLAUDE_CONFIG_DIR=' | head -n1 || true)"
GOT_CWD="$(read_cwd "$PID" || true)"
kill "$PID" 2>/dev/null || true

if [[ "$GOT_ENV" == "CLAUDE_CONFIG_DIR=$MARKER" ]]; then
  green "PASS: env recovery works for same-user node children ($GOT_ENV)"
else
  red  "FAIL: could not recover CLAUDE_CONFIG_DIR from a node child process"
  info "macOS notes: 'ps -E' only works for processes you own; SIP blocks platform"
  info "binaries entirely (that limitation does NOT apply to claude/codex — both node)."
  exit 1
fi
if [[ -n "$GOT_CWD" ]]; then
  green "PASS: cwd recovery works ($GOT_CWD)"
else
  info "WARN: cwd recovery empty — check lsof availability"
fi

# ---------- live scan (informational) ----------
info "scanning for live claude/codex processes ..."
FOUND=0
for pid in $(pgrep -x claude 2>/dev/null; pgrep -x codex 2>/dev/null); do
  FOUND=1
  NAME="$(ps -p "$pid" -o comm= | tr -d ' ')"
  CFG="$(read_env "$pid" | grep -E '^(CLAUDE_CONFIG_DIR|CODEX_HOME)=' | head -n1 || echo '<default home>')"
  CWD="$(read_cwd "$pid" || echo '?')"
  info "  pid=$pid tool=$NAME $CFG cwd=$CWD"
done
[[ $FOUND -eq 0 ]] && info "  none running (start one and re-run for the live check)"
green "DONE"
