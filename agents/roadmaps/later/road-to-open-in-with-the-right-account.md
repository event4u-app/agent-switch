---
complexity: standard
status: parked
relates:
  - slug: road-to-session-orchestration
    relation: split-from
    note: "Its step P4.7 (IDE surfaces), which had no scope; the owner asked on 2026-11-08 to plan it here for later instead of cancelling it."
review_by: 2027-02-08
entry_condition:
  what: "The owner picks this up, or a user reports that an IDE opened via \"Open in\" signed in with the wrong account."
  when: "Checked at every /roadmap:triage-parked; review_by 2027-02-08."
  who: "owner"
---

# Road to "Open in" with the right account

> **Source:** `later/road-to-session-orchestration.md` step P4.7 ("IDE surfaces
> (VS Code / JetBrains / Antigravity extensions) only after tests"). At the
> triage of 2026-11-08 the owner first cancelled it for lack of scope, then asked
> to plan it for later. Parked on 2026-11-08.
>
> _Resume when:_ see `entry_condition`. Nothing here is blocked by code; it waits
> for the owner to want it.

## Goal

When a session is opened in an IDE, the IDE's own Claude Code (or Codex)
extension runs under the same account as the session — not under whatever
account happens to be the default.

## Verified facts at planning time (2026-11-08)

- "Open in" exists for VS Code, Cursor, PhpStorm, IntelliJ IDEA, Finder and the
  terminal (`src/open-in.ts:18-34`). It opens the session's folder with the
  tool's own launcher and passes **no profile environment** — no
  `CLAUDE_CONFIG_DIR` (`src/open-in.ts:80-101`). An IDE extension started from
  there therefore uses the default account.
- Antigravity is not a target yet.
- Unknown: VS Code-family launchers (`code`, `cursor`) hand a folder to an
  already running instance, whose environment wins. Whether a per-account window
  needs its own `--user-data-dir`, and what JetBrains does, is not established.

## Phase 1 — Find out what works

- [ ] **1.1 Spike per IDE family.** For VS Code/Cursor and one JetBrains IDE:
      does an IDE started with `CLAUDE_CONFIG_DIR=<profile>` make its Claude Code
      extension use that account, with and without an instance already running?
      Record the result per IDE (works / needs own user-data-dir / not possible).
      verify: a written result table in this file, one row per IDE, from two
      accounts on one machine.
- [ ] **1.2 Decide the shape** from 1.1: profile environment only, a separate
      IDE window per account, or "not supported" shown in the menu. Owner
      confirms if a separate user-data-dir per account is needed (it duplicates
      IDE settings).
      verify: the decision recorded under `## Decisions` with its reason.

## Phase 2 — Open in, with the account

- [ ] **2.1 Pass the session's profile to the IDE launch** for the targets 1.1
      marked as working; targets that cannot do it say so in the "Open in" menu
      instead of silently using the default account.
      verify: `open-in` tests assert the launch plan carries the profile
      environment for working targets and the "not supported" note for the rest.
- [ ] **2.2 Antigravity as a target**, only if 1.1 shows it can take the profile.
      verify: menu and plan tests for the new target.
- [ ] **2.3 Docs:** the "Open in" section names which IDEs open with the
      session's account.
      verify: the docs build and link check pass.

## Decisions

- None yet.
