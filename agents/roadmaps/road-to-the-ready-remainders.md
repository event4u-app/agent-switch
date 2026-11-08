---
complexity: standard
status: open
tree_pin: 2ddd0db
parent_roadmaps: [road-to-session-orchestration, road-to-deferred-followups, road-to-host-signals-followups, road-to-agent-switch-gui-service, road-to-v3-design-gap-carried, road-to-agent-switch-native-updater]
---

# Roadmap: the ready remainders

> **Source:** `/roadmap:triage-parked`, 2026-11-07. The run re-read every file in
> `later/` and `skipped/` against the tree at `2ddd0db` and found steps whose
> parking reason no longer holds. The owner chose option 1 ("one new active
> roadmap that collects them; the source files point here, the rest stays
> parked"). Every step below carries `<!-- from: <parked-slug> <step> -->` and,
> where its wording changed, `<!-- adapted: … -->`. The source files keep their
> steps open with a `moved-to:` pointer, so nothing is counted twice.

## Goal

Everything an agent can do today without the owner, a second machine or a live
provider login, taken out of four parked roadmaps and put where `/roadmap:next`
sees it. One live defect first: a sign-in to the wrong account must not be
saved.

## Verified facts this roadmap builds on

| Fact | Evidence (at `2ddd0db`) |
|---|---|
| `login` writes the profile before the GUI checks the account, so a wrong account is saved | `src/commands/profiles.ts:205-224` |
| `redactSecrets` exists but runs only on activity and picks | `src/activity.ts:53`, `src/picks.ts:37` |
| Claude Code `routines` (used/limit) are parsed; no view renders them | `src/usage.ts:92-97` |
| rtk is still probed by output signature, although agent-config now publishes a detection contract | `src/tooling.ts:139-143`; agent-config `docs/contracts/rtk-detection.md` |
| The embedded agent-config server gets no config root and the embed URL carries only `embed=1&theme=` | `gui/src-tauri/src/ac.rs`, `ac.rs:709` |
| agent-config accepts a host-supplied config root and builds shared tokens | agent-config `--config-root` / `EVENT4U_CONFIG_HOME`, `tokens/build-as.mjs` |
| Needs items carry their approval id in `version`; the v3 window handles only Enter and `l` | `src/commands/needs.ts:96-109`, `src/attention.ts:73-76`, `gui/src/v3/window.tsx:439-443` |
| Desktop "live" means a transcript touched in the last 2 minutes | `src/desktop-sessions.ts` `DESKTOP_LIVE_MS` |
| The balancer assumes a 7-day reset when the reset time is unknown | `src/balance.ts` |

## Decisions

| ID | Decision | Why | Revisit if |
|---|---|---|---|
| D1 | Phase 1 is threat-modelled before its first edit | it is a sign-in / credential path (security-sensitive-stop) | — |
| D2 | Wrong account at sign-in means nothing is written, not "written then rolled back" | a rollback can fail half-way and leave the wrong token in the store | the provider tool can only sign in into the final store |
| D3 | Live-rebind isolation stays parked; this roadmap only warns | isolation needs per-session credential stores that are not designed yet | — |
| D4 | The embed accent is one bounded value from our token set, never free text | it reaches a URL and a stylesheet in another program | — |
| D5 | Updates: notify is the default, self-install is opt-in per release kind (owner, 2026-11-08) | code, the settings comment and the native-updater council's "Notify is the ceiling" must say the same thing; a silent install without consent is what the comment rules out | signed, verified updates with a rollback path exist (road-to-a-trusted-install) |

## Phase 1 — A wrong account is never saved

- [ ] **1.1 Threat model the sign-in write path.** Map where `login` (CLI) and the
      GUI sign-in write credentials and profile metadata, and which identity check
      runs when. Output: the abuse cases and the negative tests 1.2 must ship.
      <!-- from: road-to-session-orchestration P3.2 -->
      <!-- adapted: the parked step was a "reauth wizard"; the triage found the concrete defect at src/commands/profiles.ts:205-224 -->
- [ ] **1.2 Sign in into a staging location, check the identity, then commit.**
      A mismatch (email or org differs from the expected account) leaves the
      profile and its credential store exactly as they were, on the CLI and in the
      GUI. verify: a test seen red first — wrong account → profile file and
      credential store byte-identical; right account → written once.
      <!-- from: road-to-session-orchestration P3.2 -->

## Phase 2 — A start the user can predict

- [ ] **2.1 Start admission.** Between the `dir --guard` decision and the spawn,
      re-read the profile identity; on a change, refuse the start with the reason
      (or state in the result that routing was advisory). verify: a test that
      changes the identity between decision and spawn.
      <!-- from: road-to-session-orchestration P2.2 -->
- [ ] **2.2 Repo / org bindings.** A binding may match the `git remote` (host +
      owner, optionally repo) next to the existing folder bindings; first match
      wins, folder before remote at equal depth. verify: binding tests for remote,
      folder and both.
      <!-- from: road-to-session-orchestration P2.3 -->
- [ ] **2.3 "Ask me" and "default account" for unbound starts.** An unbound start
      either asks (GUI dialog / CLI prompt, never in a non-interactive run) or
      takes the default account; plain `claude` profile resolution is documented
      end to end in the CLI reference.
      <!-- from: road-to-session-orchestration P2.4 -->
      <!-- adapted: pool placement (P2.5) left out; decided by the owner 2026-11-08 in the source file (pool variant confirmed, narrowed) -->
- [ ] **2.4 The reason for a pick on every surface.** The tray and project
      bindings show why an account was picked, as `dir --json` and the start
      dialog already do. verify: tray and binding view tests assert the reason
      text.
      <!-- from: road-to-session-orchestration P6.8 -->

## Phase 3 — Readouts and notices that tell the truth

- [ ] **3.1 Eligibility before scoring.** Accounts are filtered for eligibility
      (same email in two orgs counted once per org, not merged) before they are
      scored; an unknown reset time scores conservatively instead of assuming
      7 days. verify: `balance` tests for both cases.
      <!-- from: road-to-session-orchestration P6.2 -->
- [ ] **3.2 Desktop "recently active".** A Desktop session found only by a fresh
      transcript is labelled "recently active", and "live" only when a process
      proves it. verify: `desktop-sessions` tests.
      <!-- from: road-to-session-orchestration P6.3 -->
- [ ] **3.3 Warn before a live rebind moves other sessions.** A rebind of a
      profile with more than one live session says which sessions follow, before
      it runs (CLI and GUI). verify: a test with two live sessions on one profile.
      <!-- from: road-to-session-orchestration P4.8 -->
      <!-- adapted: warn part only; isolate-or-refuse stays parked (D3) -->
- [ ] **3.4 Mask secrets in previews and notices.** Session previews and
      notification text pass through `redactSecrets` before they are shown or
      handed to the OS. verify: a token-shaped string in a transcript preview and
      in a notice renders masked.
      <!-- from: road-to-host-signals-followups "Mask secrets in previews and notices" -->
      <!-- adapted: the "resume when a token is seen" gate dropped; the masking has no external dependency -->
- [ ] **3.5 Quiet hours for notifications.** A time window in Settings during
      which OS notifications are held (the in-app list still records them).
      verify: a test that a notice inside the window is recorded but not sent.
      <!-- from: road-to-session-orchestration P5.3 -->
      <!-- adapted: the KPI half ("measured against real tasks") needs real use and stays in the source file -->
- [ ] **3.6 Show Claude Code routines.** Where the usage read returns `routines`
      (used/limit), the account's usage view shows it; absent means no row, never
      a zero. verify: a view test with and without `routines`.
      <!-- from: road-to-agent-switch-gui-service, remainder (a) -->
- [ ] **3.7 Updates notify by default; self-install only when switched on.**
      A fresh install checks and notifies for every release kind but installs
      nothing; installing in place is an explicit opt-in per kind in Settings ›
      Updates (D5). Existing users who never touched the kinds setting move to
      notify-only; a kinds value they set themselves is kept. The comment at
      `gui/src/settings-store.ts:136-140` and the kinds docblock describe the
      new default. verify: an engine test seen red first — no stored setting →
      a newer patch is announced and `install` is never called; kinds opted in
      → it installs.
      <!-- from: owner decision 2026-11-08 (triage follow-up): `gui/src/redesign/engines/updates.ts:69-72` installs all kinds by default, against `settings-store.ts:140` "NOT silent self-install" and the native-updater council's "Notify is the ceiling"; also covers native-updater P3.3 and its AC "defaults to Notify" (merged 2026-11-08) -->

- [ ] **3.8 Only personal plans are balanced.** An account takes part in balancing
      (starts and pools) only when its stored credential's `subscriptionType` is
      `pro` or `max`; Team, Enterprise, any other value and a missing field count as
      not balanceable, and every surface that shows a pick names that reason. The
      field is already read for the fingerprint (`src/rebind.ts:411-413`); the
      balancer (`src/balance.ts`) does not use it yet. verify: `balance` tests for
      pro, max, team, enterprise, an unknown value and a missing field, seen red first.
      <!-- from: road-to-session-orchestration P6.1 -->
      <!-- adapted: allowlist instead of a team-credential probe; owner decision 2026-11-08 — a credential without the field drops out of balancing -->

## Phase 4 — The embedded agent-config, per profile

- [ ] **4.1 rtk detection by delegation.** Use agent-config's published rtk
      detection contract; keep the output-signature probe only as the fallback
      when agent-config is absent. verify: `tooling` tests for both paths.
      <!-- from: road-to-deferred-followups P3.1 -->
- [ ] **4.2 Per-profile agent-config settings.** Start the embedded agent-config
      server with the active profile's config root (`--config-root` /
      `EVENT4U_CONFIG_HOME`), so each profile can have its own settings. verify:
      the spawned command carries the profile's root; switching profiles restarts
      with the new root.
      <!-- from: road-to-deferred-followups P3.2 -->
      <!-- adapted: the blocker (agent-config flag) has shipped; the share-collision guard (P3.3) was cancelled by the owner on 2026-11-08 as covered by agent-config -->
- [ ] **4.3 Shared design tokens, AS side.** A generated token file from the
      shared source, a drift check in CI, and a bounded `accent` parameter on the
      embed URL built in `ac.rs` (D4). verify: the drift check fails on a changed
      token; the URL carries only an accent from the token set.
      <!-- from: road-to-deferred-followups P3b.1 -->

## Phase 5 — Approve from the keyboard

- [ ] **5.1 Approval keys on a focused Needs-you item.** ⇧↵ always, ⌫ deny, Y yes,
      using the approval id the item already carries. Remotely "always" is never
      offered (v3.2 rule), so ⇧↵ acts only on local sessions. verify: window key
      tests for the three keys and for the remote case.
      <!-- from: road-to-v3-design-gap-carried "Approval keys" -->
      <!-- adapted: the trigger (approval id on the item) has fired; the id rides in `version` -->

## Phase 6 — Release hardening that runs on one machine

- [ ] **6.1 PARITY journeys as tests.** `gui/src/redesign/PARITY.md` journeys
      become executable tests; axe checks on the main views; the tray and the main
      window read one timestamped cache.
      <!-- from: road-to-session-orchestration P6.4 -->
- [ ] **6.2 Versioned, scrubbed output shapes.** `doctor`, `auth-status` and
      `activity` JSON carry a shape version and are tested with fake tokens that
      must not appear in the output.
      <!-- from: road-to-session-orchestration P6.5 -->
      <!-- adapted: the autostart-per-OS half needs other machines and stays in the source file -->
- [ ] **6.3 Upgrade fixtures from 2.1.0.** Fixture state from 2.1.0 (labels,
      alerts, protection, guard, history, bindings, pet flag) loads into the
      current version without loss. verify: fixture tests.
      <!-- from: road-to-session-orchestration P6.6 -->
      <!-- adapted: the per-OS smoke and the final threat review stay in the source file -->

## Phase 7 — Updates that can be stopped and undone

> Carried from `later/road-to-agent-switch-native-updater.md`, archived on
> 2026-11-08 by the owner (option 1): no native Tauri updater. Updates keep
> running through the CLI (`agent-switch update` → `npm install -g`, called from
> `gui/src/ipc.ts:1154-1162`); the GUI follows the CLI version
> (`src/gui-launch.ts:1-8,174`). These steps harden that path. Signing stays in
> `later/road-to-a-trusted-install.md`.

- [ ] **7.1 Kill-switch for a bad release.** Before the GUI installs a version,
      it checks whether that version is withdrawn (npm `deprecated` on the
      version, or a marker on its GitHub release) and then only notifies, with
      the reason. verify: an engine test seen red first — withdrawn version →
      `install` never called, notice says why; normal version → unchanged.
      <!-- from: road-to-agent-switch-native-updater P4.1 -->
      <!-- adapted: the parked step was a `yanked` flag in a Tauri `latest.json`; the update path is now npm, which has a native withdraw marker -->
- [ ] **7.2 Restart when idle, never mid-session.** After a successful install
      the GUI says a restart is needed and restarts only when the user agrees or
      no session it hosts is running. verify: a test — install succeeds with a
      hosted session running → no restart, notice shown; no session → restart
      offered.
      <!-- from: road-to-agent-switch-native-updater P3.4 -->
      <!-- adapted: "relaunch after the Tauri updater" became "restart after `agent-switch update`" -->
- [ ] **7.3 Say when the GUI is not the CLI's version.** When `gui-launch` finds
      no artifact in the release tagged with the CLI version and falls back to
      another release (`src/gui-launch.ts:174-177`), it says which version it
      launched. verify: a `gui-launch` test for the fallback case asserts the
      message.
      <!-- from: road-to-agent-switch-native-updater AC "CLI↔GUI version skew is impossible or clearly surfaced" -->
- [ ] **7.4 Document updates, releases and rollback.** README / docs: how
      updates arrive (notify by default, D5), how to cut a release, how to
      withdraw a bad one (7.1) and how a user goes back to the previous version
      (`npm install -g @event4u/agent-switch@<version>`). verify: the docs build
      and link check pass; every command in the page runs.
      <!-- from: road-to-agent-switch-native-updater P1.4, P4.3, P5.3 -->
      <!-- adapted: Tauri channels and `latest.json` dropped; the npm path is the only update path -->

## Open owner decisions

- None blocking these steps. Decided since the triage: gui-service (b)/(c)
  cancelled and its rejected-scope wording corrected (file archived), the
  update default (D5, step 3.7), P3.3 cancelled as covered by agent-config, G2 recorded as "both views, #166", native-updater archived (no native updater,
  hardening carried to Phase 7), autoswitch-rejected archived with the narrowed reason,
  session-orchestration P2.5 decided, P5.4 cancelled, P6.1 moved here as 3.8 (allowlist).
  P4.7 planned for later in later/road-to-open-in-with-the-right-account.md. No owner
  decision from the triage is still open.
