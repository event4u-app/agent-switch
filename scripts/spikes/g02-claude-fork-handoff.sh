#!/usr/bin/env bash
# G0.2 — Claude Code: copy + --fork-session handoff (keep-source variant).
#
# Hypothesis: copying the transcript into profile B and resuming with --fork-session
# yields a NEW session id under B with full context, while the original session
# remains resumable and unchanged under profile A. No same-id divergence.
#
# Usage:   ./g02-claude-fork-handoff.sh <source-profile> <target-profile>
# Layout:  agent-switch v2 (~/.agent-switch/claude/<name>/config)
# Cost: 3 short non-interactive claude turns.

set -euo pipefail
red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
info()  { printf '\033[36m[g0.2]\033[0m %s\n' "$*"; }
fail()  { red "FAIL: $*"; exit 1; }

command -v jq >/dev/null     || fail "jq not found"
command -v claude >/dev/null || fail "claude not found on PATH"
[[ $# -eq 2 ]] || fail "usage: $0 <source-profile> <target-profile>"

ASW_HOME="${AGENT_SWITCH_HOME:-$HOME/.agent-switch}"
SRC_CFG="$ASW_HOME/claude/$1/config"; TGT_CFG="$ASW_HOME/claude/$2/config"
[[ -d "$SRC_CFG" && -d "$TGT_CFG" ]] || fail "profile config dir(s) missing (expected under $ASW_HOME/claude/<name>/config)"
enc() { printf '%s' "$1" | sed 's/[^a-zA-Z0-9]/-/g'; }

CANARY="asw-fork-$(date +%s)-$RANDOM"
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/g02-project.XXXXXX")"; cd "$WORKDIR"
ENCDIR="$(enc "$PWD")"
info "claude: $(claude --version 2>/dev/null || echo unknown) cwd=$PWD canary=$CANARY"

# 1) create under SOURCE
CREATE_JSON="$(CLAUDE_CONFIG_DIR="$SRC_CFG" claude -p --output-format json \
  "Remember this codeword and nothing else: $CANARY. Reply only: stored.")"
ORIG_ID="$(jq -r '.session_id // empty' <<<"$CREATE_JSON")"
[[ -n "$ORIG_ID" ]] || fail "no session_id on create"
SRC_JSONL="$SRC_CFG/projects/$ENCDIR/$ORIG_ID.jsonl"
[[ -f "$SRC_JSONL" ]] || fail "transcript missing: $SRC_JSONL"
SRC_HASH_BEFORE="$(shasum -a 256 "$SRC_JSONL" 2>/dev/null || sha256sum "$SRC_JSONL")"
info "original session: $ORIG_ID"

# 2) COPY (not move) to TARGET
TGT_PROJ="$TGT_CFG/projects/$ENCDIR"; mkdir -p "$TGT_PROJ"
cp "$SRC_JSONL" "$TGT_PROJ/"
[[ -d "$SRC_CFG/projects/$ENCDIR/$ORIG_ID" ]] && cp -r "$SRC_CFG/projects/$ENCDIR/$ORIG_ID" "$TGT_PROJ/"

# 3) resume with --fork-session under TARGET
FORK_JSON="$(CLAUDE_CONFIG_DIR="$TGT_CFG" claude -p --resume "$ORIG_ID" --fork-session --output-format json \
  "What is the codeword? Reply with only the codeword.")"
FORK_ID="$(jq -r '.session_id // empty' <<<"$FORK_JSON")"
FORK_RESULT="$(jq -r '.result // empty' <<<"$FORK_JSON")"
info "fork session: ${FORK_ID:-<none>} reply: $FORK_RESULT"

grep -q "$CANARY" <<<"$FORK_RESULT" || fail "fork lost context (canary missing)"
[[ -n "$FORK_ID" && "$FORK_ID" != "$ORIG_ID" ]] || fail "fork did NOT get a new session id (id=$FORK_ID) — divergence risk is real"
green "OK: fork has new id + full context"

# 4) original must be untouched and still resumable under SOURCE
SRC_HASH_AFTER="$(shasum -a 256 "$SRC_JSONL" 2>/dev/null || sha256sum "$SRC_JSONL")"
if [[ "${SRC_HASH_BEFORE%% *}" == "${SRC_HASH_AFTER%% *}" ]]; then
  green "OK: source transcript byte-identical after fork"
else
  info "NOTE: source transcript changed after fork — investigate before trusting keep-source"
fi

ORIG_JSON="$(CLAUDE_CONFIG_DIR="$SRC_CFG" claude -p --resume "$ORIG_ID" --output-format json \
  "What is the codeword? Reply with only the codeword.")"
grep -q "$CANARY" <<<"$(jq -r '.result // empty' <<<"$ORIG_JSON")" \
  || fail "original session no longer resumable with context under source"
green "PASS G0.2 — copy+fork gives new id on target; original intact on source."
info "note: target still holds a copy under the ORIGINAL id ($TGT_PROJ/$ORIG_ID.jsonl);"
info "      the takeover implementation must delete it after a successful fork."
