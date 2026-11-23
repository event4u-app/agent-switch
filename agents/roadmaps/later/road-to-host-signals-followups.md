---
complexity: standard
status: parked
review_by: 2027-01-07
entry_condition:
  what: "Scheduler: `head -1 ~/.agent-switch/picks.jsonl` is 28 or more days old (PICKS_MAX_LINES is 1000 since 2026-11-23, about 66 days at ~15 starts/day; the ledger starts 2026-11-01, so not before 2026-11-29). Protection: a user asks for bulk `wait` setting. Codex: a Codex CLI release documents the originator (remaining scope: titles from ~/.codex/session_index.jsonl plus start->rollout mapping). Antigravity: `agy --help` lists a quota or usage command. Masking: see the owner question in this file's triage line."
  when: "Checked at every /roadmap:triage-parked; review_by 2027-01-07."
  who: "owner / upstream releases"
---

# Roadmap: host-signal follow-ups (need data, a live app or a permission)

> Last triaged: 2026-11-07 — the ledger condition as written could never fire: `PICKS_MAX_LINES = 500` (`src/picks.ts:20`) holds about 21 days, not 4 weeks — rewritten above. Terminal jump shipped (74206e3) and flipped. Codex parity partly shipped (subagent threads, rollout rate_limits). "Mask secrets in previews and notices" has no real gate (`redactSecrets` is used only in `src/activity.ts:53`, `src/picks.ts:37`) and is agent-executable now — put to the owner in the triage run of 2026-11-07.
> Last run: 2026-11-23 — Codex OSC 7501 and bulk `wait --all` shipped; ledger cap raised to
> 1000. Still parked: the ledger replay (a date), Codex session parity (no Codex release
> documents the originator; 0.167.0 checked), Antigravity usage (`agy --help` lists none).
> **Decided 2026-11-07 (owner, option 1):** "Mask secrets in previews and notices" moved to [`road-to-the-ready-remainders.md`](../archive/road-to-the-ready-remainders.md) 3.4.

> **Source:** `agents/tmp.old/inbox-2026-10-d/` — the parts of the switchboard
> comparison that `archive/road-to-signals-the-host-already-sends.md` could not
> close in one session. Each item names the trigger that makes it workable; until
> then it stays parked.
>
> **Arrivals:** 1 — `inbox-2026-11-22` (2026-11-22): hosted Codex state stays the
> 60 s transcript guess (finding F9 of `../archive/road-to-a-tree-that-reads-at-a-glance.md`),
> landed below under § Codex.

## Scheduler

- [ ] **Replay the pick ledger before tuning the balance rule.** Run the records in
      `~/.agent-switch/picks.jsonl` plus each profile's `usage-history.json` against
      the candidates one at a time: a near-equal band at 0.8× the best with an
      earliest-5h-reset tie-break, 20 % hysteresis, a per-account reserve the
      automatic pick never spends, and a 30-minute pressure term. Measure unused
      rest at reset, limit hits and account flapping. Adopt a candidate only with a
      measured gain; otherwise ±5 % stays (`src/balance.ts`).
      _Resume when:_ the ledger holds 4 weeks of starts.

## Protection

- [x] **Return a profile to Claude's own default.** `protection wait default
      <claude/name>` removes `autoContinueAtUsageLimit` from settings.json instead of
      writing `false`, so a user who set it can return to inheriting Claude's
      default. Same affected-profiles list as `on|off`. (Council 2026-10-31, see D2 in
      `../archive/road-to-signals-the-host-already-sends.md`.)
      _Resume when:_ a user asks to undo `wait on|off`, or the next change to `protection wait`.
- [x] **Bulk `protection wait on|off --all` with a preview.** Explicit and opt-in,
      never automatic: show every resolved settings target (deduplicated across
      shared links) before writing, check the targets again right before the
      write, and report partial failure.
      _Resume when:_ a user asks for bulk setting, or Claude Code changes the absent
      default to off.
      _Done 2026-11-23 (the owner asked to finish this roadmap):_ `protection wait
      on|off|default --all [--yes]` — preview without `--yes`, shared links listed once
      with every profile, re-check before each write, per-target result, exit 1 on a
      partial failure.

## Codex

- [ ] **Session parity for Codex.** Map a start to its rollout through an originator
      tag, with cwd + spawn time as the mandatory fallback (the originator variable
      is internal to Codex); titles from `session_index.jsonl`; hide subagent
      rollouts; read passive `rate_limits` from rollouts only when `sessions/` is not
      shared. _Resume when:_ a Codex CLI release documents the originator, or a
      Codex session-list complaint arrives.
- [x] **A hosted Codex session reports its own state.** Codex has three hook
      events and no prompt hook (`src/codex-hooks.ts:28`), so even after
      `../archive/road-to-a-tree-that-reads-at-a-glance.md` Phase 1 its state is the 60 s
      transcript guess. An MIT-licensed reference (`923b19d`) parses OSC 7501, the
      open Program Status Protocol, and lists Codex 0.163.0 as sending it unasked
      (`src/shared/program-status/protocol.ts`, `osc-scanner.ts`;
      `src/main/agent-hooks/README.md:49`). Spike first: does `tmux pipe-pane -O`
      deliver the raw `ESC ] 7501 ;` reports from a hosted window, does the
      installed Codex send them without a probe, and what one pipe per window costs
      against `agents/evidence/hook-relay-latency-2026-11.md`. Then port the parser
      with the MIT notice in `ADOPTED.md`, feed it as runtime source `"program"`
      below hooks, and never answer a probe (it would type outside the input lease,
      `src/host/lease.ts`). _Resume when:_ the tree roadmap's Phase 1 has shipped
      and a hosted Codex session is in daily use.
      _Done 2026-11-23:_ spike GO (Codex 0.167.0 sends `state=idle|working|done`
      unasked; `agents/evidence/codex-osc-7501-and-claude-get-usage-2026-11.md`).
      `src/program-status.ts` (parser re-derived, no R1 code copied), `pipe-pane -O`
      in `src/host/tmux-host.ts`, runtime source `"program"` below hooks and the host
      word. A hosted window is matched to its rollout by id, else account + cwd +
      first rollout after the window start.

## Antigravity

- [ ] **Usage readout through a surface `agy` itself offers.** No direct call to
      Google Cloud Code endpoints with the user's token (NON-GOALS: impersonation).
      _Resume when:_ `agy` ships a quota or usage command.

## Desktop

- [x] **Jump to a session's terminal.** Focus iTerm / Terminal.app by the session's <!-- shipped: src/focus-terminal.ts:1-8,77-79; gui/src/v3/settings.tsx:262; commit 74206e3 (triage 2026-11-07) -->
      tty through AppleScript; report error -1743 as "Automation permission denied";
      no double trigger. The Claude Desktop deep link stays out (undocumented, can
      hit the wrong instance). _Resume when:_ the owner asks for it (needs the
      Automation permission).
- [ ] **Mask secrets in previews and notices.** Run session previews and <!-- moved-to: archive/road-to-the-ready-remainders.md 3.4 (2026-11-07) -->
      notification text through `redactSecrets` (`src/activity.ts`) before they are
      shown. _Resume when:_ a preview or notice is seen carrying a token-shaped
      string.
