# ADR-010 — the timeline reader is a third sanctioned transcript reader, versioned by fixture

- **Status:** Accepted (2026-11-03) — `road-to-agent-switch-v3-client` Phase 0.
- **Extends:** ADR-002 (session preview as a second sanctioned reader).

## Context

The chat view shows a session's history before the bridge is started, and the
read-only timeline shows sessions running elsewhere. Claude keeps that history
only in its transcript JSONL, whose layout is undocumented and changes between
Claude Code versions. ADR-002 sanctioned one bounded body reader, the preview of
the first turns. A timeline needs the whole conversation, tool calls included.

## Decision

`src/timeline/claude.ts` is the third sanctioned transcript reader:

- **Local and read-only.** It reads the user's own transcript on this machine
  and never writes it, the session index or any host file. Nothing it reads
  leaves the machine.
- **Into the AS event model, never into the UI directly.** Each transcript line
  becomes zero or more AS events (`turn`, `message`, `tool.*`, `subagent.*`,
  `error`). A line type the reader does not know becomes an `unknown` event with
  the line's type — it is passed through, never dropped.
- **Versioned by fixture.** `tests/fixtures/timeline/claude-<version>.jsonl` holds
  a recorded transcript per Claude Code version the reader supports. The reader
  checks the transcript's `version` field: a version newer than the newest
  fixture still renders, with a notice and "Open in terminal" as the way out.
- **Bounded.** Pages of 200 lines from the end; the virtualised list asks for
  more as the user scrolls up.

Codex needs no reader of its own: `codex app-server` `thread/read` returns the
history (spike C3).

## Consequences

- A Claude Code update can break the reader without breaking the window: unknown
  lines show as unknown, and the version notice says why.
- Every supported version costs one fixture and one test run.
