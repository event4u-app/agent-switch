---
complexity: standard
status: done
tree_pin: a451856
---

# Roadmap: sessions that show their cache

> **Source:** `event4u/agent-config/agents/tmp/cache-awareness/` (read in place,
> not moved — it is agent-config's inbox, not ours): the owner's chat with two
> assistants, a ChatGPT roadmap ("AC Cache-Aware Session Economics", Phases
> 0–6) and the consolidated agent-config proposal
> `road-to-a-return-that-names-its-price` (pin `5a66c1bf19`). All three target
> **agent-config (AC)**. This roadmap takes only what fits agent-switch's role:
> outside the session, never in its traffic (NON-GOALS.md), owner of the
> account moves. Facts re-verified at `a451856` against the tree, local
> transcripts (Claude Code 2.1.316) and the host docs.

## Goal

When agent-switch lists a Claude session, it says whether the session's prompt
cache is still warm and, once it is cold, how many tokens the next turn
re-sends. When agent-switch moves a session to another account (takeover,
rebind) or types `/compact` into it, it names what that costs in cache terms
before it acts. Information only: no block, no automatic action, no new
command, no money figures, no in-session message.

## Verified facts this roadmap builds on

| Fact | Evidence |
|---|---|
| Every finalized assistant line carries `usage.cache_creation.{ephemeral_1h_input_tokens, ephemeral_5m_input_tokens}`, `cache_read_input_tokens` and a `timestamp` | local transcript, CC 2.1.316 (read 2026-11-01) |
| agent-switch already reads the input side of that line, but not the TTL split or the time | `src/telemetry.ts:155-163` |
| "Each request that hits the cache resets the timer"; main conversation on a plan within usage: 1h, else 5m | prompt-caching doc, "Cache lifetime" / "Which TTL each request gets" |
| A compaction writes `{"type":"system","subtype":"compact_boundary","timestamp":…}` into the transcript | local transcripts, 10 occurrences |
| Cold `/compact` "reprocesses that history as uncached input" | prompt-caching doc, "Compacting the conversation" |
| "Caches are isolated between organizations"; a resumed conversation "keeps the system prompt it started with" | prompt-caching doc, "Cache scope" / "Resuming a session" |
| 5 of the 6 local Claude profiles share one organization (hashed `oauthAccount.organizationUuid`), so "another account = cold cache" is not a safe claim | `<config>/.claude.json` of each profile |
| SessionStart `resume`/`fork` input carries `seconds_since_last_response`, `context_tokens`, `prompt_cache_likely_expired`, `estimated_cache_write_usd` (v2.1.251+, not on `startup`/`clear`/`compact`) | hooks reference, SessionStart input |
| agent-switch installs an async SessionStart hook and records only `event`, `source`, `sessionId` | `src/hooks.ts:31`, `src/commands/sessions.ts:181-197` |
| `compact` types `/compact` into a managed pane with no word on cost | `src/commands/sessions.ts:102-142` |

## Decisions

| ID | Decision | Why | Revisit if |
|---|---|---|---|
| D1 | The transcript is the source; the SessionStart resume fields only refine a resumed session before its first turn | no statusline bridge (parked: `later/road-to-agent-switch-statusline-usage.md`); the transcript is local and already sanctioned (`telemetry.ts` gate) | the statusline bridge ships — then `prompt_cache` from the status payload wins |
| D2 | agent-switch never speaks inside the session (no `systemMessage`, no `additionalContext`) | AC owns the in-session notice; two owners would print two lines; our hooks are async by design (`src/hooks.ts:4`) | AC drops its cache notice |
| D3 | Tokens only, never money | profiles are plan logins; plan-quota weighting of cache writes is unpublished | a profile type with metered billing appears |
| D4 | Move prices are shown, never ranked: rebind suggestions and `dir` picks stay on headroom | inventing a second ranking contradicts `rebind-dialog.ts:9-12` | a user asks for it with data |
| D5 | Same organization → "may stay warm", different → "re-sends ~N" — unless probe 0.1 says otherwise | doc: caches isolated per organization; local profiles mostly share one | probe 0.1 result |

## Phase 0 — Probe

- [x] **0.1 Does a move between two accounts keep the cache?** In a scratch
      directory: one `claude -p` turn on profile A, copy its transcript into
      profile B (same organization) and profile C (other organization), resume
      each with one `-p` turn inside A's TTL, read `cache_read_input_tokens`.
      verify: `agents/evidence/cache-move-probe-2026-11.md` names the CC
      version, the three read counts and the conclusion for D5.

## Phase 1 — Read the cache state

- [x] **1.1 `readClaudeCache` in `src/telemetry.ts`.** From the transcript tail:
      `lastResponseAt` (newest finalized main-chain assistant line), `ttl`
      (`1h`/`5m` from the newest line whose write split is non-zero, else
      null), `expiresAt = lastResponseAt + ttl`, `resendTokens` (that line's
      input side plus its output — the next request re-sends both), and
      `state`: `warm` before `expiresAt`, `cold` after, `compacted` when a
      `compact_boundary` is newer than the last response, `unknown` without
      TTL. Pure, `now` injected, degraded → null.
      verify: `tests/telemetry.test.ts` cases warm 1h, cold 5m, compacted,
      no-write-split → unknown, sidechain ignored, malformed tail.
- [x] **1.2 Resume fields from the hook.** `__hook-event` stores the four
      SessionStart resume fields (numbers and a boolean only).
      `sessionCache` prefers them while the resume event is newer than the
      last response.
      verify: `tests/hooks.test.ts` / sessions test with a resume fixture.

## Phase 2 — Show it where sessions are listed

- [x] **2.1 `sessions` text and JSON.** Text column for Claude rows:
      `cache warm till 10:42` / `cache cold · ~182k re-sent` /
      `cache compacted`; nothing when unknown. `--json` gains an additive
      `cache` object (`state`, `ttl`, `expiresAt`, `resendTokens`, `source`).
      verify: `tests/sessions.test.ts` + CLI snapshot updated.
- [x] **2.2 GUI session row.** The view model carries the cache state; the
      session row shows the same short text.
      verify: `gui/src/transforms.test.ts` (or the vm test) case for warm and cold.

## Phase 3 — Moves and commands name their price

- [x] **3.1 `takeover` (Claude).** Before acting, and in `--print-only` /
      `--json`: one line per D5 — e.g. `Cache: cold for 23 min — the first
      turn on MatneX re-sends ~182k, same as staying.` or `Cache: warm till
      10:42 — MatneX is another organization, its first turn re-sends ~182k.`
      verify: test of the pure line builder for warm/cold × same/other org.
- [x] **3.2 `rebind`.** The interactive picker and the one-shot output show
      the same line for the chosen target; the suggestion is unchanged (D4).
      verify: `tests/rebind-dialog.test.ts` row/line case.
- [x] **3.3 `compact`.** When the target session is cold, print before
      sending: `Cache cold for 23 min: this /compact re-reads ~182k as
      uncached input.` Never refuses.
      verify: test of the line builder; `--dry-run` output carries the line.
- [x] **3.4 Docs.** README session section and the Starlight sessions page
      describe the cache column and the move line.
      verify: `task docs:check`.

## Phase 4 — Hand-over

- [x] **4.1 Statusline bridge note.** Add an arrival line to
      `later/road-to-agent-switch-statusline-usage.md`: the status payload
      carries `prompt_cache` (v2.1.251+), which would replace 1.1's
      derivation (D1 revisit).
      verify: the line is in the file.

## Kill register

| ID | Killed | Why |
|---|---|---|
| K1 | Cache keepalive / dummy prompts | agent-switch never sends requests (NON-GOALS: no request-level anything) |
| K2 | Countdown toasts / pet bubble before expiry | noise, and it nudges the user into a manual keepalive; the session row shows the clock |
| K3 | In-session notice on `UserPromptSubmit` / SessionStart | D2 — AC's channel |
| K4 | AS statusline segment now | parked roadmap owns the bridge; 4.1 records the input |
| K5 | Money figures (`estimated_cache_write_usd`) | D3 |
| K6 | Automatic `/clear` / `/compact` / move on cold cache | NON-GOALS: agent-switch acts only when told |
| K7 | Ranking rebind / pool picks by cache cost | D4 |
| K8 | Codex cache state | rollouts carry no TTL; would be a guess |
| K9 | Cost engine, calibration, `session:cost` command (ChatGPT Phases 2, 5) | AC scope; agent-switch already has `sessions` |

## Acceptance criteria

- [x] AC-1 — `agent-switch sessions` shows warm/cold/compacted for Claude rows from the transcript alone.
- [x] AC-2 — `takeover`, `rebind` and `compact` name the cache cost before acting, organization-aware.
- [x] AC-3 — No new command, no block, no money, no in-session output.
