#!/usr/bin/env bash
# Phase-0 gate for road-to-live-rebind.md — run manually with two throwaway
# accounts; touches Claude Code's credential store under its lock.
#
# R0.3 — Lock-protocol correctness. Three sub-gates:
#   (a) the `proper-lockfile` directory mutex at `<config_dir>.lock` behaves as
#       CC's protocol says (mkdir-atomic acquire, EEXIST while held, stale >10s).
#   (b) swapping a FRESH non-expired credential under that lock does NOT get
#       clobbered back to the old account by a racing CC refresh — CC's double-
#       checked re-read sees a valid token and aborts its own refresh.
#   (c) MOVE-semantics keep one token family in exactly one store at every step
#       (the store is empty between move-out and move-in — never two live copies).
#
# CC's internal "abort my refresh" branch is not directly observable; sub-gate
# (b) asserts its EFFECT — the account after a post-swap turn is still arg2, never
# reverted to arg1.
#
# Usage:   ./r03-lock-protocol.sh <running-profile> <target-profile>
#   arg1 = profile whose store is swapped; arg2 = account to rebind TO (read-only).
#
# Requirements: bash, jq, node, curl, claude; macOS also needs `security`.
# Cost: 1-2 short non-interactive claude turns + read-only OAuth GETs.
#
# SAFETY MODEL (throwaway accounts only): identical to r01/r02 — arg2's store is
# read-only; arg1's own credential is moved aside and RESTORED on exit (trap);
# every claude turn runs in a fresh mktemp cwd. Do NOT run on a real login.

set -euo pipefail

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
info()  { printf '\033[36m[r0.3]\033[0m %s\n' "$*"; }
fail()  { red "FAIL: $*"; exit 1; }

command -v jq   >/dev/null || fail "jq not found"
command -v node >/dev/null || fail "node not found"
command -v curl >/dev/null || fail "curl not found"
command -v claude >/dev/null || fail "claude not found on PATH"
[[ $# -eq 2 ]] || fail "usage: $0 <running-profile> <target-profile>"

OS="$(uname -s)"
[[ "$OS" == "Darwin" ]] && { command -v security >/dev/null || fail "security (Keychain CLI) not found on macOS"; }

ASW_HOME="${AGENT_SWITCH_HOME:-$HOME/.agent-switch}"
C_RUN="$ASW_HOME/claude/$1/config"; C_TGT="$ASW_HOME/claude/$2/config"
[[ -d "$C_RUN" && -d "$C_TGT" ]] || fail "profile config dir(s) missing under $ASW_HOME/claude/<name>/config"

# ---------- per-OS store abstraction (mirrors src/credentials.ts backends) ----------
service_name_for() { node -e 'const c=require("crypto");const d=process.argv[1].normalize("NFC");process.stdout.write("Claude Code-credentials-"+c.createHash("sha256").update(d,"utf8").digest("hex").slice(0,8))' "$1"; }
store_read() {  # <configdir> -> credential JSON, or empty
  if [[ "$OS" == "Darwin" ]]; then
    local v; v="$(security find-generic-password -a "$USER" -s "$(service_name_for "$1")" -w 2>/dev/null || true)"
    [[ -n "$v" ]] && { printf '%s' "$v"; return; }
  fi
  cat "$1/.credentials.json" 2>/dev/null || true
}
store_set() {  # <configdir> <value>  (arg1's store only)
  if [[ "$OS" == "Darwin" ]]; then security add-generic-password -U -a "$USER" -s "$(service_name_for "$1")" -w "$2" 2>/dev/null; fi
  printf '%s' "$2" > "$1/.credentials.json" 2>/dev/null || true
  chmod 600 "$1/.credentials.json" 2>/dev/null || true
}
store_clear() {  # remove any credential from arg1's store (for the MOVE-out step)
  if [[ "$OS" == "Darwin" ]]; then security delete-generic-password -a "$USER" -s "$(service_name_for "$1")" >/dev/null 2>&1 || true; fi
  rm -f "$1/.credentials.json" 2>/dev/null || true
}

access_token_of() { jq -r '.claudeAiOauth.accessToken // empty' <<<"$1"; }
profile_json() { curl -fsS --max-time 10 -H "Authorization: Bearer $1" -H "anthropic-beta: oauth-2025-04-20" -H "User-Agent: agent-switch-spike/0 (+road-to-live-rebind)" https://api.anthropic.com/api/oauth/profile 2>/dev/null || true; }
id_label() { jq -r '.account.email_address // .account.email // .email // .account.uuid // .organization.name // "?"' <<<"${1:-}" 2>/dev/null || echo "?"; }

# ---------- CC lock (proper-lockfile dir mutex, mirrors src/locks.ts) ----------
LOCK_DIR="$C_RUN.lock"
mtime_of() { stat -f %m "$1" 2>/dev/null || stat -c %Y "$1" 2>/dev/null; }
acquire_lock() {
  local deadline=$(( $(date +%s) + 9 ))
  until mkdir "$LOCK_DIR" 2>/dev/null; do
    if [[ -d "$LOCK_DIR" ]] && (( $(date +%s) - $(mtime_of "$LOCK_DIR") > 10 )); then rmdir "$LOCK_DIR" 2>/dev/null || true; continue; fi
    (( $(date +%s) >= deadline )) && return 1
    sleep 0.25
  done
}
release_lock() { rmdir "$LOCK_DIR" 2>/dev/null || true; }

# ---------- restore-everything trap ----------
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/r03.XXXXXX")"; A_BAK="$WORKDIR/arg1.cred.bak"; SWAPPED=0
cleanup() {
  if [[ "$SWAPPED" -eq 1 && -f "$A_BAK" ]]; then store_set "$C_RUN" "$(cat "$A_BAK")"; fi
  release_lock; rm -rf "$WORKDIR" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

PROJ="$(mktemp -d "${TMPDIR:-/tmp}/r03-project.XXXXXX")"; cd "$PROJ"; PROJ="$(pwd -P)"; cd "$PROJ"
info "os=$OS claude=$(claude --version 2>/dev/null || echo unknown)"
info "run store (arg1): $C_RUN"

A_CRED="$(store_read "$C_RUN")"; B_CRED="$(store_read "$C_TGT")"
[[ -n "$A_CRED" && -n "$B_CRED" ]] || fail "both profiles must be logged in (a store read came back empty)"
A_TOK="$(access_token_of "$A_CRED")"; B_TOK="$(access_token_of "$B_CRED")"
[[ -n "$A_TOK" && -n "$B_TOK" && "$A_TOK" != "$B_TOK" ]] || fail "need two distinct account tokens"
A_ID="$(id_label "$(profile_json "$A_TOK")")"; B_ID="$(id_label "$(profile_json "$B_TOK")")"
info "arg1 account: $A_ID   arg2 account: $B_ID"

# ================= sub-gate (a): lock mutex behaves as the protocol says =========
info "(a) lock mutex ..."
acquire_lock || fail "(a) could not acquire a free lock"
mkdir "$LOCK_DIR" 2>/dev/null && fail "(a) a second mkdir on a HELD lock succeeded — not a mutex"
green "(a) OK: held lock rejects a second acquire (EEXIST is the mutex)"
# stale takeover: backdate the lock past the 10s window and confirm re-acquire.
touch -t "$(date -v-20S +%Y%m%d%H%M.%S 2>/dev/null || date -d '20 seconds ago' +%Y%m%d%H%M.%S)" "$LOCK_DIR" 2>/dev/null || true
if (( $(date +%s) - $(mtime_of "$LOCK_DIR") > 10 )); then
  release_lock; acquire_lock || fail "(a) could not re-acquire after staleness"
  green "(a) OK: a lock older than 10s is taken over as stale"
else
  info "(a) note: could not backdate the lock mtime on this platform — stale-takeover not exercised"
fi

# ================= sub-gate (c): MOVE keeps one family in one store =============
info "(c) move-semantics (still holding the lock) ..."
printf '%s' "$A_CRED" > "$A_BAK"          # arg1's family lands in exactly the backup
SWAPPED=1
store_clear "$C_RUN"                        # MOVE-out: remove A from the store
[[ -z "$(store_read "$C_RUN")" ]] || fail "(c) store still readable after move-out — that is a COPY, not a MOVE"
green "(c) OK: store empty between move-out and move-in (no two live copies)"
store_set "$C_RUN" "$B_CRED"                # MOVE-in: arg2's staging copy
MID_TOK="$(access_token_of "$(store_read "$C_RUN")")"
[[ "$MID_TOK" == "$B_TOK" ]] || fail "(c) store does not hold arg2 after move-in"
[[ "$MID_TOK" != "$A_TOK" ]] || fail "(c) store still holds arg1 — move-in failed"
green "(c) OK: after the swap the store holds arg2 only; arg1's family sits in the backup alone"
release_lock

# ================= sub-gate (b): no clobber after a post-swap turn ==============
info "(b) no-clobber: running a turn that may trip CC's refresh ..."
CLAUDE_CONFIG_DIR="$C_RUN" claude -p --output-format json "Reply only with the word: ok." >/dev/null 2>&1 \
  || fail "(b) post-swap turn failed — arg2 credential not accepted"
POST_TOK="$(access_token_of "$(store_read "$C_RUN")")"
POST_ID="$(id_label "$(profile_json "$POST_TOK")")"
if [[ "$POST_ID" != "?" && "$A_ID" != "?" ]]; then
  [[ "$POST_ID" == "$B_ID" ]] || fail "(b) CLOBBER: after the turn the store serves '$POST_ID' (arg1 was '$A_ID', arg2 '$B_ID')"
  green "(b) OK: after the turn the account is still arg2 ('$POST_ID') — no revert to arg1"
else
  # identity endpoint unavailable → fall back to token-family fingerprint
  [[ "$POST_TOK" != "$A_TOK" ]] || fail "(b) CLOBBER: store reverted to arg1's exact token after the turn"
  info "(b) note: OAuth identity endpoint unreachable; asserted store != arg1's token (weaker signal)"
  green "(b) OK: store did not revert to arg1's token"
fi

green "PASS R0.3 — lock is a real mutex; move keeps one family in one store; no old-token clobber."
info "reminder: CC's own 'abort my refresh' branch is inferred from (b)'s effect, not observed directly."
green "DONE — arg1's own credential restored on exit."
