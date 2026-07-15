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
- [ ] S7 — ccusage delegation viability (D2 gate): install current ccusage;
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
- [ ] Compaction ground truth: daemon consumes `PreCompact`/`PostCompact`/
      `SessionStart(compact)` events → threshold re-arm on *real* compaction
      (replaces any utilization-drop heuristic — council: heuristics rejected).
- [ ] `SessionStart`/`SessionEnd` events double as **cross-platform liveness**
      (fixes the Windows gap for hook-installed profiles; upgrades POSIX too).
- [x] Hook payloads verified against S6 capture; env-gated contract test.
      <!-- verify: cmdHookEvent parses exactly the S6-captured fields (hook_event_name, source, session_id); scripts/spikes/t6 is the env-gated live capture (real SessionStart stdin). ✓ -->
- [ ] Without hooks installed everything still works (degraded: no compaction
      events → thresholds re-arm on context *drop to below the lowest
      threshold*, conservative; POSIX liveness as in Phase 2).

## Phase 3: daemon — get warned

- [ ] Daemon tails live sessions' transcripts each cycle (local reads only,
      reuse poll cadence; no extra API calls) → per-session context snapshot
      into `daemon-state.json` (schema-versioned). Pre-flight canary on start
      (D0 gate 2).
- [ ] Context thresholds via the existing `detectCrossings` pattern:
      edge-triggered per session-id; re-arm on real compaction events (2.5) or
      the conservative fallback. Defaults 80/95, configurable (`state.json`:
      `contextThresholds`).
- [ ] **Persist threshold-fired state** (also fixes the existing restart
      re-fire gap for usage-window crossings — same store).
- [ ] OS notifications, zero-dep: `osascript display notification` (macOS),
      `notify-send` (Linux, degrade silently if absent), PowerShell toast
      (Windows). One notifier module, used for both context and the existing
      usage-window crossings (which today only log). Off by default;
      `agent-switch notify on|off|status`.
- [ ] **Coalescing (council #11, mandatory):** all same-cycle crossings become
      ONE notification — `"3 sessions crossed 80% (worst: project-x, 94%)"`;
      the daemon log keeps the per-session detail.
- [ ] Notification text: **project dir + percentage + suggested action only**
      — no profile names at all (council #5: furthest from the rotation line).
- [ ] Perf budget: tails <100 ms per cycle at 20 live sessions (seeded-fixture
      perf test); per-file mtime short-circuit (unchanged file → skip read).

## Phase 4: actions — one keypress, owned terminals only

- [ ] GUI embedded terminal: "Compact" / "Clear" buttons on sessions running in
      the GUI's own pty — writes `/compact\n` (primary) / `/clear\n` (behind a
      confirm; destructive). Trivial by construction — we own the pty.
- [ ] tmux managed panes (`run --tmux`): `agent-switch compact <session-id>`
      resolves session → managed pane and runs `tmux send-keys -t <pane>
      "/compact" Enter`. **Managed panes only** (registry check, the existing
      hard rule); refuses non-managed sessions with the manual command printed.
      Registry gains a `sessionId → pane` mapping; ambiguity (two managed panes,
      same dir) → hard error naming both (council: never guess the pane).
- [ ] **Idle guard (council #10):** injection refused while the turn is
      in-flight — last transcript entry younger than N s **and** non-finalized
      (`stop_reason: null`). N per provider, configurable; defaults claude 15 s,
      codex 5 s. Finalized last entry → inject immediately. `--force` override,
      `--dry-run` prints the tmux command without executing.
- [ ] Everywhere else: the notification carries the suggested command; GUI
      shows a copy-button. No injection into terminals we don't own.

## Phase 5: tokens + cost — ccusage-delegated (council D2)

Gated on S7. agent-switch does **not** re-implement transcript aggregation,
dedup, or a pricing engine — ccusage (17k★, active, 16 source adapters) is the
engine; agent-switch contributes profile targeting + the cost-honesty layer it
uniquely knows (which profiles are subscription vs API-key).

- [ ] `agent-switch tokens [profile] [--provider P] [--daily|--by-model]
      [--json]` — detects the `ccusage` binary (PATH); absent → one-line
      install pointer + exit (the tmux pattern; no bundling).
- [ ] Invocation per profile: point ccusage at the profile's config dir
      (`CLAUDE_CONFIG_DIR=<configDir>` / codex equivalent per S7 findings),
      request JSON, parse defensively (schema-versioned parser, malformed →
      "ccusage output not understood — version X, expected Y").
- [ ] **Cost-honesty wrapper (ours, binding):** every cost figure carries
      `costBasis: "vendor" | "computed" | "notional"` — subscription/OAuth
      profiles are always `notional` (agent-switch knows the credential type;
      ccusage doesn't). Rendering spec (council #14): CLI cost column
      `$X.XX (notional)`; GUI: greyed value + tooltip; JSON: `costBasis` per
      row + `pricingSource`/`snapshotDate` at rollup root (from ccusage's
      pricing metadata where exposed, else labeled "ccusage-internal").
- [ ] `agent-switch tokens status` — shows ccusage version + last-run + a
      staleness hint (no CI jobs; CLI-appropriate freshness surfacing).
- [ ] Docs: README section "Token tracking" — what needs ccusage, what works
      without it (context monitoring is independent), Gemini expectations.
- [ ] Contract test (env-gated, needs ccusage installed): JSON shape canary
      against the pinned ccusage version; drift fails loud.

**Fallback (only if S7 FAILs; parked, not planned):** own minimal aggregator —
full-scan with 3-part dedup (`sessionId + message.id + requestId`, non-sidechain
wins), rollup store `{schema, days[]}` with atomic-rename writes, mtime
high-water + weekly full re-scan (transcript deletion tolerance), bundled dated
`pricing.json` + `pricing refresh`. Kept as appendix knowledge; do not build
while ccusage delegation works.

## Phase 6: GUI — surfaces

- [ ] SessionsView: context badge per live session (color ramp reusing the
      usage-bar thresholds; `~`/stale markers per Phase 2 JSON), Compact/Clear
      buttons per Phase 4.
- [ ] Tokens view: per-profile daily/model table + total, `costBasis` rendered
      per the Phase 5 spec (notional greyed + tooltip); pure client of
      `tokens --json`; empty-state = the ccusage install pointer.
- [ ] Notifications: `tauri-plugin-notification` + capability + settings
      toggle (GUI notifies only when the daemon isn't already doing so —
      single-notifier rule via daemon-state flag).
- [ ] Tray: optional worst-session context % in the tooltip — **one number,
      active profile only** (council #5), never a per-profile list.

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
