---
complexity: standard
status: complete
tree_pin: 7280df8
execution:
  mode: process-full
relates:
  - slug: road-to-a-start-the-user-can-predict
    relation: extends
    note: "Closes what the PR #103 review found after that roadmap was archived complete; reverses one of its declines."
  - slug: road-to-session-orchestration
    relation: disjoint
    note: "Leases, start admission, multi-OS lock and upgrade matrices, Team seats stay there."
---
# Road to a balance with numbers to weigh

> **Source:** `agents/tmp.old/inbox-2026-10-c/` — two review write-ups of PR #103
> (head `1975481`) and two roadmap drafts derived from them. No owner turn in the
> round; the owner decisions of `road-to-a-start-the-user-can-predict` hold (plain
> starts balance across enabled accounts; `share on` shares the prompt history).
> Every claim re-verified at `7280df8`.
>
> **Arrivals:** 1 — `inbox-2026-10-c` (2026-10-29). Item D1 below is a second
> arrival of a point declined in `inbox-2026-10-b`.

## Goal

1. A folder bound to one account never starts on another one.
2. A plain `claude` is balanced whenever agent-switch has fresh usage — from the
   app's own refresh, not only from the background service.
3. No path in agent-switch refreshes or moves a login a profile shares with the
   default install, and old imports can be found and marked.
4. The last write race (`state.json`) and the wording slips the review found are closed.

## Decisions

| ID | ownership | resolved by | decision | evidence | revisit if |
|---|---|---|---|---|---|
| D1 | reversible-technical | agent (reopened) | A rule to one profile that is disabled or gone refuses the start (exit 86), like a pool rule. Reverses the `inbox-2026-10-b` decline: that decline argued "keeps the folder usable", which is the very argument its own D3 rejected for pools — a rule is a boundary first. Second arrival, resolved on that inconsistency, not on the count. | `src/dir-resolve.ts` — a disabled or missing mapped profile calls `balancePlain` | the owner asks for a fallback on a disabled bound account |
| D2 | reversible-technical | agent | Every successful usage read (`status --json`, daemon) also writes an unthrottled per-profile `usage-latest.json`; `dir` uses the newest of daemon state, latest snapshot and history. The 55-minute throttle stays for the history only. | `src/index.ts:688` records only via `recordHistorySample`, throttled by `HISTORY_MIN_GAP_MS` (`src/history.ts:33`, 55 min), while `dir` trusts usage younger than 10 minutes (`FRESH_USAGE_MS`); `README.md:77` claims the app's refresh is enough | the service becomes mandatory for balancing |
| D3 | reversible-technical | agent | `rebind` refuses when either side shares the default install's login. | `src/rebind.ts:665` refreshes the target before moving its login; `src/rebind.ts` never reads the marker | the provider documents a refresh that does not invalidate the sibling store |
| D4 | reversible-technical | agent | Profiles imported before the marker existed are found by identity: same account as the default install and no marker → doctor says it *may* share the login; `agent-switch mark-shared <name> [--off]` sets or clears the mark. | Only the two import paths set the marker (`src/index.ts`); the archived risk text "old imports can be marked by signing in separately" is wrong — a sign-in clears the mark | the default store gains a lineage id a profile can be compared against |
| D5 | reversible-technical | agent | A setting with no value in force is shown as a line, not as a choice. | `settings/protection.tsx` "When usage is unknown" offers Warn me / Pause with nothing selected | the protection engine ships an unknown-usage policy |

## Phase 1 — A bound account is a boundary (D1)

- [x] **1.1 Refuse a disabled or missing mapped profile.** `resolveForDir` returns
      `blocked` for a rule whose profile is disabled or gone, with the fix
      (`agent-switch enable <name>` / `map` anew / `unmap`).
      verify: `npm test` → 0 — resolver cases for disabled and missing, and a CLI
      e2e asserting exit 86 and no config dir.
- [x] **1.2 Docs and the reversed decline.** `cli.md` (`dir`) and
      `mappings-and-sharing.md` describe the refusal; the archived roadmap's
      "Not taken here" row for P0-02 records the reversal.
      verify: `task docs:check` → 0.

## Phase 2 — Balancing has fresh numbers without the service (D2)

- [x] **2.1 Latest-snapshot cache.** `usage-latest.json` per profile (one snapshot,
      atomic, `0600`, no token), written by `status --json` and the daemon on every
      successful read.
      verify: `npm test` → 0 — two reads minutes apart both update the latest
      snapshot while the history keeps one sample.
- [x] **2.2 `dir` reads the newest source.** `cachedUsage` takes the newest of
      daemon state, latest snapshot and history; the reset-time carry-over stays.
      verify: `npm test` → 0 — a fresh latest snapshot balances, a 12-minute-old
      one does not.
- [x] **2.3 Screens and docs agree.** Regenerate the captures so the banner and the
      rows agree; `README.md` and `cli.md` say which reads keep `dir` fresh.
      verify: `accounts.png` / `start-session.png` show no "too old" line next to
      rows checked within 10 minutes; `task docs:check` → 0.

## Phase 3 — No path touches a shared login (D3, D4)

- [x] **3.1 `rebind` refuses a marked profile**, as target or as the running
      profile, before any refresh, naming the fix.
      verify: `npm test` → 0 — rebind cases assert `freshen` is never called.
- [x] **3.2 Pool fallback skips a marked profile.** The stale-usage fallback's
      `usable` filter excludes it; a pool of only marked members refuses.
      verify: `npm test` → 0.
- [x] **3.3 Find old imports.** Doctor's `shared-login` check also names unmarked
      profiles whose identity equals the default install's, worded "may share".
      verify: doctor fixture with marked, same-identity unmarked and unrelated profiles.
- [x] **3.4 `mark-shared <name> [--off]`.** Sets or clears the marker; in help and `cli.md`.
      verify: CLI e2e — after `mark-shared work`, `dir --json` skips `work` with the
      shared-login reason.
- [x] **3.5 Correct the archived risk text** in
      `archive/road-to-a-start-the-user-can-predict.md` (Risk 2).
      verify: `grep -n "marked by signing in" agents/roadmaps/archive/road-to-a-start-the-user-can-predict.md` → no match.

## Phase 4 — Last race and slips

- [x] **4.1 `state.json` under the store lock, written atomically.** Every
      read-modify-write of the state runs inside `withFileLockSync`; the write goes
      through temp + rename.
      verify: `npm test` → 0 — concurrent processes toggling `disabled` and labels lose nothing.
- [x] **4.2 Ask the PowerShell the user runs first.** Order `pwsh` / `powershell`
      by the environment (`PSModulePath` of 5.1 vs 7), then the other, then the fallback path.
      verify: `npm test` → 0 with an injected 5.1 environment.
- [x] **4.3 No choice without a value (D5).** "When usage is unknown" becomes a
      read-only line.
      verify: settings test asserts no radio group in that row.
- [x] **4.4 Antigravity says why per OS.** Off macOS the start dialog disables it
      with "Antigravity profiles need macOS for now".
      verify: start-dialog test on a Linux fixture.
- [x] **4.5 Commands do not wrap mid-command** in the start dialog's reasons.
      verify: regenerated `start-session.png` inspected. *Note:* with fresh demo usage
      the capture no longer shows a command line; `reasonParts` is covered by unit tests,
      including prose that merely starts with "agent-switch".
- [x] **4.6 Found on the way: a level tie took the account about to hit its 5h limit.**
      The capture picked `side` (94 % of its 5h window) as "the first of them". A level
      tie now goes to the plain-start account, then one without a live session, then
      the one with the most room in its fullest window (`balance.ts` `peak`).
      verify: `npm test` → 0 with a busy-vs-calm tie case; `start-session.png` picks
      `work` "with the most room right now".

## Not taken here — where each review point went

| Point | Disposition |
|---|---|
| A second resolution shape `{kind, code, recovery[]}` (AS103-002) | `declined`: `blocked` was added to the existing JSON additively; a second shape would break consumers for no behaviour gain |
| One-time override for another account (AS103-003) | `already-satisfied`: `agent-switch run <profile>` and the start dialog's account picker start on a named account without touching the rule |
| Pool fallback policy `ask \| fallback-member \| block` (review, AS103-004; asked twice in the source) | `declined`: the fallback is already labelled in `dir`'s reasons ("No member of pool … has fresh usage — using …"); with D2 fresh usage is the normal case, so a third setting buys little — revisit if a stale pick hits an exhausted account in use |
| Start admission race between `dir` and spawn (AS103-005) | parked in `later/road-to-session-orchestration.md` Phase 2 (leases) |
| Seeded-credential matrix, refresh singleflight (AS103-006/007) | `already-satisfied` for agent-switch's own refreshes (`usageToken`); provider-side singleflight parked in Phase 3 there |
| Lock crash / Windows tests on real systems (review, AS103-008) | parked in Phase 6 there; the Windows `EPERM` case is handled since `1975481` |
| Version-matrix migration, rebind with parallel sessions (AS103-009/010) | parked: Phase 6 (upgrade fixtures) and Phase 4 (rebind isolation) there |
| Reason on every surface incl. tray (AS103-011) | parked in Phase 6 there; `dir --json` and the start dialog carry it |
| No reauth banner for disabled accounts/providers, pet, autostart once (AS103-012…014) | `already-satisfied` in PR #103 (`gui/src/vm/build.ts` `loginInUse`, `pet-anchor.ts`, `serviceAfterUpdate`) |
| CI and native smoke, security audit, orchestration backlog (AS103-016…018) | CI runs per push; native smoke and audit parked in Phase 6 there; orchestration owned there |

## Risk Register
<!-- risk-review: v1 | reviewed: 2026-10-29 | reviewer: claude/host -->

| Rank | Item | Risk type | Description | Mitigation | Anchored under |
|------|------|-----------|-------------|------------|----------------|
| 1 | Refusal surprises a user who disabled a bound account | product | Starts in that folder stop until the rule is changed | The message names the rule and the three fixes; only exit 86 blocks | Phase 1 |
| 2 | Identity match flags a separate login of the same account | implementation | A profile signed in on its own looks like an import | Doctor says "may"; `mark-shared --off`; nothing is blocked by the heuristic | Phase 3 |
| 3 | Locking `state.json` slows the shell wrapper | implementation | `dir` runs on every start | Reads stay lock-free; only writes lock | Phase 4 |

## Acceptance Criteria

- [x] AC-1 — A folder bound to a disabled or removed profile refuses the start; no other account is used.
- [x] AC-2 — With the app open and no service installed, a plain `claude` balances on usage read within 10 minutes.
- [x] AC-3 — `rebind`, the daemon, `status` and the pool fallback never refresh or pick a marked profile; doctor lists likely old imports.
- [x] AC-4 — Concurrent writers to `state.json` lose no change.
- [x] AC-5 — Root `npm test`, `cd gui && npx vitest run`, `npx tsc --noEmit`, `task docs:check` green; captures inspected.
