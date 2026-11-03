# ADR-009 — v3.1 bridge: one CLI process per chat session, holding the session's input lease

- **Status:** Accepted (2026-11-03) — `road-to-agent-switch-v3-client` Phase 0.
- **Evidence:** `agents/evidence/v31-phase0-spikes-2026-11.md` (C1–C3).

## Context

The chat view drives a session through the unmodified agent binary (no Agent
SDK, see the roadmap's constraints): Claude over `-p` stream-json, Codex over
`codex app-server`. Something has to own that process: start it with the right
account, translate its events into the Agent Switch event model, answer its
approval requests, and make sure nothing else types into the same session.

Options:

1. **`agent-switch bridge <session>`** — a CLI process with a line protocol on
   stdin/stdout, spawned by the GUI through the shell scope it already has.
2. **A bridge manager inside the engine** — the engine owns the agent processes;
   the GUI talks to them over the engine socket.

## Decision

Option 1.

- The GUI spawns `agent-switch bridge <session> --json`. The main window's
  capability already allows `agent-switch` with any arguments, so no new Tauri
  capability is added.
- The bridge spawns the agent: Claude with `-p --input-format stream-json
  --output-format stream-json --verbose --include-partial-messages --resume <id>
  --permission-prompt-tool stdio --permission-mode <the session's mode>` (the
  mode is passed every time: `-p` resume does not restore it); Codex with `codex
  app-server` and `thread/resume`.
- **stdout**: one JSON event per line, AS event model v1 (Phase 1).
  **stdin**: one JSON command per line — `send`, `approve`, `deny`, `answer`,
  `interrupt`, `set-model`, `set-mode`, `close`.
- **Write lock**: on start the bridge takes the session's input lease
  (`src/host/lease.ts`, holder `bridge:<pid>`), renews it while it runs and
  releases it on exit. A second bridge, or typing into the hosted terminal, meets
  `LeaseHeld` and is refused. A session running in the user's own terminal is
  never bridged — the GUI shows it read-only.
- Approvals stay real: the bridge never passes `bypassPermissions` or `--bare`.
  Every `can_use_tool` request becomes an `approval.requested` event and waits
  for an answer.

## Consequences

- An engine restart does not end a chat; the bridge lives as long as its window.
- Closing the window ends the bridge and the agent process; the session stays on
  disk and resumes like any other.
- The bridge is a CLI command, so it is tested like one (fixture agent processes),
  and it works on Node 20 — it needs no event store.

## Alternatives rejected

- **In-engine manager:** an engine restart (e.g. `engine restart` from the
  banner) would kill every open chat, and the engine needs Node 22.13 for its
  store while the bridge does not.
- **`--permission-prompt-tool` with an MCP server:** a second process for the
  same answer the stdio control protocol gives directly (C2).
