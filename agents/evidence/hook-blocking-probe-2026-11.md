# Probe: does the hook agent-switch installs hold a Claude Code turn?

Date 2026-11-02 · Claude Code 2.1.316 · macOS · roadmap
`road-to-hooks-that-keep-up` Phase 0 step 1. Script:
`scripts/spikes/t9-hook-blocking-probe.sh`.

## Method

One `claude -p "Reply with the single word ok." --output-format stream-json`
turn on a logged-in profile (MatneX), three shapes, three interleaved rounds. The
Stop hook sleeps 3 s and logs its start and end in milliseconds. It is injected
with `--settings`, so the profile's own `settings.json` is never written.

- **A** — no hook (baseline).
- **B** — `async: true` on the matcher group: the shape `withHooksInstalled`
  writes up to 2.11 (`src/hooks.ts:92`).
- **C** — `async: true` on the command handler: the shape the Claude Code hooks
  doc names.

Times are milliseconds from the start of the run.

## Result

| Run | Shape | hook start | hook end | result on stdout | exit |
|---|---|---:|---:|---:|---:|
| A1 | none | — | — | 5,494 | 6,013 |
| B1 | group | 2,315 | 5,332 | 5,338 | 6,026 |
| C1 | handler | 6,487 | not reached | 6,474 | 7,138 |
| A2 | none | — | — | 2,044 | 2,774 |
| B2 | group | 2,015 | 5,034 | 5,038 | 5,747 |
| C2 | handler | 12,809 | not reached | 12,793 | 13,470 |
| A3 | none | — | — | 2,501 | 3,203 |
| B3 | group | 4,966 | 7,982 | 7,986 | 8,516 |
| C3 | handler | 7,602 | not reached | 7,591 | 8,240 |

Model latency varies between runs (2–13 s), so the comparison that counts is
inside each run: when did the result arrive relative to the hook?

- **B (today's shape) blocks.** In all three rounds the result reached stdout
  4–6 ms after the hook *ended*: Claude Code waited the full 3 s. The group-level
  `async` key is ignored.
- **C does not block.** In all three rounds the result reached stdout 11–16 ms
  *before* the hook started; the turn did not wait for it.

## Side finding

Under `-p`, an async (C) hook that is still running when the process exits is
cut off: its end mark was never written in any C run. A one-shot session (a
council seat under `claude --print`) can therefore lose the event of its last
hook if the hook command is slow. The `__hook-event` write is a single append of
well under a second, but the fix must keep it that way; the per-event cost is
measured in Phase 0 step 3.

## What this decides

Phase 1 step 1 moves `async: true` onto the handler entry and migrates existing
installs.
