---
complexity: standard
status: complete
tree_pin: 744980b
execution:
  mode: process-full
relates:
  - slug: road-to-honest-foundations
    relation: extends
    note: "Closes gaps the PR #102 review found in its bindings, readouts and wording."
  - slug: road-to-session-orchestration
    relation: disjoint
    note: "Real pause/resume, leases, the sign-in lifecycle and the release-hardening matrix stay there."
---
# Road to a start the user can predict

> **Source:** `agents/tmp.old/inbox-2026-10-b/` — two review write-ups of PR #102,
> two roadmap drafts derived from them, and one owner turn ("erstelle eine roadmap
> im ac style"). Every claim was re-verified at `744980b` (2.2.0, PR #102 merged);
> drafts were read as proposals, not as an adopted basis.
>
> **Arrivals:** 1 — `inbox-2026-10-b` (2026-10-29).

## Goal

After 2.2.0, four things should hold that do not hold at the pin:

1. A folder bound to a pool never starts on an account outside that pool.
2. No background refresh logs out the login a profile shares with the default install.
3. No screen says "protected" or "paused" where agent-switch only warns, and no
   disabled control shows a value that is not in force.
4. Small defects the review found are closed (start dialog, PowerShell profile,
   storage races, archived roadmap status).

## Decisions

| ID | ownership | resolved by | decision | evidence | revisit if |
|---|---|---|---|---|---|
| D1 | owner | owner, this session | Plain starts without a folder rule keep balancing across the enabled accounts. The archived constraint "inside explicitly created pools only" is rewritten to match. | Owner, 2026-10-29: "Warum musste ich sagen agent-switch use ArturB ??? Das soll AS doch automatisch machen"; `src/dir-resolve.ts:122-133` | the owner asks to scope balancing by label or exclude Team seats |
| D2 | owner | owner, this session | `share on` keeps sharing the prompt history across accounts. | Owner, 2026-10-29: "vorher konnte ich die über alle accounts hinweg nutzen und alte commands suchen. Können wir das fixen?"; `src/share.ts` `LOG_ITEMS` | the owner asks for a per-label split |
| D3 | reversible-technical | agent | A pool binding stays inside its pool: with no fresh member it picks a member, and with no usable member it refuses the start (guard exit 86) instead of using the active profile. | `src/dir-resolve.ts:93,101,107` call `fallbackToActive` | refusing blocks real work more often than it protects |
| D4 | reversible-technical | agent | A profile created by `import` with a seeded credential is marked as sharing its login with the default install; agent-switch never refreshes it and never balances onto it. | `src/index.ts:449-452` warns that "the first side to refresh invalidates the other"; `src/daemon.ts:376` refreshes every polled profile | the provider documents a refresh that does not invalidate the sibling store |
| D5 | reversible-technical | agent | Wording follows behaviour: protection "warns at N %", nothing is "paused"; disabled controls show the value in force. | `src/protection.ts` header; `gui/src/redesign/screens/accounts.tsx:293`; `gui/src/vm/rules.ts:111`; `settings/protection.tsx:127,147` | real pause ships (`road-to-session-orchestration` Phase 1) |

## Phase 1 — Bindings stay inside their pool (D3)

- [x] **1.1 Pick inside the pool when usage is stale.** In `resolveForDir`
      (`src/dir-resolve.ts`), a pool whose members have no fresh usage uses the
      plain-start account when it is a usable member, otherwise the first usable
      member — never an account outside the pool.
      verify: `npm test` → 0, with a `tests/foundations.test.ts` case "pool work,
      active personal, stale usage → a work member".
- [x] **1.2 Refuse when the pool cannot serve.** A pool that no longer exists, or
      has no usable member for the provider, returns a `blocked` reason. `dir
      --guard` prints it on stderr and exits 86 (the wrapper's only blocking
      code); `dir --json` reports `blocked`.
      verify: `npm test` → 0, with cases for a missing pool and an all-disabled
      pool, and a CLI e2e asserting exit 86.
- [x] **1.3 Docs follow.** `starlight/.../reference/cli.md` (`dir`) and
      `guides/mappings-and-sharing.md` describe the in-pool fallback and the refusal.
      verify: `task docs:check` → 0 errors.

## Phase 2 — No silent logouts (D4)

- [x] **2.1 Record the shared login at import.** A seeded `import` (both the Claude
      and the file-provider path, `src/index.ts:420-483`) writes a marker into the
      profile; an unseeded one does not. No token or hash is stored.
      verify: `npm test` → 0 with a seeded and an unseeded case.
- [x] **2.2 Never refresh it.** The daemon (`snapshotFor`, `src/daemon.ts`) uses
      the stored access token of a marked profile only while it is valid and never
      runs Claude Code's refresh for it.
      verify: `npm test` → 0 — a marked profile with an expired token triggers no
      refresh and reports no usage.
- [x] **2.3 Never balance onto it.** `pickBalanced` skips a marked profile with the
      reason "shares its login with the default install".
      verify: `npm test` → 0 with a `resolveForDir` case.
- [x] **2.4 Doctor names it, a separate sign-in clears it.** `doctor` reports a
      warn check for marked profiles with the fix `agent-switch login <name>`; a
      successful `login` removes the marker.
      verify: `npm test` → 0 with a doctor case.
- [x] **2.5 Say who keeps a login fresh.** `auth-status` names the background
      service for Claude profiles it polls and "only when you use it" for marked
      profiles.
      verify: `npm test` → 0 with both cases.

## Phase 3 — Wording and controls that tell the truth (D5)

- [x] **3.1 Accounts page.** The subtitle (`accounts.tsx:293`) says at what share an
      account warns instead of "whether its sessions are protected"; the protect
      cell uses a neutral icon instead of the green shield.
      verify: `cd gui && npx vitest run` → 0 with the copy asserted.
- [x] **3.2 No "paused" without a pause.** `rules.ts:111` "Paused at its limit"
      becomes "At its limit".
      verify: `grep -rn "Paused at its limit" gui/src` → no match; rules test updated.
- [x] **3.3 Disabled controls show the value in force.** "Protect new accounts"
      renders checked (the default is on); "When usage is unknown" shows the
      option in force selected. *Corrected from verification:* no option is in force
      for unknown usage (no warning is sent), so the text says that instead of
      selecting "Warn me".
      verify: settings test asserts the checked switch and the selected segment.
- [x] **3.4 Start dialog lists what can start.** `START_TOOLS` drops `gemini`
      (no backend) and gains `antigravity`, disabled with its reason while no
      account can take work.
      verify: `cd gui && npx vitest run` → 0 with a start-dialog case.
- [x] **3.5 "Used in" without a placeholder.** The accounts list stops printing "—"
      above running/idle while no surface is known.
      verify: accounts test asserts no lone "—" in the Used-in cell.

## Phase 4 — Small fixes

- [x] **4.1 PowerShell profile path.** `rcFileFor` (`src/shellenv.ts:229`) asks the
      shell for `$PROFILE` (`pwsh`, then `powershell`) and keeps the hard-coded path
      only as the fallback — covers Windows PowerShell 5.1 and a Documents folder
      redirected to OneDrive.
      verify: `npm test` → 0 with an injected `$PROFILE` answer.
- [x] **4.2 Pools and protection writes are serialized.** `src/pools.ts` and
      `src/protection.ts` read-modify-write under the same file lock the rest of
      the store uses, so two processes cannot lose each other's update.
      verify: `npm test` → 0 with a concurrent-update case.
- [x] **4.3 Archived roadmaps match the code.** `archive/road-to-honest-foundations.md`
      and `archive/road-to-the-session-control-redesign.md` say `status: complete`,
      and the pools-only constraint lines (28-29, 107) are rewritten per D1 with the
      owner's words cited.
      verify: `grep -n "status:" agents/roadmaps/archive/road-to-honest-foundations.md agents/roadmaps/archive/road-to-the-session-control-redesign.md` → both `complete`.
- [x] **4.4 Screenshots.** Regenerate with `task gui:screenshots` (demo data only)
      after Phase 3 and inspect each capture.
      verify: the captures differ only where Phase 3 changed copy.
      *Found on the way:* the published `start-session.png` showed a red "is not a
      full folder path" line — the capture rewrote the demo folder to `~/…`, which the
      dialog rightly refuses. Session folders now stay absolute on a stand-in home
      (`fixtures.DEMO_HOME`), which the privacy gate exempts by name.

## Not taken here — where each review point went

| Point | Disposition |
|---|---|
| Balancing scoped by label, Team seats excluded (draft D1 b, 2.2) | `owner-decision` resolved as D1; Team-seat detection needs plan metadata from the credential store, which no read-only probe here may open — parked in `later/road-to-session-orchestration.md` Phase 6 |
| Prompt history opt-in, never across labels (draft D2 b, 3.1-3.5) | `already-satisfied` by the owner's D2 |
| `mergePromptHistory` race (draft 3.3) | `declined`: the merge runs only on `share on`/`sync`, re-checks the size and retries three times; the remaining window is the rename itself, and deferring merges until no session runs would leave an always-busy machine unmerged |
| Exact mapping to a disabled profile rebalances (P0-02) | ~~`declined`~~ — **reversed 2026-10-29** (`inbox-2026-10-c`, second arrival): the decline contradicted this roadmap's own D3 (a rule is a boundary first); now refused, see `archive/road-to-a-balance-with-numbers-to-weigh.md` D1 |
| Eligibility by org, conservative capacity, shared-email (P0-04, P0-05) | `already-satisfied` in part (any window at its threshold is skipped, `cli.md` `dir`); the rest needs provider org metadata — parked in Phase 6 there |
| Rebind on a shared profile, Antigravity keychain (P0-07, P0-08) | `already-satisfied`: owned by `later/road-to-session-orchestration.md` Phase 4 |
| Desktop "live" from transcript age (P1-02) | parked in Phase 6 there |
| Parity E2E, design gate with users, tray/main cache, autostart OS matrix, diagnostics scrub (P1-03…P1-07) | parked in Phase 6 there |
| CI on the merge candidate (P2-01) | `already-satisfied`: PR #102 merged with 10/10 checks green; `main` CI on `1593904` green |
| Upgrade migration, desktop/security smoke, security review (P2-02…P2-04) | parked in Phase 6 there |
| True orchestration (P3-01…P3-06) | `already-satisfied`: owned by `later/road-to-session-orchestration.md` Phases 1-5 |
| Settings › Distribution switch, label scope (draft 2.3) | `declined`: it only made sense with draft option D1 b; the owner chose automatic balancing |
| Start dialog shows the same reasons as `dir --json` (draft 2.4) | `already-satisfied`: the dialog reads `dir --json` (`resolutionFromCli`, `gui/src/redesign/screens/logic.ts`) |
| Invariants: 95 % alerts separate, pet intro byte-exact, autostart off stays off (R5, R11, R12) | `already-satisfied`: unchanged by this roadmap and covered by existing tests |
| Split behaviour changes out of the redesign PR | `already-fixed` (overtaken): PR #102 is merged |

## Risk Register
<!-- risk-review: v1 | reviewed: 2026-10-29 | reviewer: claude/host -->

| Rank | Item | Risk type | Description | Mitigation | Anchored under |
|------|------|-----------|-------------|------------|----------------|
| 1 | Refusal blocks real work | product | A deleted pool still bound to a folder now refuses starts | The message names the binding and the fix (`unmap` or a new pool); only exit 86 blocks, any other failure still starts the tool | Phase 1 |
| 2 | Old imports carry no marker | implementation | Profiles imported before 2.1 keep being refreshed | *Corrected 2026-10-29:* a sign-in clears the mark, it does not set it. Doctor names unmarked profiles with the default install's account, and `agent-switch mark-shared <name>` sets the mark (`archive/road-to-a-balance-with-numbers-to-weigh.md` D4) | Phase 2 |
| 3 | Marked profile shows no usage | product | A dormant marked profile reports nothing once its token lapses | The reason is shown; one `login` clears the marker | Phase 2 |

## Acceptance Criteria

- [x] AC-1 — A folder bound to a pool starts on a pool member or is refused; never on an account outside the pool.
- [x] AC-2 — A profile imported with a seeded credential is never refreshed by the daemon and never picked by balancing; doctor says why.
- [x] AC-3 — No GUI string says "protected" or "paused" for a state agent-switch only warns about; disabled controls show the value in force.
- [x] AC-4 — The start dialog offers no provider without a backend.
- [x] AC-5 — Root `npm test`, `cd gui && npx vitest run`, `npx tsc --noEmit` and `task docs:check` green.
