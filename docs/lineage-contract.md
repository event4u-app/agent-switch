# Lineage contract — telling Agent Switch who started a session

Version 1 (2026-11-02). Stable: new fields may be added, existing ones keep their
meaning. Read by Agent Switch ≥ the v3 engine; written by anything that starts an
agent session on behalf of another one — an agent-config council, an arena, a
script.

Agent Switch never guesses a parent. A session appears under another one only
when it says so itself, through these environment variables, or when Agent
Switch started it (ADR-007).

## The variables

Set them in the environment of the process that starts the child session
(`claude -p …`, `codex exec …`). Child processes inherit them; Claude Code passes
its environment on to the hooks Agent Switch installs, which read them once, at
the child's `SessionStart`. Verified with Claude Code 2.1.316: a child `claude
-p` sees the variables its parent was started with
(`agents/evidence/v3-phase0-spikes-2026-11.md`, T-S3).

| Variable | Required | Value |
|---|---|---|
| `AGENT_SWITCH_PARENT_SESSION` | yes | The parent session: `<provider>/<account>/<session-id>` when known, else the bare session id. Letters, digits and `-` in the id. |
| `AGENT_SWITCH_PARENT_KIND` | no | One of `subagent`, `council`, `arena`, `court`, `helper`, `other`. Anything else reads as `other`. |
| `AGENT_SWITCH_PARENT_LABEL` | no | What to show for the child, up to 80 characters, e.g. `seat 2 of 3`. Control characters become spaces. Never put secrets or prompt text here: it is stored and displayed. |
| `AGENT_SWITCH_PARENT_AGENT` | no | The parent's tool, lowercase, e.g. `claude`, `codex`. |

A malformed `AGENT_SWITCH_PARENT_SESSION` is ignored — the child then shows as
a root, never under a guessed parent. A session never becomes its own parent.

## What Agent Switch sets itself

| Situation | Edge | Source shown |
|---|---|---|
| A session started inside an Agent Switch hosted window (`AGENT_SWITCH_HOST_PANE` holds the window's session key) | `started_by` that session | "via host" |
| `takeover` resuming a session on another account (same id or a fork) | `continued_from` the original | "via host" |
| A subagent (`SubagentStart` hook) | `subagent` of its session | "via hook" |
| Subagent transcripts next to a session, without hooks | a count only | "counted" |

`continued_from` is drawn apart from `started_by`. A compaction keeps the
session id and is shown as an event on that session, not as an edge. A `/clear`
starts a new session id and the host does not say which session was cleared, so
it is not linked yet.

## Where it shows

`agent-switch sessions --json` lists, per session, `children` (each with `kind`,
`state` and `source`), `childCount`, `childSource`, and for a child its `parent`.
A session in a temp folder that no one claims carries `"relation": "unknown"`.
`agent-switch sessions --tree --json` nests children under their parent; counts
of sessions count roots only.

## For agent-config

agent-config adopts this contract in its own change: its council and arena
runners set the variables above when they start seats. Agent Switch reads no
agent-config files and no agent-config-specific variables.
