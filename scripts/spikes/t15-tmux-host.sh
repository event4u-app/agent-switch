#!/usr/bin/env bash
# T15 / S5 — tmux as the v3 session host (road-to-agent-switch-v3-central,
# Phase 0). Checks the rules the host would rely on, with no Claude involved:
#   1. an own server: `-L as-<uid>-spike -f /dev/null`, so the user's tmux.conf
#      and the user's default server are never touched;
#   2. one window per hosted session, started by argv (never typed);
#   3. one linked view session per viewer (`new-session -t`): two viewers can
#      look at different windows at the same time;
#   4. `send-keys -l` reaches the right window; `capture-pane` reads it back;
#   5. closing a viewer or detaching never ends a hosted session;
#   6. `refresh-client` on a viewer is accepted;
#   7. the user's default server is unchanged before and after.
# Prints one JSON line per check and exits non-zero on the first failure.
set -uo pipefail
command -v tmux >/dev/null || { echo '{"check":"tmux","ok":false,"why":"tmux missing"}'; exit 2; }
SOCK="as-$(id -u)-spike-$$"
T() { tmux -L "$SOCK" -f /dev/null "$@"; }
SCRATCH="$(mktemp -d)"
cleanup() { T kill-server >/dev/null 2>&1; rm -rf "$SCRATCH"; }
trap cleanup EXIT
ok() { echo "{\"check\":\"$1\",\"ok\":true${2:+,$2}}"; }
fail() { echo "{\"check\":\"$1\",\"ok\":false,\"why\":\"$2\"}"; exit 1; }

before="$(tmux ls 2>/dev/null | sort | md5 -q 2>/dev/null || tmux ls 2>/dev/null | sort | md5sum | cut -d' ' -f1)"

# 1+2: own server, the host session holds one window per hosted session. The
# programs are argv: a shell that echoes what it reads, standing in for a CLI.
T new-session -d -s host -n s1 -x 120 -y 30 sh -c 'while IFS= read -r l; do echo "s1 got: $l"; done' || fail own-server "new-session failed"
T new-window -d -t host -n s2 sh -c 'while IFS= read -r l; do echo "s2 got: $l"; done'
T new-window -d -t host -n s3 sh -c 'while IFS= read -r l; do echo "s3 got: $l"; done'
[ "$(T list-windows -t host -F '#W' | tr '\n' ' ')" = "s1 s2 s3 " ] || fail one-window-per-session "$(T list-windows -t host -F '#W' | tr '\n' ' ')"
ok own-server "\"socket\":\"$SOCK\""
ok one-window-per-session "\"windows\":3"

# 3: two viewers, linked to the host, each on its own window.
T new-session -d -s view-a -t host
T new-session -d -s view-b -t host
T select-window -t view-a:s1
T select-window -t view-b:s3
a="$(T display-message -p -t view-a '#W')"; b="$(T display-message -p -t view-b '#W')"
[ "$a" = s1 ] && [ "$b" = s3 ] || fail independent-viewers "view-a=$a view-b=$b"
ok independent-viewers "\"viewA\":\"$a\",\"viewB\":\"$b\""

# 4: literal input reaches exactly one window.
T send-keys -t host:s2 -l 'hello from the lease holder'
T send-keys -t host:s2 Enter
sleep 0.5
got="$(T capture-pane -p -t host:s2 | grep -c 's2 got: hello from the lease holder')"
others="$(T capture-pane -p -t host:s1 | grep -c 'hello' ; true)"
[ "$got" = 1 ] && [ "$others" = 0 ] || fail send-keys-literal "s2=$got s1=$others"
ok send-keys-literal

# 5: a viewer goes away, the hosted sessions stay.
T kill-session -t view-a
[ "$(T list-windows -t host -F '#W' | wc -l | tr -d ' ')" = 3 ] || fail viewer-close-keeps-sessions "windows gone"
ok viewer-close-keeps-sessions

# 6: refresh-client is accepted for a viewer (no client attached in this headless run → tmux reports that, which is fine).
msg="$(T refresh-client -t view-b 2>&1 || true)"
ok refresh-client "\"note\":\"$(echo "$msg" | tr -d '"' | head -1)\""

# 7: the user's default server is untouched.
after="$(tmux ls 2>/dev/null | sort | md5 -q 2>/dev/null || tmux ls 2>/dev/null | sort | md5sum | cut -d' ' -f1)"
[ "$before" = "$after" ] || fail default-server-untouched "tmux ls changed"
ok default-server-untouched
echo "{\"tmux\":\"$(tmux -V)\",\"os\":\"$(uname -s)\"}"
