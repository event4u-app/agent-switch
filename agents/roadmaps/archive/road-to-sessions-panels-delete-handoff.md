---
complexity: structural
execution:
  mode: manual
---

# Roadmap: agent-switch sessions — panels, delete, and cross-agent handoff

> Make the Sessions surface a first-class multi-provider panel, add a
> safety-gated per-session delete for Claude and Codex, and add an honest,
> human-gated, lossy cross-agent handoff bridge — foundation-first, with every
> blocking review mitigation wired in as an explicit step or acceptance criterion.

## Goal

Ship three capabilities on top of the existing session primitives **without
widening the transcript-egress boundary** except through explicit, per-act,
human-gated steps:

1. A backend `sessions rm` / `sessions restore` for both providers with
   mis-target-impossibility and a hard live-guard.
2. A GUI Sessions view with main-page-style provider tabs, per-provider grouped
   lists, and delete-with-confirm + undo.
3. A cross-provider handoff that seeds a **new** target session from a
   human-reviewed context brief (metadata-only by default; transcript-content
   tier deferred as experimental).

## Context

- TypeScript CLI plus a Tauri/React GUI under `gui/`. A `tests/` dir +
  `tsconfig.test.json` are the test harness.
- **Session storage (verified):** Claude session = one transcript
  `<config>/projects/<encoded-cwd>/<id>.jsonl` plus an OPTIONAL `<id>/`
  checkpoint sibling dir (`src/sessions.ts:206-213`). Codex session = one
  date-partitioned rollout `<config>/sessions/YYYY/MM/DD/rollout-<ISO>-<uuid>.jsonl[.zst]`,
  no project dir, no checkpoint (`src/sessions.ts:296-319`).
- **Privacy boundary (verified):** exactly TWO content readers exist —
  `readSessionHeader` (first line, 64 KiB cap, cwd + summary only;
  `src/sessions.ts:39-75`) and `src/telemetry.ts` (tail 256 KiB, token/model
  counts only, own-session). Transfer/delete never read the blob (byte-size
  verify only; `src/sessions.ts:243-244`). The only pre-existing content egress
  to the GUI is `SessionRow.summary` over the `--json` contract
  (`src/index.ts:770-793`).
- **Reusable primitives (verified):** `locateSession` / `locateCodexSession`
  scan profiles with zero/multiple-hit divergence guards; `liveSessionPids`
  gives PROFILE-granular liveness (`src/api.ts:93-119`); `turnInFlight` +
  `IDLE_GUARD_MS` drive the compact idle-guard; `cleanupForkVehicle` is the
  current jsonl+checkpoint delete shape (`src/sessions.ts:290-294`).
- **Constraint (verified):** top-level `rm` is already `cmdRemove` = whole-PROFILE
  deletion (`src/index.ts:1514`). A session-scoped delete MUST be a `sessions`
  subcommand, never a new top-level verb.
- **Constraint (verified):** session ids flow raw from positional args into fs
  paths — `parseArgs` applies NO id validation, and `locateSession` joins
  `${id}.jsonl` / `${id}` directly. A recursive `fs.rmSync` on an unvalidated id
  is arbitrary directory deletion. Delete is the first feature that turns this
  latent traversal into direct destruction — id-validation is a Phase-1
  precondition, not a nicety.
- **Feasibility stance (adopted):** a LOSSLESS cross-provider resume is
  infeasible (mutually incompatible transcript schemas — Claude assistant lines
  vs Codex `event_msg`/`token_count` — plus non-portable `tool_use`/`tool_result`
  turns; neither CLI documents an import path). Framed as "lossless resume
  infeasible; a lossy metadata bridge is the pragmatic default", NOT "cross-provider
  handoff is impossible". A translation bridge is recorded as deferred, not dismissed.

## Phase 0 — Feasibility spikes (gate Phase 3 only; do NOT gate Phase 1/2)

Two blocking unknowns underpin the handoff bridge; cheap to probe and green
before any handoff code. Phases 1 and 2 do not depend on them.

> **Phase-0 findings (2026-07-17, from `--help` only — no session runs, no usage
> consumed):** Claude exposes a positional prompt + `-p/--print` and
> `--resume`/`--continue`/`--fork-session`; it has **no** native session-delete
> command (Claude sessions stay plain files → manual delete). Codex has **native
> session management**: `codex delete <id|name>` (permanent), `codex archive` /
> `unarchive` (reversible), `codex resume`, `codex fork`. Verified in a throwaway
> `CODEX_HOME`: `codex delete`/`archive` are offline, non-interactive, and
> `CODEX_HOME`-scoped (bogus id → "No … session found"), **but exit 0 even on
> not-found** (detect outcome from output, not exit code) and they initialize
> Codex state DBs in the home on first touch. This moved the Codex delete design
> to the native commands (see Phase 1) and the seed-mechanism surface is known
> for Claude (positional/`-p`) — but a REAL authed run to confirm a seeded
> session is still required for Phase 3.

- [x] **Step 1:** Spike the seed mechanism — RAN (user-authorized). Surface
      confirmed from `--help` (Claude positional/`-p`, Codex positional/`exec`).
      A headless `-p` run in an isolated profile config returned "Not logged in"
      (auth is interactive, not headless) → the Phase-3 seed must run in the
      embedded pty (the proven `run`/`takeover` path), never headless. Finding
      recorded; Phase-3 seed design confirmed.
      _Files:_ `scripts/spikes/h1-seed-mechanism.md`.
- [x] **Step 2:** Spike translation-falsification — RAN (user-authorized, no
      model turns / no usage). Evidence: no native cross-format import; `codex
      resume` is TUI-only (`stdin is not a terminal`) so a translated file can't
      be fed headlessly; hand-placed rollout files aren't recognized as sessions
      (codex is index/state-driven); schemas + tool-call turns don't map. →
      "lossless resume infeasible" upgraded from assertion to evidence-backed;
      translation-bridge stays deferred/fragile. Shipped metadata bridge unaffected.
      _Files:_ `scripts/spikes/h2-translation-falsification.md`.
- [x] **Step 3:** Import-path re-check — DONE via `claude --help` / `codex --help`.
      No native cross-format import exists; but Codex DOES natively manage its own
      sessions (`delete`/`archive`/`resume`/`fork`), which the code-only council
      missed — adopted for the Phase-1 Codex path.
      _Files:_ `scripts/spikes/h2-translation-falsification.md`.

## Phase 1 — Backend session delete for Claude + Codex (CLI + primitives + tests)

Delete is irreversible and destructive — nail safety at the primitive/CLI layer
before any UI touches it. Folds all four blocking data-loss mitigations
(id validation, no-force-over-live, codex freshness guard, TOCTOU re-check) plus
checkpoint-first ordering and a trash-default undo.

- [x] **Step 1:** `assertValidSessionId(id)` — strict canonical-UUID pattern;
      reject any id containing `/`, `\`, or `..`; throw before any fs access.
      Wired as the FIRST action on the `sessions rm`/`restore` path.
      _Files:_ `src/sessions.ts`, `src/args.ts`. _Verify:_ unit test — `../../etc/passwd`,
      `a/b`, `..`, empty rejected; a real UUID passes; `tsc -p tsconfig.test.json --noEmit` clean.
- [x] **Step 2:** Realpath-prefix assertion after locate — assert the resolved
      jsonl and checkpointDir resolve INSIDE `projects/` (Claude) / `configDir`
      (Codex) via `fs.realpathSync` prefix check; refuse otherwise. Defense-in-depth.
      _Files:_ `src/sessions.ts`. _Verify:_ unit test — a symlinked transcript pointing
      outside the profile tree is refused.
- [x] **Step 3:** Delete primitives, provider-split.
      **Claude** (no native command — files): `deleteSession(loc, {purge})` with
      ordering REVERSED from `cleanupForkVehicle` — checkpoint dir FIRST, transcript
      LAST, so a crash leaves a locatable, resumable session. Default = TRASH-MOVE
      (`fs.renameSync` into `<config>/.agent-switch-trash/<ts>-<id>/` + manifest;
      cross-device → copy→verify→delete); `purge:true` does the true `fs.rmSync`.
      Best-effort legs + residue report.
      **Codex** (native, adopted Phase-0): resolve the owning profile with
      `locateCodexSession` (read-only, for the --from scan), then spawn the native
      command in that profile's `CODEX_HOME`: trash → `codex archive <id>`, purge →
      `codex delete <id>`. Parse OUTPUT for success ("No … found" = not-found;
      exit code is 0 either way). Codex restore = `codex unarchive <id>`. Do NOT
      manually `fs.rm` codex rollouts (Codex owns `.zst`/indexes/state).
      _Files:_ `src/sessions.ts`, `src/index.ts`. _Verify:_ Claude unit tests —
      trash relocates jsonl + checkpoint + manifest; purge removes both; mid-leg
      failure reports residue; no-checkpoint case succeeds. Codex — command builder
      emits `CODEX_HOME=<cfg> codex archive|delete|unarchive <id>` (assert args +
      env; spawn mocked); not-found output is surfaced as an error.
- [x] **Step 4:** Claude `restoreSession(trashId)` + a bounded file-trash sweep
      (age/size cap, ~7 days) run opportunistically on the delete path. Codex
      restore is the native `codex unarchive <id>` (no file-trash for codex).
      _Files:_ `src/sessions.ts`. _Verify:_ unit test — Claude restore round-trips;
      sweep drops entries older than the cap, keeps fresh; codex restore builds the
      `unarchive` command.
- [x] **Step 5:** `sessions rm <id>` + `sessions restore <trashId>` INSIDE
      `cmdSessions` (branch on `positional[0]==="rm"`/`"restore"`). Resolution
      reuses the takeover pattern: `--from` scans one profile, else all provider
      profiles; zero hits → die "not found"; MULTIPLE hits → die "pick --from"
      (never guess). Run `sharedHistory` first; a shared tree requires an extra
      acknowledgment (deletion removes it for ALL sharing profiles).
      _Files:_ `src/index.ts`. _Verify:_ build; same-id-in-two-profiles fixture
      refused without `--from`; shared-history fixture forces the extra ack.
- [x] **Step 6:** Live-guard (blocking mitigations). Claude: re-run
      `liveSessionPids` on the resolved SOURCE profile AT EXEC TIME (never trust a
      `live` flag from IPC); ANY live pid → REFUSE, and `--force` MUST NOT override
      for delete. Codex: no pid detection — refuse when rollout mtime is within a
      freshness window (~60s) unless an explicit typed-id acknowledgment is given;
      `--force` documented inert for codex; never use `turnInFlight` for codex
      (Claude-transcript-shaped). Require `--yes` non-interactive; `--json` emits a
      structured result.
      _Files:_ `src/index.ts`, `src/api.ts`, `src/telemetry.ts`. _Verify:_ faked live
      pid → Claude delete refused AND `--force` still refuses; codex delete inside
      freshness window refused without typed ack; re-resolve at exec (mutate fixture
      between list and rm).
- [x] **Step 7:** Dispatch integrity — `rm`/`restore` handled only inside
      `cmdSessions`; top-level `case "remove"/"rm"` (`src/index.ts:1514`) stays
      profile-removal, untouched.
      _Files:_ `src/index.ts`. _Verify:_ `agent-switch rm <profile>` still
      profile-removes; `agent-switch sessions rm <id>` session-deletes; both tested.
- [x] **Step 8:** CLI test suite for delete/restore covering the guards +
      content-unavailable honesty (codex + `.zst` + oversized-header rows carry
      cwd/summary=null; the confirmation says "no readable content" and leans on
      id/filename/size/mtime, never presents an empty summary as contentless).
      _Files:_ `tests/`, `tsconfig.test.json`. _Verify:_ `npm test` green;
      `tsc -p tsconfig.test.json --noEmit` clean.

## Phase 2 — GUI multi-provider Sessions view + delete-with-confirm (ipc + view + tests)

Surface both providers and the delete affordance. Lifts the proven main-page
provider-tab machinery into `SessionsView`; delete via a non-terminal IPC path
with optimistic UI + undo. The GUI live badge is advisory display only — the CLI
re-check is the real gate.

- [x] **Step 1:** Teach `ipc.listSessions` a provider param; fetch per ENABLED
      provider and concatenate. Each fetch independent (catch→`[]` per provider,
      never a `Promise.all` reject that blanks the view). Keep `--recent 20`.
      _Files:_ `gui/src/ipc.ts`. _Verify:_ gui vitest — `listSessions(profile,20,'codex')`
      builds `sessions <profile> --recent 20 --provider codex --json`; a throwing
      codex fetch yields `[]` while claude rows still render.
- [x] **Step 2:** Pure builder `deleteSessionArgs(provider,id,from,{purge})` +
      `deleteSession()`/`restoreSession()` via `runCli` (NOT `EmbeddedTerminal` —
      delete is non-interactive and its result must be captured). Args carry ONLY
      id/provider/from(/`--purge`)/`--yes` — never a `live` flag (CLI re-checks).
      _Files:_ `gui/src/ipc.ts`. _Verify:_ gui vitest asserts args verbatim:
      `sessions rm <id> --provider claude --from <profile> --yes`; restore builds
      `sessions restore <trashId>`.
- [x] **Step 3:** Redesign `SessionsView` to reuse the main page's provider-tab
      machinery (`enabledIds`, `groupByProvider`, `role='tab'` buttons, count
      badges) with per-provider grouped lists + empty states. Hide antigravity
      (no session backend). Codex rows render an explicit "liveness unknown"
      caption; on win32, Claude rows without a live signal likewise show it rather
      than a reassuring idle badge.
      _Files:_ `gui/src/App.tsx`, `gui/src/transforms.ts`. _Verify:_ gui vitest —
      Codex tab shows codex rows; Claude tab shows claude rows; antigravity absent;
      a codex row shows the liveness caveat.
- [x] **Step 4:** Per-row Delete — trash icon flips the row IN PLACE into an
      inline confirm strip echoing provider / profile / decoded cwd / short id /
      filename / byte size / mtime / has-checkpoint. On a LIVE row Delete is
      hard-disabled ("Stop the live session first" — no force affordance for
      genuinely-live rows). On confirm: optimistic row removal + an Undo toast
      wired to `restoreSession` (~8 s). On CLI throw: refetch and roll back.
      _Files:_ `gui/src/App.tsx`. _Verify:_ gui vitest — confirm strip renders the
      object fields; live-row Delete disabled; confirm fires `deleteSession` + shows
      Undo; a rejected delete restores the row.
- [x] **Step 5:** `hideSummaries` GUI setting suppressing `SessionRow.summary`
      (the one pre-existing content egress). Default keeps current behavior.
      _Files:_ `gui/src/App.tsx`, `gui/src/settings-store`. _Verify:_ gui vitest —
      with `hideSummaries` on, summary text absent; off, it shows.
- [x] **Step 6:** Preserve same-provider takeover — the takeover target picker on
      each row lists only profiles of that row's provider (cross-provider is the
      handoff bridge, not takeover).
      _Files:_ `gui/src/App.tsx`. _Verify:_ gui vitest — a codex row's picker lists
      only codex profiles; a claude row only claude.
- [x] **Step 7:** Extend `App.test.tsx` for the new view + delete flows using the
      existing hoisted-ipc + stubbed-`EmbeddedTerminal` harness.
      _Files:_ `gui/src/App.test.tsx`. _Verify:_ `cd gui && npm test` green.

## Phase 3 — Cross-provider handoff bridge (metadata-only default; content tier deferred)

A genuinely lossy, additive bridge that seeds a NEW target session from a
human-reviewed brief and NEVER deletes or resumes the source. The default
composes only the already-sanctioned readers (zero new egress). Gated on the
Phase-0 spike being green.

- [x] **Step 1:** ADR recording the honest feasibility stance — lossless
      cross-provider resume infeasible (format + tool-call semantics), lossy
      metadata bridge is the default, transcript-translation deferred/experimental.
      Cite the Phase-0 spike outcomes.
      _Files:_ `docs/adr/`, `src/handoff.ts`. _Verify:_ ADR created via the
      adr-create flow, references h1/h2 spike notes; index regenerated.
- [x] **Step 2:** `handoff extract <id> --from <provider>/<profile> [--out <file>]
      [--print-only] [--json]` (metadata-only) — compose `readSessionHeader`
      (Claude cwd+summary), telemetry (model + context %), and filesystem-derived
      git facts into a structured markdown brief. NO new transcript reader. Write to
      `<config>/.agent-switch/handoff/<id>.md` mode `0600` in a dir `mkdir 0o700`
      (never cwd, never a synced/tracked path); default print-to-stdout for the GUI.
      Codex source is known-thin → emit an explicit honesty note rather than a
      silent empty brief.
      _Files:_ `src/handoff.ts`, `src/index.ts`, `src/sessions.ts`. _Verify:_
      `handoff extract <claudeId> --print-only --json` yields cwd/model/context; a
      written brief is mode `0600` in the dedicated dir; a codex source prints the note.
- [x] **Step 3:** `handoff seed --to <provider>/<profile> --brief <path>` as a
      SEPARATE command (never auto-run after extract, never triggered by model
      output). Launches the target via `run` passthrough using the spike-confirmed
      `@file`/stdin surface so brief bytes NEVER appear in argv or shell history.
      Wraps the brief in a spotlight/quarantine preamble treating it as untrusted
      DATA. The confirmation names the destination VENDOR ("this sends context into
      an OpenAI Codex session"). Source is preserved (additive).
      _Files:_ `src/handoff.ts`, `src/index.ts`. _Verify:_ `handoff seed` opens the
      target with the brief via file/stdin (assert no brief content in the launched
      argv); the preamble is present; the source transcript is untouched.
- [x] **Step 4:** Brief lifecycle — auto-cleanup after a successful seed + a
      bounded TTL sweep for orphaned briefs (reuse the Phase-1 trash-sweep pattern).
      _Files:_ `src/handoff.ts`. _Verify:_ brief removed after seed; a brief older
      than the TTL is swept; unit-tested.
- [x] **Step 5:** GUI handoff — per-row "Hand off →" action whose target picker
      lists the OTHER provider's profiles. A modal with an EDITABLE brief preview
      pane, a persistent banner "Lossy — starts a NEW <vendor> session; history,
      tool state, and checkpoints do NOT transfer; the original stays", and a Seed
      button DISABLED until the preview has been viewed (the human egress gate).
      Extract via `runCli` (`--print-only`); Seed opens `EmbeddedTerminal` on the
      target run.
      _Files:_ `gui/src/App.tsx`, `gui/src/ipc.ts`. _Verify:_ gui vitest — modal
      shows the brief; Seed disabled until preview viewed; Seed opens the terminal
      with the target run + brief-by-file; the lossy banner present.
- [x] **Step 6:** Tests across CLI + GUI for the metadata-only path + the
      human-gated seed.
      _Files:_ `tests/`, `gui/src/App.test.tsx`. _Verify:_ `npm test` and
      `cd gui && npm test` green; `tsc -p tsconfig.test.json --noEmit` clean.

## Acceptance Criteria

- [x] `sessions rm <id>` where `<id>` contains `..`, `/`, or `\` is refused before
      any fs access; top-level `agent-switch rm <profile>` still performs
      whole-profile removal unchanged.
- [x] Deleting an idle Claude session moves transcript + checkpoint into
      `<config>/.agent-switch-trash/…` (checkpoint first, transcript last) and
      `sessions restore <trashId>` round-trips it; `--purge` performs true
      irreversible deletion.
- [x] Delete is refused whenever the source profile has any live pid
      (re-checked at exec); `--force` does NOT override the live guard for delete.
- [x] Codex delete requires `--yes` + a typed-id acknowledgment and is refused
      within the mtime-freshness window; `--force` is documented inert for codex;
      `turnInFlight` is not used for codex.
- [x] Delete arguments over IPC carry only id/provider/from(/`--purge`)/`--yes` and
      never a `live` flag; the CLI re-resolves the id and re-checks liveness at exec.
- [x] An id present in multiple profiles is refused with "pick `--from`" (never
      guesses); a shared-history tree forces an extra acknowledgment.
- [x] The Sessions view shows Claude AND Codex via main-page-style provider tabs
      with per-provider grouped lists + empty states; antigravity hidden; codex
      (and win32-unknown) rows show an explicit "liveness unknown" caption; the GUI
      live badge is advisory only.
- [x] Delete UI hard-disables on live rows, removes optimistically with an Undo
      toast, and rolls back on CLI error.
- [x] The default handoff reads no message body — only `readSessionHeader` +
      telemetry + filesystem git facts; the brief file is mode `0600` in a dedicated
      non-tracked/non-synced dir; the brief is passed to the target by `@file`/stdin
      (never argv); the brief is spotlighted as untrusted data; the confirmation
      names the destination VENDOR.
- [x] `handoff seed` is a separate command that never auto-fires after extract and
      is never triggered by model output; the source session is preserved.
- [x] Transcript-content handoff (`--include-transcript`) is NOT shipped here
      (deferred/experimental).
- [x] `tsc -p tsconfig.test.json --noEmit` clean; CLI test suite and `gui` vitest
      suite both pass.

## Risks & Mitigations

- **Unvalidated session-id → arbitrary directory deletion (path traversal).**
  Latent in takeover today; delete makes it direct. → `assertValidSessionId`
  before any fs access + realpath-prefix assertion; negative unit tests (P1 §1-2).
- **`--force` deletes a LIVE session** (liveness is per-PROFILE, not per-session).
  → for delete, `--force` MUST NOT override the live guard; genuinely-live rows
  hard-blocked in CLI + UI (P1 §6, P2 §4).
- **Codex has zero liveness detection; `turnInFlight` is Claude-shaped** → an
  actively-appended rollout could be deleted mid-write. → mtime-freshness proxy
  (~60 s) + mandatory typed-id ack; `--force` inert for codex (P1 §6).
- **TOCTOU** — GUI lists, user confirms, session goes live before delete. → the
  CLI is the sole authority: re-resolve + re-check liveness at exec; the arg
  builder never carries a `live` flag (P1 §6, P2 §2).
- **Seeded target executes injected instructions from the source (lethal trifecta).**
  → metadata-only default; brief treated as untrusted DATA and spotlighted; seed is
  a separate explicit human act, never auto-run; content tier deferred (P3 §3).
- **A full-content reader silently becomes cross-vendor transfer of arbitrary
  conversation content.** → content tiers OFF by default and deferred; the
  metadata default adds no new reader; a future content tier must be opt-in per
  act, a single named module, human review+redact gated, vendor-named.
- **The brief file is a durable plaintext leak.** → mode `0600` in a dedicated
  non-tracked/non-synced dir, auto-cleaned after seed, TTL-swept; GUI defaults to
  print-only/in-memory (P3 §2,4).
- **Partial delete orphans an unrecoverable, unlocatable checkpoint dir.** →
  checkpoint deleted FIRST, transcript LAST, so a crash leaves a locatable,
  resumable session; best-effort with a residue report (P1 §3).
- **The handoff rests on an unverified seed primitive.** → Phase-0 spike confirms
  each CLI's fresh-session initial-prompt surface before any handoff code; P3 gated
  on a green spike.
- **Metadata-only handoff from a Codex SOURCE is nearly empty** (cwd/summary/model
  null). → do not claim symmetry; emit an explicit honesty note for codex sources;
  a gated codex meta reader is deferred (P3 §2).

## Council Notes

- **Convergence** — all three lenses agree: (a) session delete MUST be a `sessions`
  subcommand (top-level `rm` is profile-removal); (b) reuse the takeover locate +
  zero/multiple-hit divergence guards and the Claude `liveSessionPids` guard; (c) a
  lossless cross-provider RESUME is infeasible; the realistic bridge is lossy and
  seeds a NEW target session; (d) metadata-only is the only shippable default
  handoff and needs no new transcript reader (for a Claude source).
- **Convergence (privacy)** — the transcript-egress boundary (exactly two
  content-minimizing readers) is the sacred invariant; delete opens NO new read
  surface; any transcript-content handoff is a deliberate, opt-in, human-reviewed,
  single-named-module exception, shipped last and most gated — here deferred.
- **Disagreement — trash vs hard delete:** ux-first + the data-loss review favor
  trash-default with Undo; privacy-first + minimal-loss lean irreversible with
  `--purge`. Adopted: **trash-default + `--purge`** (every mis-target becomes a
  recoverable annoyance; trash stays inside config, reads nothing) — flippable
  (open question).
- **Disagreement — where the brief is authored:** minimal-loss proposed driving the
  SOURCE agent to write its own brief; the privacy review rebutted that this does
  not reduce egress and adds an injection surface. Adopted: agent-switch composes
  existing sanctioned readers for the default; any agent-authored/rich brief is a
  deferred, equally-gated content tier.
- **Disagreement — delete `--force` on a live session:** ux-first/minimal-loss
  proposed a force-escalation; the data-loss review (adopted) makes force
  NON-overriding for delete.
- **Feasibility reframe (adopted):** "true resume impossible" downgraded to
  "lossless resume infeasible; lossy metadata bridge is the pragmatic default",
  with a Phase-0 falsification spike so the claim is evidence-backed and a
  translation bridge recorded as deferred rather than dismissed.

## Open Questions

- Trash-default vs true irreversible delete: is trash-move + Undo + `--purge` the
  right default, or must delete be immediate `fs.rmSync` with no holding area?
- Codex live-guard sufficiency: is mtime-freshness + typed-id ack acceptable, or
  should codex deletes be refused entirely until a real liveness signal exists
  (fail-closed vs usability)?
- Does the Codex CLI (and Claude) cleanly accept an initial prompt to seed a FRESH
  session via `@file`/stdin, or is pane-injection the only path? (Phase-0 answers.)
- Is the metadata-only handoff genuinely useful as the default, given it is
  near-empty for a Codex source — or does real value require the deferred content tier?
- Brief lifecycle specifics: exact dir, permissions, TTL/sweep cadence — and does
  emptying trash/briefs need its own confirmation or is silent self-management fine?
- Should the session summary be suppressed by default (privacy-first) or shown with
  the `hideSummaries` opt-out (this roadmap's pick)?
- Should handoff be reachable only from the Sessions view, or also as a "hand this
  off" affordance from an open terminal session?

## Deferred

- **Transcript-CONTENT handoff tier** (`--include-transcript` / rich brief): the
  only boundary-widening step. If built — opt-in per act, a single named reader
  module, bounded (last-N main-chain turns + hard byte cap), human review+redact
  gated, spotlighted as untrusted data, confirmation names the destination vendor.
- **A gated Codex meta reader** (first-line / rollout metadata) to make
  codex-source metadata handoff non-empty — same review gate.
- **Transcript-TRANSLATION resume** (parse one format → normalize → re-emit the
  other): real but fragile alternative pending the Phase-0 falsification; irreducible
  `tool_use`/`tool_result` loss.
- **Real Codex live-session detection** (a pid-file or equivalent) to replace the
  mtime-freshness proxy.
- **`.jsonl.zst` decompression** in the telemetry/content readers (today compressed
  rollouts yield no context and cannot back a content handoff — fail-closed with a
  note until supported).
- **Antigravity Sessions tab / session backend** — hidden until it has a session store.
