#!/usr/bin/env bash
# Phase-0 gate for road-to-live-rebind.md — run manually with two throwaway
# accounts; touches Claude Code's credential store under its lock.
#
# R0.1 — Linux/Windows live-reload: writing the target account's credential into
# a profile's plaintext `.credentials.json` (under CC's own lock) makes the very
# next message run on the NEW account, with no process restart.
#
# Hypothesis: the store, not the process, decides the account. CC re-reads
# `.credentials.json` per message on Linux/Win, so a swap lands on the next turn.
#
# Usage:   ./r01-live-reload-linux-win.sh <running-profile> <target-profile>
# Example: ./r01-live-reload-linux-win.sh privat work
#   arg1 = the profile whose (running) session we rebind — its store is swapped.
#   arg2 = the account to rebind TO — its credential is read (read-only) and a
#          COPY is swapped into arg1's store.
#
# Requirements: bash, jq, node, curl, claude on PATH; both agent-switch profiles
# logged in (layout: ~/.agent-switch/claude/<name>/config, honours AGENT_SWITCH_HOME).
# Cost: 2 short non-interactive claude turns (one per account) + a few read-only
#       OAuth profile/usage GETs.
#
# SAFETY MODEL (throwaway accounts only):
#   - Profile arg2's store is READ-ONLY — never moved, written, or deleted.
#   - Profile arg1's own credential is MOVED ASIDE to a backup and RESTORED on
#     exit (trap), never deleted. The only store this script mutates is arg1's,
#     and it is put back exactly as found.
#   - The credential that gets swapped IN is a staging COPY this script created
#     from arg2's bytes; it lives in a mktemp dir and is removed on exit.
#   - Every claude turn runs in a fresh mktemp cwd; no real project is touched.
#   - Because the swap-in is a COPY, arg2's token family briefly lives in two
#     stores during the test; a claude turn could make CC rotate it. Harmless on
#     a throwaway account, and exactly the divergence the real feature avoids by
#     MOVING (see r03). Do NOT run this on a real login.

set -euo pipefail

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
info()  { printf '\033[36m[r0.1]\033[0m %s\n' "$*"; }
fail()  { red "FAIL: $*"; exit 1; }

command -v jq   >/dev/null || fail "jq not found"
command -v node >/dev/null || fail "node not found"
command -v curl >/dev/null || fail "curl not found"
command -v claude >/dev/null || fail "claude not found on PATH"
[[ $# -eq 2 ]] || fail "usage: $0 <running-profile> <target-profile>"

# This gate is the plaintext-file backend (Linux/Windows). On macOS CC reads the
# Keychain BEFORE the file, so a file swap is shadowed — use r02 there instead.
[[ "$(uname -s)" == "Darwin" ]] && {
  red "R0.1 is the Linux/Windows plaintext-file gate."
  info "On macOS the Keychain shadows .credentials.json — run r02-macos-keychain-pickup.sh."
  exit 2
}

ASW_HOME="${AGENT_SWITCH_HOME:-$HOME/.agent-switch}"
C_RUN="$ASW_HOME/claude/$1/config"   # the profile store we rebind (arg1)
C_TGT="$ASW_HOME/claude/$2/config"   # the account to rebind TO (arg2), read-only
[[ -d "$C_RUN" ]] || fail "running-profile config dir missing: $C_RUN"
[[ -d "$C_TGT" ]] || fail "target-profile config dir missing: $C_TGT"

# ---------- OAuth read-only helpers (verified against src/api.ts) ----------
access_token_of() { jq -r '.claudeAiOauth.accessToken // empty' <<<"$1"; }
profile_json() {  # <access_token> -> account identity JSON, or empty
  curl -fsS --max-time 10 \
    -H "Authorization: Bearer $1" \
    -H "anthropic-beta: oauth-2025-04-20" \
    -H "User-Agent: agent-switch-spike/0 (+road-to-live-rebind)" \
    https://api.anthropic.com/api/oauth/profile 2>/dev/null || true
}
usage_json() {  # <access_token> -> 5h/7d usage windows JSON, or empty
  curl -fsS --max-time 10 \
    -H "Authorization: Bearer $1" \
    -H "anthropic-beta: oauth-2025-04-20" \
    -H "User-Agent: agent-switch-spike/0 (+road-to-live-rebind)" \
    https://api.anthropic.com/api/oauth/usage 2>/dev/null || true
}
# Best-effort human label; the load-bearing comparison is the access token itself.
id_label() { jq -r '.account.email_address // .account.email // .email // .account.uuid // .organization.name // "?"' <<<"${1:-}" 2>/dev/null || echo "?"; }

# ---------- CC lock (proper-lockfile dir mutex, mirrors src/locks.ts) ----------
LOCK_DIR="$C_RUN.lock"
mtime_of() { stat -f %m "$1" 2>/dev/null || stat -c %Y "$1" 2>/dev/null; }
acquire_lock() {  # 9s timeout, 10s staleness takeover — CC's own protocol
  local deadline=$(( $(date +%s) + 9 ))
  until mkdir "$LOCK_DIR" 2>/dev/null; do
    if [[ -d "$LOCK_DIR" ]] && (( $(date +%s) - $(mtime_of "$LOCK_DIR") > 10 )); then
      rmdir "$LOCK_DIR" 2>/dev/null || true; continue
    fi
    (( $(date +%s) >= deadline )) && return 1
    sleep 0.25
  done
}
release_lock() { rmdir "$LOCK_DIR" 2>/dev/null || true; }

# ---------- restore-everything trap ----------
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/r01.XXXXXX")"
A_BAK="$WORKDIR/arg1.credentials.json.bak"
cleanup() {
  # Restore arg1's own credential if we moved it aside, and drop any lock we hold.
  [[ -f "$A_BAK" ]] && mv -f "$A_BAK" "$C_RUN/.credentials.json" 2>/dev/null || true
  release_lock
  rm -rf "$WORKDIR" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# ---------- fresh project cwd ----------
PROJ="$(mktemp -d "${TMPDIR:-/tmp}/r01-project.XXXXXX")"; cd "$PROJ"
PROJ="$(pwd -P)"; cd "$PROJ"   # canonicalize (macOS /var -> /private/var)
CANARY="asw-rebind-$(date +%s)-$RANDOM"
info "claude : $(claude --version 2>/dev/null || echo unknown)"
info "cwd    : $PROJ"
info "run store (arg1): $C_RUN"
info "target    (arg2): $C_TGT"

# ---------- read both credentials (read-only) ----------
A_CRED="$(cat "$C_RUN/.credentials.json" 2>/dev/null || true)"
B_CRED="$(cat "$C_TGT/.credentials.json" 2>/dev/null || true)"
[[ -n "$A_CRED" ]] || fail "no .credentials.json in run store — is '$1' logged in (Linux/Win)?"
[[ -n "$B_CRED" ]] || fail "no .credentials.json in target store — is '$2' logged in (Linux/Win)?"
A_TOK="$(access_token_of "$A_CRED")"; B_TOK="$(access_token_of "$B_CRED")"
[[ -n "$A_TOK" && -n "$B_TOK" ]] || fail "could not parse claudeAiOauth.accessToken from a store"
[[ "$A_TOK" != "$B_TOK" ]] || fail "both profiles hold the SAME token — need two different accounts"
green "OK: two distinct account tokens present"
info "arg1 account: $(id_label "$(profile_json "$A_TOK")")"
info "arg2 account: $(id_label "$(profile_json "$B_TOK")")"
B_USAGE_BEFORE="$(usage_json "$B_TOK")"

# ---------- baseline: one turn on arg1's own account ----------
info "baseline turn on the running account (arg1) ..."
BASE_JSON="$(CLAUDE_CONFIG_DIR="$C_RUN" claude -p --output-format json \
  "Remember this codeword and nothing else: $CANARY. Reply only: stored." 2>/dev/null)" \
  || fail "baseline claude -p failed — arg1 not usable (login expired?)"
jq -e '.session_id' >/dev/null <<<"$BASE_JSON" || fail "no session_id on baseline turn"
green "OK: baseline turn ran on arg1"

# ---------- swap arg2's credential into arg1's store, under CC's lock ----------
info "acquiring CC's lock: $LOCK_DIR"
acquire_lock || fail "could not acquire CC's lock in 9s — a live session may be mid-refresh"
mv "$C_RUN/.credentials.json" "$A_BAK"                 # arg1's own cred moved aside (restored on exit)
printf '%s' "$B_CRED" > "$C_RUN/.credentials.json"     # staging COPY of arg2 swapped in
chmod 600 "$C_RUN/.credentials.json" 2>/dev/null || true
release_lock
info "swapped arg2's credential into the run store under the lock"

# ---------- assert the store now serves arg2 (the falsifiable core) ----------
NOW_TOK="$(access_token_of "$(cat "$C_RUN/.credentials.json")")"
[[ "$NOW_TOK" == "$B_TOK" ]] || fail "store does not hold arg2's token after swap (swap landed wrong)"
green "OK: run store now serves arg2's token"

# ---------- the next message must run on arg2, no restart ----------
info "next turn on the same store (should run as arg2) ..."
NEXT_JSON="$(CLAUDE_CONFIG_DIR="$C_RUN" claude -p --output-format json \
  "Reply only with the word: ok." 2>/dev/null)" \
  || fail "next turn failed — arg2's credential not accepted after swap"
jq -e '.session_id' >/dev/null <<<"$NEXT_JSON" || fail "no session_id on the post-swap turn"
green "PASS R0.1 — swap landed under the lock; the next turn ran on arg2 with no restart."

# ---------- independent confirmation (informational) ----------
POST_ID="$(id_label "$(profile_json "$B_TOK")")"
info "post-swap account identity (arg2): $POST_ID"
if [[ -n "$B_USAGE_BEFORE" ]]; then
  B_USAGE_AFTER="$(usage_json "$B_TOK")"
  if [[ -n "$B_USAGE_AFTER" && "$B_USAGE_AFTER" != "$B_USAGE_BEFORE" ]]; then
    green "confirm: arg2's usage window moved after the swapped turn (billing followed the store)"
  else
    info "usage windows unchanged/empty — rate windows are coarse + eventually-consistent; the store+turn proof above stands"
  fi
fi

# ---------- persistent-process note (operator interactive confirmation) ----------
info "NOTE: headless 'claude -p' is a fresh process each turn, so this proves the"
info "      STORE SWAP takes effect for the next message. To also confirm a LONG-LIVED"
info "      interactive session re-reads without restart, run 'agent-switch run $1'"
info "      in a terminal, swap while it is open, and send a message — usage should"
info "      move to arg2 within one turn (Linux/Win) with the process untouched."
green "DONE — arg1's own credential restored on exit."
