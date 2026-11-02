#!/usr/bin/env bash
# T9 — does an installed agent-switch hook hold a Claude Code turn?
# (road-to-hooks-that-keep-up, Phase 0 step 1.)
#
# Runs one `claude -p` turn three times against a logged-in profile, each with a
# Stop hook that sleeps HOOK_SLEEP seconds, injected via `--settings` so the
# profile's own settings.json is never written:
#   A) no hook                         — baseline
#   B) `async: true` on the matcher group (the shape agent-switch ≤ 2.11 writes)
#   C) `async: true` on the command handler (the shape the hooks doc names)
# For each run it records when the result message reached stdout and when the
# process exited, relative to the start. A hook that blocks shows up as
# result/exit ≥ HOOK_SLEEP later than the baseline.
#
# Usage: CLAUDE_CONFIG_DIR=<logged-in profile config> scripts/spikes/t9-hook-blocking-probe.sh
set -uo pipefail
: "${CLAUDE_CONFIG_DIR:?point CLAUDE_CONFIG_DIR at a logged-in profile config dir}"
HOOK_SLEEP="${HOOK_SLEEP:-3}"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

# Millisecond clock that works on macOS (BSD date has no %N).
NOW="perl -MTime::HiRes=time -e 'printf qq(%d\\n), time*1000'"
hook_cmd="sh -c \"$NOW >> '$SCRATCH/hook-\$RUN.log'; sleep $HOOK_SLEEP; $NOW >> '$SCRATCH/hook-\$RUN.log'\""

write_settings() { # $1 = run id, $2 = shape
  local cmd="${hook_cmd//\$RUN/$1}"
  case "$2" in
    none)    echo '{}' ;;
    group)   node -e 'console.log(JSON.stringify({hooks:{Stop:[{async:true,hooks:[{type:"command",command:process.argv[1]}]}]}}))' "$cmd" ;;
    handler) node -e 'console.log(JSON.stringify({hooks:{Stop:[{hooks:[{type:"command",command:process.argv[1],async:true}]}]}}))' "$cmd" ;;
  esac > "$SCRATCH/settings-$1.json"
}

run() { # $1 = run id, $2 = shape
  write_settings "$1" "$2"
  local t0; t0=$(node -e 'console.log(Date.now())')
  claude -p "Reply with the single word ok." --output-format stream-json --verbose \
      --settings "$SCRATCH/settings-$1.json" 2>/dev/null \
    | node -e '
      const t0 = Number(process.argv[1]); let buf = "", result = null;
      process.stdin.on("data", (c) => {
        buf += c; let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          try { if (JSON.parse(line).type === "result" && result === null) result = Date.now() - t0; } catch {}
        }
      }).on("end", () => console.log(JSON.stringify({ resultMs: result, exitMs: Date.now() - t0 })));
    ' "$t0" > "$SCRATCH/timing-$1.json"
  local hook="null"
  if [ -s "$SCRATCH/hook-$1.log" ]; then
    hook=$(node -e 'const [s,e]=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(Number);console.log(JSON.stringify({hookStartMs:s-Number(process.argv[2]),hookEndMs:e?e-Number(process.argv[2]):null}))' "$SCRATCH/hook-$1.log" "$t0")
  fi
  echo "{\"run\":\"$1\",\"shape\":\"$2\",\"timing\":$(cat "$SCRATCH/timing-$1.json"),\"hook\":$hook}"
}

echo "{\"claude\":\"$(claude --version | head -1)\",\"hookSleepS\":$HOOK_SLEEP}"
ROUNDS="${ROUNDS:-3}"
for r in $(seq 1 "$ROUNDS"); do
  run "A$r" none
  run "B$r" group
  run "C$r" handler
done
