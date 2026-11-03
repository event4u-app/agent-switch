# ADR-006 — v3 module split: engine, host, app, hook relay

- **Status:** Proposed (2026-11-02) — draft from `road-to-agent-switch-v3-central`
  Phase 0. Open input: Decision E1 (engine runtime), owner.
- **Evidence:** `agents/evidence/v3-phase0-spikes-2026-11.md` (S3, S4, S5,
  T-S3), `agents/evidence/hook-event-cost-2026-11.md`.

## Context

Today agent-switch is one Node CLI (`src/`) with a background daemon mode, a
Tauri GUI (`gui/`) that runs the CLI with `--json` and parses its output, and
hooks that start the full CLI once per event (`__hook-event`, p95 56 ms). v3
adds sessions that keep running when the window closes, an event store, and a
GUI that needs pushed state instead of polled JSON. One maintainer, one repo,
one CI (Decision E3).

## Decision

Four parts in the one repo, with one rule for dependencies: **everything
depends on the protocol; nothing depends on the app.**

| Part | What it is | Lives in |
|---|---|---|
| **protocol** | Types and message shapes shared by engine and app: requests, events, the session/edge/fact records of ADR-007. No runtime code beyond validators. | `src/protocol/` |
| **engine** | Today's CLI and daemon, plus the event store (M1) and the protocol server on a 0600 Unix socket (named pipe on Windows). The CLI's `--json` output stays as it is (`tests/cli-snapshot.test.ts`). | `src/` |
| **host** | Starts and keeps hosted sessions: own tmux server `-L as-<uid>` with `-f /dev/null`, one window per session, one linked view session per viewer, argv-only starts, the input lease. A module of the engine, behind an interface, so a native host can replace tmux later. | `src/host/` |
| **app** | The Tauri GUI. Talks to the engine over the protocol socket; falls back to `--json` calls for anything not yet on the protocol. Type-only imports from `src/protocol/`. | `gui/` |
| **hook relay** (`as-hook`) | What a hook process runs: read stdin, add the hook env, send one `hook` line to the engine socket, run the CLI's `__hook-event` with the same stdin when the engine does not answer "stored". | `relay/` (Rust, no dependencies) — see Amendment 1 |

- Requests carry an idempotency key; events carry `(producer, seq)` so the store
  can dedupe and order per producer.
- Hosted sessions get AS hooks through `--settings` (S3: added to, never
  replacing, the user's own). Children of a hosted session do not inherit them
  (T-S3), so lineage for children travels through env vars (ADR-007) and through
  the user's own hook install where present.
- **The `as-hook` gate (p95 < 20 ms)** is measured against the 56 ms Node
  baseline. A Bun-compiled CLI already reaches p95 20.4 ms without a separate
  relay (S4). Whether the relay is the compiled engine or a small native binary
  follows from E1; this ADR fixes only its contract (stdin in, one line out,
  file fallback, never blocks, never fails the host session).

## Amendment 1 — the relay is a native binary (2026-11-03, M2)

E1 asked for the acknowledgement point first and the runtime from a measurement.

- **Acknowledgement = durably stored.** The engine answers `{"stored": true}`
  only after the ring line is written and (best effort) the store row
  committed (`src/hook-intake.ts`). Received-but-unwritten is not an
  acknowledgement. An engine that does not answer within 1.5 s gets the event
  through the CLI as well: a slow engine can double an event, it cannot lose
  one.
- **Runtime: native.** `node -e 0` alone costs p95 33 ms on the measuring Mac,
  over the whole 20 ms budget, so no Node relay can meet the gate. The Rust
  relay with the engine reached p95 4.5 ms sequential and 16.4 ms with 50 hooks
  at once, with 0 events lost
  (`agents/evidence/hook-relay-latency-2026-11.md`, all three platforms in CI).
- **Distribution:** one binary per platform on each release;
  `agent-switch hooks relay <file>` puts it at `<root>/bin/as-hook` and moves
  installed hooks to it. Without it, hooks run the CLI as before.

## Consequences

- The GUI stops parsing human output and stops polling for state the engine can
  push. The `--json` CLI stays the public contract for scripts.
- One process owns the store and the socket; a second engine start finds the
  socket and exits, or takes over a stale one.
- Tests: protocol validators get property tests; the host gets the S5 checks as
  integration tests (macOS and Linux CI have tmux; Windows is "ephemeral" until a
  native host exists).

## Alternatives

- **Separate repos for engine and app** — rejected (E3): one maintainer, version
  skew between two release trains.
- **App talks to the store directly** — rejected: two writers, and the app would
  depend on the store layout.
- **Engine as an HTTP server** — rejected: `NON-GOALS.md` § No bundled dashboard
  server; a 0600 socket has no port.
