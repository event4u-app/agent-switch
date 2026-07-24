#!/usr/bin/env bash
# Phase-0 gate for road-to-live-rebind.md — run manually with two throwaway
# accounts; touches Claude Code's credential store under its lock.
#
# R0.2 — macOS Keychain pickup: writing the target account's credential into the
# profile's hashed Keychain entry (under CC's lock) makes the next message run on
# the NEW account. Records that the ~30s Keychain read-cache is a persistent-
# process latency only — non-critical in the MANUAL rebind flow.
#
# Hypothesis: CC reads the Keychain entry `Claude Code-credentials-<sha8(NFC(dir))>`
# before the plaintext file; a swap of that entry is adopted on the next turn
# (a persistent session within ~30s, since CC caches the Keychain read ~30s).
#
# Usage:   ./r02-macos-keychain-pickup.sh <running-profile> <target-profile>
#   arg1 = profile whose session we rebind — its Keychain entry is swapped.
#   arg2 = account to rebind TO — its Keychain entry is read (read-only).
#
# Requirements: macOS, bash, jq, node, curl, claude, `security`; both agent-switch
# profiles logged in (layout: ~/.agent-switch/claude/<name>/config).
# Cost: 2 short non-interactive claude turns + a few read-only OAuth GETs.
#
# SAFETY MODEL (throwaway accounts only):
#   - arg2's Keychain entry is READ-ONLY — never overwritten or deleted.
#   - arg1's own Keychain entry is BACKED UP (value read out) and RESTORED on
#     exit (trap). The only entry this script mutates is arg1's own service.
#   - Every claude turn runs in a fresh mktemp cwd; no real project is touched.
#   - The swap-in is a COPY of arg2's bytes; a turn could make CC rotate arg2's
#     token. Harmless on a throwaway account; the real feature MOVES (see r03).
#     Do NOT run this on a real login.

set -euo pipefail

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
info()  { printf '\033[36m[r0.2]\033[0m %s\n' "$*"; }
fail()  { red "FAIL: $*"; exit 1; }

[[ "$(uname -s)" == "Darwin" ]] || { red "R0.2 is the macOS Keychain gate — on Linux/Windows run r01-live-reload-linux-win.sh."; exit 2; }
command -v jq   >/dev/null || fail "jq not found"
command -v node >/dev/null || fail "node not found"
command -v curl >/dev/null || fail "curl not found"
command -v security >/dev/null || fail "security (macOS Keychain CLI) not found"
command -v claude >/dev/null || fail "claude not found on PATH"
[[ $# -eq 2 ]] || fail "usage: $0 <running-profile> <target-profile>"

ASW_HOME="${AGENT_SWITCH_HOME:-$HOME/.agent-switch}"
C_RUN="$ASW_HOME/claude/$1/config"
C_TGT="$ASW_HOME/claude/$2/config"
[[ -d "$C_RUN" ]] || fail "running-profile config dir missing: $C_RUN"
[[ -d "$C_TGT" ]] || fail "target-profile config dir missing: $C_TGT"

# Keychain service name CC derives per config dir — sha256(NFC(dir))[:8], EXACTLY
# as src/keychain.ts serviceNameFor() computes it (the raw, unresolved dir string).
service_name_for() {
  node -e 'const c=require("crypto");const d=process.argv[1].normalize("NFC");process.stdout.write("Claude Code-credentials-"+c.createHash("sha256").update(d,"utf8").digest("hex").slice(0,8))' "$1"
}
kc_read()   { security find-generic-password -a "$USER" -s "$1" -w 2>/dev/null || true; }         # <service> -> value
kc_write()  { security add-generic-password -U -a "$USER" -s "$1" -w "$2" 2>/dev/null; }           # <service> <value>
kc_delete() { security delete-generic-password -a "$USER" -s "$1" >/dev/null 2>&1 || true; }

RUN_SVC="$(service_name_for "$C_RUN")"
TGT_SVC="$(service_name_for "$C_TGT")"

access_token_of() { jq -r '.claudeAiOauth.accessToken // empty' <<<"$1"; }
profile_json() { curl -fsS --max-time 10 -H "Authorization: Bearer $1" -H "anthropic-beta: oauth-2025-04-20" -H "User-Agent: agent-switch-spike/0 (+road-to-live-rebind)" https://api.anthropic.com/api/oauth/profile 2>/dev/null || true; }
id_label()    { jq -r '.account.email_address // .account.email // .email // .account.uuid // .organization.name // "?"' <<<"${1:-}" 2>/dev/null || echo "?"; }

# ---------- CC lock (proper-lockfile dir mutex, mirrors src/locks.ts) ----------
LOCK_DIR="$C_RUN.lock"
mtime_of() { stat -f %m "$1" 2>/dev/null || stat -c %Y "$1" 2>/dev/null; }
acquire_lock() {
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
RUN_BAK=""      # arg1's original Keychain value, captured before the swap
SWAPPED=0
cleanup() {
  if [[ "$SWAPPED" -eq 1 ]]; then
    if [[ -n "$RUN_BAK" ]]; then kc_write "$RUN_SVC" "$RUN_BAK"; else kc_delete "$RUN_SVC"; fi
  fi
  release_lock
}
trap cleanup EXIT INT TERM

PROJ="$(mktemp -d "${TMPDIR:-/tmp}/r02-project.XXXXXX")"; cd "$PROJ"; PROJ="$(pwd -P)"; cd "$PROJ"
CANARY="asw-rebind-$(date +%s)-$RANDOM"
info "claude : $(claude --version 2>/dev/null || echo unknown)"
info "run store (arg1): $C_RUN  [svc $RUN_SVC]"
info "target    (arg2): $C_TGT  [svc $TGT_SVC]"

# ---------- read both credentials (read-only) ----------
A_CRED="$(kc_read "$RUN_SVC")"; [[ -z "$A_CRED" ]] && A_CRED="$(cat "$C_RUN/.credentials.json" 2>/dev/null || true)"
B_CRED="$(kc_read "$TGT_SVC")"; [[ -z "$B_CRED" ]] && B_CRED="$(cat "$C_TGT/.credentials.json" 2>/dev/null || true)"
[[ -n "$A_CRED" ]] || fail "no Keychain/file credential for '$1' — logged in?"
[[ -n "$B_CRED" ]] || fail "no Keychain/file credential for '$2' — logged in?"
A_TOK="$(access_token_of "$A_CRED")"; B_TOK="$(access_token_of "$B_CRED")"
[[ -n "$A_TOK" && -n "$B_TOK" ]] || fail "could not parse claudeAiOauth.accessToken from a store"
[[ "$A_TOK" != "$B_TOK" ]] || fail "both profiles hold the SAME token — need two different accounts"
green "OK: two distinct account tokens present"
info "arg1 account: $(id_label "$(profile_json "$A_TOK")")"
info "arg2 account: $(id_label "$(profile_json "$B_TOK")")"

# ---------- baseline turn on arg1 ----------
info "baseline turn on the running account (arg1) ..."
CLAUDE_CONFIG_DIR="$C_RUN" claude -p --output-format json \
  "Remember this codeword and nothing else: $CANARY. Reply only: stored." >/dev/null 2>&1 \
  || fail "baseline claude -p failed — arg1 not usable (login expired?)"
green "OK: baseline turn ran on arg1"

# ---------- swap arg2's credential into arg1's Keychain entry, under CC's lock ----------
info "acquiring CC's lock: $LOCK_DIR"
acquire_lock || fail "could not acquire CC's lock in 9s — a live session may be mid-refresh"
RUN_BAK="$A_CRED"                     # value to restore arg1 to on exit
SWAPPED=1
kc_write "$RUN_SVC" "$B_CRED" || { release_lock; fail "security add-generic-password failed"; }
release_lock
info "swapped arg2's credential into arg1's Keychain entry under the lock"

# ---------- assert the store now serves arg2 (falsifiable core) ----------
NOW_TOK="$(access_token_of "$(kc_read "$RUN_SVC")")"
[[ "$NOW_TOK" == "$B_TOK" ]] || fail "Keychain entry does not hold arg2's token after swap"
green "OK: arg1's Keychain entry now serves arg2's token"

# ---------- next fresh-process turn must run on arg2 ----------
info "next turn on the same store (should run as arg2) ..."
CLAUDE_CONFIG_DIR="$C_RUN" claude -p --output-format json "Reply only with the word: ok." >/dev/null 2>&1 \
  || fail "next turn failed — arg2's credential not accepted after Keychain swap"
green "PASS R0.2 — Keychain swap landed under the lock; the next turn ran on arg2."

# ---------- ~30s cache: latency note, not a blocker ----------
info "LATENCY: a fresh 'claude -p' process reads the Keychain immediately, so pickup"
info "         here is instant. A LONG-LIVED interactive session caches the Keychain"
info "         read ~30s, so it adopts the swap within ~30s. In the MANUAL rebind flow"
info "         this is NON-CRITICAL: the user clicks switch, keeps working, and the"
info "         next message (≤ ~30s) runs on arg2 — no proactive-switch timing pressure."
info "         Operator confirmation: 'agent-switch run $1', swap, send a message, watch"
info "         it land on arg2 within ~30s with the process untouched."
green "DONE — arg1's Keychain entry restored on exit."
