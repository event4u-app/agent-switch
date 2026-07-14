# Phase-0 spikes — road-to-session-handoff

Four falsification gates, each self-contained, each with an explicit PASS/FAIL and
an honest-null path. Run on your primary POSIX machine first (macOS or Linux).
See `agents/roadmaps/road-to-session-handoff.md` (Phase 0) for the roadmap
consequence of each gate.

## Order & invocation

```bash
./g04-process-env-recovery.sh                      # free, no accounts needed — run first
./g01-claude-move-handoff.sh  privat work          # 2 short claude turns
./g02-claude-fork-handoff.sh  privat work          # 3 short claude turns
./g03-codex-rollout-transfer.sh <src-codex-home> <tgt-codex-home>   # 2-3 codex exec turns
```

Profile layout: agent-switch v2 — `~/.agent-switch/claude/<name>/config`
(honours `AGENT_SWITCH_HOME`). For g03 pass explicit codex home dirs, e.g.
`~/.agent-switch/codex/<name>/config`, or `~/.codex` as source if you only have
the default install — the script only ever MOVES the one throwaway rollout it
created itself.

Prereqs: `jq`, `node`, both agent-switch Claude profiles logged in; for g03 two
authenticated `CODEX_HOME` dirs.

## What each script deliberately does NOT do

- No parsing of transcript/rollout content — files are opaque blobs (format is
  documented as internal and version-unstable). Only supported script interfaces
  are used: `claude -p --output-format json` (session_id, result) and `codex exec`.
- No touching of real projects — every session is created in a fresh mktemp cwd.
- No writes outside the two profile dirs you name on the command line.

## Result matrix → roadmap consequence

| Gate | PASS means | FAIL/null means |
|---|---|---|
| G0.1 | move-based `takeover` is the core primitive, Phase 2 holds | fall back to shared-history-only (M1) + spawn |
| G0.2 | `--keep-source` variant is safe via fork (M3) | takeover is move-only, no keep-source |
| G0.3 (a) | full Codex parity incl. transfer | — |
| G0.3 (b) | Codex takeover needs an index-rebuild step | — |
| G0.3 (c) | Codex ships list+spawn only; record honest-null with codex version + state-layer inventory | — |
| G0.4 | daemon can map live pids → profile+cwd without root | GUI session list limited to "recent" (mtime-based), no live detection |

## Version pinning

Record in the spike log: `claude --version`, `codex --version`, OS, and for g03
the presence of `session_index.jsonl` / `state_5.sqlite`. G0.1/G0.2 results are
only valid per Claude Code version — the roadmap's canary check (risk #1) pins
the observed header shape before building on them.

## Results log

| Gate | Date | Machine | Versions | Result |
|---|---|---|---|---|
| G0.4 | 2026-07-14 | macOS 15.7.3 | claude 2.1.209, codex 0.134.0 | PASS (env via `ps -wwE` for node children; cwd via `lsof`). Original probe against `sleep` was a false negative — Apple platform binaries block env readout; node processes (claude/codex) do not. |
| G0.1 | — | — | — | open (needs two logged-in Claude profiles) |
| G0.2 | — | — | — | open (needs two logged-in Claude profiles) |
| G0.3 | — | — | — | open (needs two authenticated codex homes) |
