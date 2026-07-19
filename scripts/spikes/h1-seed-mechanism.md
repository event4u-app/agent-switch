# Spike h1 — session seed mechanism (Phase 0, roadmap: road-to-sessions-panels-delete-handoff)

**Question.** Can `claude` / `codex` start a NEW session seeded with an initial
prompt (the primitive the cross-provider handoff `seed` builds on), and via
which surface?

## Findings (2026-07-17)

### Seed surface — CONFIRMED from `--help` (no runs, no usage)

- **Claude:** `claude [prompt]` positional + `-p/--print` for non-interactive;
  `--resume` / `-c/--continue` / `--fork-session` for resuming. A positional
  prompt (or `-p "<prompt>"`) starts a session with that prompt as the first turn.
- **Codex:** `codex [PROMPT]` positional + `codex exec` for non-interactive.
  Also native `codex resume` / `fork` / `archive` / `delete` / `unarchive`.

### Empirical headless run — BLOCKED (environment limitation, not a code issue)

Ran, with the user's this-turn authorization:
`agent-switch run MatneX -p "Reply with exactly: OK"` (CLAUDE_CONFIG_DIR =
the MatneX profile config).

Result: **`Not logged in · Please run /login`** — no session file was created.
An isolated profile CONFIG dir does **not** carry headless OAuth credentials for
`-p` print mode; login state is established interactively. (No session file was
created, so there was nothing to clean up.)

## Consequence for Phase 3 (design-confirming)

The handoff **seed must run INTERACTIVELY** — inside the embedded pty on the
target profile (exactly how `run` / `takeover` already resume sessions, where
the user is logged in), **never** as a headless `-p` call. This is precisely the
roadmap's Phase-3 design ("Seed opens EmbeddedTerminal on the target run").

Therefore:
- The seed **surface** is confirmed; the **mechanism** is the proven interactive
  pty path (the entire session-listing / takeover / telemetry feature set relies
  on interactive runs creating `<config>/projects/<cwd>/<id>.jsonl` — extensively
  tested). No headless spike is required to build Phase 3 on this path.
- A headless seed is ruled OUT (auth is interactive).

## Not run

- **h2 translation-falsification** (re-emit one format into the other): deferred,
  needs authed runs; not required — the metadata-bridge default does not translate.
