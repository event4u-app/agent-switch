---
complexity: standard
status: planned
---

# Roadmap: host-signal follow-ups (need data, a live app or a permission)

> **Source:** `agents/tmp.old/inbox-2026-10-d/` — the parts of the switchboard
> comparison that `archive/road-to-signals-the-host-already-sends.md` could not
> close in one session. Each item names the trigger that makes it workable; until
> then it stays parked.

## Scheduler

- [ ] **Replay the pick ledger before tuning the balance rule.** Run the records in
      `~/.agent-switch/picks.jsonl` plus each profile's `usage-history.json` against
      the candidates one at a time: a near-equal band at 0.8× the best with an
      earliest-5h-reset tie-break, 20 % hysteresis, a per-account reserve the
      automatic pick never spends, and a 30-minute pressure term. Measure unused
      rest at reset, limit hits and account flapping. Adopt a candidate only with a
      measured gain; otherwise ±5 % stays (`src/balance.ts`).
      _Resume when:_ the ledger holds 4 weeks of starts.

## Codex

- [ ] **Session parity for Codex.** Map a start to its rollout through an originator
      tag, with cwd + spawn time as the mandatory fallback (the originator variable
      is internal to Codex); titles from `session_index.jsonl`; hide subagent
      rollouts; read passive `rate_limits` from rollouts only when `sessions/` is not
      shared. _Resume when:_ a Codex CLI release documents the originator, or a
      Codex session-list complaint arrives.

## Antigravity

- [ ] **Usage readout through a surface `agy` itself offers.** No direct call to
      Google Cloud Code endpoints with the user's token (NON-GOALS: impersonation).
      _Resume when:_ `agy` ships a quota or usage command.

## Desktop

- [ ] **Jump to a session's terminal.** Focus iTerm / Terminal.app by the session's
      tty through AppleScript; report error -1743 as "Automation permission denied";
      no double trigger. The Claude Desktop deep link stays out (undocumented, can
      hit the wrong instance). _Resume when:_ the owner asks for it (needs the
      Automation permission).
- [ ] **Mask secrets in previews and notices.** Run session previews and
      notification text through `redactSecrets` (`src/activity.ts`) before they are
      shown. _Resume when:_ a preview or notice is seen carrying a token-shaped
      string.
