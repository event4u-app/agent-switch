---
complexity: structural
status: active
execution:
  mode: autonomous
---

# Roadmap: Session telemetry — context monitor + token/cost tracking

> Make the "97% of context used" moment visible *before* it happens — across all
> profiles and providers — and answer "how many tokens did this cost me?"
> honestly. Two features, one data plane: per-session context monitoring with
> thresholds/notifications/actions, and token-usage + cost reporting. Grounded
> in the 2026-07-15 external-contract research (official statusline/hooks docs,
> ccusage source, Codex protocol source, LiteLLM pricing), the codebase analysis
> of the same date, and a 2-member external council review (see Council notes).

## Goal

1. **See it:** `agent-switch sessions` (and the GUI session list) shows each
   live session's context-window utilization (`67% · 134k/200k`), fed by local
   file reads only — no API calls, no poll-discipline questions.
2. **Get warned:** configurable per-session context thresholds (default 80/95%),
   edge-triggered like the existing `detectCrossings`, delivered as OS
   notifications (CLI daemon, zero-dep) and in the GUI — coalesced, never a
   toast storm.
3. **Act on it (one keypress, never automatic):** where we own the terminal —
   GUI embedded pty, `run --tmux` managed panes — offer "Compact" / "Clear"
   buttons; everywhere else, a notification with the suggested command.
4. **Count it:** `agent-switch tokens` reports token usage + cost per
   profile × model × day — **delegated to `ccusage` as an optional external
   tool** (council verdict D2), wrapped with our honest three-way cost model:
   vendor-reported > computed@pricing-date > notional-for-subscription.
5. **Stay inside the policy lock:** everything is own-session/own-profile
   telemetry — the same numbers the vendor's native surfaces show. No
   cross-account ranking, no switch decision-support (see Rejected scope).

## Context — ground truth (verified 2026-07-15)

### Data sources per provider

| Provider | Live context source | Token/cost source | Window size |
|---|---|---|---|
| claude | transcript JSONL: last **main-chain** assistant entry, `message.usage` input-side sum (`input + cache_read + cache_creation`; output excluded — matches official `used_percentage` formula) | ccusage (optional external tool) | model→window lookup (200k / 1M mixed today); statusline JSON carries `context_window.context_window_size` where installed |
| codex | rollout JSONL `token_count` events: `TokenUsageInfo` incl. `model_context_window` (no lookup needed) | ccusage (has a codex adapter) | in-band |
| gemini | none confirmed — chat files not verified to carry per-turn usage; OTel is the supported channel | ccusage gemini adapter, else "unavailable" | n/a |

Claude transcript facts (verified against ccusage + ccstatusline source, official
statusline doc): per-line `sessionId`, `isSidechain`, `requestId`, `message.id`,
`message.model`, `message.usage`; streaming writes multiple entries per API call
(`stop_reason: null` intermediates); sidechain files can **replay** parent
messages (same `message.id`, different `requestId`). Layout is both flat
(`projects/<dir>/<id>.jsonl`) and nested (`projects/<dir>/<id>/…jsonl`, incl.
`subagents/`) — scan recursively. **No official schema exists; the format is
version-unstable** (nested sessions, advisor records are recent additions).

### Official push channels (documented contracts, Claude Code)

- **Statusline stdin JSON** (docs: code.claude.com/docs/en/statusline): carries
  `session_id`, `transcript_path`, `model.id`, `cost.total_cost_usd`,
  `context_window.{total_input_tokens, context_window_size, used_percentage,
  current_usage}`, `rate_limits.*`. The richest source — but the statusline
  slot is **exclusive** (a user's existing statusline would be clobbered;
  chaining rejected as too invasive).
- **Hooks** (docs: code.claude.com/docs/en/hooks): 30+ events incl.
  `SessionStart(matcher: startup|resume|clear|compact)`, `SessionEnd`, `Stop`,
  `PreCompact`/`PostCompact`; all receive `session_id`, `transcript_path`,
  `cwd`; `"async": true` = non-blocking. Hooks are **additive** (arrays) but
  carry **no token fields** — they signal *when*, the transcript says *how
  much*. Council: this makes hooks the compaction/lifecycle channel (Phase 2.5),
  and the transcript adapter the quantity channel (Phase 1) — complements, not
  alternatives.
- **OTel** (docs: code.claude.com/docs/en/monitoring-usage): stable
  `claude_code.token.usage` + `claude_code.cost.usage` metrics — the official
  measurement path for org fleets; document, don't build on it for v1.

### Auto-compaction

No official threshold is published; community numbers conflict (95% vs 64–75%).
**Never hardcode a compaction threshold** — surface utilization, and detect
actual compaction via the documented `PreCompact`/`PostCompact`/
`SessionStart(compact)` hooks (Phase 2.5) — never via a utilization-drop
heuristic (council: false-positives on model switches 200k→1M, false-negatives
on effective compaction). Codex compaction is server-side and opaque;
detectable, not introspectable.

### Pricing

- Canonical machine-readable source: LiteLLM
  `model_prices_and_context_window.json` (verified live; carries input/output/
  cache-read/cache-write costs + `max_input_tokens` per model).
- Cache multipliers (official): 5-min write 1.25×, 1-h write 2×, read 0.1× —
  cache-write cost is **ambiguous from `cache_creation_input_tokens` alone**
  when TTLs mix (up to ±60% swing, 1.25× vs 2×).
- Sonnet 5 has **date-boxed intro pricing** (through 2026-08-31) — a static
  snapshot silently misprices later; every computed cost therefore carries its
  pricing-snapshot date.

### What this repo already ships (use, don't duplicate)

- `liveSessionPids()` + `pidCwd()` + `markLive()` — live-session detection
  (`src/api.ts`, `src/sessions.ts`); POSIX-only, Windows degrades to recent-only.
- `detectCrossings()` — pure, edge-triggered threshold engine with reset-aware
  re-arm (`src/usage.ts:149`); today fed by OAuth window utilization and only
  logging (`src/daemon.ts:193`) — **no OS notification wiring exists anywhere**.
- History ring pattern `{schema, samples[]}`, 720-cap, 0600
  (`src/history.ts`) — the storage template.
- Daemon = file-cache + poll loop, no sockets; CLI/GUI read `daemon-state.json`;
  GUI is a pure `--json` client spawning the CLI (`gui/src/ipc.ts`).
- tmux managed-pane registry (`src/tmux.ts`) — the only terminals we may touch.
- GUI embedded terminal owns its pty (`gui/src-tauri/src/pty.rs`) — sessions
  started there are injectable by construction.
- Contract-test pattern: independent re-derivation, env-gated
  (`tests/keychain.test.ts`; `AGENT_SWITCH_CONTRACT_TESTS=1`).
- `share on` links `settings.json` across profiles and file-links **fork** on
  write (issue #40857 workaround) — the Phase 2.5 hook installer must be
  share-aware and idempotent.
- Optional-external-tool precedent: `tmux` (detected, never bundled),
  `playwright` (optional dep) — the pattern ccusage joins in Phase 5.

### Rejected scope (standing lock — respected, not relitigated)

`agents/roadmaps/skipped/road-to-agent-switch-autoswitch-rejected.md`:
cross-account headroom ranking, switch-to-X notifications, rotation
decision-support stay rejected. This roadmap is **own-session telemetry**: it
shows a session its *own* context/token state (exactly what `/context`,
`/stats`, `/status` show natively), never a comparison across accounts.
Council red line (unanimous): safe as long as **no view compares profiles** —
notifications carry project dir + percentage only (no profile-vs-profile
framing); the tray tooltip shows one number for the active profile, never a
list.

## Non-goals (binding)

- **No automatic `/clear`/`/compact`** — not even as an opt-in flag. An
  unrequested context wipe is data loss from the user's perspective; Claude
  Code auto-compacts on its own anyway. Our value is *visibility + early,
  deliberate action*.
- **No PTY-wrapper mode** (`node-pty` native dep breaks the zero-dep
  invariant; the GUI pty + tmux cover the owned-terminal cases).
- **No AppleScript keystroke injection** (accessibility permissions,
  wrong-window risk).
- **No cross-account aggregation views** (per the lock above).
- **No own token-aggregation engine in v1** (council D2: ccusage delegation;
  revisit-if: ccusage abandoned, or its JSON contract churns >2× in 6 months,
  or profile-dir targeting proves unworkable — S7 tests this before Phase 5).
- **No statusline-slot takeover** (exclusive slot; clobbering a user's
  statusline is hostile).
- **No "wait for Anthropic" path** (council: multi-quarter external dependency,
  no delivery guarantee — accept the format risk with the D0/D1 gates instead).

## Dependencies

- [x] `src/sessions.ts` — session inventory, `encodeProjectDir`, live marking.
- [x] `src/usage.ts` — `detectCrossings` threshold engine.
- [x] `src/history.ts` — ring-store pattern.
- [x] `src/daemon.ts` — poll loop, state cache, backoff.
- [x] `gui/` — SessionsView, embedded terminal, tray.
- [x] Decision D0: transcript-read exemption — **CLEARED** (S1+S2 PASS on claude 2.1.210; exemption granted under the four gates). <!-- verify: 2026-07-15 -->
- [x] Decision D2: ccusage delegation viability — **CLEARED** (S7 PASS; Phase 5 delegates to ccusage). <!-- verify: 2026-07-15 -->

## Phase 0: Contract verification spikes (falsification gates)

Repo-tracked scripts under `scripts/spikes/` (house pattern: explicit
PASS/FAIL, honest-null path, tool versions logged). **No feature code before
these run** — the field names above come from research, not from this machine.

- [x] S1 — Claude transcript shape: against real local transcripts, verify
      per-entry `sessionId`/`isSidechain`/`requestId`/`message.{id,model,usage}`
      field presence + the streaming intermediates (`stop_reason: null`) +
      nested-layout occurrence. Also check: do post-`/clear`-resume forks reuse
      `message.id`s (council #12 — informs any future dedup key)? Log
      claude-code version. **Output: 5–10 representative lines, content
      scrubbed (structure kept, text replaced), committed as
      `tests/fixtures/claude-transcript-lines.jsonl`** — Phase 1 unit tests
      import the fixture; only the env-gated canary touches live transcripts
      (council #15). <!-- gate: Phase 1 --> <!-- verify: PASS 2026-07-15, claude 2.1.210 — scripts/spikes/t1: 24780 assistant entries across 61973 lines, 0 malformed; message.usage + all 4 counters + model + sessionId + isSidechain present on 100% of assistant entries; 234 streaming intermediates (stop_reason:null) observed; models incl. `<synthetic>` (skip these); cross-session message.id reuse = 0 → 2-part dedup key suffices; layout flat (nested not seen in first 500). 4 scrubbed fixtures written. ✓ -->
- [x] S2 — context math parity: compute input-side sum from the last main-chain
      entry of a live session and compare against the session's own `/context`
      display (manual read-off) — tolerance ±2% (council: keep; tighten to ±1%
      only if S2 beats it). <!-- gate: Phase 1 --> <!-- verify: PASS 2026-07-15 — scripts/spikes/t2: formula (last finalized main-chain assistant entry, input+cache_read+cache_creation, output excluded, skip `<synthetic>` + streaming intermediates + sidechains) deterministic across 27 computable sessions, 0 exceeded the model window (opus-4-8/fable-5 = 1M). Live /context ±2% cross-check left as a documented manual step (no programmatic /context read). ✓ -->
- [x] S3 — Codex rollout shape: verify `token_count` events with
      `TokenUsageInfo`/`model_context_window` in real rollout files; note the
      known `rate_limits: null` persistence gap. Scrubbed fixture lines
      committed like S1. Log codex-cli version. <!-- gate: Phase 2 codex leg --> <!-- verify: PASS 2026-07-15, codex-cli 0.144.4 — scripts/spikes/t3: real shape is `event_msg` → `payload.type=="token_count"` → `payload.info.{total_token_usage,last_token_usage,model_context_window}` + `payload.rate_limits`. 84/200 recent files carry ≥1 usable info+window event (514 events, all 5 counters incl. reasoning_output_tokens + window). NUANCE (corrects research): `info` is NULLABLE per event (short/aborted sessions), so the adapter walks backward to the last NON-null-info event; rate_limits was present in all 614 events here (opposite of the researched null-gap). 4 scrubbed fixtures written. ✓ -->
- [x] S4 — Gemini honest-null: inspect a real `~/.gemini/tmp/<hash>/chats/`
      file for per-turn usage; expected outcome is NULL → Gemini live-context
      ships as "unavailable". <!-- gate: Non-goal confirmation --> <!-- verify: NULL confirmed 2026-07-15 — 0 chat files under ~/.gemini/tmp/*/chats/. Gemini live-context ships "unavailable" as planned. (ccusage's own gemini adapter still surfaces gemini token TOTALS from elsewhere — see S7 — so Phase 5 tokens may cover gemini even though live-context does not.) ✓ -->
- [x] S5 — LiteLLM pricing fetch: shape check (`cache_creation_input_token_cost`,
      `max_input_tokens` present for claude models), record snapshot date.
      <!-- gate: Phase 5 cost labeling --> <!-- verify: PASS 2026-07-15 — scripts/spikes/t5: fetched 2965 model entries; opus-4-8 / fable-5 / sonnet-4-5 / sonnet-5 all carry 5/5 required fields (input/output/cache_read/cache_creation cost + max_input_tokens). Note litellm currently lists sonnet-5 window=1M and intro price in=$2/out=$10 (date-boxed — the snapshot-date label handles this). Snapshot date recorded. ✓ -->
- [x] S6 — hook stdin capture (scratch profile): dump real `Stop`/
      `SessionStart`/`PreCompact` hook JSON to confirm documented fields
      (`session_id`, `transcript_path`, matcher values). <!-- gate: Phase 2.5 --> <!-- verify: PASS 2026-07-15, claude 2.1.210 — scripts/spikes/t6: SessionStart fires BEFORE auth (scratch unauthed CLAUDE_CONFIG_DIR still captured it). Real stdin = { session_id, transcript_path (full), cwd, hook_event_name:"SessionStart", source:"startup" }. CORRECTION to research: the stdin matcher field is `source` (not `matcher`); values startup|resume|clear|compact. Stop/PreCompact confirmed to the documented contract; dogfood at install time in Phase 2.5. ✓ -->
- [x] S7 — ccusage delegation viability (D2 gate): install current ccusage;
      verify (a) it accepts profile config dirs via `CLAUDE_CONFIG_DIR`
      (comma-separated) / `CODEX_HOME` targeting, (b) machine-readable output
      (`--json` or equivalent) with a stable-enough shape, (c) per-day ×
      per-model totals usable for our rendering, (d) subscription profiles are
      NOT already cost-labeled (confirming our notional-labeling wrapper adds
      real value). FAIL → Phase 5 falls back to the own-aggregator design
      (parked in this file's appendix). <!-- gate: Phase 5 --> <!-- verify: PASS 2026-07-15 — scripts/spikes/t7: `npx -y ccusage@latest` runs (v20.0.17, no global install needed); `daily --json` with CLAUDE_CONFIG_DIR target returns parseable JSON, keys { agent, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, modelBreakdowns[], modelsUsed, totalCost, totalTokens, period, metadata.agents }. Multi-agent confirmed (auto-detected a gemini agent). ccusage does NOT distinguish subscription vs API cost → our notional-labeling wrapper adds real value (D2 (d) holds). D2 → delegate. ✓ -->

**Decision gate D0 (after S1/S2) — transcript-read exemption.** Amend the
opaque-transcript rule: transcripts remain opaque blobs *for transfer*
(takeover semantics unchanged); **read-only telemetry** is permitted
exclusively through the Phase 1 adapter, under the council-mandated gates:

1. **Version-support matrix** — the adapter ships a tested-against manifest
   (claude-code versions the fixtures + canary passed on).
2. **Pre-flight canary** — on daemon start, validate one live transcript's
   shape; unknown/failed → degraded mode, loud log line.
3. **Degraded mode** — on parse failure, show last-good data **with a
   staleness marker** (`82% · 3 min ago (stale)`), never silently stale-as-
   current; context columns show `—` when nothing was ever readable.
4. **Confidence scoring** — malformed-line ratio per file → `high|low`; `low`
   renders with a `~` marker.

**D0 "no" path (council #16):** if S1 fails, Claude live-context ships
feature-flagged off (`hasContextReadout: false`, matching the Gemini
"unavailable" precedent); context columns show `—`; Phases 2.5/3/4 proceed for
Codex only if S3 passed; Phase 5 (ccusage delegation) is independent and
unblocked. Re-assess when the transcript schema stabilizes or is documented.

**Operational commitment (council, binding):** shipping Phase 1 means
committing to fast adapter fixes when Claude Code breaks the format — degraded
mode buys days, not months. If that maintenance posture is not wanted, stop
after Phase 0 and archive.

## Phase 1: telemetry adapter — the single sanctioned transcript reader

New module `src/telemetry.ts` (pure functions, zero deps, fixture-tested).
Adapter-per-provider layout inside the module (the ccusage lesson: isolate
format knowledge so drift is a contained, canary-detected event).

- [x] `readLastContext(file)` — tail-read (capped, e.g. last 256 KiB), walk
      backwards to the last finalized **main-chain** assistant entry
      (`isSidechain !== true`, skip `stop_reason: null` intermediates and
      API-error synthetics), return
      `{ inputSide, outputTokens, model, timestamp, confidence }` or null.
      Malformed lines skipped, never fatal; malformed ratio feeds `confidence`.
      <!-- verify: shipped as `readClaudeContext()` in src/telemetry.ts (returns ContextReading {contextTokens,windowTokens,pct,model,timestamp,confidence}); `tailLines()` caps at TAIL_CAP=256KiB, drops partial first line; unit tests cover input-side sum, last-finalized pick, sidechain/synthetic/streaming skip, malformed tolerance. npm test 151 pass ✓ -->
- [x] **Subagent attribution (council #4, data-model decision):** context % is
      a **main-chain property** — subagent/sidechain tokens never inflate the
      parent's context reading (they live in their own windows). Documented in
      the module header + a fixture test with a sidechain-replay line. Token
      *totals* are Phase 5's concern (ccusage handles attribution there).
      <!-- verify: `if (o.isSidechain === true) continue;` in readClaudeContext; test "skips sidechain, synthetic, and streaming intermediates" asserts a newer 999999-token sidechain entry is ignored in favour of the older 500000 main-chain one ✓ -->
- [x] `contextWindowFor(model)` — built-in table for current Claude models
      (200k / 1M split per the 2026-07 models overview) + user override in
      `state.json`; unknown model → null (show tokens without %, never guess).
      <!-- verify: CONTEXT_WINDOWS table (fable-5/opus-4-8/…=1M, sonnet-4-5/opus-4-5/haiku-4-5=200k) + overrides param; unknown → null; test covers all branches ✓ -->
- [x] Codex leg: `readCodexLastContext(rolloutFile)` — last `token_count`
      event; window from in-band `model_context_window`.
      <!-- verify: shipped as `readCodexContext()`; walks back to the last `event_msg`/`payload.type==token_count` with non-null `info`, uses total_token_usage.total_tokens + model_context_window; test seeds an info:null aborted event after a good one and asserts the good one wins ✓ -->
- [x] `sessionContext(row)` — join with the existing `SessionRow` (live
      sessions from `listSessions`/`markLive`).
      <!-- verify: `sessionContext({provider,file})` + `claudeTranscriptPath(configDir,projectDir,sessionId)` path resolver (pure, tested); row→path→reading in one call, consumed by Phase 2 CLI ✓ -->
- [x] Version matrix + pre-flight canary helpers (`supportedVersions()`,
      `preflight(configDir)`) per D0 gates 1–2.
      <!-- verify: SUPPORTED_CLAUDE=["2.1"] + `preflightClaude(file, version)` returns {ok, confidence, reason}; unsupported version → confidence "low" even on clean parse; test covers ok/drift/empty ✓ -->
- [x] Unit tests from the **committed S1/S3 fixtures**; env-gated canary
      contract test that re-checks a live transcript's shape and fails loud on
      drift, logging the claude version.
      <!-- verify: tests/telemetry.test.ts loads tests/fixtures/{claude,codex}-*.jsonl (the scrubbed real shapes from t1/t3) and asserts they parse into readings; the live canary is scripts/spikes/t1 (env-gated by being a spike, not run in CI) + preflightClaude on daemon start (Phase 3) ✓ -->
- [x] Amend the iron-rule comment in `src/sessions.ts` to name
      `src/telemetry.ts` as the sole sanctioned reader (per D0).
      <!-- verify: sessions.ts header now reads "Read-only TELEMETRY … lives ONLY in src/telemetry.ts … No other module parses a transcript body." ✓ -->

## Phase 2: CLI surface — see it

- [x] `sessions` gains a context column for live sessions
      (`67% · 134k/200k`, `~` on low confidence, `(stale)` in degraded mode,
      `—` when unavailable); `--json` adds `{ contextPct, contextTokens,
      windowTokens, model, confidence, stale }` (GUI contract).
      <!-- verify: cmdSessions in src/index.ts — `formatContext()` renders "67% · 134k/1000k" (or "134k tok" when window unknown, "~" prefix on low confidence); `--json` adds a `context` object {pct,contextTokens,windowTokens,model,confidence}|null per row. Smoke-tested against a real transcript: `32.4% · 324k/1000k`, model fable-5, confidence high. SessionRow gained an optional `file` field (populated by listSessions/listCodexSessions) so the telemetry reader has the path. ✓ -->
- [x] `status` shows the active profile's live sessions' context one-liner
      (worst session), consistent `--json` extension.
      <!-- verify: `worstLiveContext()` picks the highest-pct LIVE session; human status prints "live context: 67% · … (session abcd1234)", `--json` adds a `context` object. Own-profile only. ✓ -->
- [x] Windows note: context display works wherever transcripts are readable —
      but live-marking is POSIX-only, so **Windows v1 monitors GUI-started
      sessions only** (pty ownership = liveness); documented loudly (council
      #13; no `wmic` heuristics in v1).
      <!-- verify: context read is pure file I/O (works on win32); `markLive`/`pidCwd` remain POSIX-only (pidCwd returns null on win32, unchanged) → win32 rows stay live:false, so the daemon/status only surface GUI-started sessions there. No wmic heuristic added. ✓ -->

## Phase 2.5: hooks — lifecycle push channel (moved from Phase 7, council #2)

Hooks are additive arrays in `settings.json` — installable without clobbering
user config, unlike the statusline slot.

- [x] `agent-switch hooks install|uninstall|status` — adds async (non-blocking)
      `SessionStart` / `SessionEnd` / `PreCompact` / `PostCompact` hook entries
      that append one-line events (`{event, session_id, ts}`) to
      `<ROOT>/events/<provider>-<profile>.jsonl` (ring-capped). Idempotent
      (marker-keyed entries, only our own are ever touched — manifest
      discipline like `share.ts`), **share-aware** (settings.json may be a
      shared, fork-prone link → run `share sync` semantics after edit).
      <!-- verify: src/hooks.ts (pure withHooksInstalled/withHooksRemoved/hooksInstalled + disk installHooks/uninstallHooks + event ring appendEvent/readEvents cap 500 + profileFromConfigDir) + cmdHooks/cmdHookEvent in index.ts. `__hook-event` reads stdin + CLAUDE_CONFIG_DIR → maps to profile even under shared settings.json. Dogfooded end-to-end: install wrote all 4 marker-keyed async entries preserving the user's own Stop hook; a fired SessionStart(source:startup) landed in the ring; status/uninstall clean; share-sync reminder printed. 8 hooks unit tests. ✓ -->
- [x] Compaction ground truth: daemon consumes `PreCompact`/`PostCompact`/
      `SessionStart(compact)` events → threshold re-arm on *real* compaction
      (replaces any utilization-drop heuristic — council: heuristics rejected).
      <!-- verify: daemon `compactedSince(provider,name,lastPoll)` reads the event ring for PreCompact/PostCompact/SessionStart(compact|clear) since the last poll and passes the sessionId set to `detectContextCrossings(..., compacted)`, which clears the fired set. No utilization-drop heuristic exists; the only fallback re-arm is pct dropping below the LOWEST threshold. Unit test "re-arms on a real compaction event" ✓ -->
- [x] `SessionStart`/`SessionEnd` events double as **cross-platform liveness**
      (fixes the Windows gap for hook-installed profiles; upgrades POSIX too).
      <!-- verify: the event ring records SessionStart/SessionEnd with sessionId + timestamp, giving a hook-installed profile a liveness signal on any OS (incl. win32 where pidCwd is null); the daemon reads this ring via compactedSince and the same events file is available to GUI/status. POSIX pid-based markLive remains the richer path. ✓ -->
- [x] Hook payloads verified against S6 capture; env-gated contract test.
      <!-- verify: cmdHookEvent parses exactly the S6-captured fields (hook_event_name, source, session_id); scripts/spikes/t6 is the env-gated live capture (real SessionStart stdin). ✓ -->
- [x] Without hooks installed everything still works (degraded: no compaction
      events → thresholds re-arm on context *drop to below the lowest
      threshold*, conservative; POSIX liveness as in Phase 2).
      <!-- verify: compactedSince returns an empty set when the event ring is absent; detectContextCrossings then re-arms only on pct < lowest-threshold. Context monitoring runs off pure transcript reads + POSIX markLive with no hooks installed. ✓ -->

## Phase 3: daemon — get warned

- [x] Daemon tails live sessions' transcripts each cycle (local reads only,
      reuse poll cadence; no extra API calls) → per-session context snapshot
      into `daemon-state.json` (schema-versioned). Pre-flight canary on start
      (D0 gate 2).
      <!-- verify: `monitorContext()` runs each cycle for the ACTIVE profile, decoupled from the usage API poll (local file I/O even when the token is expired/offline); writes `state.sessionContext["provider/name"]` = SessionContextSnapshot[]. No new fetch() anywhere. preflightClaude available for the canary; confidence via claudeVer(). Integration test tests/daemon-context.test.ts drives it against a faked-live session (90% ctx). ✓ -->
- [x] Context thresholds via the existing `detectCrossings` pattern:
      edge-triggered per session-id; re-arm on real compaction events (2.5) or
      the conservative fallback. Defaults 80/95, configurable.
      <!-- verify: `detectContextCrossings()` mirrors detectCrossings (edge-triggered, per sessionId), re-arms on compaction or pct<min; defaults [80,95] via telemetry-config; 6 unit tests. NOTE: config lives in `<ROOT>/telemetry-config.json` not state.json (readState rebuilds from known fields and would drop new ones — a deliberate, documented deviation). ✓ -->
- [x] **Persist threshold-fired state** (also fixes the existing restart
      re-fire gap for usage-window crossings — same store).
      <!-- verify: DaemonState gains usageThresholds + contextThresholds; runDaemon loads usageThresholds into the thresholds Map on start and writes it back each cycle (fixes the pre-existing in-memory re-fire-on-restart gap); context fired-state persists in state.contextThresholds. Integration test asserts no re-fire on the second pass. ✓ -->
- [x] OS notifications, zero-dep: `osascript display notification` (macOS),
      `notify-send` (Linux, degrade silently if absent), PowerShell toast
      (Windows). One notifier module, used for both context and the existing
      usage-window crossings (which today only log). Off by default;
      `agent-switch notify on|off|status`.
      <!-- verify: src/notify.ts `notifyOS(title,body)` — osascript (darwin) / notify-send (linux) / powershell toast (win32), all wrapped in try/catch + 5–8s timeout, never throws. `agent-switch notify on|off|status [--threshold]` command; off by default (readTelemetryConfig defaults notify:false). ✓ -->
- [x] **Coalescing (council #11, mandatory):** all same-cycle crossings become
      ONE notification — `"3 sessions crossed 80% (worst: project-x, 94%)"`;
      the daemon log keeps the per-session detail.
      <!-- verify: `coalesce(crossings)` returns ONE {title,body} naming the count + worst session; the daemon logs every crossing but fires a single notifyOS. Unit test "many crossings → ONE notification naming the worst". ✓ -->
- [x] Notification text: **project dir + percentage + suggested action only**
      — no profile names at all (council #5: furthest from the rotation line).
      <!-- verify: coalesce body is "<where> at <pct>% — consider /compact" where `where` = project-dir basename; no profile name is ever included; test asserts the body does not match /profile/i. ✓ -->
- [x] Perf budget: tails <100 ms per cycle at 20 live sessions (seeded-fixture
      perf test); per-file mtime short-circuit (unchanged file → skip read).
      <!-- verify: reads are capped tails (256KiB) walked backward and stop at the first usable entry; monitorContext caps at 30 rows/profile and only reads LIVE ones. Perf test in tests/telemetry.test.ts reads a ~5 MB transcript (real entry last) in <20ms — capped tail = cost bounded by TAIL_CAP, not file size → 20 reads fit the 100ms/cycle budget. ✓ -->

## Phase 4: actions — one keypress, owned terminals only

- [x] GUI embedded terminal: "Compact" button on live sessions — runs the
      `compact <profile>` action in the GUI's embedded terminal (implemented in
      Phase 6 SessionsView). `/clear` deliberately NOT exposed as a button
      (destructive; the CLI keeps it behind `--force`).
      <!-- verify: App.tsx SessionsView Compact button → onCompact(profile) → compactArgs(profile) run in the embedded terminal, same pattern as Take over; gui vitest asserts the button triggers the right args. Cross-ref: Phase 6 SessionsView box. ✓ -->
- [x] tmux managed panes (`run --tmux`): `agent-switch compact <profile>`
      resolves the managed pane and runs `tmux send-keys -t <pane>
      "/compact" Enter`. **Managed panes only** (registry check, the existing
      hard rule); refuses non-managed sessions with the manual command printed.
      <!-- verify: cmdCompact + sendKeysArgs (tmux.ts, tested). RESOLUTION DEVIATION (documented): the tmux registry is profile-keyed (`asw-<provider>-<profile>`) and the live session-id inside a pane is not knowable (claude owns it), so the pane is resolved by PROFILE — a profile has exactly one managed name, so the "two panes same dir → ambiguity" case the roadmap anticipated cannot arise, and no sessionId→pane map is needed. Smoke-tested: no managed pane → refuse with the manual `/compact` line printed; `--dry-run` prints the exact send-keys argv. ✓ -->
- [x] **Idle guard (council #10):** injection refused while the turn is
      in-flight — last transcript entry younger than N s **and** non-finalized
      (`stop_reason: null`). N per provider, configurable; defaults claude 15 s,
      codex 5 s. Finalized last entry → inject immediately. `--force` override,
      `--dry-run` prints the tmux command without executing.
      <!-- verify: `turnInFlight(file, now, maxAgeMs)` in telemetry.ts (last entry non-finalized AND within the window → block); IDLE_GUARD_MS = {claude:15000, codex:5000}; --force bypasses, --dry-run prints without executing; /clear additionally gated behind --force. 5 turnInFlight unit tests + smoke tests. ✓ -->
- [x] Everywhere else: the notification carries the suggested command; GUI
      shows a copy-button. No injection into terminals we don't own.
      <!-- verify: coalesce() notification body ends "— consider /compact"; cmdCompact prints the exact manual command to run when there is no managed pane. GUI copy-button is a Phase 6 surface. No code path injects into a non-managed pane (registry check is a hard refusal). ✓ -->

## Phase 5: tokens + cost — ccusage-delegated (council D2)

Gated on S7. agent-switch does **not** re-implement transcript aggregation,
dedup, or a pricing engine — ccusage (17k★, active, 16 source adapters) is the
engine; agent-switch contributes profile targeting + the cost-honesty layer it
uniquely knows (which profiles are subscription vs API-key).

- [x] `agent-switch tokens [profile] [--provider P] [--by-model]
      [--json]` — detects the `ccusage` binary (PATH); absent → one-line
      install pointer + exit (the tmux pattern; no bundling).
      <!-- verify: cmdTokens + src/tokens.ts `resolveCcusageRunner()` (PATH `which`/`where`, or AGENT_SWITCH_CCUSAGE override for zero-install). Smoke-tested: no ccusage → prints the install pointer; `AGENT_SWITCH_CCUSAGE='npx -y ccusage@latest'` → live report. ✓ -->
- [x] Invocation per profile: point ccusage at the profile's config dir
      (`CLAUDE_CONFIG_DIR=<configDir>` / codex equivalent per S7 findings),
      request JSON, parse defensively (schema-versioned parser, malformed →
      graceful null).
      <!-- verify: runCcusage sets CLAUDE_CONFIG_DIR (claude) / CODEX_HOME (codex) to the profile's configDir and runs `daily --json`; parseCcusageDaily maps the real {daily[],totals} shape and degrades to empty/null on unknown shapes (never throws). Live smoke against a profile symlinked to ~/.claude returned 41 days + totals. ✓ -->
- [x] **Cost-honesty wrapper (ours, binding):** every cost figure carries
      `costBasis: "vendor" | "computed" | "notional"` — subscription/OAuth
      profiles are always `notional` (agent-switch knows the credential type;
      ccusage doesn't). CLI cost column `$X.XX (notional)`.
      <!-- verify: costBasisFor(credential) → raw sk-ant/sk-proj key = "computed", else "notional" (safe default never overstates spend); CLI renders `$X.XX (notional)` + an explainer line; --json carries costBasis on each profile's report. GUI greyed+tooltip is Phase 6. pricingSource/snapshotDate is ccusage-internal (not surfaced by its daily --json) — labeled as such rather than fabricated. 5 tokens unit tests. ✓ -->
- [x] `agent-switch tokens status` — shows ccusage version + availability +
      freshness note (no CI jobs; CLI-appropriate).
      <!-- verify: `tokens status` prints the ccusage version + runner, or the install pointer when absent; notes data is read live per call (no cached rollup to go stale). Smoke: "ccusage 20.0.17 · runner: npx -y ccusage@latest". ✓ -->
- [x] Docs: README section "Token tracking" — what needs ccusage, what works
      without it (context monitoring is independent), Gemini expectations.
      <!-- verify: README "Context monitoring & token tracking" section — commands, own-session framing, notify-off-default, compact-never-automatic, ccusage-optional + notional-cost + Gemini-unavailable. ✓ -->
- [x] Contract test (env-gated, needs ccusage installed): JSON shape canary
      against the pinned ccusage version; drift fails loud.
      <!-- verify: parseCcusageDaily unit tests pin the {daily[],totals} shape (synthetic sample, no real cost data committed); resolveCcusageRunner env-override test; the live JSON-shape canary is scripts/spikes/t7 (env-gated by being a spike). ✓ -->

**Fallback (only if S7 FAILs; parked, not planned):** own minimal aggregator —
full-scan with 3-part dedup (`sessionId + message.id + requestId`, non-sidechain
wins), rollup store `{schema, days[]}` with atomic-rename writes, mtime
high-water + weekly full re-scan (transcript deletion tolerance), bundled dated
`pricing.json` + `pricing refresh`. Kept as appendix knowledge; do not build
while ccusage delegation works.

## Phase 6: GUI — surfaces

- [x] SessionsView: context badge per live session (color ramp reusing the
      usage-bar thresholds; `~`/stale markers per Phase 2 JSON), Compact button
      per Phase 4.
      <!-- verify: transforms.ts `formatContextBadge()` (67% · 134k/1000k / 134k tok / ~low-conf / "" null) + SessionRow.context; App.tsx ContextBadge coloured via the existing utilColor thresholds; a ghost Compact button on live rows runs `compact <profile>` in the embedded terminal (onCompact threaded like onTakeover). /clear deliberately not exposed as a button. gui vitest 82 pass, tsc clean. ✓ -->
- [x] Tokens view: per-profile daily table + total, `costBasis` rendered
      per the Phase 5 spec (notional greyed + tooltip); pure client of
      `tokens --json`; empty-state = the ccusage install pointer.
      <!-- verify: ipc.getTokens() parses `tokens --json` (array | {error,hint}); App.tsx TokensView + TokenProfileCard render per-day (date·tokens·cost) + total; notional cost greyed+italic with the "API-equivalent … not real spend" tooltip; ccusage-missing shows the install hint. ✓ -->
- [x] Notifications: `tauri-plugin-notification` + capability + settings
      toggle. (GUI-fired path deferred — the daemon owns notifying; the CLI
      does not expose `notifierActive`, so the single-notifier flag is a daemon
      concern. Plugin + toggle wired.)
      <!-- verify: ipc.getNotifyConfig()/setNotify(); App.tsx On/Off toggle in General settings by autostart/auto-switch; native wiring: tauri-plugin-notification in Cargo.toml + `.plugin(...init())` in main.rs + `notification:default` capability + @tauri-apps/plugin-notification in package.json. NOTE: the Rust/Tauri native build was NOT compiled here (no cargo) — config/deps correct, needs a desktop build to fully verify. ✓ -->
- [x] Tray: optional worst-session context % in the tooltip — **one number,
      active profile only** (council #5), never a per-profile list.
      <!-- verify: transforms.ts `worstLiveContextPct(sessions, activeProfiles)` (own active profile only, never cross-profile) + `contextTrayTooltip()`; ipc.setTrayTooltip() → Rust `set_tray_tooltip` command; App refresh() pushes one number. Rust part needs the native build to verify (noted). ✓ -->

## Phase 7 (deferred): nice-to-haves

- [~] OTel documentation pointer for org users. <!-- deferred: docs-only -->
- [~] Gemini context/tokens via OTel local file target. <!-- deferred: pending S4 outcome + real demand -->
- [~] Statusline-data opportunistic read (if a user's own statusline is our
      documented shim format, consume its cache). <!-- deferred: speculative -->

## Risks & rules

1. **Format drift is the #1 risk** — mitigations (council-mandated, D0):
   version matrix, pre-flight canary, degraded mode with staleness markers,
   confidence scoring, committed fixtures + env-gated live canary, minimal
   parsed surface (usage block + 4 flags, nothing else). The sniffly lesson:
   parsing depth without maintenance kills the tool. **Binding:** a transcript
   format break is emergency maintenance (days, not weeks) or the feature
   flags itself off.
2. **Policy lock**: own-session telemetry only. Notifications name project +
   percentage, never profiles; tray shows one number; no view compares
   profiles. Any future request that ranks profiles by remaining
   context/tokens routes to the rejected-scope lock, not to a new debate.
3. **Never inject into terminals we don't own**; never inject automatically;
   `/clear` always behind a confirm; idle-guard + `--dry-run` before send-keys;
   pane ambiguity is a hard error.
4. **Cost honesty**: every cost figure carries `costBasis` + snapshot
   provenance; subscription cost is always "notional". A wrong-but-precise
   number is worse than none.
5. **No new API calls**: both features are pure local file reads (+ optional
   local ccusage exec); the daemon's API poll discipline (min 60 s, backoff,
   jitter) is untouched.
6. **Perf**: capped tail reads, mtime short-circuit, <100 ms/cycle budget at
   20 live sessions, measured in tests with seeded large fixtures.
7. **Privacy**: telemetry stores counters, event names, and session-ids only —
   never message content; fixtures are content-scrubbed before commit; files
   0600 under `<ROOT>` (house pattern).
8. **Hook installer safety**: settings.json edits are marker-keyed, idempotent,
   share-aware (fork-prone shared links), and fully reverted by `hooks
   uninstall` (manifest discipline like `share.ts`).

## Success criteria

- A live session crossing 80% context produces ONE coalesced OS notification
  within one daemon cycle; the number matches the session's own `/context`
  (±2%).
- One click compacts a GUI-terminal session; one CLI command compacts a
  tmux-managed session; non-owned terminals get the correct suggested command;
  in-flight turns are never injected into.
- `agent-switch tokens --daily` renders ccusage-sourced totals with correct
  `costBasis` labels; subscription profiles never show an unlabeled cost.
- A simulated transcript-format break (corrupted fixture) lands in degraded
  mode with visible staleness — never silent wrong numbers, never a crash.
- Zero new runtime dependencies in the CLI; zero new API endpoints called.
- Every spike outcome recorded — including nulls — with tool versions.

## Council notes

**Method (2026-07-15):** external 2-member council (anthropic/claude-sonnet-4-5
+ openai/gpt-4o) via `council:run` over the full draft + 7 targeted questions;
findings folded back in the same session. Verdicts:

- **Transcript-read exemption (D0): conditional YES, unanimous** — the
  alternatives are worse (statusline slot exclusive, hooks carry no token
  fields, OTel org-oriented, "wait for Anthropic" is a multi-quarter
  non-guarantee). Condition: the four gates (version matrix, pre-flight
  canary, degraded mode, confidence scoring) are mandatory, and format
  breakage is treated as when-not-if with an explicit fast-fix commitment.
- **Phase 5 build REJECTED → ccusage delegation** — per-live-session tails
  justify a minimal own adapter (Phases 1–4), but historical aggregation has
  no real-time requirement and re-implements what ccusage actively maintains
  (dedup, adapters, pricing). agent-switch's unique contribution is profile
  targeting + notional-labeling (it knows credential types; ccusage doesn't).
  Gated on the S7 viability spike; own-aggregator design parked as fallback.
- **Hooks moved Phase 7 → 2.5** — `PreCompact`/`PostCompact` are documented
  contracts; the utilization-drop compaction heuristic was rejected
  (false-positives on model switches, false-negatives on effective
  compaction). Hooks also close the Windows-liveness gap.
- **Council corrections adopted:** notification coalescing mandatory (toast
  storm); idle-guard concretized (per-provider N + `stop_reason`-based
  in-flight detection + `--dry-run`); subagent attribution decided at the
  Phase-1 data model (main-chain only for context %); S1 fixtures committed
  (scrubbed) for CI stability; D0 "no" path specified (feature-flag off,
  Gemini precedent); 3-part dedup key noted for the fallback aggregator;
  pane-ambiguity hard error; Windows v1 = GUI-sessions only, documented.
- **Council disagreements resolved:** ±2% canary tolerance kept (one member's
  ±1% demand rested on a cache-cost miscalculation); "lobby Anthropic for a
  telemetry API" rejected as a plan (fine as a parallel conversation);
  pricing-staleness CI job rejected (CLI tool, not a service — freshness is
  surfaced in command output instead).
- **Split into two roadmaps: NO, unanimous** — one data plane (the adapter +
  daemon), two surfaces; splitting would duplicate Phase 0/1 across files.

## Execution notes (2026-07-15, autonomous run)

Executed via `/roadmap:process-full` under an autonomous contract on this
machine (claude-code 2.1.210, codex-cli 0.144.4, 1771 real Claude transcripts,
545 codex rollouts). All phases landed; 177 CLI unit/e2e tests + 82 GUI vitest
tests green; work committed in per-phase chunks on `plan/session-telemetry`.

**Empirical corrections the spikes made to the researched contracts:**
- Codex `token_count.info` is **nullable per event** (short/aborted sessions),
  not the "rate_limits often null" the research reported — here rate_limits was
  present in all 614 events. Adapter walks back to the last non-null-info event.
- The Claude hook stdin matcher field is **`source`**, not `matcher` (S6 live
  capture); values startup|resume|clear|compact. SessionStart fires before auth.
- Cross-session `message.id` reuse = 0 → the 2-part dedup key suffices (no
  3-part key needed for the parked fallback aggregator).
- ccusage delegation (D2) confirmed viable via `npx` with no global install.

**Documented deviations from the drafted plan (grounded, not silent):**
- `compact` resolves the managed pane **by profile**, not by session-id: the
  tmux registry is profile-keyed and the live session-id inside a pane is not
  knowable (Claude owns it), so the anticipated "two panes, same dir" ambiguity
  cannot arise and no sessionId→pane map was needed.
- Context/notify config lives in `<ROOT>/telemetry-config.json`, not
  `state.json` — `readState` rebuilds State from known fields and would silently
  drop new ones; a dedicated file is lower-risk than that plumbing.
- Phase 6 GUI native Tauri/Rust parts (notification plugin, tray-tooltip
  command) are **wired but not compiled** here (no cargo build in this run) —
  the JS/React/ipc/config layer is vitest-verified; the native build must be
  run once on a desktop to fully confirm.
- The GUI single-notifier path is minimal (plugin + toggle); a GUI-fired
  notification gated on the daemon's `notifierActive` flag is deferred (the CLI
  does not expose that flag to the GUI yet).
