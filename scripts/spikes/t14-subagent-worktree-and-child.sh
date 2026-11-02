#!/usr/bin/env bash
# T14 — two lineage questions for road-to-agent-switch-v3-central, Phase 0:
#   T-S2: which `cwd` does a SubagentStart/Stop hook report for a subagent that
#         runs with `isolation: worktree`?
#   T-S3: does a child `claude -p` started from inside a session (the way a
#         council seat is started) inherit (a) hooks the parent got through
#         `--settings`, and (b) an env var the parent was started with?
#
# Scratch git repo; hooks in its `.claude/settings.json` (project scope, which a
# child started in the same folder also reads) log event, session id, cwd and
# the env var; one extra Stop hook arrives only through the parent's
# `--settings`. The profile's settings.json is never written.
#
# Usage: CLAUDE_CONFIG_DIR=<logged-in profile config> scripts/spikes/t14-subagent-worktree-and-child.sh
set -uo pipefail
: "${CLAUDE_CONFIG_DIR:?point CLAUDE_CONFIG_DIR at a logged-in profile config dir}"
SCRATCH="$(mktemp -d)"
trap 'cd /; git -C "$SCRATCH/repo" worktree prune >/dev/null 2>&1; rm -rf "$SCRATCH"' EXIT
REPO="$SCRATCH/repo"
mkdir -p "$REPO/.claude"
git -C "$REPO" init -q && echo hi > "$REPO/README.md" && git -C "$REPO" add . && git -C "$REPO" -c user.name=t -c user.email=t@t commit -qm init

LOG="$SCRATCH/log.jsonl"
logger() { # $1 = source label
  printf '%s' "node -e 'let d=\"\";process.stdin.on(\"data\",c=>d+=c).on(\"end\",()=>{const o=JSON.parse(d);require(\"fs\").appendFileSync(\"$LOG\",JSON.stringify({src:\"$1\",ev:o.hook_event_name,sid:o.session_id,agent:o.agent_id,cwd:o.cwd,parentEnv:process.env.AGENT_SWITCH_PARENT_SESSION||null})+\"\\n\")})'"
}
node -e '
  const [proj, flag, projFile, flagFile] = process.argv.slice(1);
  const h = (c) => [{ hooks: [{ type: "command", command: c }] }];
  require("fs").writeFileSync(projFile, JSON.stringify({ hooks: { Stop: h(proj), SubagentStart: h(proj), SubagentStop: h(proj) } }));
  require("fs").writeFileSync(flagFile, JSON.stringify({ hooks: { Stop: h(flag) } }));
' "$(logger project)" "$(logger flag)" "$REPO/.claude/settings.json" "$SCRATCH/flag.json"

cd "$REPO"
AGENT_SWITCH_PARENT_SESSION=parent-marker claude -p \
  "Do these two things, then reply with the single word done.
1. Use the Agent tool once with subagent_type general-purpose, isolation worktree, and the prompt: run pwd with Bash and reply with its output.
2. Run this exact Bash command: claude -p 'Reply with the single word ok.'" \
  --settings "$SCRATCH/flag.json" --allowedTools "Agent Bash(claude -p:*) Bash(pwd)" >/dev/null 2>&1

echo "{\"claude\":\"$(claude --version | head -1)\"}"
[ -s "$LOG" ] || { echo "NULL: no hook fired" >&2; exit 2; }
sed -e "s#$SCRATCH#<scratch>#g" "$LOG"
