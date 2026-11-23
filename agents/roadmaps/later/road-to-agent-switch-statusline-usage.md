---
complexity: structural
status: parked
execution:
  mode: manual
review_by: 2026-12-23
entry_condition:
  what: "Owner decides Phase 6: the control query (`get_usage`) is labelled EXPERIMENTAL in the binary's own SDK. Option 1: statusline -> control query -> last real snapshot, delete fetchUsage (the 2026-11-02 E-token decision as written). Option 2: keep the token poll as a last fallback until the control query has held for stated Claude Code versions. Option 3: do not adopt the control query until the label goes. The council split 1 vs 2 on 2026-11-23 and both seats sent it back to the owner."
  when: "On the owner's answer; review_by 2026-12-23."
  who: "owner"
---

# Roadmap: agent-switch usage — source rate_limits from the statusline, stop polling

> Last triaged: 2026-11-07 — gate unmet but probably passable now (CC 2.1.316 vs NO-GO on 2.1.215). Usage still polls the OAuth token (`src/api.ts:80`, callers `src/daemon.ts:638`, `src/commands/shared.ts:178`, `src/commands/usage.ts:108`). P4 Step 4 shipped and flipped; 36 steps still needed, none obsolete. Line refs in P6.2 have drifted (`daemon.ts:533` -> `:638`, `shared.ts:166` -> `:178`, `rebind.ts:147` -> `:151`).

> Add a local, zero-network statusline bridge: a managed `agent-switch __statusline`
> command that Claude Code runs each render reads `rate_limits` from the statusLine
> stdin, maps `CLAUDE_CONFIG_DIR` → profile, normalizes to the existing
> `UsageSnapshot` shape, and writes a per-profile cache — then chains to the user's
> pre-existing statusline so their bar is untouched. The polled `/api/oauth/usage`
> path is demoted to a fallback. Gated on a blocking live spike.
>
> **Arrivals:** 5 — latest `inbox-2026-11-22` (2026-11-22): an MIT-licensed agent
> IDE read at `923b19d` runs exactly this bridge in production — a managed
> statusline script that prints nothing, skips payloads without `rate_limits`,
> throttles to one post per 15 s and attributes by `CLAUDE_CONFIG_DIR`
> (`src/main/claude/hooks/statusline-script.ts:25-160`); its own comment says the
> polled usage endpoint 429s for it and that Claude Code ≥ 2.1.80 sends
> `rate_limits` in the statusline stdin
> (`src/shared/agent-usage/rate-limits/claude-statusline-rate-limits.ts:1`). That
> version claim is the reference's, unverified here, and contradicts this file's
> 2.1.215 NO-GO — the entry-condition spike settles it. Third-or-later arrival:
> put to the owner in that round's reply.
> Before that: `inbox-2026-11-b` (2026-11-02, AS v3 proposal step V0.2):
> move usage off the OAuth token entirely — statusline first, then an undocumented
> control query over the unmodified binary (`initialize` → `get_usage`, needs a
> spike), then remove `readProfileCredential`/`fetchUsage`/`fetchProfile`. The
> removal collides with ADR-003 (`src/rebind.ts:147` reads the profile via the
> token) and ADR-004 (`src/token-freshen.ts:161`) — the proposal listed only the
> daemon and two commands as callers. **Owner decision E-token (2026-11-02): only
> the usage query moves off the token** (Phase 6); rebind and token-freshen keep
> their narrow reads as the ADRs allow.
> Before that: `cache-awareness` (2026-11-01, agent-config inbox): the
> status payload also carries `prompt_cache` (`warm`, `ttl`, `expires_at`,
> `recache_tokens_if_cold`; CC v2.1.251+, statusline doc). Once this bridge ships,
> those fields replace the transcript derivation in `readClaudeCache`
> (`road-to-sessions-that-show-their-cache` D1). Before that: `inbox-2026-10-d` (2026-10-31): the CC 2.1.314 binary
> carries `rate_limits.five_hour` / `seven_day` statusline fields, and the docs say they
> arrive only after the first API response. The 2026-07-19 NO-GO was taken on 2.1.215
> before that; re-run the Phase-0 capture after a first response before reusing it.
> Earlier: the original 2026-07 request.

## Goal

Stop the GUI from polling Anthropic's aggressively-429ing `/api/oauth/usage`
endpoint by sourcing usage windows (`rate_limits.five_hour`/`.seven_day`) from the
Claude Code statusLine stdin with **zero network calls**, falling back to the
polled path only when the statusline source is stale or absent — **without ever
clobbering, corrupting, or irreversibly altering a user's existing statusline**.

## Context

- **Precedent:** `src/hooks.ts` already installs ADDITIVE, marker-keyed
  (`HOOK_MARKER='asw_managed'`), idempotent, fully-reversible hooks into a
  profile's `settings.json`; `cmdHookEvent` (`src/commands/sessions.ts`) reads fd0
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
  (`src/commands/shared.ts`) → daemon-cache-first, else `fetchUsage`→`parseUsage`.
  Daemon has a parallel producer `snapshotFor` (`src/daemon.ts:276-283`). Plugging
  the statusline source into BOTH seams = zero GUI change.
- **Current 429-prone path:** `src/api.ts` `oauthGet('/api/oauth/usage')` with
  429/Retry-After retry (`api.ts:37-72`). `anthropics/claude-code` #31637/#30930
  closed "not planned"; no reliable Retry-After. This is the path being demoted.
- **`settings.json` is a fork-prone SHARED symlink** (`src/share.ts:4-16`); a
  managed statusLine inherits that contract + its `share sync` reminder
  (`src/commands/sharing.ts`).
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
- [x] **Step 2:** Enumerate the EXACT `rate_limits` shape — field names
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
- [x] **Step 4:** Prototype the wrap-chain round-trip under share-off AND share-on:
      a wrapper that buffers stdin, spawns a real user statusline (e.g. ccstatusline)
      with full inherited env+cwd, re-feeds stdin, relays stdout+exit verbatim;
      capture before/after renders; measure cadence + per-render wall-clock.
      _Files:_ `scripts/spikes/t8-statusline-stdin-capture.sh`. _Verify:_ diff of
      un-wrapped vs wrapped rendered stdout is EMPTY (byte-identical); cadence recorded.
- [x] **Step 5:** GO/NO-GO — if `rate_limits` absent, OR `CLAUDE_CONFIG_DIR` absent,
      OR wrap not byte-identical → STOP, document, poll left unchanged. Else proceed.
      _Files:_ `agents/roadmaps/road-to-agent-switch-statusline-usage.md`. _Verify:_
      roadmap records an explicit GO/NO-GO with spike evidence cited.

### Phase-0 GO/NO-GO — **GO** (2026-11-23)

Re-run on **Claude Code 2.1.316**, profile config dir of a signed-in Team account, model
Haiku, after one API response. The capture statusLine was injected for that one session
with `claude --settings <file>`, so no profile's `settings.json` was edited.

- **G1 (rate_limits presence) — PASS.** 18 top-level keys, among them
  `rate_limits: { five_hour: { used_percentage: 7, resets_at: <epoch s> }, seven_day: { … } }`.
  Field names: `used_percentage` (integer percent), `resets_at` (epoch **seconds**),
  nested by window key; only `five_hour` and `seven_day` appear (no per-model window).
  Also new since 2.1.215: `prompt_cache`, `prompt_id`, `session_name`, `scratchpad_dir`.
  Scrubbed: `tests/fixtures/statusline-stdin.json`; the same payload without
  `rate_limits`, standing in for a free-tier or pre-response render:
  `tests/fixtures/statusline-stdin-freetier.json` (derived, not captured).
- **G6 (`CLAUDE_CONFIG_DIR` in the statusLine env) — PASS** again.
- **G-wrap — PASS.** A wrapper that buffers stdin and re-feeds it to a statusline
  printing ANSI colour, the model id and `$PWD` and exiting 3 gave byte-identical stdout
  and the same exit code; about 50 ms per render for the shell prototype. No profile on
  the owner's machine has a statusLine of its own today, so the chain path is for other
  users.

**Decision:** GO. Phases 1–5 are unblocked; the polled path stays as the fallback.

### Phase-0 GO/NO-GO — **NO-GO** (2026-07-19, superseded by the GO above)

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

- [x] **Step 1:** `parseStatuslineUsage(raw, capturedAt): UsageSnapshot | null` as
      the THIRD input mapper in `src/usage.ts`. Emit `UsageWindow[]` keyed
      `five_hour`/`seven_day`; coerce `resets_at` (epoch|ISO)→ISO; accept
      `used_percentage|utilization`; NEVER throw; return **null** on zero usable
      windows (no-empty-write invariant).
      _Files:_ `src/usage.ts`, `tests/fixtures/statusline-stdin*.json`. _Verify:_
      unit test asserts `five_hour`/`seven_day` windows with correct
      utilization+resetsAt; free-tier fixture → null (not empty snapshot).
- [x] **Step 2:** Additive optional `source?: 'statusline'|'poll'|'merged'` on
      `UsageSnapshot` + per-window provenance (per-window `capturedAt` or a
      `staleWindows[]`) to support independent hatching in the merge. GUI ignores
      fields it does not read.
      _Files:_ `src/usage.ts`, `gui/src/transforms.ts`. _Verify:_ `tsc --noEmit`
      on `src/` + `gui/`; existing parse/transforms tests stay green.
- [x] **Step 3:** `src/statusline.ts` cache helpers — `readStatuslineSnapshot` /
      `writeStatuslineSnapshot`: single-object per-profile file under
      `profileDir(provider,name)`, atomic (temp+rename, mode 0o600),
      malformed-tolerant, SKIP write on null.
      _Files:_ `src/statusline.ts`, `src/profiles.ts`, `src/hooks.ts`. _Verify:_
      unit test round-trips; corrupted file → null, no throw; null → no write.

## Phase 2 — Reversible managed statusLine registration that CHAINS the user's

The central safety problem + the reopened decision. The stashed original MUST
live out-of-band (CC's atomic write may strip unknown keys ON the object);
"ours" is detected by command-string match.

> **v1 scope, decided 2026-11-23 (council, both seats; ADR-011):** opt-in
> `agent-switch statusline on|off|status`; a profile that already has a statusLine is
> left untouched; the managed command prints nothing. Stashing and chaining a user's
> bar are carried to [`road-to-statusline-chaining.md`](road-to-statusline-chaining.md)
> with their acceptance criteria. Steps below are restated to that scope.

- [x] **Step 1:** Record the reopened decision via `adr-create`: prior council
      PARKED/REJECTED chaining; changed condition = 429 storms w/o Retry-After;
      mechanism = a REVERSIBLE, refuse-to-wrap-bounded wrap. **Surface to the user as
      a numbered decision (auto-install-with-hooks vs opt-in) BEFORE the installer.**
      _Files:_ `docs/adr/`. _Verify:_ ADR created + index regenerated; the user's
      install-posture decision recorded in the roadmap.
      _Done 2026-11-23:_ `docs/adr/ADR-011-statusline-quota-is-opt-in-and-never-wraps-a-users-bar.md`.
      The owner delegated open questions in this run to the AI council; its record is
      `agents/runtime/council/responses/2026-11-23-statusline-install.md` (gitignored).
- [x] **Step 2:** Pure `withStatuslineInstalled`/`withStatuslineRemoved` in
      `src/statusline.ts` (v1, ADR-011). INVARIANT: `settings.statusLine` is
      byte-clean `{type,command,padding}` — NO `asw_*` keys on it. Any existing
      statusLine (ours excepted) → refuse, `changed:false`, reason `"has-own"`.
      "Ours" = command-string match. Remove only when the slot is still ours; a
      user's replacement is reported and kept. Double install is a no-op.
      _Files:_ `src/statusline.ts`. _Verify:_ round-trip suite: no-prior →
      install → remove leaves every other key byte-equal; existing user statusLine →
      refused, file unchanged; user replaced ours after install → remove keeps it.
- [x] **Step 3:** Resolve + embed an ABSOLUTE binary path at install
      (`process.execPath` + entry script, or which-resolved), NOT bare
      `agent-switch`. Unresolvable → REFUSE install, stay on poll. Handle the
      per-machine-path-in-a-shared-file tension (re-resolve on `share sync`).
      _Files:_ `src/statusline.ts`, `src/share.ts`. _Verify:_ installed command is
      an absolute path; unresolvable binary → `changed:false` + warning, no edit.
      _Done 2026-11-23, with a different answer to the shared-file tension:_ not a
      re-resolve on `share sync`; `on` re-points any managed command whose path moved
      ("ours" = an absolute path running `__statusline`), and `status` flags a path
      that no longer exists.
- [x] **Step 4:** `installStatusline`/`uninstallStatusline` disk ops write through
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

- [x] **Step 1:** `cmdStatusline()` in `src/index.ts`, registered internal like
      `__hook-event`: read fd0 stdin ONCE, `JSON.parse`, read `CLAUDE_CONFIG_DIR`,
      `profileFromConfigDir`, extract ONLY `rate_limits` (NEVER dereference
      `transcript_path`), `parseStatuslineUsage`, write cache (skip on null). Whole
      body in try/catch that never throws. Zero network.
      _Files:_ `src/index.ts`, `src/usage.ts`, `src/statusline.ts`, `src/hooks.ts`.
      _Verify:_ pipe the fixture as stdin w/ `CLAUDE_CONFIG_DIR` set → cache written;
      free-tier fixture → no write; malformed stdin → exit 0, no throw, no write.
- [-] **Step 2:** _Carried to `later/road-to-statusline-chaining.md` (ADR-011 rule 2);
      v1 prints nothing — see Step 4._ Chain delegate — after the cache write, if the sidecar holds an
      original command, spawn it with FULL inherited env+cwd, re-feed buffered
      stdin, relay stdout BYTE-FOR-BYTE + exit code, time-boxed (~1-2s); on
      timeout/failure emit empty, never block/crash. Capture cache BEFORE spawning.
      No original → emit nothing (or a compact line, per the Phase-2 decision).
      _Files:_ `src/index.ts`, `src/statusline.ts`. _Verify:_ wrap a dummy statusline
      printing known ANSI → `__statusline` stdout byte-identical; hung child → empty
      within timeout + cache still written; child exit code relayed.
- [x] **Step 4:** Print nothing (ADR-011 rule 3): `cmdStatusline` writes no byte
      to stdout and exits 0 on every path. _Verify:_ the CLI test pipes the fixture
      and asserts empty stdout, exit 0; malformed stdin likewise.
- [x] **Step 3:** Privacy gate — `cmdStatusline` references ONLY `rate_limits`,
      makes no network call, forbids any `transcript_path` dereference.
      _Files:_ `src/index.ts`. _Verify:_ grep body for `transcript_path` → zero;
      review confirms no fetch/http reachable from `cmdStatusline`.

## Phase 4 — Producer seam: prefer-fresh → poll → serve-stale + mandatory hybrid merge

Source-selection is the point of the feature, but a PARTIAL statusline source must
never mask the COMPLETE poll, nor blind the daemon's switch/threshold path.

- [x] **Step 1:** Prepend a statusline-if-fresh branch to `claudeSnapshot`
      (`src/commands/shared.ts`) and `snapshotFor` (`src/daemon.ts:276-283`): read the
      statusline cache; if present AND version-supported AND `capturedAt` age <
      `STATUSLINE_TTL` → use it (zero network); else existing daemon-cache-if-fresh;
      else the unchanged poll. Poll null/429 → return the stalest REAL snapshot,
      never N.A. when a snapshot exists. `STATUSLINE_TTL` ≤ GUI `staleAfterMs`; an
      elapsed-`resetsAt` snapshot is treated as stale.
      _Files:_ `src/index.ts`, `src/daemon.ts`, `src/api.ts`. _Verify:_ integration
      test with `oauthGet` spied: fresh statusline cache → ZERO `oauthGet`; stale →
      exactly one poll; 429 → stalest real snapshot, not null.
- [x] **Step 2:** Hybrid merge (v1 mandatory) — overlay fresh statusline windows
      onto the last polled/daemon snapshot by `window.key`; windows absent from
      statusline (per-model opus/sonnet, weekly_scoped/Fable, routines) are FILLED
      from poll, never dropped; per-window provenance drives independent hatching;
      snapshot `capturedAt` = the OLDER of the merged sources.
      _Files:_ `src/usage.ts`, `src/index.ts`, `src/daemon.ts`. _Verify:_ statusline
      `{five_hour,seven_day}` + polled `{opus,sonnet}` → merged carries all four with
      correct per-window `capturedAt`; a window missing from both → N.A., not dropped.
- [x] **Step 3:** Switch-path coverage guard — `detectCrossings` / `maxUtilization`
      / `pickSwitchTarget` operate on the poll-complete merged window set, never a
      fewer-window statusline-only snapshot.
      _Files:_ `src/daemon.ts`, `src/usage.ts`. _Verify:_ a per-model window at 95%
      present only in poll data still triggers a crossing + `pickSwitchTarget` even
      when a fresh statusline snapshot omits it.
- [x] **Step 4:** Fix `claudeSnapshot` freshness — gate serving a cached snapshot on <!-- shipped: src/daemon.ts:346-350 snapshotFresh reads snap.capturedAt; src/commands/shared.ts:170-174 (triage 2026-11-07) -->
      the snapshot's OWN `capturedAt` (`STATUSLINE_TTL`), not solely on
      `state.lastPoll`, so `--json` consumers never get stale-stamped-fresh data.
      _Files:_ `src/index.ts`, `src/daemon.ts`. _Verify:_ a within-TTL-but-old
      snapshot re-served by a daemon cycle is not reported fresh to a `--json`
      consumer whose `capturedAt` age exceeds the threshold.
- [x] **Step 5:** Confirm the GUI needs zero changes — `profileUsage` → `status
      --json` returns the unchanged `UsageSnapshot`; `isUsageStale`/`withStickyResets`
      operate on `capturedAt` regardless of source.
      _Files:_ `gui/src/ipc.ts`, `gui/src/App.tsx`, `gui/src/usage-cache.ts`,
      `gui/src/UsageBars.tsx`. _Verify:_ GUI with a statusline-sourced cache → bars
      render from it, no GUI diff; advance `capturedAt` past `staleAfterMs` → hatch.

## Phase 5 — Install wiring, version canary, doctor visibility, docs

- [x] **Step 1:** Wire `installStatusline`/`uninstallStatusline` into the existing
      hooks install/uninstall path (respecting the Phase-2 auto-vs-opt-in decision)
      so both managed edits install + reverse together.
      _Files:_ `src/index.ts`. _Verify:_ install installs both; uninstall reverses
      both, leaving `settings.json` byte-exact to pre-install.
- [x] **Step 2:** statusLine-contract version canary distinct from telemetry
      `SUPPORTED_CLAUDE`: missing `rate_limits` / out-of-range CC → `parseStatuslineUsage`
      null → transparent poll fallback; log the drift.
      _Files:_ `src/statusline.ts`, `src/usage.ts`, `src/telemetry.ts`. _Verify:_
      capture without `rate_limits` → null → poll; drift log emitted; no crash.
- [x] **Step 3:** Surface statusline-wrap health in `doctor` (present / displaced /
      missing), mirroring `share.ts` `sharedLinkHealth`, so a user re-running
      ccstatusline's installer (which silently displaces our wrap) is visible.
      _Files:_ `src/index.ts`, `src/share.ts`. _Verify:_ after manually replacing
      `settings.statusLine` with a foreign command, `doctor` reports "displaced".
- [x] **Step 4:** Exclude the sidecar + per-profile usage cache from sharing (like
      `sessions/`); update docs/README/roadmap; record the honest expectation that
      for multi-profile users the 429 relief is ~1/N (statusline fires only for the
      profile with a live session) and the burst-stagger + per-profile cooldown
      remain the primary 429 defense.
      _Files:_ `src/share.ts`, `docs/`, `README.md`, this roadmap. _Verify:_ a
      `share sync` does not propagate the sidecar; docs state the ~1/N relief.

## Phase 6 — Usage without the token (owner decision E-token, 2026-11-02)

Scope is the usage query only. ADR-003 (rebind, `src/rebind.ts:147`) and ADR-004
(token-freshen, `src/token-freshen.ts:161`) keep their narrow credential reads;
the login stamp (`src/daemon.ts:541`) is not a usage read and stays.

- [x] **Step 1:** Spike the control query over the unmodified binary
      (`initialize` → `get_usage`): per-profile via `CLAUDE_CONFIG_DIR`, no token
      handled by AS, output shape and CC version recorded as a fixture.
      _Done 2026-11-23:_ works on 2.1.316 without `initialize` and without a prompt;
      6.6 s per query; richer than the statusline (per-model weekly, `limits[]`). The
      binary's own SDK names it `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET`,
      so it is a fallback that must degrade to "absent". Evidence:
      `agents/evidence/codex-osc-7501-and-claude-get-usage-2026-11.md`; fixture
      `tests/fixtures/claude-get-usage-2.1.316.json`.
> **Parked 2026-11-23 on an owner decision.** Phases 1–5 shipped (opt-in statusline,
> ADR-011). Step 1's spike found the control query declared experimental, which is new
> since the E-token decision; the council split (one seat for removing the token poll
> now, one for keeping it as a last fallback) and both seats returned the choice to the
> owner. Record: `agents/runtime/council/responses/2026-11-23-control-query.md`
> (gitignored). The options are in the frontmatter.

- [ ] **Step 2:** Usage source order statusline (Phases 1–5) → control query →
      serve-stale; the three `fetchUsage` callers (`src/daemon.ts:533`,
      `src/commands/shared.ts:166`, `src/commands/usage.ts:108`) move to it.
- [ ] **Step 3:** Remove `fetchUsage` once it has no caller. `fetchProfile` in
      `src/commands/usage.ts:108` goes only if the control query also returns the
      profile; otherwise it stays on the ADR-003 path.
- [ ] **Step 4:** Test that no usage path reads the credential (spy on
      `readProfileCredential` across a full `status --json` and a daemon tick).

## Acceptance Criteria

- [x] Phase-0 gate PASSED before any downstream build: a committed fixture proves
      `rate_limits` present on the installed CC's statusLine stdin with exact shape
      documented; `CLAUDE_CONFIG_DIR` confirmed in the env; wrap round-trip
      byte-identical under share-off + share-on. Any failure → not built, poll intact.
- [x] `settings.statusLine` stays byte-clean `{type,command,padding}`; NO `asw_*`
      keys on the object; "ours" = command string match on the resolved absolute path;
      an existing user statusLine is never touched (ADR-011).
- [x] install → uninstall leaves every other key of `settings.json` byte-equal, and
      a shared `settings.json` names every profile it serves before `on`/`off` write.
- [-] _Carried to `later/road-to-statusline-chaining.md`:_ single stash keyed to the
      shared SOURCE dir; restore of the one original; sidecar excluded from sharing.
- [x] The installed command is an absolute resolved binary path; unresolvable →
      REFUSE install, retain the polled path.
- [-] _Carried to `later/road-to-statusline-chaining.md`:_ the chain delegate preserves
      the bar byte-for-byte, is time-boxed, emits empty on failure, never blocks.
- [x] The managed command prints nothing and exits 0 on every path (ADR-011).
- [x] `parseStatuslineUsage` returns null on zero usable windows; cache never
      written empty; a null cache = source-absent → poll (existing N.A. path for
      API-key/free-tier preserved).
- [x] Hybrid merge present in v1: absent windows filled from poll, never dropped;
      per-window provenance drives hatching; snapshot `capturedAt` = older source.
- [x] The daemon switch/threshold path always operates on the poll-complete merged
      window set, never a fewer-window statusline-only snapshot.
- [x] `STATUSLINE_TTL` ≤ GUI `staleAfterMs`; an elapsed-`resetsAt` snapshot is stale.
- [x] Source selection = prefer-fresh-statusline → poll → serve-stalest-real: fresh
      cache = zero `oauthGet`; poll only when stale/absent; 429/null serves the
      stalest real snapshot, never N.A. when any snapshot exists.
- [x] Zero new network egress: `cmdStatusline` makes no network call, never
      dereferences `transcript_path` (review + grep).
- [x] GUI unchanged: `status --json` returns the same `UsageSnapshot`; bars render +
      hatch from a statusline-sourced snapshot with no GUI code change.
- [x] The reopened "chaining rejected / no statusline-slot takeover" decision is
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
