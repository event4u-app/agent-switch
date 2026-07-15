#!/usr/bin/env bash
# S6 — capture the real stdin JSON a Claude Code hook receives, to confirm the
# documented fields (session_id, transcript_path, cwd, hook_event_name, matcher)
# for the Phase 2.5 hook installer. Uses a throwaway CLAUDE_CONFIG_DIR so the
# user's real ~/.claude/settings.json is never touched.
#
# Auth note: `claude -p` needs a logged-in config dir. A fresh scratch dir is
# NOT logged in, so this will exit honest-null unless you point it at a
# logged-in dir via CLAUDE_CONFIG_DIR. That is the correct, safe default — the
# documented contract (code.claude.com/docs/en/hooks) is the fallback source
# and the installer dogfoods live capture in Phase 2.5.
set -uo pipefail
green() { printf '\033[32m%s\033[0m\n' "$*"; }
red()   { printf '\033[31m%s\033[0m\n' "$*"; }
info()  { printf '\033[36m[s6]\033[0m %s\n' "$*"; }

SCRATCH="$(mktemp -d)"
CAP="$SCRATCH/hook-stdin.json"
trap 'rm -rf "$SCRATCH"' EXIT

# A SessionStart hook that dumps stdin and lets the session continue.
mkdir -p "$SCRATCH"
cat > "$SCRATCH/settings.json" <<JSON
{
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command", "command": "cat > '$CAP'" } ] }
    ]
  }
}
JSON

info "scratch CLAUDE_CONFIG_DIR: $SCRATCH"
info "attempting a one-shot session to fire SessionStart…"
CLAUDE_CONFIG_DIR="$SCRATCH" claude -p "hook capture probe" >/dev/null 2>&1
STATUS=$?

if [ -s "$CAP" ]; then
  info "captured hook stdin JSON:"
  cat "$CAP" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const o=JSON.parse(d);console.log(JSON.stringify(Object.fromEntries(Object.keys(o).map(k=>[k,typeof o[k]==="object"?"<obj>":o[k]])),null,1));}catch{console.log(d.slice(0,500))}})'
  green "PASS: real hook stdin captured — fields above confirm the Phase 2.5 contract"
  exit 0
fi

red "NULL: no hook stdin captured (scratch dir not logged in; claude exit=$STATUS)."
echo "Documented contract (code.claude.com/docs/en/hooks) is authoritative for Phase 2.5:"
echo "  common fields: session_id, transcript_path, cwd, permission_mode, hook_event_name"
echo "  SessionStart adds: matcher ∈ {startup, resume, clear, compact}"
echo "Live capture will be dogfooded by the Phase 2.5 installer against a logged-in dir."
exit 2
