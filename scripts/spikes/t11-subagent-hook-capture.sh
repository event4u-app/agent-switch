#!/usr/bin/env bash
# T11 — capture the real stdin of Claude Code's SubagentStart / SubagentStop
# hooks (road-to-hooks-that-keep-up, Phase 2 step 1), so the recorded field
# names come from a live payload, not from the docs.
#
# One `claude -p` turn that asks for one subagent, hooks injected with
# `--settings` (the profile's settings.json is never written). Prints each
# payload with string values longer than 80 characters shortened and the
# subagent's last message removed, ready to commit as a fixture.
#
# Usage: CLAUDE_CONFIG_DIR=<logged-in profile config> scripts/spikes/t11-subagent-hook-capture.sh
set -uo pipefail
: "${CLAUDE_CONFIG_DIR:?point CLAUDE_CONFIG_DIR at a logged-in profile config dir}"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

dump="sh -c 'cat >> \"$SCRATCH/payloads.jsonl\"; echo >> \"$SCRATCH/payloads.jsonl\"'"
node -e '
  const cmd = process.argv[1];
  const h = [{ hooks: [{ type: "command", command: cmd }] }];
  console.log(JSON.stringify({ hooks: { SubagentStart: h, SubagentStop: h } }));
' "$dump" > "$SCRATCH/settings.json"

(cd "$SCRATCH" && claude -p "Use the Agent tool exactly once with subagent_type general-purpose and the prompt 'Reply with the single word ok.' Then reply with what it returned." \
  --settings "$SCRATCH/settings.json" --allowedTools Agent Task >/dev/null 2>&1)

[ -s "$SCRATCH/payloads.jsonl" ] || { echo "NULL: no subagent hook fired" >&2; exit 2; }
echo "{\"claude\":\"$(claude --version | head -1)\"}"
node -e '
  const fs = require("fs");
  for (const line of fs.readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean)) {
    const o = JSON.parse(line);
    delete o.last_assistant_message;
    for (const [k, v] of Object.entries(o)) if (typeof v === "string" && v.length > 80) o[k] = v.slice(0, 77) + "...";
    console.log(JSON.stringify(o));
  }
' "$SCRATCH/payloads.jsonl"
