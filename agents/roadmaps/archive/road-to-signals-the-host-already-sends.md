---
complexity: standard
status: done
tree_pin: 28d7337
---

# Roadmap: read the signals the host already sends

> **Source:** `agents/tmp.old/inbox-2026-10-d/` — two competing deep-analysis
> roadmaps (one per assistant, both pinned to v2.5.0 / `932df80`) and the owner's
> transcript asking for a deep comparison against five "switchboard"-class tools.
> Claims re-verified at `28d7337` (v2.6.3) against the tree and against the
> installed Claude Code 2.1.314 binary. Related, already-consumed inbox material
> (`profile-switch/`, `token-and-context.txt`) is covered by the archived
> `road-to-session-handoff` and `road-to-agent-switch-session-telemetry`.

## Goal

agent-switch guesses in three places where Claude Code now reports the answer
itself. This roadmap stops guessing where the host's own data is local, cheap
and verified, and says honestly what the host does at the limit. It adds no
proxy, no request routing and no automatic account switch (NON-GOALS.md).

## Verified facts this roadmap builds on

| Fact | Evidence |
|---|---|
| The live registry `<config>/sessions/<pid>.json` carries `sessionId`, `status` (`idle`, `shell`, …), `statusUpdatedAt`, `kind` | read of 10 local registry files, CC 2.1.309–2.1.312 |
| agent-switch reads only the file NAME and pid liveness, then guesses the live transcript by pid → cwd → newest file in that dir | `src/api.ts:143-157`, `src/sessions.ts:237-253` |
| `StopFailure` hook input: `error`, `error_details`, `last_assistant_message`; `error` ∈ `rate_limit`, `authentication_failed`, `oauth_org_not_allowed`, `account_on_hold`, `billing_error`, `overloaded`, `server_error`, `unknown`, … | strings of the CC 2.1.314 binary |
| agent-switch installs no `StopFailure` hook | `src/hooks.ts:29` |
| `Notification` hook input: `message`, `title`, `notification_type`; types include `quota_auto_resume_{armed,cancelled,disabled,fired,offer,setting,stale}` | strings of the CC 2.1.314 binary |
| `autoContinueAtUsageLimit` (user setting): "wait for the limit to reset and continue automatically. When off, the limit dialog offers the wait as a choice." An absent key reads as on | strings of the CC 2.1.314 binary |
| Protection only warns and says so | `src/protection.ts:7-10` |
| `listSessions` reads the 64 KiB header of every transcript, then sorts and caps | `src/sessions.ts:163-209` |
| Launch gate at the protection threshold already exists for new starts | `src/dir-resolve.ts:54,138` |

## Phase 1 — Live state from the host's own registry

- [x] **Read the registry contents, defensively.** `liveSessions(configDir)` in
      `src/api.ts` returns `{pid, sessionId|null, status|null, statusUpdatedAt|null}`
      for every live pid. A malformed or unreadable file degrades to the pid alone.
      `liveSessionPids` keeps its contract on top of it.
- [x] **Mark live by session id, fall back to the cwd guess.** `markLive` marks a row
      live when a live registry entry names its `sessionId`; only pids without a
      readable id go through the pid → cwd → newest-file path. Rows carry
      `hostStatus` (the registry's word, verbatim) and `liveSource`
      (`registry` | `cwd`).
- [x] **Expose it additively.** `sessions --json` gains `hostStatus` and `liveSource`;
      the text listing shows the host status next to "live". No field is removed.

## Phase 2 — A stopped session says why

- [x] **Install `StopFailure`.** Add it to `HOOK_EVENTS`; the existing
      `hooksInstalled` check makes `hooks install` upgrade old installs in place.
      Record `error` on the event (`HookEventRecord.error`), never the message body.
- [x] **Turn the error into a needs-you notice with a reason.** `rate_limit` →
      "hit its usage limit", `authentication_failed` / `oauth_org_not_allowed` →
      "is signed out", `account_on_hold` → "account is on hold", `billing_error` →
      "has a billing problem", anything else → "stopped with an error (<type>)".
- [x] **Map the native wait.** A `Notification` whose `notification_type` is
      `quota_auto_resume_armed` / `_fired` / `_stale` / `_disabled` / `_cancelled`
      becomes "waiting for the limit to reset", "resumed after the reset",
      "the wait went stale", "auto-continue is off", "the wait was cancelled".
      Store `notification_type` on the event record.

## Phase 3 — Protection knows whether the host waits

- [x] **Read the effective setting per profile.** `autoContinueState(configDir)` →
      `on` | `off` | `default` (key absent; the host treats it as on) from the
      profile's `settings.json` (a shared link reads the shared source).
- [x] **Say it on every protection surface.** `protection` (text and `--json`
      field `hostWaits`) and the threshold warning: "Claude waits at the limit and
      continues after the reset" vs "auto-continue is off — the session stops at
      the limit". Never "paused".
- [x] **Opt-in switch, never a default flip.** `agent-switch protection wait on|off
      [profile]` writes `autoContinueAtUsageLimit` into that profile's settings —
      through the share source when `settings.json` is shared, so the link does not
      fork — and says which profiles it affected.

## Phase 4 — The session list reads only what it shows

- [x] **stat, sort, cap, then read headers.** `listSessions` collects
      `{file, mtime, birthtime}` first and reads `readSessionHeader` only for the
      rows it returns. Test: with N transcripts and `limit` L, the header reader
      runs L times.

## Phase 5 — Every automatic pick can be explained afterwards

- [x] **Pick ledger.** Each automatic start pick
      appends `{at, provider, chosen, why, blocked?, note?}` to
      `~/.agent-switch/picks.jsonl` (`why` carries the candidates and skips in the
      resolver's own words); recorded for `dir --guard`, the shell wrapper's start, ring-capped at 500, mode 0600, no prompt text.
- [x] **`agent-switch picks [--recent N] [--json]`** prints the ledger. This is the
      evidence base the scheduler tuning (stub below) needs.

## Phase 6 — Honest text

- [x] **A move says what it costs.** The session sheet's "Move to another account" (switch live and take over) and the CLI `takeover` output say the
      first turn on the other account re-reads the whole context without cache,
      and that right after a compaction is the cheapest moment.
- [x] **NON-GOALS: what agent-switch holds.** A short section: where logins live
      (each provider's own store per profile), the one exception (`rebind` writes a
      credential store, ADR-003), what never happens (no token leaves the machine,
      no request is proxied or replayed). Not legal advice.
- [x] **README** documents `hostStatus` / `liveSource`, the `StopFailure` reasons,
      `protection wait`, and `picks`.

## Decisions

| # | Decision | Alternatives | Reason | Revisit-if |
|---|---|---|---|---|
| D1 | The registry file is the first live source; `claude agents --json` is not called | spawn `claude agents --json` per profile per poll | the registry is already on disk, costs one read, and carries the fields; a CLI spawn per profile per daemon cycle is unmeasured | the registry stops carrying `sessionId`/`status`, or `agents --json` adds a field AS needs |
| D2 | Auto-continue is shown and switchable on request, never set by default (inbox E2) | write it into shared settings automatically | a write to the user's Claude settings is a consumer-facing change; an explicit command is the consent | owner asks for it on by default |
| D3 | No priming of 5h windows (inbox E1) | daemon sends requests to start windows | contradicts "nothing happens by itself"; spends quota | owner opts in per account |
| D4 | Scheduler constants stay (±5 %) until the ledger has data | adopt leeovery's 0.8 band / 20 % hysteresis now | those constants were fitted to per-request-fresh data; AS sees ≤10 min old snapshots | stub `scheduler-replay` fires |
| D5 | Killed: proxy / mid-session replay, CC-impersonating probes, complexity-based model routing, own multi-session board, remote/phone server, auto-trusting folders for `/stats` | — | NON-GOALS, legal-and-compliance page, and the authors' own retirement (ruban-24) | never on this roadmap |
| D6 | Read-only MCP/HTTP API for agent-config (inbox AS-401) declined here | build it now | `--json` on every command is already the machine contract; a server is a NON-GOAL | agent-config names a call `--json` cannot serve |

## Not on this roadmap (owned elsewhere or parked)

- statusLine `rate_limits` re-run of the Phase-0 spike → `../later/road-to-agent-switch-statusline-usage.md` (Arrivals line).
- Real pause before the limit, Codex turn gate, staggered resume → `../later/road-to-session-orchestration.md` Phase 1.
- Parked in `../later/road-to-host-signals-followups.md` (need elapsed time, live apps or permissions):
  - `scheduler-replay` — replay `picks.jsonl` + usage history against band / hysteresis / reserve candidates; trigger: 4 weeks of ledger data.
  - `codex-session-parity` — originator tag with cwd + spawn-time fallback, titles from `session_index.jsonl`, subagent filter; trigger: a Codex session-list complaint or a Codex CLI release that documents the originator.
  - `antigravity-usage` — only through a surface `agy` itself offers; trigger: `agy` ships a quota command.
  - `tty-jump` — focus iTerm / Terminal.app by tty via AppleScript; trigger: owner wants it (needs Automation permission).
  - `preview-masking` — mask token-shaped strings in previews and notices; trigger: a preview is seen carrying a secret.

## Risk register

| Risk | Mitigation |
|---|---|
| Registry format is internal and may change | every field optional; unreadable → today's heuristic |
| `StopFailure` error enum grows | unknown values map to a generic "stopped with an error (<type>)" |
| `autoContinueAtUsageLimit` default differs by version or rollout | absent key reported as `default`, never as a promise |
| Writing settings forks a shared link | write through the share source (`share.ts`), test the shared case |
