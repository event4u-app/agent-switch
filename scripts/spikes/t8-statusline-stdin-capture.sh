#!/usr/bin/env bash
# t8 — capture the real stdin JSON a Claude Code STATUSLINE command receives, to
# confirm (G1) rate_limits.{five_hour,seven_day} presence + exact shape and (G6)
# CLAUDE_CONFIG_DIR presence in the statusLine env, for the statusline-usage
# roadmap (Phase 0, road-to-agent-switch-statusline-usage.md).
#
# WHY THIS NEEDS A REAL SESSION (unlike t6):
#   - A statusLine renders ONLY in an INTERACTIVE session — `claude -p` does not
#     invoke it. So this cannot be captured headlessly.
#   - rate_limits only appears for a LOGGED-IN Pro/Max config dir. A throwaway
#     scratch dir is not logged in → no rate_limits. So we must point at a real
#     agent-switch profile's config dir, which means temporarily editing THAT
#     profile's settings.json. This script backs it up first and restores it in
#     `finish`, so the mutation is bounded and reversible.
#   - Running the session consumes account usage — that is the operator's action.
#
# USAGE (two phases, so the mutation is always restored):
#   1) ./t8-statusline-stdin-capture.sh setup <CLAUDE_CONFIG_DIR>
#        → backs up settings.json, injects a capture statusLine, prints the exact
#          interactive command to run.
#   2) run the printed `claude` command, wait for the status bar to render once,
#      then quit (Ctrl-C / /exit).
#   3) ./t8-statusline-stdin-capture.sh finish <CLAUDE_CONFIG_DIR>
#        → prints the captured rate_limits shape + env check, then RESTORES
#          settings.json to the backup (always, even if capture is empty).
set -uo pipefail
green() { printf '\033[32m%s\033[0m\n' "$*"; }
red()   { printf '\033[31m%s\033[0m\n' "$*"; }
info()  { printf '\033[36m[t8]\033[0m %s\n' "$*"; }

MODE="${1:-}"
CFG="${2:-}"
if [ -z "$MODE" ] || [ -z "$CFG" ]; then
  red "usage: $0 setup|finish <CLAUDE_CONFIG_DIR>"
  echo "  <CLAUDE_CONFIG_DIR> must be a LOGGED-IN dir (e.g. ~/.agent-switch/claude/<profile>/config)"
  exit 64
fi

SETTINGS="$CFG/settings.json"
BACKUP="$CFG/.settings.json.t8-backup"
CAP="$CFG/.t8-statusline-stdin.json"
ENVCAP="$CFG/.t8-statusline-env.txt"
# The capture command: dump stdin to CAP, dump the CLAUDE env to ENVCAP, then
# emit a visible line so the bar is not blank while capturing.
CAPCMD="tee '$CAP' >/dev/null; env | grep -i claude > '$ENVCAP' 2>/dev/null; printf 't8-capturing…'"

if [ "$MODE" = "setup" ]; then
  [ -d "$CFG" ] || { red "no such config dir: $CFG"; exit 66; }
  if [ -f "$BACKUP" ]; then
    red "a t8 backup already exists ($BACKUP) — run 'finish' first to restore, then retry."
    exit 65
  fi
  # Back up (or record that there was none) so finish always restores exactly.
  if [ -f "$SETTINGS" ]; then
    cp -p "$SETTINGS" "$BACKUP"
    BASE="$(cat "$SETTINGS")"
  else
    printf '__t8_no_original__' > "$BACKUP"
    BASE='{}'
  fi
  # Inject statusLine into a copy of the existing settings (preserve everything else).
  echo "$BASE" | CAPCMD="$CAPCMD" node -e '
    let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
      let o={}; try{o=JSON.parse(d||"{}")}catch{o={}}
      o.statusLine={type:"command",command:process.env.CAPCMD,padding:0};
      process.stdout.write(JSON.stringify(o,null,2));
    });' > "$SETTINGS.tmp" && mv "$SETTINGS.tmp" "$SETTINGS"
  chmod 600 "$SETTINGS" 2>/dev/null || true
  green "setup done — capture statusLine injected (original backed up to $BACKUP)."
  info "NOW RUN AN INTERACTIVE SESSION (consumes account usage), let the bar render once, then quit:"
  echo
  echo "    CLAUDE_CONFIG_DIR='$CFG' claude"
  echo
  info "then run:  $0 finish '$CFG'"
  exit 0
fi

if [ "$MODE" = "finish" ]; then
  RC=0
  if [ -s "$CAP" ]; then
    info "captured statusLine stdin — top-level keys + rate_limits shape:"
    node -e '
      const fs=require("fs");
      const o=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
      console.log("top-level keys:", Object.keys(o).join(", "));
      console.log("rate_limits:", JSON.stringify(o.rate_limits ?? null, null, 2));
    ' "$CAP" || RC=1
    if [ -s "$ENVCAP" ]; then
      if grep -qi "CLAUDE_CONFIG_DIR" "$ENVCAP"; then
        green "G6 PASS: CLAUDE_CONFIG_DIR present in the statusLine env:"; grep -i CLAUDE_CONFIG_DIR "$ENVCAP"
      else
        red "G6 FAIL: CLAUDE_CONFIG_DIR NOT in the statusLine env → profile mapping impossible."
      fi
    fi
    node -e 'const o=require(process.argv[1]); process.exit(o.rate_limits?0:3)' "$CAP" \
      && green "G1 PASS: rate_limits present. Scrub + commit as tests/fixtures/statusline-stdin.json." \
      || red "G1 FAIL/NULL: no rate_limits in the statusLine stdin (tier/version?) — feature blocked, poll stays."
  else
    red "NULL: no statusLine stdin captured. Either the session did not render a bar, the dir is not logged in, or this CC version predates statusLine rate_limits."
    RC=2
  fi
  # ALWAYS restore, whatever happened.
  if [ -f "$BACKUP" ]; then
    if [ "$(cat "$BACKUP")" = "__t8_no_original__" ]; then
      rm -f "$SETTINGS"; info "restored: removed the settings.json we created (there was none originally)."
    else
      mv "$BACKUP" "$SETTINGS"; info "restored: settings.json returned to its pre-t8 backup."
    fi
  fi
  rm -f "$CAP" "$ENVCAP"
  exit $RC
fi

red "unknown mode '$MODE' (use setup|finish)"; exit 64
