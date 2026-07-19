---
complexity: structural
execution:
  mode: manual
---

# Roadmap: agent-switch usage — source rate_limits from the statusline, stop polling

> Add a local, zero-network statusline bridge: a managed `agent-switch __statusline`
> command that Claude Code runs each render reads `rate_limits` from the statusLine
> stdin, maps `CLAUDE_CONFIG_DIR` → profile, normalizes to the existing
> `UsageSnapshot` shape, and writes a per-profile cache — then chains to the user's
> pre-existing statusline so their bar is untouched. The polled `/api/oauth/usage`
> path is demoted to a fallback. Gated on a blocking live spike.

## Goal

Stop the GUI from polling Anthropic's aggressively-429ing `/api/oauth/usage`
endpoint by sourcing usage windows (`rate_limits.five_hour`/`.seven_day`) from the
Claude Code statusLine stdin with **zero network calls**, falling back to the
polled path only when the statusline source is stale or absent — **without ever
clobbering, corrupting, or irreversibly altering a user's existing statusline**.

## Context

- **Precedent:** `src/hooks.ts` already installs ADDITIVE, marker-keyed
  (`HOOK_MARKER='asw_managed'`), idempotent, fully-reversible hooks into a
  profile's `settings.json`; `cmdHookEvent` (`src/index.ts:720-738`) reads fd0
  stdin + `CLAUDE_CONFIG_DIR` and maps dir→profile via `profileFromConfigDir`
  (`src/hooks.ts:156-164`). The `__statusline` command mirrors this shape.
- **Critical difference from hooks:** `settings.statusLine` is a **single object**
  `{type,command,padding}`, not an array — the additive-into-array marker
  technique does NOT transfer. Installing ours REPLACES the user's unless it
  chains/wraps. This single-slot clobber is the central safety problem.
- **Data model is fixed:** `UsageSnapshot {windows:[{key,label,utilization,resetsAt}],
  routines, capturedAt, resetCredits?}` (`src/usage.ts:11-29`). `parseUsage`
  already normalizes two input shapes; statusline is a THIRD shape needing
  `parseStatuslineUsage` that emits the SAME keys `five_hour`/`seven_day` so
  `detectCrossings`/`withStickyResets`/`isUsageStale` stay unchanged.
- **GUI is a pure consumer:** `gui/src/ipc.ts:152` `profileUsage` shells
  `status --provider <p> <name> --json` → `cmdStatus` → `claudeSnapshot`
  (`src/index.ts:363-376`) → daemon-cache-first, else `fetchUsage`→`parseUsage`.
  Daemon has a parallel producer `snapshotFor` (`src/daemon.ts:276-283`). Plugging
  the statusline source into BOTH seams = zero GUI change.
- **Current 429-prone path:** `src/api.ts` `oauthGet('/api/oauth/usage')` with
  429/Retry-After retry (`api.ts:37-72`). `anthropics/claude-code` #31637/#30930
  closed "not planned"; no reliable Retry-After. This is the path being demoted.
- **`settings.json` is a fork-prone SHARED symlink** (`src/share.ts:4-16`); a
  managed statusLine inherits that contract + its `share sync` reminder
  (`src/index.ts:622-625`).
- **No statusLine stdin has EVER been captured here.** `scripts/spikes` has
  t1/t2/t3/t5/t6/t7 — none for statusLine; t6 (hook stdin) returned honest-NULL.
  The "rate_limits on statusLine ≥2.1.x" claim is documentation + ccusage/ccstatusline
  inference, **unverified against a running binary**.
- **Reopened lock:** a prior council PARKED statusline-consumption ("speculative")
  and REJECTED chaining as "too invasive / no statusline-slot takeover". This spec
  reopens that under `decision-revisit-gate`; the changed condition (429 storms with
  no reliable Retry-After) is legitimate but must be surfaced via ADR + a numbered
  user decision, never silently overridden.

## Phase 0 — Live spike (BLOCKING gate; nothing downstream builds until it passes)

Every design rests on facts unverifiable from source: does the installed Claude
Code emit `rate_limits` on statusLine stdin (and in what shape), is
`CLAUDE_CONFIG_DIR` set in that command's env, and does a wrap-chain render
byte-identically. **Needs a real authed Claude session — user-gated.**

- [x] **Step 1:** Throwaway statusLine capture spike mirroring the t6 hook-stdin
      pattern: a temp statusLine command that cats stdin to a file AND dumps
      `env | grep CLAUDE`, installed against a logged-in `CLAUDE_CONFIG_DIR`, then
      run a real Claude session (Pro/Max tier).
      _Files:_ `scripts/spikes/t8-statusline-stdin-capture.sh`. _Verify:_ non-empty
      JSON capture produced; `jq '.rate_limits' capture.json` non-null.
- [-] **Step 2:** Enumerate the EXACT `rate_limits` shape — field names
      (`used_percentage` vs `utilization`), reset type (epoch vs ISO), nesting
      (`five_hour`/`seven_day` keys vs `limits[]`), which windows present, tier, CC
      version. Commit a scrubbed fixture (+ a free-tier/absent fixture).
      _Files:_ `tests/fixtures/statusline-stdin.json`,
      `tests/fixtures/statusline-stdin-freetier.json`. _Verify:_ `jq` confirms each
      documented field.
- [x] **Step 3:** Confirm G6 — `CLAUDE_CONFIG_DIR` present in the statusLine
      command's env (from the env dump). Absent → profile mapping impossible → STOP.
      _Files:_ `scripts/spikes/t8-statusline-stdin-capture.sh`. _Verify:_ grep the
      env dump; the var equals the per-profile config dir.
- [-] **Step 4:** Prototype the wrap-chain round-trip under share-off AND share-on:
      a wrapper that buffers stdin, spawns a real user statusline (e.g. ccstatusline)
      with full inherited env+cwd, re-feeds stdin, relays stdout+exit verbatim;
      capture before/after renders; measure cadence + per-render wall-clock.
      _Files:_ `scripts/spikes/t8-statusline-stdin-capture.sh`. _Verify:_ diff of
      un-wrapped vs wrapped rendered stdout is EMPTY (byte-identical); cadence recorded.
- [x] **Step 5:** GO/NO-GO — if `rate_limits` absent, OR `CLAUDE_CONFIG_DIR` absent,
      OR wrap not byte-identical → STOP, document, poll left unchanged. Else proceed.
      _Files:_ `agents/roadmaps/road-to-agent-switch-statusline-usage.md`. _Verify:_
      roadmap records an explicit GO/NO-GO with spike evidence cited.

### Phase-0 GO/NO-GO — **NO-GO** (2026-07-19)

The blocking Phase-0 spike ran against a logged-in Pro/Max profile
(`~/.agent-switch/claude/Matze4u/config`) on **Claude Code 2.1.215**. Result:

- **G1 (rate_limits presence) — FAIL.** A real interactive session rendered the
  statusLine and produced a non-empty stdin capture with 13 top-level keys:
  `session_id, transcript_path, cwd, effort, model, workspace, version,
  output_style, cost, context_window, exceeds_200k_tokens, fast_mode, thinking`.
  There is **no `rate_limits` key** (nor any usage-window field). `context_window`
  and `cost` are present, but not the `rate_limits.{five_hour,seven_day}` this
  feature depends on.
- **G6 (`CLAUDE_CONFIG_DIR` in the statusLine env) — PASS.** The var was present
  and equalled the per-profile config dir.
- **Wrap round-trip (G-wrap) — NOT REACHED.** NO-GO on G1 short-circuits it.

**Decision:** NO-GO. The load-bearing data source (`rate_limits` on statusLine
stdin) does not exist on CC 2.1.215, so per the Acceptance-Criteria gate the
feature is **not built** and the polled `/api/oauth/usage` path is **left
unchanged**. The roadmap's own top risk ("load-bearing data source unverified
against a running binary") is the one that fired — the spike did its job.

This also corrects the Context claim that `rate_limits` ships on statusLine
"≥2.1.x": 2.1.215 does **not** emit it. Downstream Phases 1–5 are blocked on an
external trigger (a future CC version that emits `rate_limits` on statusLine
stdin, or confirmation it appears only under a near-limit condition not seen in
this capture) and are parked, not cancelled — re-run this Phase-0 spike to
re-open the gate.

> **Spike-tooling note:** `scripts/spikes/t8-statusline-stdin-capture.sh` had a
> bug on first run — `CAPCMD` was passed as a node CLI arg instead of an env var,
> so the injected `statusLine.command` was `undefined` and CC rejected the
> settings file. Fixed (env var now precedes `node`); the capture above is from
> the fixed run.

## Phase 1 — Pure statusline mapper + cache primitives (no install, no settings I/O)

Safe, testable foundation: a defensive normalizer that degrades to null (never
empty windows) and an atomic per-profile cache. Pure/unit-testable, no slot risk.

- [ ] **Step 1:** `parseStatuslineUsage(raw, capturedAt): UsageSnapshot | null` as
      the THIRD input mapper in `src/usage.ts`. Emit `UsageWindow[]` keyed
      `five_hour`/`seven_day`; coerce `resets_at` (epoch|ISO)→ISO; accept
      `used_percentage|utilization`; NEVER throw; return **null** on zero usable
      windows (no-empty-write invariant).
      _Files:_ `src/usage.ts`, `tests/fixtures/statusline-stdin*.json`. _Verify:_
      unit test asserts `five_hour`/`seven_day` windows with correct
      utilization+resetsAt; free-tier fixture → null (not empty snapshot).
- [ ] **Step 2:** Additive optional `source?: 'statusline'|'poll'|'merged'` on
      `UsageSnapshot` + per-window provenance (per-window `capturedAt` or a
      `staleWindows[]`) to support independent hatching in the merge. GUI ignores
      fields it does not read.
      _Files:_ `src/usage.ts`, `gui/src/transforms.ts`. _Verify:_ `tsc --noEmit`
      on `src/` + `gui/`; existing parse/transforms tests stay green.
- [ ] **Step 3:** `src/statusline.ts` cache helpers — `readStatuslineSnapshot` /
      `writeStatuslineSnapshot`: single-object per-profile file under
      `profileDir(provider,name)`, atomic (temp+rename, mode 0o600),
      malformed-tolerant, SKIP write on null.
      _Files:_ `src/statusline.ts`, `src/profiles.ts`, `src/hooks.ts`. _Verify:_
      unit test round-trips; corrupted file → null, no throw; null → no write.

## Phase 2 — Reversible managed statusLine registration that CHAINS the user's

The central safety problem + the reopened decision. The stashed original MUST
live out-of-band (CC's atomic write may strip unknown keys ON the object);
"ours" is detected by command-string match.

- [ ] **Step 1:** Record the reopened decision via `adr-create`: prior council
      PARKED/REJECTED chaining; changed condition = 429 storms w/o Retry-After;
      mechanism = a REVERSIBLE, refuse-to-wrap-bounded wrap. **Surface to the user as
      a numbered decision (auto-install-with-hooks vs opt-in) BEFORE the installer.**
      _Files:_ `docs/adr/`. _Verify:_ ADR created + index regenerated; the user's
      install-posture decision recorded in the roadmap.
- [ ] **Step 2:** Pure `withStatuslineInstalled`/`withStatuslineRemoved` in
      `src/statusline.ts`. INVARIANT: `settings.statusLine` stays byte-clean
      `{type,command,padding}` — NO `asw_*` keys on it. Stash the user's ORIGINAL
      VERBATIM to an out-of-band sidecar keyed to the shared SOURCE dir, excluded
      from sharing. Detect "ours" by command-string match. Refuse non-command
      types. Guard self-wrap + double-install.
      _Files:_ `src/statusline.ts`, `src/share.ts`. _Verify:_ byte-exact round-trip
      suite: install→uninstall === original across five cases (no-prior,
      command+padding, command+unknown-extra-keys, user-replaced-post-install,
      shared-collapse).
- [ ] **Step 3:** Resolve + embed an ABSOLUTE binary path at install
      (`process.execPath` + entry script, or which-resolved), NOT bare
      `agent-switch`. Unresolvable → REFUSE install, stay on poll. Handle the
      per-machine-path-in-a-shared-file tension (re-resolve on `share sync`).
      _Files:_ `src/statusline.ts`, `src/share.ts`. _Verify:_ installed command is
      an absolute path; unresolvable binary → `changed:false` + warning, no edit.
- [ ] **Step 4:** `installStatusline`/`uninstallStatusline` disk ops write through
      the shared symlink via `writeSettings` (preserving the link) + emit the
      `share sync` reminder on change; exclude the sidecar + statusline cache from
      sharing (like `sessions/`).
      _Files:_ `src/statusline.ts`, `src/index.ts`, `src/share.ts`. _Verify:_
      install→uninstall restores a temp `settings.json` byte-exact; manifest
      excludes the sidecar; reminder prints only on change.

## Phase 3 — `__statusline` runtime handler (capture + chain delegate)

Per-render command: capture `rate_limits` to cache with zero network + zero
transcript reads, then faithfully re-emit the user's original bar. Runs in the
render path → never throw, block, or corrupt.

- [ ] **Step 1:** `cmdStatusline()` in `src/index.ts`, registered internal like
      `__hook-event`: read fd0 stdin ONCE, `JSON.parse`, read `CLAUDE_CONFIG_DIR`,
      `profileFromConfigDir`, extract ONLY `rate_limits` (NEVER dereference
      `transcript_path`), `parseStatuslineUsage`, write cache (skip on null). Whole
      body in try/catch that never throws. Zero network.
      _Files:_ `src/index.ts`, `src/usage.ts`, `src/statusline.ts`, `src/hooks.ts`.
      _Verify:_ pipe the fixture as stdin w/ `CLAUDE_CONFIG_DIR` set → cache written;
      free-tier fixture → no write; malformed stdin → exit 0, no throw, no write.
- [ ] **Step 2:** Chain delegate — after the cache write, if the sidecar holds an
      original command, spawn it with FULL inherited env+cwd, re-feed buffered
      stdin, relay stdout BYTE-FOR-BYTE + exit code, time-boxed (~1-2s); on
      timeout/failure emit empty, never block/crash. Capture cache BEFORE spawning.
      No original → emit nothing (or a compact line, per the Phase-2 decision).
      _Files:_ `src/index.ts`, `src/statusline.ts`. _Verify:_ wrap a dummy statusline
      printing known ANSI → `__statusline` stdout byte-identical; hung child → empty
      within timeout + cache still written; child exit code relayed.
- [ ] **Step 3:** Privacy gate — `cmdStatusline` references ONLY `rate_limits`,
      makes no network call, forbids any `transcript_path` dereference.
      _Files:_ `src/index.ts`. _Verify:_ grep body for `transcript_path` → zero;
      review confirms no fetch/http reachable from `cmdStatusline`.

## Phase 4 — Producer seam: prefer-fresh → poll → serve-stale + mandatory hybrid merge

Source-selection is the point of the feature, but a PARTIAL statusline source must
never mask the COMPLETE poll, nor blind the daemon's switch/threshold path.

- [ ] **Step 1:** Prepend a statusline-if-fresh branch to `claudeSnapshot`
      (`src/index.ts:363-376`) and `snapshotFor` (`src/daemon.ts:276-283`): read the
      statusline cache; if present AND version-supported AND `capturedAt` age <
      `STATUSLINE_TTL` → use it (zero network); else existing daemon-cache-if-fresh;
      else the unchanged poll. Poll null/429 → return the stalest REAL snapshot,
      never N.A. when a snapshot exists. `STATUSLINE_TTL` ≤ GUI `staleAfterMs`; an
      elapsed-`resetsAt` snapshot is treated as stale.
      _Files:_ `src/index.ts`, `src/daemon.ts`, `src/api.ts`. _Verify:_ integration
      test with `oauthGet` spied: fresh statusline cache → ZERO `oauthGet`; stale →
      exactly one poll; 429 → stalest real snapshot, not null.
- [ ] **Step 2:** Hybrid merge (v1 mandatory) — overlay fresh statusline windows
      onto the last polled/daemon snapshot by `window.key`; windows absent from
      statusline (per-model opus/sonnet, weekly_scoped/Fable, routines) are FILLED
      from poll, never dropped; per-window provenance drives independent hatching;
      snapshot `capturedAt` = the OLDER of the merged sources.
      _Files:_ `src/usage.ts`, `src/index.ts`, `src/daemon.ts`. _Verify:_ statusline
      `{five_hour,seven_day}` + polled `{opus,sonnet}` → merged carries all four with
      correct per-window `capturedAt`; a window missing from both → N.A., not dropped.
- [ ] **Step 3:** Switch-path coverage guard — `detectCrossings` / `maxUtilization`
      / `pickSwitchTarget` operate on the poll-complete merged window set, never a
      fewer-window statusline-only snapshot.
      _Files:_ `src/daemon.ts`, `src/usage.ts`. _Verify:_ a per-model window at 95%
      present only in poll data still triggers a crossing + `pickSwitchTarget` even
      when a fresh statusline snapshot omits it.
- [ ] **Step 4:** Fix `claudeSnapshot` freshness — gate serving a cached snapshot on
      the snapshot's OWN `capturedAt` (`STATUSLINE_TTL`), not solely on
      `state.lastPoll`, so `--json` consumers never get stale-stamped-fresh data.
      _Files:_ `src/index.ts`, `src/daemon.ts`. _Verify:_ a within-TTL-but-old
      snapshot re-served by a daemon cycle is not reported fresh to a `--json`
      consumer whose `capturedAt` age exceeds the threshold.
- [ ] **Step 5:** Confirm the GUI needs zero changes — `profileUsage` → `status
      --json` returns the unchanged `UsageSnapshot`; `isUsageStale`/`withStickyResets`
      operate on `capturedAt` regardless of source.
      _Files:_ `gui/src/ipc.ts`, `gui/src/App.tsx`, `gui/src/usage-cache.ts`,
      `gui/src/UsageBars.tsx`. _Verify:_ GUI with a statusline-sourced cache → bars
      render from it, no GUI diff; advance `capturedAt` past `staleAfterMs` → hatch.

## Phase 5 — Install wiring, version canary, doctor visibility, docs

- [ ] **Step 1:** Wire `installStatusline`/`uninstallStatusline` into the existing
      hooks install/uninstall path (respecting the Phase-2 auto-vs-opt-in decision)
      so both managed edits install + reverse together.
      _Files:_ `src/index.ts`. _Verify:_ install installs both; uninstall reverses
      both, leaving `settings.json` byte-exact to pre-install.
- [ ] **Step 2:** statusLine-contract version canary distinct from telemetry
      `SUPPORTED_CLAUDE`: missing `rate_limits` / out-of-range CC → `parseStatuslineUsage`
      null → transparent poll fallback; log the drift.
      _Files:_ `src/statusline.ts`, `src/usage.ts`, `src/telemetry.ts`. _Verify:_
      capture without `rate_limits` → null → poll; drift log emitted; no crash.
- [ ] **Step 3:** Surface statusline-wrap health in `doctor` (present / displaced /
      missing), mirroring `share.ts` `sharedLinkHealth`, so a user re-running
      ccstatusline's installer (which silently displaces our wrap) is visible.
      _Files:_ `src/index.ts`, `src/share.ts`. _Verify:_ after manually replacing
      `settings.statusLine` with a foreign command, `doctor` reports "displaced".
- [ ] **Step 4:** Exclude the sidecar + per-profile usage cache from sharing (like
      `sessions/`); update docs/README/roadmap; record the honest expectation that
      for multi-profile users the 429 relief is ~1/N (statusline fires only for the
      profile with a live session) and the burst-stagger + per-profile cooldown
      remain the primary 429 defense.
      _Files:_ `src/share.ts`, `docs/`, `README.md`, this roadmap. _Verify:_ a
      `share sync` does not propagate the sidecar; docs state the ~1/N relief.

## Acceptance Criteria

- [ ] Phase-0 gate PASSED before any downstream build: a committed fixture proves
      `rate_limits` present on the installed CC's statusLine stdin with exact shape
      documented; `CLAUDE_CONFIG_DIR` confirmed in the env; wrap round-trip
      byte-identical under share-off + share-on. Any failure → not built, poll intact.
- [ ] `settings.statusLine` stays byte-clean `{type,command,padding}`; NO `asw_*`
      keys on the object; original stashed VERBATIM out-of-band; "ours" = command
      string match on the resolved absolute path.
- [ ] install → uninstall byte-exact across all five cases (round-trip suite).
- [ ] Shared `settings.json`: a single stash keyed to the shared SOURCE dir;
      uninstalling any profile restores the one original and never deletes the slot
      on a missing per-profile stash; sidecar excluded from sharing.
- [ ] The installed command is an absolute resolved binary path; unresolvable →
      REFUSE install, retain the polled path.
- [ ] The chain delegate preserves the bar byte-for-byte (stdout, ANSI, exit,
      padding), is time-boxed, emits empty on failure, never blocks; cache written
      BEFORE the delegate spawn.
- [ ] `parseStatuslineUsage` returns null on zero usable windows; cache never
      written empty; a null cache = source-absent → poll (existing N.A. path for
      API-key/free-tier preserved).
- [ ] Hybrid merge present in v1: absent windows filled from poll, never dropped;
      per-window provenance drives hatching; snapshot `capturedAt` = older source.
- [ ] The daemon switch/threshold path always operates on the poll-complete merged
      window set, never a fewer-window statusline-only snapshot.
- [ ] `STATUSLINE_TTL` ≤ GUI `staleAfterMs`; an elapsed-`resetsAt` snapshot is stale.
- [ ] Source selection = prefer-fresh-statusline → poll → serve-stalest-real: fresh
      cache = zero `oauthGet`; poll only when stale/absent; 429/null serves the
      stalest real snapshot, never N.A. when any snapshot exists.
- [ ] Zero new network egress: `cmdStatusline` makes no network call, never
      dereferences `transcript_path` (review + grep).
- [ ] GUI unchanged: `status --json` returns the same `UsageSnapshot`; bars render +
      hatch from a statusline-sourced snapshot with no GUI code change.
- [ ] The reopened "chaining rejected / no statusline-slot takeover" decision is
      recorded via ADR + surfaced to the user as a numbered decision before the wrap
      installer is built.

## Risks & Mitigations

- **Marker keys on the statusLine object silently dropped/rejected by CC's atomic
  write** → erases the only copy of the user's original. → REJECTED marker-in-object;
  stash out-of-band in a sidecar; keep the object byte-clean; detect "ours" by
  command-string match.
- **Shared `settings.json` collapses per-profile stash** (uninstall wipes the shared
  bar; sync re-propagates a stale wrap). → single stash keyed to the shared SOURCE
  dir; restore the single original; never delete on a missing per-profile stash;
  exclude sidecar from sharing; share-sync reminder on change.
- **Bare `agent-switch` unresolvable in CC's render env → blank/error bar every
  render.** → embed an absolute path at install; refuse-if-unresolvable; re-resolve
  on share sync.
- **Chain fidelity** (re-fed stdin/relayed stdout adds a byte, drops ANSI/exit/
  padding). → buffer stdin; spawn with full env+cwd; pipe byte-for-byte; relay exit;
  carry padding; time-box + empty on failure; Phase-0 proves byte-identical.
- **A partial statusline source preferred over the complete poll** masks a dropped
  window as fresh N.A. and blinds auto-switch/threshold to a maxed per-model window.
  → hybrid merge is v1; daemon switch/threshold path sees the poll-complete set.
- **An empty-window snapshot stamped `capturedAt=now`** flips honest N.A. into false
  "fresh empty bars". → `parseStatuslineUsage` null on zero windows; writer skips on
  null; producer treats null cache as source-absent; free-tier fixture asserts this.
- **Load-bearing data source unverified against a running binary** (no fixture; t6
  returned honest-NULL; prior research was wrong once on codex rate_limits). → hard
  Phase-0 gate: capture real stdin, commit a fixture, confirm presence + shape +
  `CLAUDE_CONFIG_DIR`; STOP if either absent.
- **Double process-spawn per render lags the prompt** if CC invokes statusLine per
  keystroke. → measure cadence + wall-clock in Phase 0; keep `cmdStatusline`
  zero-dependency; reconsider auto-vs-opt-in if per-keystroke.
- **Building on the mechanism the prior council rejected without surfacing the
  reopened lock.** → ADR via `adr-create` citing the changed condition; numbered
  user decision before the Phase-2 installer.
- **User (or ccstatusline's installer) replaces the statusline after install** →
  capture silently stops, GUI reverts to the 429-prone poll with no signal. →
  uninstall acts only when the slot is still ours; `doctor` reports present/
  displaced/missing; idempotent re-assert with the refuse-if-unknown guard.

## Council Notes

- **Convergence** (all lenses + reviews): reuse the `UsageSnapshot` model + keys
  `five_hour`/`seven_day` so `detectCrossings`/`withStickyResets`/`isUsageStale` and
  the entire GUI need zero change; the statusline source plugs in at the two existing
  producer seams (`claudeSnapshot`, `snapshotFor`).
- **Convergence:** a live Phase-0 spike is a blocking gate — G1 (rate_limits presence
  + shape) and G6 (`CLAUDE_CONFIG_DIR` in env) are both hard-stops; do not ship on
  the documented contract alone.
- **Convergence:** demote the poll to a fallback, never remove it; the design
  REDUCES egress and introduces none (no-new-egress CONFIRMED against real code).
- **Shift** (reviews overruled minimal-diff): marker-in-object → out-of-band sidecar
  is mandatory (CC may strip/reject unknown keys).
- **Shift** (availability review overruled phasing): the hybrid merge is a v1
  REQUIREMENT, not Phase-5-optional — a partial source preferred over the complete
  poll masks coverage gaps and blinds auto-switch.
- **Disagreement (routed to user):** default install posture — auto-install the wrap
  alongside hooks (more data, touches the exclusive slot) vs opt-in (safer, but many
  users keep 429ing). Phase-2 ADR decision.
- **Disagreement (routed to user):** with NO prior statusline, should `__statusline`
  emit nothing (invisible) or a compact usage line (visible value-add)? Privacy-safe
  default leans to nothing.
- **Convergence (decision-revisit-gate):** the reopened park/reject is legitimate
  given the 429-storm evidence, but must be surfaced via ADR + numbered decision.

## Open Questions

- **G1 (blocking, spike output):** the EXACT `rate_limits` stdin shape — field names,
  reset timestamp type, nesting.
- **G3:** real statusLine invocation cadence + typical between-session staleness →
  sets the concrete `STATUSLINE_TTL` (≤ GUI `staleAfterMs`).
- **G4:** is `rate_limits` Pro/Max-only? Free-tier/absent must degrade to poll
  (confirmed by fixture).
- **G5:** which CC version first ships `rate_limits` on statusLine stdin; does stdin
  carry a version field for the canary.
- **Coverage:** does statusline carry the richer windows (opus/sonnet, weekly_scoped/
  Fable, routines, resetCredits) or only the two core windows? Determines whether the
  hybrid merge is permanent or collapses to a clean replace.
- **Default install posture** (user decision, Phase-2 ADR): auto-install-with-hooks
  vs opt-in.
- **No-original passthrough** (user decision): emit nothing vs a compact usage line.
- **Absolute-path-in-a-shared-file portability:** re-resolve on `share sync` vs an
  always-on-PATH shim — pick during Phase 2.
- **G2:** does CC tolerate a clean `{type,command,padding}` object without choking.

## Deferred

- GUI source badge / "as of <time>" tooltip surfacing the new `source` field —
  additive, post-v1, no data-path change.
- Appending statusline snapshots to `usage-history.json` for history parity —
  deferred to keep the privacy surface minimal; decide after v1.
- Any richer-window low-cadence poll optimization beyond the hybrid merge — moot if
  the spike shows statusline carries all windows (merge collapses to a clean replace).
- A fuller D0-style degraded-mode canary subsystem beyond the version-null degrade —
  only if drift proves frequent.
