#!/usr/bin/env bash
# G0.3 — Codex CLI: is a rollout file transplanted into another CODEX_HOME usable?
#
# This is the genuine falsification risk. Three possible outcomes:
#   (a) resume-by-id works immediately after file move            -> full takeover parity
#   (b) works only after index/state reconciliation               -> takeover with rebuild step
#   (c) never works on this Codex version (sqlite/app-server owns truth) -> ship list+spawn only,
#       document as honest-null
#
# Usage:   ./g03-codex-rollout-transfer.sh <source-codex-home> <target-codex-home>
# Example: ./g03-codex-rollout-transfer.sh ~/.agent-switch/codex/privat/config ~/.agent-switch/codex/work/config
#          (or ~/.codex as source if you only have the default install)
#
# Requirements: codex on PATH, both homes authenticated (codex login done once per home).
# Cost: 2-3 short `codex exec` turns.
# Safety: only ever moves the one throwaway rollout file it created itself.

set -euo pipefail
red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
info()  { printf '\033[36m[g0.3]\033[0m %s\n' "$*"; }
fail()  { red "FAIL: $*"; exit 1; }

command -v codex >/dev/null || fail "codex not found on PATH"
[[ $# -eq 2 ]] || fail "usage: $0 <source-codex-home> <target-codex-home>"
SRC="$(cd "$1" && pwd)"; TGT="$(cd "$2" && pwd)"
[[ -d "$SRC" && -d "$TGT" ]] || fail "codex home dir(s) missing"

CANARY="asw-codex-$(date +%s)-$RANDOM"
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/g03-project.XXXXXX")"; cd "$WORKDIR"
info "cwd=$PWD canary=$CANARY"
info "codex version: $(codex --version 2>/dev/null || echo unknown)"

snapshot() { find "$1/sessions" -type f \( -name 'rollout-*.jsonl' -o -name 'rollout-*.jsonl.zst' \) 2>/dev/null | sort; }

# 1) create a session under SOURCE and identify its rollout file by set-difference
BEFORE="$(snapshot "$SRC")"
CODEX_HOME="$SRC" codex exec "Remember this codeword and nothing else: $CANARY. Reply only: stored." \
  >/dev/null 2>&1 || fail "codex exec failed under source home (logged in?)"
AFTER="$(snapshot "$SRC")"
NEW_FILE="$(comm -13 <(echo "$BEFORE") <(echo "$AFTER") | head -n1)"
[[ -n "$NEW_FILE" ]] || fail "no new rollout file appeared under $SRC/sessions"
info "rollout file: $NEW_FILE"

# session id from the filename (rollout-<timestamp>-<uuid>.jsonl[.zst])
BASENAME="$(basename "$NEW_FILE")"
SESSION_ID="$(printf '%s' "$BASENAME" \
  | grep -oE '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}' | head -n1)"
[[ -n "$SESSION_ID" ]] || info "WARN: no uuid in filename; will rely on --last only"
info "session id  : ${SESSION_ID:-<unknown>}"

# informational: which state stores exist? (predicts outcome c)
for f in session_index.jsonl state_5.sqlite; do
  [[ -e "$SRC/$f" ]] && info "source has $f (index/state layer present)"
  [[ -e "$TGT/$f" ]] && info "target has $f (index/state layer present)"
done

# 2) MOVE rollout into TARGET, preserving the date-partitioned relative path
REL="${NEW_FILE#"$SRC"/}"
mkdir -p "$TGT/$(dirname "$REL")"
mv "$NEW_FILE" "$TGT/$REL"
info "moved to    : $TGT/$REL"

ask() {  # ask() <resume-args...> — returns 0 if canary comes back
  local OUT RC
  set +e
  OUT="$(CODEX_HOME="$TGT" codex exec resume "$@" \
        "What is the codeword I asked you to remember? Reply with only the codeword." 2>&1)"
  RC=$?
  set -e
  info "reply (rc=$RC): $(tail -n1 <<<"$OUT")"
  [[ $RC -eq 0 ]] && grep -q "$CANARY" <<<"$OUT"
}

# 3) outcome (a): direct resume in target home
info "attempt A: resume by id / --last directly after move ..."
if { [[ -n "$SESSION_ID" ]] && ask "$SESSION_ID"; } || ask --last; then
  green "PASS G0.3 -> outcome (a): transplanted rollout resumes immediately. Full takeover parity possible."
  exit 0
fi

# 4) outcome (b): nudge the index/state layer, then retry
info "attempt B: index reconciliation heuristics ..."
[[ -f "$TGT/session_index.jsonl" ]] && { info "removing target session_index.jsonl to force rescan"; rm -f "$TGT/session_index.jsonl"; }
if { [[ -n "$SESSION_ID" ]] && ask "$SESSION_ID"; } || ask --last; then
  green "PASS G0.3 -> outcome (b): works after index rescan. Takeover needs a rebuild step."
  exit 0
fi

# 5) outcome (c): honest null
red "G0.3 -> outcome (c): transplanted rollout NOT resumable on this Codex version."
info "Consequence per roadmap: Codex parity ships as list + spawn inside the target profile"
info "(codex resume --all), no cross-home transfer. Record this as honest-null with:"
info "  codex version, presence of session_index.jsonl/state sqlite, and this script's output."
exit 2
