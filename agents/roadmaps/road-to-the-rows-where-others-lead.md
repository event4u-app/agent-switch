---
complexity: structural
status: in-progress
tree_pin: ce9e019
execution:
  mode: process-full
review_by: 2026-12-31
relates:
  - slug: road-to-keep-signed-in-codex-antigravity
    relation: disjoint
    note: "Owns the sign-in lifecycle for Codex and Antigravity; nothing here duplicates it."
  - slug: road-to-session-orchestration
    relation: extends
    note: "Pulls two items forward from it (D34 keychain, DE/EN); real pause/resume and leases stay there."
  - slug: road-to-agent-switch-native-updater
    relation: unblocks
    note: "Its first prerequisite is a signing pipeline; Phase 1 here builds it."
  - slug: road-to-agent-switch-statusline-usage
    relation: disjoint
    note: "Official rate_limits source for live sessions stays there."
---

# Road to the rows where others lead

> **Source:** `agents/tmp.old/inbox-2026-11-a/as-review-1/` — the leading review of
> 2026-11-01 (deep analysis plus its own roadmap draft, pinned to `ce9e019` / npm
> 2.6.3), a competing 30-package plan from a second assistant (v15) for the same
> pin, the owner's transcript 2026-10-27 → 2026-11-01, and the older loose inbox
> files of July–October. The review is leading (owner, 2026-11-01); the other
> sources were read for anything it misses.
>
> **Re-verified at `ce9e019`** before planning: `src/index.ts` 3,401 lines with
> 64 `cmd*` functions; `src/agy-keychain.ts:60,65` creates and unlocks the profile
> keychain with `-p ""`; no `agent.view` / `DISABLE_AGENT_VIEW` anywhere in
> `src`, `gui/src`, `README.md`; `release.yml` has no signing or notarisation
> step; `README.md:156` still says native package managers are planned; no
> translation layer in `gui/src`.
>
> **Arrivals:** 1 — `inbox-2026-11-a` (2026-11-01).

## Goal

Raise the rows where agent-switch scores lowest against the field without giving
up what the other rows rest on: explicit switching only, no refresh grant of its
own, no proxy, nothing written to a tool's default location.

| Row | Today | Target | Who leads today |
|---|---|---|---|
| C13 Install & platforms | 5 | 8 (D1 paid) / 6 (not) | cc-switch (notarised cask, msi, deb/rpm/AppImage) |
| C5 Limit handling | 6 | 7 | claude-swap / cswap (drain), clauth (fallback chain) |
| C11 Code health | 7 | 8 | clauth (coverage, audit), ccam (benchmark gate) |
| C8 GUI (language) | 7 | 8 | CCSwitcher (6 languages), Antigravity-Manager (12) |
| C3 Reach of the readout | 7 | 8 | CodexBar, ccdeck read claude-swap's list schema v1 |
| C6 Live sessions (safety) | 8 | 8, without a wrong-account path | — |
| C10 Credential safety | 8 | 9 | claude-account, caam |

Scores are the review's judgement of read code, not measurements.

## Findings

| ID | Defect at `ce9e019` | Evidence |
|---|---|---|
| F1 | Release builds are unsigned and not notarised; npm is the only package channel. Homebrew stops accepting casks that fail Gatekeeper from 2026-09-01. | `.github/workflows/release.yml`; `README.md:156`; Homebrew/brew#20755 |
| F2 | No account-isolation handling for Claude Code Agent View (`claude --bg`, `claude agents`). caam found the background supervisor ignores its per-profile `HOME`; agent-switch isolates by `CLAUDE_CONFIG_DIR`, so whether it is affected is unknown and untested. | caam `README.md:468`; grep → no match |
| F3 | The Antigravity profile keychain has an empty password (D34). | `src/agy-keychain.ts:60,65` |

## Decisions

| ID | ownership | resolved by | decision | revisit if |
|---|---|---|---|---|
| D1 | owner | **open** | Pay for signing: Apple Developer ID (~99 USD/year), optionally Azure Trusted Signing. Without it Phase 1 stops at an own tap with a quarantine caveat plus winget. | the owner declines the cost |
| D2 | reversible-technical | agent | The claude-swap-compatible list is read-only (`supportsAccountSwitching: false`). | the owner wants switching from CodexBar |
| D3 | owner | **owner, 2026-11-01: (a) build it** | "Switch when this turn ends": the user arms a live switch; it runs at the next idle edge the host reports; never armed automatically. | the owner rejects anything that runs later than the click |
| D4 | reversible-technical | agent | agent-switch never sets `CLAUDE_CODE_DISABLE_AGENT_VIEW` for the user. If F2 is confirmed: warn, and set it only per profile behind an opt-in. | Anthropic binds the supervisor per config dir |
| D5 | reversible-technical | agent | The Antigravity profile keychain gets a random password, stored in the user's login keychain under an agent-switch service name. | macOS refuses the unlock in a background launch |
| D6 | reversible-technical | agent | `index.ts` is split by command family behind an unchanged dispatch; no behaviour change in the same PR. | — |
| D7 | reversible-technical | agent | DE/EN covers every visible GUI string; the CLI stays English; `PET_WELCOME` stays byte-exact in English. | the owner wants the intro translated |
| D8 | reversible-technical | agent | The `audit` job gates what ships: `npm audit --omit=dev` in `gui/`. The dev tree carries 16 advisories (vitest 2 / vite 5 chain) that need a major upgrade; carried to `later/road-to-deferred-followups.md`, not ignored. | the vitest/vite upgrade lands → gate the full tree |
| D9 | reversible-technical | agent | The property test (4.4) found that a busy one-account folder rule gives way to a free account under guard `block` (c63a357, shipped in 2.6.3, covered by a test). Kept as shipped; the stale module header that said a rule never leaves itself is corrected. | the owner wants one-account rules to refuse instead |

## Phase 0 — Safety before reach

- [ ] **0.1 Spike: Agent View under a profile (F2).** On macOS with two signed-in
      profiles A and B, start `claude --bg` under A through the wrapper, then under
      B; list with `claude agents --json`. Record which account each bills, whether
      the supervisor carries `CLAUDE_CONFIG_DIR`, whether a B session attaches to
      A's supervisor, and the Claude Code version.
      verify: a dated record under `agents/evidence/`, tokens redacted.
- [ ] **0.2 If 0.1 shows a wrong account:** `doctor` check `agent-view-isolation`
      (warn); the session list marks foreign-config Agent View sessions; per-profile
      opt-in `agent-view off` sets `CLAUDE_CODE_DISABLE_AGENT_VIEW=1` in that
      profile's wrapper only (D4). If binding is correct, record it in the platform
      notes and close.
      verify: `npm test` → 0 with a doctor fixture; e2e that only the opted-in profile gets the variable.
- [x] **0.3 Antigravity keychain with a real password (F3, D5).** <!-- done: 2026-11-01 — src/agy-keychain.ts (store-then-change migration, half-way resume), doctor check agy-keychain-password, tests/agy-keychain.test.ts with mocked security; no real macOS keychain run --> New profiles get
      a 32-byte random password stored in the login keychain as
      `agent-switch.agy.<profile-hash>`. Existing profiles migrate on their next
      `run` (`set-keychain-password`, old empty password accepted once). `doctor`
      reports any profile still on an empty password.
      verify: `npm test` → 0 with mocked `security` calls for create, migrate and unlock.
- [ ] **0.4 Replace D34 in `later/road-to-session-orchestration.md` Phase 4 with a pointer here.**
      verify: grep → pointer only.

## Phase 1 — An install the OS trusts (F1, needs D1)

- [ ] **1.1 macOS signing and notarisation in `release.yml`** (Tauri `APPLE_*`
      secrets, stapled universal `.dmg`; the job fails when a secret is missing).
      verify: `spctl -a -vv -t install` and `xcrun stapler validate` on the release `.dmg`.
- [ ] **1.2 Windows signing (optional within D1).**
      verify: `Get-AuthenticodeSignature` → `Valid`, or the SmartScreen note in the release text.
- [ ] **1.3 Homebrew** — own tap `event4u-app/homebrew-tap`; official cask only after 1.1. No `--no-quarantine` advice.
      verify: `brew install --cask event4u-app/tap/agent-switch` on a clean runner.
- [ ] **1.4 winget** manifest (silent switch, direct `InstallerUrl`, SHA-256), submitted to `microsoft/winget-pkgs`, updated from `release.yml`.
      verify: `winget install event4u.agent-switch` then `agent-switch --version`.
- [ ] **1.5 README and docs** list brew/winget/npm; `later/road-to-agent-switch-native-updater.md` gets "prerequisite 1 met".
      verify: `task docs:check` → 0.

## Phase 2 — A readout other tools can show (D2)

- [x] **2.1 claude-swap-compatible list, read-only.** `agent-switch --list --json`
      and `agent-switch list --json --format cswap-v1` emit `schemaVersion: 1`,
      `supportsAccountSwitching: false`, `activeAccountNumber` and `accounts[]`
      (`number` stable from a stored map and never reused, `email`, `alias`,
      `active`, `disabled`, `usageStatus`, `usage.fiveHour`/`usage.sevenDay` as
      `{pct, resetsAt}`, `usageFetchedAt`, `usageAgeSeconds`). Claude only. Errors
      are `{"schemaVersion":1,"error":{…}}` with a non-zero exit. No token, no
      network, cache only.
      verify: `npm test` → 0 with a field-by-field fixture and a no-network test.
      done: `src/cswap-list.ts` + `tests/cswap-list.test.ts`; numbers in `~/.agent-switch/cswap-numbers.json`; `stale` past `cacheMaxAgeMs` (the age the CLI stops serving a cached snapshot).
- [x] **2.2 Prove it against the consumer's rules:** cache-only read; `--version`
      answers; unknown usage is `usage: null` with `usageStatus: "unavailable"`.
      verify: e2e < 300 ms on a five-profile fixture; `--version` prints a semver.
      done: e2e measured 81–93 ms on the five-profile fixture; `--version` added (it was unhandled before) and prints `2.6.3`.
- [x] **2.3 Docs page** "Show agent-switch accounts in CodexBar / ccdeck", read-only by design. No outreach.
      verify: `task docs:check` → 0.
      done: `guides/codexbar-ccdeck.md` in the sidebar; flags in `reference/cli.md`; `astro check` 0 errors.

## Phase 3 — Switch when the turn ends (D3 = a)

- [x] **3.1 Arm, do not run.** The session sheet and
      `agent-switch rebind --when-idle <profile> <account>` arm a live switch with
      creation time, target and a 30-minute expiry, visible in the session row
      ("switches to B when this turn ends"); cancelled with one click or
      `rebind --cancel`.
      verify: `npm test` → 0 for arm, cancel and expiry.
      done: `src/rebind-arm.ts` (arm store `rebind-arms.json` under `withFileLockSync`,
      one arm per profile, session id from the registry); CLI `rebind <account> --when-idle
      [--profile] [--session]` and `rebind --cancel [--profile]`; `sessions --json` carries
      `armed`, the text listing and the GUI row/sheet show it with a cancel button.
      Tests: `tests/rebind-arm.test.ts`, e2e in `tests/cli-e2e.test.ts`.
- [x] **3.2 Run at the idle edge.** The daemon watches the registry state; on a
      `busy → idle` edge it runs the existing `rebind` with all its guards. A
      refused guard drops the arm and tells the user why. Without a registry state
      (`liveSource: "cwd"`) arming is refused.
      verify: daemon test with a scripted registry `busy, busy, idle` → `rebind` once at the edge, never for `cwd`.
      done: `watchArmsOnce` consumes the arm before calling `rebind` (at most once);
      the daemon runs it on a 2 s timer (`startArmWatcher`), separate from the 60 s poll.
      A refusal drops the arm, notifies and logs activity; an ended session drops it too.
      Tests: `tests/rebind-arm.test.ts`, `tests/daemon-rebind.test.ts`. Not yet run against a
      real live Claude Code session.
- [x] **3.3 Honest copy.** The arm dialog says the prompt cache does not move and
      nothing switches without this click.
      verify: GUI test asserts both sentences.
      done: `ARM_CACHE_SENTENCE` / `ARM_CLICK_SENTENCE` in `gui/src/redesign/screens/session-sheet.tsx`,
      asserted in `screens.test.tsx`.

## Phase 4 — Code health (D6)

- [x] **4.1 Split `src/index.ts` by command family** behind one dispatch table;
      help output byte-identical.
      verify: `npm test` → 0; snapshot of `--help` unchanged; `src/index.ts` < 600 lines.
      done: `src/index.ts` 3,437 → 201 lines (header, imports, `main()` dispatch). Twelve
      modules under `src/commands/`: profiles 564, sessions 508, takeover 365, system 329,
      usage 321, shared 320, routing 316, rebind 203, desktop 193, settings 138, sharing 124,
      help 78. All 109 top-level statements moved byte-identical (only `export` added);
      region banners dropped. One adaptation: `cmdActivate` resolves `../index.js` from
      `import.meta.url`, since the module now sits in `dist/commands/` (caught by the e2e
      `activate` test). Proof: `tests/cli-snapshot.test.ts` (help, `-h`, `--help`, unknown
      command, 28 read-only commands on a fixture home — stdout, stderr, exit) committed
      before the split and unchanged after; `npm test` 727 pass / 0 fail / 13 skipped.
- [x] **4.2 Coverage floor** — `node --test --experimental-test-coverage` for the
      root, `vitest --coverage` for the GUI; floor = today's number minus 1 %, may only rise.
      verify: CI job `coverage` fails when the floor is undercut.
      done: measured 2026-11-01 on macOS (node 26 locally; CI runs node 22) — root
      lines 70.99 / branches 73.57 / functions 69.88 → floor 69 / 72 / 68 (`npm run coverage`);
      GUI (`src/**`) lines 79.61 / statements 79.61 / branches 83.91 / functions 70.39 →
      floor 78 / 78 / 82 / 69 (`gui/vite.config.ts`, `@vitest/coverage-v8@2.1.9`). Job
      `coverage` on macos-latest; `task coverage`. Raising a floor to 99 exits 1 on both sides.
- [x] **4.3 Dependency audit** — `npm audit --omit=dev` (root), `npm audit` (`gui/`), `cargo audit` (`gui/src-tauri`).
      verify: CI job `audit` green.
      done: job `audit` + `task audit`. Root: 0. GUI gates `--omit=dev --audit-level=high`
      (what ships in the bundle): 0. `cargo audit` (cargo-audit 0.22.2): 0 vulnerabilities,
      13 warnings (unmaintained/unsound transitive crates of Tauri), exit 0. Not gated and
      still open: the GUI dev tree has 16 advisories (3 critical, 4 high) in vitest 2 /
      tinypool / vite 5 / @vitest/coverage-v8 — fixable only by a vitest 5 / vite 8 major
      upgrade; nanoid, postcss, source-map-js, browserslist fixable by `npm audit fix`.
- [x] **4.4 Property tests for routing** (from the v15 plan, AS-003). Generated
      inputs over `src/dir-resolve.ts`: missing/disabled profiles, pool changes,
      unknown and stale usage. An explicit binding never resolves outside its
      boundary; unknown usage is never treated as free capacity.
      verify: `npm test` → 0 with ≥ 1,000 generated cases, no new runtime dependency.
      done: `tests/dir-resolve-property.test.ts`, mulberry32 seeded (`FUZZ_SEED`), 1,500
      worlds × 3 properties (invariants, pool change, usage decay); each branch reached ≥ 30×.
      Mutation-checked: dropping the staleness check, counting unknown usage as room, the
      pool fallback picking `active`, and dropping the missing-account refusal each go red.
      Finding: a one-account rule DOES leave its account under guard `block` when that
      account is busy (`giveWayIfBusy`, c63a357, deliberate and tested) — contradicts
      "never resolves outside its boundary" and the module header; the property encodes
      the exception (guard block + busy + a free account + a `note`) pending a decision.

## Phase 5 — The GUI in German and English (D7)

- [ ] **5.1 String table.** Visible strings in `gui/src/redesign/**` and
      `gui/src/ui/**` go through one `t()` with `en` and `de`; language follows the
      OS with an override in Settings › General; numbers and plurals through `Intl`.
      verify: a lint test fails on a JSX text node without `t()` in those folders; settings test for the override.
- [ ] **5.2 German copy reviewed for meaning.** `PET_WELCOME` stays English.
      verify: regression test that `PET_WELCOME` is unchanged.
- [ ] **5.3 Layout holds in German.** Regenerate screenshots in `de` and inspect
      each for overflow and cut-off — including the pet bubble with a full-length
      title plus action line (`long-text.png` from the July inbox showed it clipped;
      `gui/pet.html:66-76` has no overflow rule, window 240×330).
      verify: the PR lists every capture as inspected.
- [ ] **5.4 Replace the DE/EN item in `later/road-to-session-orchestration.md` Phase 5 with a pointer here.**
      verify: grep → pointer only.

## Not in this roadmap — where each point goes

| Point | Disposition |
|---|---|
| Codex/Antigravity keep-signed-in | `already-planned`: `road-to-keep-signed-in-codex-antigravity.md` |
| Automatic failover at the limit | `declined`: owner rule 2026-10-28 — no automatic switch of a running session; Phase 3 is the explicit form |
| Own refresh grant | `declined`: ADR-004 |
| Routing proxy or pooled accounts | `declined`: NON-GOALS |
| Official statusline `rate_limits` | `already-planned`: `later/road-to-agent-switch-statusline-usage.md` |
| Native in-app updater | `unblocked by Phase 1`; stays in `later/` |
| Gemini CLI provider (v15 AS-019) | `parked`: `later/road-to-session-orchestration.md` Phase 4 (re-check Google login first) |
| v15 P0 harness (AS-001 capability matrix, AS-002 upgrade fixtures, AS-005 OS launch matrix, AS-008 release reproducibility) | `declined` as a block: needs real multi-OS machines and provider logins; the parts that matter here are 4.2–4.4 and Phase 1 |
| v15 AS-004/AS-015/AS-016 auth lifecycle + reauth wizard | `already-planned`: `later/road-to-session-orchestration.md` Phase 3 |
| v15 AS-009–AS-014 scheduler v2, leases, admission tokens | `already-planned`: `later/road-to-session-orchestration.md` Phase 2; balance + pools already ship (`src/balance.ts`, `src/pools.ts`) |
| v15 AS-021–AS-025 pause/journal/resume | `already-planned`: `later/road-to-session-orchestration.md` Phase 1 |
| v15 AS-017/AS-018/AS-020 desktop adapters, agy stop-the-line | `already-planned`: same, Phase 4; the macOS half of AS-018 is 0.3 here |
| v15 AS-026 usability pass incl. en/de | `adopted` as Phase 5 (language); the five-user benchmark `declined` — no test users in this repo's process |
| v15 AS-027 project-aware sharing matrix | `already-planned`: `later/road-to-session-orchestration.md` Phase 5 |
| v15 AS-028 redacted support bundle | `declined` for now: `redactSecrets` exists (`src/activity.ts:53`) but no owner demand for an export; revisit on the first support case that needs one |
| v15 AS-029 performance budgets, AS-030 release compatibility monitor | `parked`: no measured problem; the CC-version canary already ships |
| AS side of shared design tokens (July inbox, AC matches AS look) | `parked`: `later/road-to-deferred-followups.md` Phase 3 — blocked on the agent-config token pipeline |
| `gui/README.md:29` says Node ≥ 18 | `adopted`, fixed in passing with this roadmap (root floor is `>=20`) |
| Asking users for stars, outreach, launch posts | `out of scope` |

## Risk Register
<!-- risk-review: v1 | reviewed: 2026-11-01 | reviewer: claude/host -->

| Rank | Item | Risk type | Mitigation | Anchored under |
|---|---|---|---|---|
| 1 | Agent View bills the wrong account | external | spike first; warn + per-profile opt-in; never touch the default | Phase 0 |
| 2 | Keychain migration locks a user out of agy | implementation | migrate only when the empty password unlocks; never delete the old keychain; doctor shows the state | Phase 0 |
| 3 | Signing secrets leak or expire | operational | release environment with required reviewers; narrowest API key | Phase 1 |
| 4 | The compatible list drifts from claude-swap's schema | external | fixture pinned to `72ccd58`; additive fields only | Phase 2 |
| 5 | An armed switch fires into a bad moment | product | 30-minute expiry, visible state, one-click cancel, all rebind guards | Phase 3 |
| 6 | The split changes behaviour | implementation | byte-identical help snapshot; no logic changes in the split | Phase 4 |
| 7 | German strings break layouts | implementation | inspect every `de` capture | Phase 5 |

## Acceptance Criteria

- [ ] AC-1 — It is recorded whether an Agent View session under a profile bills that profile; if not, doctor warns and a per-profile opt-in exists.
- [ ] AC-2 — No Antigravity profile keychain has an empty password after its next run.
- [ ] AC-3 — With D1 paid: Gatekeeper-clean brew install, winget install. Without: tap + winget work and the docs name the extra step.
- [ ] AC-4 — `agent-switch --list --json` passes the schema-v1 fixture, reads only the cache, < 300 ms, never offers a switch.
- [ ] AC-5 — An armed switch runs once at the next idle edge, expires, or is cancelled; it never runs without an arm.
- [ ] AC-6 — `src/index.ts` < 600 lines with byte-identical help; coverage and audit jobs green.
- [ ] AC-7 — Every visible GUI string exists in DE and EN; `PET_WELCOME` unchanged; every `de` capture inspected.
