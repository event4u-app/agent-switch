#!/usr/bin/env bash
# G0.1 — Claude Code: move-based session handoff between two agent-switch profiles.
#
# Hypothesis: a session created under profile A, whose transcript file is MOVED into
# profile B's projects/<same-encoded-cwd>/ dir, resumes under profile B with full context.
#
# Usage:   ./g01-claude-move-handoff.sh <source-profile> <target-profile>
# Example: ./g01-claude-move-handoff.sh privat work
#
# Requirements: bash, jq, claude on PATH, both CLAUDE profiles logged in
# (agent-switch layout: ~/.agent-switch/claude/<name>/config).
# Cost: 2 short non-interactive claude turns (one per profile).
# Safety: uses a throwaway tmp dir as project cwd; never touches a real project.
#         Only supported script interfaces are used (claude -p --output-format json);
#         the transcript jsonl is treated as an opaque blob (moved, never parsed).

set -euo pipefail

# ---------- helpers ----------
red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
info()  { printf '\033[36m[g0.1]\033[0m %s\n' "$*"; }
fail()  { red "FAIL: $*"; exit 1; }

command -v jq >/dev/null     || fail "jq not found"
command -v claude >/dev/null || fail "claude not found on PATH"
[[ $# -eq 2 ]] || fail "usage: $0 <source-profile> <target-profile>"

# Provider-scoped v2 layout: <root>/claude/<name>/config
ASW_HOME="${AGENT_SWITCH_HOME:-$HOME/.agent-switch}"
SRC_CFG="$ASW_HOME/claude/$1/config"
TGT_CFG="$ASW_HOME/claude/$2/config"
[[ -d "$SRC_CFG" ]] || fail "source config dir missing: $SRC_CFG"
[[ -d "$TGT_CFG" ]] || fail "target config dir missing: $TGT_CFG"

# encoded-cwd per docs: every non-alphanumeric char of the absolute path -> '-'
enc() { printf '%s' "$1" | sed 's/[^a-zA-Z0-9]/-/g'; }

CANARY="asw-spike-$(date +%s)-$RANDOM"
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/g01-project.XXXXXX")"
cd "$WORKDIR"
WORKDIR="$(pwd -P)"; cd "$WORKDIR"   # canonicalize (macOS /var -> /private/var); claude encodes the physical cwd
ENCDIR="$(enc "$PWD")"
info "claude      : $(claude --version 2>/dev/null || echo unknown)"
info "project cwd : $PWD"
info "encoded dir : $ENCDIR"
info "canary      : $CANARY"

# ---------- step 1: create session under SOURCE ----------
info "creating session under source profile '$1' ..."
CREATE_JSON="$(CLAUDE_CONFIG_DIR="$SRC_CFG" claude -p --output-format json \
  "Remember this codeword and nothing else: $CANARY. Reply only: stored.")"
SESSION_ID="$(jq -r '.session_id // empty' <<<"$CREATE_JSON")"
[[ -n "$SESSION_ID" ]] || fail "could not extract session_id from create response"
info "session id  : $SESSION_ID"

SRC_PROJ="$SRC_CFG/projects/$ENCDIR"
TGT_PROJ="$TGT_CFG/projects/$ENCDIR"
SRC_JSONL="$SRC_PROJ/$SESSION_ID.jsonl"
[[ -f "$SRC_JSONL" ]] || fail "transcript not found where expected: $SRC_JSONL (encoding scheme drifted?)"
green "OK: transcript exists at expected encoded path"

# informational: what else lives next to the transcript (index, checkpoint dir)?
info "source project dir contents (informational):"
# shellcheck disable=SC2012  # human-readable listing; filenames here are uuid-shaped
ls -la "$SRC_PROJ" | sed 's/^/        /'
[[ -d "$SRC_PROJ/$SESSION_ID" ]] && HAS_SUBDIR=1 || HAS_SUBDIR=0

# ---------- step 2: MOVE transcript (+ checkpoint subdir) to TARGET ----------
mkdir -p "$TGT_PROJ"
mv "$SRC_JSONL" "$TGT_PROJ/"
[[ "$HAS_SUBDIR" -eq 1 ]] && { mv "$SRC_PROJ/$SESSION_ID" "$TGT_PROJ/"; info "moved checkpoint subdir too"; }
info "moved transcript into target profile"

# ---------- step 3: resume under TARGET, ask for the canary ----------
info "resuming under target profile '$2' ..."
set +e
RESUME_JSON="$(CLAUDE_CONFIG_DIR="$TGT_CFG" claude -p --resume "$SESSION_ID" --output-format json \
  "What is the codeword I asked you to remember? Reply with only the codeword.")"
RC=$?
set -e
[[ $RC -eq 0 ]] || fail "resume exited with code $RC — session not found under target (index required after all?)"

RESULT="$(jq -r '.result // empty' <<<"$RESUME_JSON")"
info "resume reply: $RESULT"
if grep -q "$CANARY" <<<"$RESULT"; then
  green "PASS G0.1 — moved session resumed on target profile with full context."
else
  red  "PARTIAL: resume ran but canary missing — context not restored. Inspect: $TGT_PROJ"
  exit 1
fi

# ---------- step 4 (informational): index self-heal ----------
if [[ -f "$TGT_PROJ/sessions-index.json" ]]; then
  if grep -q "$SESSION_ID" "$TGT_PROJ/sessions-index.json" 2>/dev/null; then
    info "index: target sessions-index.json now references the session (self-healed)"
  else
    info "index: target sessions-index.json exists but does NOT reference the session"
    info "       -> resume-by-id works regardless; picker visibility needs manual check: agent-switch run $2 -- --resume"
  fi
else
  info "index: no sessions-index.json in target project dir (nothing to heal; picker likely scans jsonl)"
fi

info "artifacts kept for inspection under: $TGT_PROJ and $WORKDIR"
green "DONE"
