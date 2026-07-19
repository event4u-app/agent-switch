# Spike h2 — translation falsification + import re-check (Phase 0)

**Question.** Is a LOSSLESS cross-provider resume genuinely infeasible, or can a
transcript be translated from one agent's format into the other's and resumed?
And does either CLI expose a native cross-format import that would make the
handoff bridge unnecessary?

## Method

No model turns were sent — no account usage was consumed. Probes were structural
only, in throwaway `CODEX_HOME` dirs (bogus UUID, hand-authored rollout files).

## Findings (2026-07-18)

### Import-path re-check — NO native cross-format import (confirmed)

`claude --help` / `codex --help` expose no export / import / replay / transcript
command that ingests the other agent's format. Codex has native session
management (`resume` / `fork` / `archive` / `delete` / `unarchive`) but strictly
over its OWN rollouts. → the bridge is not made redundant by a native command.

### `codex resume` is TUI-only — no scriptable load path

`codex resume <id>` with a non-terminal stdin errors immediately:
`Error: stdin is not a terminal`. Codex resume is an interactive TUI; there is
no headless "load this session and report" surface. A translated file therefore
cannot even be programmatically fed to codex to "resume".

### Hand-authored rollout files are not recognized as sessions

Placing a file (Claude-shaped OR codex-shaped) at a valid codex rollout path
(`sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`) in a throwaway home and running
the non-interactive `codex archive <uuid>` did NOT treat it as an archivable
session (`Error: failed to archive session`). Codex session management is driven
by its own internal state/index layer, not by portable rollout files you can
hand-author and drop in. So "translate Claude → write a codex rollout → resume"
does not work by construction, independent of content fidelity.

### Schema incompatibility (already documented, unchanged)

Claude lines are `{type: user|assistant, message:{role,content[]}}`; codex lines
are `{type: session_meta|event_msg|…, payload:{…}}` (`src/telemetry.ts:20-29`).
`tool_use`/`tool_result` turns have no portable mapping between the two.

## Conclusion

"Lossless cross-provider resume is infeasible" is upgraded from assertion to
**evidence-backed**: no import path, resume is unscriptable TUI, hand-placed
translated files are not recognized as sessions, and the schemas + tool-call
semantics do not map. A transcript-TRANSLATION resume remains a **deferred,
fragile** alternative (it would need to drive the interactive TUI and reconstruct
codex's internal session state, on top of a lossy schema remap) — NOT adopted.
The shipped metadata bridge (ADR-001) does not translate, so nothing here blocks it.

## Caveat (honesty)

The exact `codex archive` recognition semantics (found-but-failed vs not-found)
were not fully pinned down — the conclusion rests on the resume-is-TUI-only +
no-import-path + schema-incompatibility evidence, which is sufficient and
independent of that ambiguity.
