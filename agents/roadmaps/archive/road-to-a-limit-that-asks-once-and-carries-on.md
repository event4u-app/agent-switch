---
complexity: large
status: done
---

# Roadmap: a limit that asks once and carries on

> **Source:** owner request 2026-11-04 (chat): Codex limits that refresh by
> themselves, switch accounts only when needed, a dialog the user confirms when
> a switch cannot be automatic (Claude and Codex), and the session continues by
> itself after the switch — without crossing a provider's terms.

## Constraints (do not relitigate)

- A running session changes its account only after the user confirms it
  (`NON-GOALS.md` § No request-level routing). A confirmed dialog is that
  confirmation; a silent automatic switch is out.
- Redeeming the user's own banked Codex reset is opt-in (`auto-reset`).
- No new credential-store write path: Claude switches via `rebind` (ADR-003),
  Codex via `takeover` (move + resume), never by rewriting Codex's `auth.json`.

## Phase A — Limits that are fresh

- [x] **A1 Codex sessions count as live for polling.** A Codex profile with a
      running `codex` process (CODEX_HOME = the profile) is polled at the base
      cadence, like a Claude profile with a live session, not every 5 minutes.
- [x] **A2 Limits from the session file.** Codex writes `rate_limits` after
      every turn into its rollout; the daemon reads the newest one per profile
      (local, no network) and keeps it when it is newer than the last capture.
- [x] **A3 After a reset.** A window whose `resetsAt` has passed while it was at
      the threshold is re-polled on the next cycle, and "<account> is free again"
      is announced once.

## Phase B — Switch only when needed

- [x] **B1 Start strategy.** `agent-switch strategy balance|fill [--provider P]`:
      `balance` (default, today) spreads new starts; `fill` keeps starting on
      the preferred account until it reaches its protection threshold, then the
      account with the most headroom.
- [x] **B2 Running sessions stay put** until the limit is actually reached —
      the limit dialog (C) fires on the real limit, not on a forecast.

## Phase C — A dialog instead of a bell

- [x] **C1 Limit reached → attention item.** Claude `StopFailure: rate_limit`
      for a session, and a Codex account at 100 %, raise one "limit reached"
      item per session / account and cycle, with an OS notification.
- [x] **C2 The window opens the limit sheet by itself** for a new "limit
      reached" item (once per item), with the best free account preselected.

## Phase D — Carry on after the switch

- [x] **D0 Spikes.** (a) Does Claude's wait-for-reset pick up a rebind before
      the reset? (b) Can a running Codex reread a changed login? Record the
      answer; build only on what is verified.
      Recorded 2026-11-04: (a) not verifiable without a real limit hit on this
      machine — nothing depends on it: after the switch Agent Switch types the
      continuation itself where it may, and asks for one message elsewhere.
      (b) not pursued: testing it means writing Codex's `auth.json`, which the
      constraints above rule out; Codex moves via `takeover` instead.
- [x] **D1 Claude: rebind, then continue** where agent-switch may type: a GUI
      chat (bridge `send`) or a managed tmux pane (`send-keys`). In the user's
      own terminal, say plainly that one message continues it.
- [x] **D2 Codex: move, then resume with a prompt** — `takeover` to the target
      and `codex resume <id> "<continue>"`, in place where the pane is managed,
      else in a new terminal window.
- [x] **D3 Docs** for A–D (CLI reference, Codex guide, move-a-session guide).
