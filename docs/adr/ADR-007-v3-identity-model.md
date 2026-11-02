# ADR-007 — v3 identity model: namespaced ids, edges with provenance, separate state axes

- **Status:** Proposed (2026-11-02) — draft from `road-to-agent-switch-v3-central`
  Phase 0.
- **Evidence:** `agents/evidence/v3-phase0-spikes-2026-11.md` (T-S1…T-S4),
  `tests/fixtures/claude-subagent-hooks-2.1.316.jsonl`.

## Context

A Claude `session_id` is unique inside one config dir, not across them: a
`takeover` copies a transcript into another profile under the same id, and the
user's own `~/.claude` can hold the same id as an AS profile. Processes, terminal
windows and worktrees come and go independently of sessions. The v3 UI must never
show a guessed relation (spec §1.4, §13.6) and must not fold unrelated states
(pinned, working, PR failing, read-only) into one status column.

## Decision

### Identities — four kinds, never mixed

| Kind | Key | Example |
|---|---|---|
| session | `(provider, account, sessionId)` — `account` is the AS profile, or `default` for the tool's own dir | `claude/work/3c87a281-…` |
| process | `(host, pid, startedAt)` | from `claude agents --json` (T-S4) or the pid files |
| terminal | `(kind, address)` — `tmux:<socket>:<window-id>` or `tty:/dev/ttys003` | |
| worktree | canonical `git rev-parse --show-toplevel` path | `<repo>/.claude/worktrees/agent-<id>` (T-S2) |

A subagent is not a session: it is `(session, agentId)`.

### Edges — every relation says where it came from

```ts
interface Edge {
  from: Id; to: Id;
  kind: "subagent" | "helper" | "started_by" | "continued_from" | "cleared" | "compacted";
  source: "hook" | "lineage" | "git" | "github" | "host" | "counted" | "unknown";
  confidence: "proven" | "reported" | "unknown";
  observedAt: string;
}
```

- `hook` — a host hook said so (SubagentStart carries the parent `session_id`).
- `lineage` — the env contract `AGENT_SWITCH_PARENT_SESSION|_AGENT|_KIND|_LABEL`;
  env vars reach a child `claude -p` (T-S3), so council seats can name their
  parent.
- `git` / `github` — a shared worktree, branch or PR.
- `host` — AS started it (takeover, handoff, fork, hosted start).
- `counted` — the child is known only by count (subagent files without hooks).
- `unknown` — a candidate AS cannot prove. Rendered "relation unknown"; never
  drawn as a parent. There is no heuristic edge.

`continued_from` is drawn apart from `started_by`; `/clear` and `/compact` are
edges, not new roots. Every child has exactly one parent or the `unknown` edge;
the graph has no cycles (property-tested).

### State — four axes, never one column

| Axis | Values |
|---|---|
| library | `none · pinned · auto-kept · archived · trashed` + vault state `kept · at-risk · lost` |
| runtime | `working · needs-you · waiting · idle · done · parked · auth-paused · pause-requested` (spec §3.3) |
| PR | lifecycle, mergeability, review, CI — each its own field, each with `UNKNOWN` |
| capability | `hosted · own-terminal`, `writable · read-only`, `chat-capable` |

The UI derives its single trailing slot (spec §5.2) from these axes by a fixed
priority; the store never stores the derived value.

## Consequences

- Every query and every protocol message names the account with the session id.
- Facts (branch, PR, cwd) carry a `source` too (`hook · proc · transcript ·
  github`), so "via hook" / "via git" tooltips read stored data, not guesses.
- Migration: today's JSON files key sessions by bare id per profile file, so the
  account is implied by the file and can be filled in at import.

## Alternatives

- **Global `session_id` key** — rejected: collides after takeover and between
  the user's own dir and AS profiles.
- **Inferred parents (temp cwd, timing)** — rejected by spec §1.4; a temp cwd
  that never ran on a TTY may mark a candidate, never an edge.
