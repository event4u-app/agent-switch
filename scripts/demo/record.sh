#!/usr/bin/env bash
# Records the README / docs demo GIF from the real CLI against a seeded,
# anonymized throw-away home (example.com identities, fake tokens, no network).
#
#   npm run build && scripts/demo/record.sh     → .github/assets/demo.gif
#
# Needs asciinema (≥ 3) and agg on PATH.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CLI="$ROOT/dist/index.js"
OUT="${DEMO_OUT:-$ROOT/.github/assets/demo.gif}"
[ -f "$CLI" ] || { echo "run npm run build first" >&2; exit 1; }
command -v asciinema >/dev/null && command -v agg >/dev/null || { echo "needs asciinema and agg" >&2; exit 1; }

HOME_DIR="$(cd "$(mktemp -d)" && pwd -P)"   # resolved: macOS temp dirs live behind /private
trap 'rm -rf "$HOME_DIR"' EXIT
ASH="$HOME_DIR/.agent-switch"
mkdir -p "$HOME_DIR/dev/client-a"

seed_profile() { # name email
  local d="$ASH/claude/$1/config"
  mkdir -p "$d"
  printf '{"oauthAccount":{"emailAddress":"%s"}}\n' "$2" >"$d/.claude.json"
  node -e 'console.log(JSON.stringify({claudeAiOauth:{accessToken:"demo",refreshToken:"demo",expiresAt:Date.now()+8*3600e3,scopes:["user:inference"]}}))' >"$d/.credentials.json"
}
seed_profile work work@example.com
seed_profile personal me@example.com

# Fresh usage, as the background service would have written it a moment ago.
node -e '
const fs = require("fs"), ash = process.argv[1], now = Date.now(), h = 3600e3;
const write = (name, five, week, weekResetH) => fs.writeFileSync(`${ash}/claude/${name}/usage-latest.json`, JSON.stringify({
  capturedAt: new Date(now).toISOString(),
  windows: [
    { key: "five_hour", label: "5h", utilization: five, resetsAt: new Date(now + 2 * h).toISOString() },
    { key: "seven_day", label: "7d", utilization: week, resetsAt: new Date(now + weekResetH * h).toISOString() },
  ],
}));
write("work", 12, 81, 120);
write("personal", 8, 34, 14);' "$ASH"
env -i PATH="$PATH" HOME="$HOME_DIR" AGENT_SWITCH_HOME="$ASH" node "$CLI" use work >/dev/null

CAST="$HOME_DIR/demo.cast"
DEMO_HOME="$HOME_DIR" DEMO_CLI="$CLI" asciinema rec --quiet --overwrite --window-size 136x24 \
  -c "bash '$ROOT/scripts/demo/play.sh'" "$CAST"
agg --theme monokai --font-size 18 --idle-time-limit 3.5 --last-frame-duration 4 "$CAST" "$OUT"
echo "wrote $OUT"
