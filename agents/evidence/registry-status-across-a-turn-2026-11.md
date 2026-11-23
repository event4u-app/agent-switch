# The registry word across a turn (S1)

> Spike S1 of `agents/roadmaps/archive/road-to-a-tree-that-reads-at-a-glance.md`.
> Recorded 2026-11-23 on macOS with **Claude Code 2.1.316**, interactive TUI in tmux,
> model Haiku, one profile config dir. Fixture: `tests/fixtures/registry-status-2.1.316.json`.

## Method

A sampler read every live `<config>/sessions/<pid>.json` of all six local profiles about
once a second for 25 minutes (7,359 samples, every one from 2.1.316), keeping `status` and
`statusUpdatedAt`. One dedicated session was then driven through each situation in the
roadmap, with a timestamp written at each input.

## Result per situation

| Situation | Observed `status` | `statusUpdatedAt` | Reading |
|---|---|---|---|
| At rest | `idle` | time the turn ended | idle |
| Prompt sent, model thinking | `busy` within 1 s | prompt time | working |
| Tool call longer than two minutes (a foreground `du` over the home folder, 155 s) | `busy` throughout | **unchanged** for the whole call | working |
| Turn ended while a background shell still runs | `shell` | turn end | idle — the model waits for nothing |
| Esc during the tool call | `idle` within 1 s | interrupt time | idle |
| Permission prompt (Bash command) | `waiting` within 2 s | prompt time | needs you |
| Permission prompt raised by a subagent | `waiting` on the **parent's** file | prompt time | needs you |
| Subagent running in the background after the turn | `idle` | turn end | idle (the child has its own row) |
| `/compact` | `busy` for 11 s, then `idle` | start, then end | working, then idle |
| `/clear` | `idle`; `sessionId` changes, pid stays | clear time | idle, new session |

Across all live sessions on the machine the sampler saw four words: `idle` (6,446), `busy`
(488), `shell` (221), `waiting` (204). No other word appeared.

## Findings

1. **`busy` holds through a long tool call.** The kill condition of S1 does not fire: D1 keeps
   the registry word first.
2. **The word changes at a permission prompt**, to `waiting` — a fourth word the roadmap did
   not list. It is a host-reported "needs you" and is read as such (`source: "host"`), below a
   hook or transcript wait.
3. **`statusUpdatedAt` moves only when the word changes.** It is the turn's start during a
   long `busy`, so D3's "unconfirmed" must not rest on it alone; it rests on the newer of it
   and the transcript time, as D3 already says.
4. **`shell` is a finished turn**, not work: the background shell runs without the model.
5. A foreground `sleep` longer than the Bash timeout is moved to the background by Claude Code
   itself (the word then goes `busy` → `shell` at once), so a long-tool probe needs a real
   command, not a sleep.

## What this does not cover

Codex (no registry file), Claude Desktop sessions, and versions other than 2.1.316. The word
is internal to Claude Code; `runtimeState` treats an unknown word as silence and falls back to
the transcript time, so a renamed word degrades to the old behaviour.
