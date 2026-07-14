---
complexity: standard
status: active
---

# Roadmap: Session handoff between profiles (`sessions` + `takeover`)

> Switching the *account* under a coding-agent session must not cost the
> conversation: move a session's transcript from profile A to profile B and
> resume it there — one CLI command today, one GUI click later. Grounded in the
> profile-switch research dossier (2026-07), local verification on this machine
> (2026-07-14), and a 5-lens council review.

## Goal

1. **`agent-switch sessions`** — inventory of recent (and, where detectable,
   live) Claude Code sessions per profile, human-readable and `--json` (the GUI
   contract, per the "GUI is a pure `--json` client" rule).
2. **`agent-switch takeover <session-id> --to <profile>`** — per-session
   transfer between two Claude profiles: crash-safe copy→verify→delete of the
   transcript (plus its checkpoint subdir when present), then resume on the
   target — in the same terminal when interactive.
3. `--keep-source` variant: copy + `--fork-session` on the target (new session
   id there, original untouched at the source), with cleanup of the transfer
   copy so two profiles never both own a file under the same session id.
4. Later phases: tmux in-place handoff (GUI end state), GUI one-click takeover,
   Codex parity — each gated on its verification spike.

## Context — ground truth

### Claude Code session model (docs / upstream issues, 2026-07)

| Fact | Detail |
|---|---|
| Storage | `<CLAUDE_CONFIG_DIR>/projects/<encoded-cwd>/<session-id>.jsonl`; encoded-cwd = absolute path, non-alphanumerics → `-` |
| Resume | `claude --resume <id>`, `claude -c`, `/resume` picker; `--fork-session` copies history into a NEW session id |
| cwd scoping | resume lookup is hard-filtered to `projects/<encoded-$PWD>/`; copying the jsonl into another config dir's same-encoded dir and resuming there is the documented upstream workaround |
| Format stability | transcript entry format is **internal and version-unstable** — files are opaque blobs; at most the first line may be read, defensively |
| Concurrency | resuming one session id in two places without forking interleaves both into one transcript |
| Permissions | "allow for this session" approvals do NOT survive a fork |

**Structural advantage:** an *account* handoff keeps the cwd constant, so the
encoded project dir is identical in source and target profile. The upstream
cwd-scoping pain does not exist here — handoff degenerates to moving one file
between two `projects/<same-encoded-cwd>/` dirs.

### What this repo already ships (use, don't duplicate)

- `liveSessionPids(configDir)` (`src/api.ts`) — live pid ↔ profile mapping via
  `<config>/sessions/{pid}.json`. **This is the primary live-session primitive**;
  the dossier's process-env scanning is only an *enrichment* (pid → cwd) and
  only needed to map a live pid to its project dir.
- `share on --history` (`src/share.ts`) — the M1 "shared history tree" path,
  shipped, POSIX-only. `takeover` must detect it and skip file ops.
- `migrateLegacyLayout` (`src/profiles.ts`) — the copy→verify→delete precedent
  the transfer follows.
- Command pattern: `cmdX()` + `switch(cmd)` + `usage()` + `VALUE_FLAGS`
  (`src/index.ts`, `src/args.ts`); e2e harness with seeded temp
  `AGENT_SWITCH_HOME` (`tests/cli-e2e.test.ts`).

### Local verification (macOS 15.7.3, claude 2.1.209, codex-cli 0.134.0, 2026-07-14)

- **No logged-in profiles exist on this machine** → spikes G0.1–G0.3 cannot run
  yet; the implementation is therefore structured so all file mechanics are
  testable without accounts, and real-resume verification is contract-gated.
- **G0.4 mechanism verified with a corrected probe:** `ps -wwE` returns the env
  of **node processes** (which `claude` and `codex` both are) for same-user
  processes; it returns nothing for Apple platform binaries (`sleep`, `bash`) —
  the dossier's original g04 script used `sleep` as its test child and produced
  a **false negative**. cwd recovery via `lsof -a -p <pid> -d cwd` works.
- The dossier's spike scripts assumed the v1 profile layout
  (`~/.agent-switch/<name>/config`); the real layout is provider-scoped
  (`~/.agent-switch/claude/<name>/config`). Fixed in `scripts/spikes/`.

### Handoff mechanism inventory (decided)

| # | Mechanism | Verdict |
|---|---|---|
| M1 | Shared history tree (`share on --history`) | shipped; power-user default; `takeover` detects it and skips file ops |
| M2 | Per-session transfer (move) | **the core primitive** — this roadmap, Phase 2 |
| M3 | Copy + `--fork-session` (`--keep-source`) | ships with Phase 2; forced fork prevents same-id divergence |
| M4 | tmux in-place terminal swap | Phase 3, opt-in `run --tmux`, POSIX-only |
| M5 | Spawn-new-terminal (GUI fallback, all OS) | Phase 4 |
| M6 | Credential hot-swap in a live session | **rejected** — corrupts profile isolation / OAuth lineage (see `roadmaps/skipped/`) |

## Dependencies

- [x] `src/api.ts` — `liveSessionPids()` live-session primitive.
- [x] `src/share.ts` — `share on --history` (M1) + manifest discipline.
- [x] `src/profiles.ts` — provider-scoped layout, `configDir()`, copy→verify precedent.
- [x] `src/args.ts` — `VALUE_FLAGS` parsing pattern.
- [x] `tests/cli-e2e.test.ts` — seeded-home e2e harness.

## Phase 0: Verification spikes (falsification gates)

Fixed, repo-tracked spike scripts; each self-contained with explicit PASS/FAIL
and an honest-null path. G0.1–G0.3 need two logged-in Claude profiles (and two
authenticated `CODEX_HOME`s for G0.3) — they gate *later* phases, not Phase 1/2
file mechanics (those are seed-testable; the resume semantics they rely on are
the documented upstream workaround).

- [x] Ship corrected spike scripts under `scripts/spikes/` (provider-scoped
   profile layout; g04 probes a **node** child, not an Apple platform binary;
   README with run order + version-pinning log template). <!-- verify: shellcheck clean (2 documented info-level disables); g04 passes locally ✓ -->
- [x] Run g04 on macOS — env recovery for node children + cwd via lsof.
   <!-- verify: PASS 2026-07-14, macOS 15.7.3 — env via ps -wwE, cwd via lsof; live scan enumerated 26 real claude pids with cwds ✓ -->
- [ ] Run g01 (move handoff) with two logged-in profiles. **Gated: needs two
   logged-in Claude profiles.** Record `claude --version` with the result.
- [ ] Run g02 (copy+fork, keep-source safety) with two logged-in profiles.
   **Gated as g01.**
- [ ] Run g03 (Codex rollout transplant) with two authenticated codex homes.
   Outcome (a)/(b)/(c) decides Phase 5's shape; honest-null is a valid result.
   **Gated: needs two codex logins.**

## Phase 1: `agent-switch sessions` — inventory + `--json`

New module `src/sessions.ts` (pure, unit-testable) + `cmdSessions` in
`src/index.ts`. Claude-only for now (Codex lands in Phase 5).

- [x] `encodeProjectDir(cwd)` — the documented `[^A-Za-z0-9]` → `-` scheme,
   exported and unit-tested (the single place the scheme lives). <!-- verify: tests/sessions.test.ts ✓ -->
- [x] `readSessionHeader(file)` — defensive first-line read (capped at 64 KiB,
   try/catch, returns `{ cwd?, summary? }` or nulls). **The only transcript
   read in the codebase — never more than line 1.** <!-- verify: tests/sessions.test.ts (bad JSON, missing file, >64 KiB line) ✓ -->
- [x] `listSessions(configDir, limit)` — scan `projects/*/[id].jsonl` by mtime;
   rows `{ sessionId, projectDir, cwd, mtimeMs, live }`. <!-- verify: tests/sessions.test.ts ✓ -->
- [x] Live enrichment (POSIX): `pidCwd(pid)` via `/proc/<pid>/cwd` (linux) /
   `lsof -d cwd` (darwin); a session is `live` when its profile has a live pid
   whose cwd encodes to the session's project dir and it is that dir's newest
   transcript. win32: `live` stays false (recent-only), documented. <!-- verify: markLive unit test (injected cwd, own pid) ✓ -->
- [x] `cmdSessions` — `agent-switch sessions [profile] [--recent N] [--json]`,
   grouped human output (`*` = live), flat-array JSON for the GUI; `usage()`
   line; `recent` added to `VALUE_FLAGS`. <!-- verify: cli-e2e "sessions --json" ✓ -->
- [x] Unit tests (`tests/sessions.test.ts`): encoding, capped/defensive header
   read, mtime ordering, live matching against a fake sessions/{pid}.json with
   the test's own pid. <!-- verify: node --test 8/8 ✓ -->
- [x] e2e (`tests/cli-e2e.test.ts`): seeded fake profiles + transcripts →
   `sessions --json` shape; empty-state message. <!-- verify: cli-e2e ✓ -->

## Phase 2: `agent-switch takeover` — per-session transfer (M2/M3)

`agent-switch takeover <session-id> --to <profile> [--from <profile>]
[--keep-source] [--print-only] [--force]`.

- [x] Source resolution: locate `<id>.jsonl` across Claude profiles (or
   `--from`); found in more than one profile → hard error (divergence already
   happened — surface, never guess). <!-- verify: cli-e2e "MULTIPLE profiles" ✓ -->
- [x] Guards, in order: target profile exists; target ≠ source;
   **shared-history detection** (source and target `projects/` resolve to the
   same real path → no file ops, print the resume command only);
   **collision refusal** (target already has `<id>.jsonl` → refuse, always);
   **live-source refusal** (source profile has live sessions → refuse with
   "close it first" unless `--force`). <!-- verify: cli-e2e (collision, live, shared) + unit tests ✓ -->
- [x] Transfer = copy→verify→delete (`migrateLegacyLayout` precedent):
   checkpoint subdir `<id>/` first (when present), transcript last; verify by
   existence + byte size before the source is removed. Transcripts stay opaque
   blobs — moved, never parsed. <!-- verify: transferSession unit tests ✓ -->
- [x] Resume: print the exact command
   (`agent-switch run <target> -- --resume <id>`); when stdin is a TTY and not
   `--print-only`, exec into it directly (the takeover becomes the new session
   in this terminal). Index files (`sessions-index.json`, `history.jsonl`) are
   **never written** — resume-by-id is the supported path; picker visibility is
   informational (g01 measures it). <!-- verify: cli-e2e resume-command assertion ✓ -->
- [x] `--keep-source` (M3): copy instead of move, resume with
   `--fork-session`, and after the interactive session exits delete the
   transfer copy under the ORIGINAL id (the g02 divergence trap).
   `--keep-source --print-only` is refused (cleanup needs the interactive
   step until the GUI orchestrates it via `--json`). <!-- verify: cleanupForkVehicle unit test + cli-e2e refusal ✓ -->
- [x] `to`/`from` added to `VALUE_FLAGS`; `usage()` lines; permissions-reset
   note in the fork path's output (upstream behavior). <!-- verify: value-flag e2e paths exercise --to/--from ✓ -->
- [x] Unit tests: plan construction, each guard, fork-cleanup planning.
   <!-- verify: tests/sessions.test.ts 8/8 ✓ -->
- [x] e2e: seeded transcript moves between seeded profiles (`--print-only`);
   collision refused; live-source refused (fake `sessions/<testpid>.json`);
   `--force` overrides; keep-source+print-only refused; shared-history
   (symlinked `projects/`) prints resume command without moving files.
   <!-- verify: cli-e2e 6 new cases ✓ -->
- [x] Contract test (gated `AGENT_SWITCH_CONTRACT_TESTS=1`, needs two logged-in
   profiles): end-to-end canary — create session under A, `takeover --to` B,
   resume returns the canary (the g01 flow through the real CLI).
   <!-- verify: tests/integration.test.ts added; compiles + skips cleanly ungated; RUN is gated on two logged-in profiles (same gate as Phase 0.3) -->

## Phase 3: `run --tmux` + in-place handoff (M4, POSIX, opt-in)

- [x] `agent-switch run <profile> --tmux` wraps the session in an
   agent-switch-managed tmux session (name `asw-<provider>-<profile>`, recorded
   in `<ROOT>/tmux-sessions.json`). `src/tmux.ts` + `cmdRun`. <!-- verify: tmux.test.ts + live new-session probe (tmux 3.7b) ✓ -->
- [x] `takeover --in-place`: only inside a managed pane (recorded-name check) —
   `respawn-pane -k` replaces the pane's process with the target profile's env +
   `claude --resume <id>` (the pane persists). Chosen over send-keys/wait because
   send-keys /exit tears the pane down when the CLI is the pane's own command;
   `-k` reliably kills-and-replaces. **Never touches a non-managed session.**
   <!-- verify: tmux.test.ts (builders + managed-only detection) + live respawn-pane probe ✓ -->
- [x] Fallback (no managed pane / non-macOS): M5 spawn-new-terminal
   (`osascript` Terminal.app on macOS, print elsewhere) with the resume command
   and the "close the old window" hint. <!-- verify: cli-e2e in-place refusal combos; spawnNewTerminal path -->

**Note:** g01's live handoff canary (Phase 0) still gates full end-to-end proof
with a real Claude session; the tmux orchestration mechanics are verified here.

## Phase 4: GUI — profile → session list → one-click takeover

Gated on Phases 1–2 (CLI is the engine; GUI stays a `--json` client).

- [x] `gui/src/ipc.ts`: `listSessions()` (→ `sessions --recent N --json`) +
   `takeoverArgs()` (pure builder). Takeover runs **interactively in the
   embedded terminal**, so the CLI's own keep-source fork-cleanup applies — the
   non-interactive `takeover --json` fork-orchestration is deferred as a
   refinement (noted; the interactive path covers the case today).
   <!-- verify: ipc.test (listSessions/takeoverArgs) ✓ -->
- [x] `SessionsView` (header history icon): Claude sessions list (profile, live
   badge, age, summary) with a per-session **target-profile picker + fork
   toggle + Take over** button. <!-- verify: App.test — take over opens the embedded terminal with the right args ✓ -->
- [x] Execution: the GUI runs `takeover` in the embedded terminal, which
   delegates to the CLI (managed-tmux → `--in-place`; otherwise M5 spawn).

## Phase 5: Codex parity — per the G0.3 outcome

- [ ] G0.3 outcome (a): extend `sessions`/`takeover` to codex rollout files
   (`$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl`, date-partitioned move).
   Outcome (b): same + index-reconciliation step. Outcome (c): `sessions` lists
   codex sessions; takeover degrades to spawn-in-target (`codex resume --all`);
   the null is recorded here with codex version + state-layer inventory.
- [ ] Gemini and further providers only after a per-provider ground-truth
   table exists (per the multi-provider roadmap's discipline).

## Risks & rules

1. **Format instability is the #1 risk.** Transcripts are whole-file opaque
   blobs; only `readSessionHeader` may look inside (line 1, capped, try/catch,
   filename-derived fallback). A canary check lives in the contract test —
   drift fails loud, per Claude Code version.
2. **Same-id divergence is forbidden by construction** — move-by-default,
   forced fork on `--keep-source`, transfer-copy cleanup, multi-profile hit =
   hard error, collision = hard refusal.
3. **Data safety:** copy→verify→delete only; no step ever leaves zero copies of
   a transcript; worst crash case is two copies + a printed warning, never none.
4. **Never touch non-managed terminals** (Phase 3 is pane-scoped, opt-in).
5. **Permissions reset on fork** — surfaced in command output and the GUI
   confirm dialog, not buried in docs.
6. **Policy framing:** takeover is **user-initiated only**. No daemon-automatic
   takeover-on-threshold; anything automatic stays behind the existing opt-in
   autoswitch flag, off by default (same ToS posture as the multi-provider
   roadmap).
7. **Linux XDG state dir** (`~/.local/state/claude/`) is shared across profiles
   — re-verify after takeover that nothing session-relevant leaks through it
   (doctor note, Phase 3 timeframe).

## Success criteria

- CLI handoff: ≤ 1 command to a resumed session on the target profile, zero
  manual file ops, macOS/Linux/Windows (Windows without live detection).
- GUI handoff (Phase 4): ≤ 2 clicks; zero terminal interaction (tmux path) or
  exactly one window close (fallback).
- Zero transcript parsing beyond the guarded, capped header line.
- Every spike outcome recorded — including nulls — with tool versions.

## Council notes

**Method (2026-07-14):** the external multi-model council (anthropic + openai,
as used for the multi-provider roadmap) was unavailable this session — the org
hit its monthly spend limit mid-review and no repo-local council config exists —
so the review ran as an inline 5-lens panel (architecture, correctness, safety,
UX/scope, testing) over the dossier + the real codebase. Key verdicts:

- **Architecture:** the dossier's process-env scanning duplicated
  `liveSessionPids()`; demoted to cwd-enrichment. New logic lives in
  `src/sessions.ts` (pure) + `cmdSessions`/`cmdTakeover` (thin), per the
  existing command pattern; GUI consumes `--json` only.
- **Correctness:** the dossier's spike scripts used the pre-v2 profile layout —
  fixed before anything runs them; g04's `sleep` child was a false negative on
  macOS (platform-binary env is blocked; node children readable). Resume
  semantics remain upstream-documented-but-locally-unverified until G0.1/G0.2
  run → contract-gated, never assumed in unit/e2e tests.
- **Safety:** raw `rename` replaced with copy→verify→delete; live-source and
  collision guards are hard; `sessions-index.json` is never written (format not
  ours); shared-history mode short-circuits file ops.
- **UX/scope:** interactive picker and `asw!!` sugar deferred (GUI covers the
  pick-from-list case); `--keep-source --print-only` refused rather than
  leaving a divergence trap dangling.
- **Testing:** all file mechanics seed-testable without accounts; the only
  account-dependent assertions live in the contract test and the spikes.
