# ADR-001 — Cross-provider session handoff is a lossy metadata bridge, not a resume

- **Status:** Accepted (2026-07-17)
- **Context roadmap:** `agents/roadmaps/archive/road-to-sessions-panels-delete-handoff.md` (Phase 3, archived)

## Context

Users want to hand a session off from one agent to another (e.g. Claude → Codex).
The intuitive expectation is a *resume*: the target agent picks up the exact
conversation. We investigated whether that is possible.

Evidence:

- **Transcript formats are mutually incompatible.** Claude stores a session as
  `<config>/projects/<encoded-cwd>/<id>.jsonl` with assistant/tool-use lines;
  Codex stores date-partitioned `rollout-*.jsonl[.zst]` with `event_msg` /
  `token_count` records (`src/telemetry.ts:20-29`). Neither schema is a superset
  of the other, and `tool_use`/`tool_result` turns have no portable mapping.
- **Neither CLI imports the other's format.** `claude --help` / `codex --help`
  expose no cross-format import/replay command (spike h2 / import re-check,
  `scripts/spikes/h2-translation-falsification.md`). Codex has native session
  management (`resume`/`fork`/`archive`/`delete`/`unarchive`) but only for its
  own rollouts.
- **Auth is interactive.** A headless `claude -p` run in an isolated profile
  config returns "Not logged in" (spike h1, `scripts/spikes/h1-seed-mechanism.md`),
  so any seed of a target session must run interactively in the embedded pty.

## Decision

Cross-provider handoff is implemented as a **lossy metadata bridge**, never a
resume or a transcript translation:

1. **`handoff extract`** composes a small, human-readable markdown *brief* from
   the already-sanctioned readers only — `readSessionHeader` (cwd + summary),
   telemetry (model + context %), and filesystem git facts. It opens **no new
   transcript reader**; the transcript-egress boundary (exactly two
   content-minimizing readers) is unchanged.
2. **`handoff seed`** opens the *target* agent interactively in the embedded pty
   with a prompt that references the brief **by path** (content never enters
   argv or shell history). The brief file is mode `0600`, cleaned up after a
   successful seed, and TTL-swept when orphaned.
3. The source session is **never** moved, deleted, or translated — the handoff
   is additive (two sessions result).

## Consequences

- The handoff is honestly *lossy*: prior conversation, tool state, and
  checkpoints do **not** transfer. The UI states this plainly.
- A Codex source is metadata-thin (no cwd/summary/model derivable without
  reading the rollout body, which we never do) — its brief carries an explicit
  honesty note rather than looking empty.
- No new cross-vendor content egress is introduced. A future
  transcript-**content** tier (`--include-transcript`) remains **deferred** and,
  if ever built, must be opt-in per act, a single named reader module, bounded,
  human review+redact gated, and vendor-named in its confirmation.

## Alternatives considered

- **Lossless resume** — infeasible (format + tool-call incompatibility, no import
  path). Rejected.
- **Transcript translation** (parse one format → normalize → re-emit the other) —
  fragile, irreducible `tool_use`/`tool_result` loss; recorded as deferred in the
  roadmap, not adopted.
