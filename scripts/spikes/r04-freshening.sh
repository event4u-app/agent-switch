#!/usr/bin/env bash
# Phase-0 gate for road-to-live-rebind.md — run manually with two throwaway
# accounts; touches Claude Code's credential store under its lock.
#
# R0.4 — Freshening + quarantine. Before a rebind swaps the target credential in:
#   - refresh it if it expires in < 10 min (2x CC's own 5-min buffer), and
#   - if its refresh token is DEAD, QUARANTINE it — never activate a credential
#     that will die mid-session.
#
# This gate NEVER writes a real credential store — it only reads the target,
# decides freshen-vs-skip, probes liveness against the VERIFIED profile endpoint
# (src/api.ts), and exercises the quarantine branch. The real refresh grant is
# owned by the Phase-1 write module; this script performs it only if the operator
# supplies the endpoint (ASW_OAUTH_TOKEN_URL + ASW_OAUTH_CLIENT_ID) — no invented
# constants.
#
# Usage:   ./r04-freshening.sh <running-profile> <target-profile> [--force-refresh] [--force-quarantine]
#   arg2 = the target credential to evaluate; arg1 = the profile it would be
#          swapped into (context only — this script does not swap).
#   --force-refresh    treat the target as freshen-required regardless of expiry
#                      (exercise the refresh-decision branch on a healthy token).
#   --force-quarantine simulate a dead refresh token (exercise the quarantine
#                      branch deterministically, without a genuinely-dead account).
#
# Requirements: bash, jq, node, curl, `security` on macOS; both profiles logged in.
# Cost: read-only OAuth GETs (+ one refresh POST only if you supply the endpoint).
#
# SAFETY: read-only against both real stores; every artifact is written under a
# mktemp quarantine dir and removed on exit. Do NOT run on a real login.

set -euo pipefail

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
info()  { printf '\033[36m[r0.4]\033[0m %s\n' "$*"; }
fail()  { red "FAIL: $*"; exit 1; }

command -v jq   >/dev/null || fail "jq not found"
command -v node >/dev/null || fail "node not found"
command -v curl >/dev/null || fail "curl not found"

FORCE_REFRESH=0; FORCE_QUARANTINE=0; ARGS=()
for a in "$@"; do
  case "$a" in
    --force-refresh)    FORCE_REFRESH=1 ;;
    --force-quarantine) FORCE_QUARANTINE=1 ;;
    *) ARGS+=("$a") ;;
  esac
done
[[ ${#ARGS[@]} -eq 2 ]] || fail "usage: $0 <running-profile> <target-profile> [--force-refresh] [--force-quarantine]"

OS="$(uname -s)"
[[ "$OS" == "Darwin" ]] && { command -v security >/dev/null || fail "security (Keychain CLI) not found on macOS"; }
ASW_HOME="${AGENT_SWITCH_HOME:-$HOME/.agent-switch}"
C_TGT="$ASW_HOME/claude/${ARGS[1]}/config"
[[ -d "$ASW_HOME/claude/${ARGS[0]}/config" ]] || fail "running-profile config dir missing"
[[ -d "$C_TGT" ]] || fail "target-profile config dir missing: $C_TGT"

service_name_for() { node -e 'const c=require("crypto");const d=process.argv[1].normalize("NFC");process.stdout.write("Claude Code-credentials-"+c.createHash("sha256").update(d,"utf8").digest("hex").slice(0,8))' "$1"; }
store_read() {  # read-only
  if [[ "$OS" == "Darwin" ]]; then
    local v; v="$(security find-generic-password -a "$USER" -s "$(service_name_for "$1")" -w 2>/dev/null || true)"
    [[ -n "$v" ]] && { printf '%s' "$v"; return; }
  fi
  cat "$1/.credentials.json" 2>/dev/null || true
}

QDIR="$(mktemp -d "${TMPDIR:-/tmp}/r04-quarantine.XXXXXX")"
trap 'rm -rf "$QDIR" 2>/dev/null || true' EXIT INT TERM

TGT_CRED="$(store_read "$C_TGT")"
[[ -n "$TGT_CRED" ]] || fail "no credential for target profile '${ARGS[1]}' — logged in?"
TGT_TOK="$(jq -r '.claudeAiOauth.accessToken // empty' <<<"$TGT_CRED")"
TGT_RT="$(jq -r '.claudeAiOauth.refreshToken // empty' <<<"$TGT_CRED")"
TGT_EXP="$(jq -r '.claudeAiOauth.expiresAt // empty' <<<"$TGT_CRED")"
[[ -n "$TGT_TOK" ]] || fail "could not parse claudeAiOauth.accessToken from target"
[[ -n "$TGT_RT"  ]] || info "note: target has no refreshToken — a freshen would be impossible (quarantine on need)"

# ---------- minutes-to-expiry (ms or s epoch, tolerated) ----------
MINS="$(node -e 'let e=Number(process.argv[1]);if(!Number.isFinite(e)||e===0){console.log("NA");process.exit(0)}if(e<1e12)e*=1000;console.log(Math.round((e-Date.now())/60000))' "${TGT_EXP:-0}")"
if [[ "$MINS" == "NA" ]]; then info "target expiresAt absent/unparseable — treating freshen as REQUIRED (unknown expiry)"; NEED=1
elif (( MINS < 10 )); then info "target expires in ${MINS} min (< 10) → freshen REQUIRED"; NEED=1
else info "target expires in ${MINS} min (>= 10) → no freshen needed"; NEED=0; fi
(( FORCE_REFRESH )) && { info "--force-refresh → treating freshen as REQUIRED"; NEED=1; }

# ---------- liveness against the verified profile endpoint (src/api.ts) ----------
STATUS="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 \
  -H "Authorization: Bearer $TGT_TOK" \
  -H "anthropic-beta: oauth-2025-04-20" \
  -H "User-Agent: agent-switch-spike/0 (+road-to-live-rebind)" \
  https://api.anthropic.com/api/oauth/profile 2>/dev/null || echo "000")"
case "$STATUS" in
  2??)      LIVE="ok" ;;
  401|403)  LIVE="rejected" ;;
  *)        LIVE="unknown" ;;
esac
info "profile-endpoint status: $STATUS ($LIVE)"

quarantine() {  # <reason> — mark and REFUSE to activate; never touches a store
  local reason="$1"
  printf '{"profile":"%s","reason":"%s","quarantined_at":"%s"}\n' "${ARGS[1]}" "$reason" "$(date -u +%FT%TZ)" \
    > "$QDIR/${ARGS[1]}.quarantine.json"
  red "QUARANTINE: target '${ARGS[1]}' must NOT be activated — $reason"
  info "marker (scratch, removed on exit): $QDIR/${ARGS[1]}.quarantine.json"
  green "PASS R0.4 — quarantine gate fired; a dead credential is never swapped in."
  exit 0
}

# ---------- deterministic quarantine drill ----------
(( FORCE_QUARANTINE )) && quarantine "simulated dead refresh token (--force-quarantine)"

# ---------- decision + quarantine logic ----------
if [[ "$LIVE" == "unknown" ]]; then
  red "HONEST-NULL R0.4 — profile endpoint unreachable (offline/transient), cannot decide."
  info "re-run online; do NOT activate the target until liveness is confirmed."
  exit 2
fi

if (( NEED == 0 )); then
  # Healthy and comfortably in-window → swap directly, no refresh.
  [[ "$LIVE" == "ok" ]] || quarantine "credential rejected ($STATUS) despite a far expiry — refresh underneath a live session or re-login"
  green "PASS R0.4 — no freshen needed (>= 10 min) and the token is accepted; safe to swap directly."
  exit 0
fi

# Freshen required.
if [[ "$LIVE" == "rejected" || -z "$TGT_RT" ]]; then
  # The access token is already dead, or there is no refresh token — a swap now
  # would hand a running session a credential that fails on the next message.
  if [[ -n "${ASW_OAUTH_TOKEN_URL:-}" && -n "${ASW_OAUTH_CLIENT_ID:-}" && -n "$TGT_RT" ]]; then
    info "attempting operator-supplied refresh grant ..."
    RESP="$(curl -sS --max-time 15 -X POST "$ASW_OAUTH_TOKEN_URL" -H 'Content-Type: application/json' \
      -d "$(jq -nc --arg rt "$TGT_RT" --arg cid "$ASW_OAUTH_CLIENT_ID" '{grant_type:"refresh_token",refresh_token:$rt,client_id:$cid}')" 2>/dev/null || true)"
    NEWTOK="$(jq -r '.access_token // .claudeAiOauth.accessToken // empty' <<<"${RESP:-}" 2>/dev/null || true)"
    [[ -n "$NEWTOK" ]] || quarantine "refresh grant returned no access_token (dead refresh token: $(jq -r '.error // "no error field"' <<<"${RESP:-{}}" 2>/dev/null))"
    printf '%s' "$RESP" > "$QDIR/${ARGS[1]}.refreshed.json"   # scratch only, never a store
    green "PASS R0.4 — refresh recovered a live token BEFORE the swap (freshened, scratch: $QDIR/${ARGS[1]}.refreshed.json)."
    exit 0
  fi
  quarantine "freshen required but $( [[ -z "$TGT_RT" ]] && echo "no refresh token present" || echo "no refresh endpoint supplied and the access token is rejected" )"
fi

# Freshen required, access token still live, refresh token present → Phase-1 owns
# the actual refresh; the DECISION + inputs are correct.
green "PASS R0.4 — freshen REQUIRED and possible: token still live, refresh token present."
info "the real refresh grant belongs to the Phase-1 write module (or supply"
info "ASW_OAUTH_TOKEN_URL + ASW_OAUTH_CLIENT_ID to exercise it here). Never swap a"
info "sub-10-min token in without freshening first."
