---
complexity: small
status: planned
tree_pin: ff38137
---

# Roadmap: hooks that keep up (non-blocking, lossless, subagent-aware)

> **Source:** `agents/tmp.old/inbox-2026-11-b/` — owner transcript (three turns,
> 2026-11-02) plus six assistant proposals for a session control center / AS v3.
> This roadmap carries the defect half that every later phase depends on (proposal
> step V0.1 and the subagent event half of P1).
>
> Sibling: [`road-to-agent-switch-v3-central.md`](road-to-agent-switch-v3-central.md)
> builds the session tree on top of the events this roadmap makes trustworthy.

## Branch

Targets `dev/v3` like all v3 work (branch model in
[`road-to-agent-switch-v3-central.md`](road-to-agent-switch-v3-central.md)). The
defect also exists in 2.x; shipping a backport to `main` early is a separate
owner decision, not part of this roadmap.

## Goal

The lifecycle hooks agent-switch installs never hold a Claude turn, never lose an
event under concurrent sessions, and record subagent start/stop with the ids a
tree needs. Measured before and after, not assumed.

## Verified against the tree (`ff38137`)

- `async: true` is spread onto the matcher group, not onto the command handler:
  `withHooksInstalled` pushes `{ ...buildHookEntry(bin), async: true }`
  (`src/hooks.ts:88-91`), while the handler object is built without it
  (`src/hooks.ts:51-55`). The Claude Code hooks doc places `async` on the handler.
  Whether CC ignores the group-level key is **unverified on a live binary** —
  Phase 0 measures it instead of trusting either reading.
- The event ring is read whole, appended, trimmed to `EVENT_RING_CAP = 500` and
  rewritten without a lock (`src/hooks.ts:39`, `src/hooks.ts:237-243`). Two
  sessions ending together can drop a line; a burst of subagent events would push
  out the `Notification`/`StopFailure` lines that "needs you" is derived from
  (`src/hooks.ts:225-233`).
- `HOOK_EVENTS` has no `SubagentStart`/`SubagentStop` (`src/hooks.ts:33`).

## Constraints

- Hooks stay opt-in (`agent-switch hooks install`); this roadmap changes what an
  installed hook does, not whether it is installed.
- A hook that fails or times out never blocks or breaks the host session.

## Phase 0 — Measure first

- [x] Reproduce the blocking: a `Stop` hook with a 2 s sleep under the current
      entry shape, time the turn end on a live CC; repeat with `async` on the
      handler. Record CC version + both timings in `agents/evidence/`.
      → `agents/evidence/hook-blocking-probe-2026-11.md`: today's shape holds the
      turn for the full hook; `async` on the handler does not.
- [x] Reproduce the loss: a test that fires N concurrent `appendEvent` calls
      against one file and counts surviving lines (expected red today).
      → `tests/hooks.test.ts`; red on `ff38137`: 997 of 1000 events lost.
- [x] Measure the per-event cost of `agent-switch __hook-event` (node start,
      p50/p95 over 50 events) — the baseline the v3 `as-hook` gate compares against.
      → `agents/evidence/hook-event-cost-2026-11.md`: p95 56 ms wall, 3.9 CPU s
      per 100 events.

## Phase 1 — Fix

- [x] Put `async: true` on the handler entry; on `hooks install`/`status`, migrate
      an existing group-level entry in place (idempotent, marker-scoped, user
      entries untouched). Tests for fresh install, migration and uninstall.
      → `hooks status` also migrates; `hooksNeedMigration` in `src/hooks.ts`.
- [x] Make `appendEvent` lossless: append-only write with `O_APPEND` (one
      `write` per record under `PIPE_BUF`) plus a trim that runs under a lock file
      and never drops records newer than the reader's cursor. The concurrency test
      from Phase 0 turns green.
      → Done by rotation instead of a rewrite: past `ROTATE_BYTES` one writer
      renames the live file to `.1` under the lock; a writer that finds the lock
      held skips the rotation. Reads see `.pin` + `.1` + live, so nothing is
      dropped before it is a full generation old.
- [x] Separate the "needs you" signal from volume: trimming keeps the latest
      `Notification`/`StopFailure` per session even when older lines go.
      → `.pin` holds a session's last Notification/StopFailure from a dropped
      generation until a newer event of that session arrives (max. 7 days).

## Phase 2 — Subagent events

- [x] Add `SubagentStart`/`SubagentStop` to `HOOK_EVENTS`; record `agent_id`,
      `agent_type`, parent `session_id` and `cwd` from the payload (field names
      verified against a captured live payload, fixture committed).
      → `scripts/spikes/t11-subagent-hook-capture.sh`,
      `tests/fixtures/claude-subagent-hooks-2.1.316.jsonl`; `recordFromPayload`
      keeps ids, type and cwd, never `last_assistant_message`.
- [x] `sessions --json` exposes `children: [{agentId, type, state, cwd}]` per
      session; without hooks the field is absent, never an empty list.
      → `childrenOf` in `src/hooks.ts`; a parent's `SessionEnd` ends its children.
- [x] Docs: `hooks` page lists the new events and what each one costs.
      → `concepts/sessions-and-context.mdx`, `guides/move-a-session.mdx`.

## Acceptance

- The Phase 0 blocking probe shows no turn delay from an installed AS hook.
- 20 concurrent writers × 50 events: zero lost lines.
- A session with 4 subagents shows 4 children in `sessions --json`.

## Risk Register

| Risk | Mitigation |
|---|---|
| CC changes hook payload field names | fixture per CC version; unknown fields passed through, missing ones → field absent |
| Lock file left behind after a crash | stale-lock age check; append path never waits on the lock |
