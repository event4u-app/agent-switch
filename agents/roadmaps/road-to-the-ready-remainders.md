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
| D6 | "Local" for ⇧↵ means the session's chat runs in this window (answered through its bridge); any other chat approval goes through `needs allow\|deny` (the bridge inbox), which has no "always" | the inbox refuses "always" by design (`src/bridge/inbox.ts`), so the queue can only offer it where the chat view itself answers | the inbox accepts "always" |
| D7 | Y on a focused approval allows once; ↵ keeps the item's verb (Open chat); Y on a question is not wired | a question's answer is free text or a choice the queue does not show, so "yes" would guess | questions carry a yes/no shape in `needs --json` |
| D8 | A release is withdrawn by `npm deprecate` on that version or a `Withdrawn: <reason>` line in its GitHub release notes; when that status cannot be read, an opted-in kind is announced, not installed | the GUI learns the latest version from the GitHub release, and npm is what `agent-switch update` installs from, so both are read; an outage must not read as "not withdrawn" | releases carry a signed manifest with a withdraw field (road-to-a-trusted-install) |
| D9 | After an update the GUI never restarts by itself: it offers the restart (notice + a Restart button in Settings › Updates while the installed version is newer than the running one), and while a session it hosts runs (alive hosted sessions plus chats in this window; unknown counts as running) the notice says to wait | the step allows a restart when idle, but an unasked restart under the user's cursor is the conservative reading's opposite, and the offer covers "restart when the user agrees" | the owner wants a restart without asking when nothing runs |
| D10 | `strategy ask` asks only with a terminal on stdin and stderr; anywhere else (pipe, script, `exec`, the GUI's own calls) the start takes the preferred account, else the balanced pick; an answer that names no account starts nothing (exit 86) | the step forbids a prompt in a non-interactive run but names no fallback; the preferred account is the one the user set themselves, and starting nothing on a bad answer is the conservative reading | the owner wants `ask` to refuse non-interactive starts instead |
| D11 | Without a reset time a window is weighed over its own length (5 h, 7 d, 30 d; 30 d when the length is unknown), and the reason says "at least … %/h" | a window resets at the latest one length from now, so that is the only bound the data gives; a week for a 5 h window was a guess, not a bound | the usage read always carries a reset time |
| D12 | "Counted once per org": Claude profiles whose `.claude.json` names the same email AND the same `organizationUuid` are weighed once (the preferred one, else the first); a missing org never folds two profiles together; other providers are not folded | two profiles of one account share one set of limits; folding on email alone would merge two orgs, which the step forbids | providers expose an org id for Codex / agy |
| D13 | The plan allowlist binds balancing only — balanced plain starts, pool picks (fresh or not) and the free account a busy one gives way to; a folder rule to one account, the preferred account (fallback, `strategy default`/`fill`) and the `ask` choices still use a Team seat. It applies to Claude only (Codex and agy credentials carry no `subscriptionType`), and the credential is read only for an account that is about to be weighed | the owner's rule is about balancing, and the user's own explicit choice is not a balance; reading every keychain item on each wrapped start would slow the shell hot path | the owner wants Team seats refused outright |
| D14 | "The active profile's config root" is `<agent-switch home>/claude/<active claude profile>/agent-config`, read from `state.json` on every agent-config call; no active Claude profile, an unreadable state file or a name the CLI would not write means agent-config's default root; an owned server under another root is stopped and started again, a found one is never stopped | the GUI's agent-config card is about Claude profiles; the profile's `config` dir belongs to Claude Code, so a dedicated subdir keeps the two apart (agent-config creates it 0700); agent sessions do not get the root yet (their hooks still read `~/.event4u/agent-config`) | agent-config settings should follow another provider's profile, or sessions should carry `EVENT4U_CONFIG_HOME` |
| D15 | The shared token source is vendored (`gui/design-tokens/event4u-agent-tokens.json`, verbatim from agent-config `tokens/` at e494248); `scripts/design-tokens.mjs` generates `gui/design-tokens/as-tokens.css` from it and `--check` compares generated against the vendored copy; the file is not pasted over `gui/src/index.css`. The embed `accent` is a name from the set's `brand` group (today `orange`), never a colour value | the source lives only in the agent-config repository, its npm package does not ship `tokens/`, so CI cannot read it; replacing the GUI palette is a visual change the step does not ask for; a name keeps colour values out of the URL | agent-config publishes the token file, or the owner wants the shared palette in the GUI |

## Phase 1 — A wrong account is never saved

- [x] **1.1 Threat model the sign-in write path.** Map where `login` (CLI) and the
      GUI sign-in write credentials and profile metadata, and which identity check
      runs when. Output: the abuse cases and the negative tests 1.2 must ship.
      done: `agents/evidence/sign-in-write-path-threat-model-2026-11.md`.
      <!-- from: road-to-session-orchestration P3.2 -->
      <!-- adapted: the parked step was a "reauth wizard"; the triage found the concrete defect at src/commands/profiles.ts:205-224 -->
- [x] **1.2 Sign in into a staging location, check the identity, then commit.**
      A mismatch (email or org differs from the expected account) leaves the
      profile and its credential store exactly as they were, on the CLI and in the
      GUI. verify: a test seen red first — wrong account → profile file and
      credential store byte-identical; right account → written once.
      done: `src/staged-login.ts`; `tests/cli-e2e.test.ts` "login: …" N1–N6 (N1–N4
      seen red first), `tests/staged-login.test.ts`; the GUI reads exit 4 as
      "nothing was saved" (`reauthOutcome`).
      <!-- from: road-to-session-orchestration P3.2 -->

## Phase 2 — A start the user can predict

- [x] **2.1 Start admission.** Between the `dir --guard` decision and the spawn,
      re-read the profile identity; on a change, refuse the start with the reason
      (or state in the result that routing was advisory). verify: a test that
      changes the identity between decision and spawn.
      done: `src/start-admission.ts`, `exec` and `dir --guard` refuse with 86;
      `tests/start-admission.test.ts` (changed / signed out seen red first; unchanged starts once).
      <!-- from: road-to-session-orchestration P2.2 -->
- [x] **2.2 Repo / org bindings.** A binding may match the `git remote` (host +
      owner, optionally repo) next to the existing folder bindings; first match
      wins, folder before remote at equal depth. verify: binding tests for remote,
      folder and both.
      done: `map --remote` / `unmap --remote` (`src/mappings.ts` `remotes`); `tests/remote-bindings.test.ts`
      (remote, repo-before-owner, folder vs remote at/above/below the root; seen red first), cli-e2e "remote binding".
      <!-- from: road-to-session-orchestration P2.3 -->
- [x] **2.3 "Ask me" and "default account" for unbound starts.** An unbound start
      either asks (GUI dialog / CLI prompt, never in a non-interactive run) or
      takes the default account; plain `claude` profile resolution is documented
      end to end in the CLI reference.
      done: `strategy default|ask` (`src/dir-resolve.ts`, `src/unbound-ask.ts`, D10); `tests/unbound-start.test.ts`
      (seen red first), GUI `screens.test.tsx` "strategy ask" + `settings.test.tsx`; cli.mdx "Which account a start uses".
      v3 New session asks too (no Start until a pick, the pick is started hosted or in the terminal): `v3/dialogs.test.tsx`
      "strategy ask", `v3/adapter/actions.test.ts` "account chosen in the dialog", `v3/adapter/data.test.ts` "under strategy ask" (seen red first);
      a new chat in chat view asks the same way: `v3/dialogs.test.tsx` "a chat under strategy ask", `data.test.ts` "a new chat under strategy ask".
      <!-- from: road-to-session-orchestration P2.4 -->
      <!-- adapted: pool placement (P2.5) left out; decided by the owner 2026-11-08 in the source file (pool variant confirmed, narrowed) -->
- [x] **2.4 The reason for a pick on every surface.** The tray and project
      bindings show why an account was picked, as `dir --json` and the start
      dialog already do. verify: tray and binding view tests assert the reason
      text.
      done: v3 tray "Next start → … : reason" + `→ next` from the CLI's pick (`dir --plain --json`, new tray scope);
      binding rows "Why: …"; `gui/src/v3/tray.test.tsx`, `accounts.test.tsx` bindings, `tray-calls.test.ts` (seen red first).
      <!-- from: road-to-session-orchestration P6.8 -->

## Phase 3 — Readouts and notices that tell the truth

- [x] **3.1 Eligibility before scoring.** Accounts are filtered for eligibility
      (same email in two orgs counted once per org, not merged) before they are
      scored; an unknown reset time scores conservatively instead of assuming
      7 days. verify: `balance` tests for both cases.
      done: `tests/balance.test.ts` — unknown reset weighed over the window's length (D11), same email + same org weighed once, two orgs kept apart, unknown org never folded (D12); seen red first.
      <!-- from: road-to-session-orchestration P6.2 -->
- [x] **3.2 Desktop "recently active".** A Desktop session found only by a fresh
      transcript is labelled "recently active", and "live" only when a process
      proves it. verify: `desktop-sessions` tests.
      done: `tests/desktop-sessions.test.ts` › "live only when a running process names the session, whatever the transcript's age" + the Code-tab case (seen red first); `gui/src/vm/build.test.ts` › "a Desktop session written lately … is 'recently active'" (en "Recently active", de "Kürzlich aktiv"); CLI `sessions` prints `[recently active]`.
      <!-- from: road-to-session-orchestration P6.3 -->
- [x] **3.3 Warn before a live rebind moves other sessions.** A rebind of a
      profile with more than one live session says which sessions follow, before
      it runs (CLI and GUI). verify: a test with two live sessions on one profile.
      done: `tests/rebind-dialog.test.ts` › "followersNote: …", `tests/cli-e2e.test.ts` › "rebind: with two live sessions on the profile it names both before it runs"; GUI `src/v3/dialogs.test.tsx` › "a live switch names the sessions on the account that switch along…", `data.test.ts` › decisionFor alsoOn, `redesign/screens/screens.test.tsx` › "names the other live sessions…" (all seen red first).
      <!-- from: road-to-session-orchestration P4.8 -->
      <!-- adapted: warn part only; isolate-or-refuse stays parked (D3) -->
- [x] **3.4 Mask secrets in previews and notices.** Session previews and
      notification text pass through `redactSecrets` before they are shown or
      handed to the OS. verify: a token-shaped string in a transcript preview and
      in a notice renders masked.
      done: `tests/session-preview.test.ts` › "a token-shaped string in a turn renders masked…" + "a token cut by the text cap…", `tests/notifications.test.ts` › "appendNotification masks…", `tests/os-notify.test.ts` › "a token-shaped string never reaches the OS", `gui/src/notifications.test.ts` › sendDesktopNotification masks; GUI mirror `gui/src/redact.ts` byte-compared in `tests/release-notes.test.ts` (all seen red first).
      <!-- from: road-to-host-signals-followups "Mask secrets in previews and notices" -->
      <!-- adapted: the "resume when a token is seen" gate dropped; the masking has no external dependency -->
- [ ] **3.5 Quiet hours for notifications.** A time window in Settings during
      which OS notifications are held (the in-app list still records them).
      verify: a test that a notice inside the window is recorded but not sent.
      <!-- from: road-to-session-orchestration P5.3 -->
      <!-- adapted: the KPI half ("measured against real tasks") needs real use and stays in the source file -->
- [x] **3.6 Show Claude Code routines.** Where the usage read returns `routines`
      (used/limit), the account's usage view shows it; absent means no row, never
      a zero. verify: a view test with and without `routines`.
      done: `gui/src/v3/pages.test.tsx` › "Accounts page › routines" (with, with 0 used, without); `vm/build.test.ts` › "routines"; `v3/adapter/data.test.ts` › "an account's routines reach its Accounts-page row…". The CLI already carries `routines` in `status`/`limits --json`; no root change.
      <!-- from: road-to-agent-switch-gui-service, remainder (a) -->
- [x] **3.7 Updates notify by default; self-install only when switched on.**
      A fresh install checks and notifies for every release kind but installs
      nothing; installing in place is an explicit opt-in per kind in Settings ›
      Updates (D5). Existing users who never touched the kinds setting move to
      notify-only; a kinds value they set themselves is kept. The comment at
      `gui/src/settings-store.ts:136-140` and the kinds docblock describe the
      new default. verify: an engine test seen red first — no stored setting →
      a newer patch is announced and `install` is never called; kinds opted in
      → it installs.
      done: `gui/src/redesign/engines/engines.test.ts` › "with no stored kinds setting it only announces, for every kind", "installs a kind the user opted into, and keeps a kinds value they set themselves".
      <!-- from: owner decision 2026-11-08 (triage follow-up): `gui/src/redesign/engines/updates.ts:69-72` installs all kinds by default, against `settings-store.ts:140` "NOT silent self-install" and the native-updater council's "Notify is the ceiling"; also covers native-updater P3.3 and its AC "defaults to Notify" (merged 2026-11-08) -->

- [x] **3.8 Only personal plans are balanced.** An account takes part in balancing
      (starts and pools) only when its stored credential's `subscriptionType` is
      `pro` or `max`; Team, Enterprise, any other value and a missing field count as
      not balanceable, and every surface that shows a pick names that reason. The
      field is already read for the fingerprint (`src/rebind.ts:411-413`); the
      balancer (`src/balance.ts`) does not use it yet. verify: `balance` tests for
      pro, max, team, enterprise, an unknown value and a missing field, seen red first.
      done: `tests/balance.test.ts` › "plan: …", "balance: team, enterprise, an unknown value and a missing field are skipped…", pool and give-way cases (seen red first); `tests/cli-e2e.test.ts` › "dir --json: a team account is not balanced, and the reason is in the why-lines" (D13).
      <!-- from: road-to-session-orchestration P6.1 -->
      <!-- adapted: allowlist instead of a team-credential probe; owner decision 2026-11-08 — a credential without the field drops out of balancing -->

## Phase 4 — The embedded agent-config, per profile

- [ ] **4.1 rtk detection by delegation.** Use agent-config's published rtk
      detection contract; keep the output-signature probe only as the fallback
      when agent-config is absent. verify: `tooling` tests for both paths.
      <!-- from: road-to-deferred-followups P3.1 -->
- [x] **4.2 Per-profile agent-config settings.** Start the embedded agent-config
      server with the active profile's config root (`--config-root` /
      `EVENT4U_CONFIG_HOME`), so each profile can have its own settings. verify:
      the spawned command carries the profile's root; switching profiles restarts
      with the new root.
      done: `gui/src-tauri/src/ac.rs` tests › `spawned_command_carries_the_profile_root_and_only_then`, `switching_profiles_restarts_the_owned_server_with_the_new_root`, `active_root_*` (seen red first, D14).
      <!-- from: road-to-deferred-followups P3.2 -->
      <!-- adapted: the blocker (agent-config flag) has shipped; the share-collision guard (P3.3) was cancelled by the owner on 2026-11-08 as covered by agent-config -->
- [x] **4.3 Shared design tokens, AS side.** A generated token file from the
      shared source, a drift check in CI, and a bounded `accent` parameter on the
      embed URL built in `ac.rs` (D4). verify: the drift check fails on a changed
      token; the URL carries only an accent from the token set.
      done: `tests/design-tokens.test.ts` (a changed token, a hand-edited or missing file fail `--check`; CI runs it in the gui job); `ac.rs` tests › `settings_url_carries_only_an_accent_from_the_token_set`, `accents_come_from_the_shared_token_set` (seen red, guard sensitivity checked, D15).
      <!-- from: road-to-deferred-followups P3b.1 -->

## Phase 5 — Approve from the keyboard

- [x] **5.1 Approval keys on a focused Needs-you item.** ⇧↵ always, ⌫ deny, Y yes,
      using the approval id the item already carries. Remotely "always" is never
      offered (v3.2 rule), so ⇧↵ acts only on local sessions. verify: window key
      tests for the three keys and for the remote case.
      <!-- from: road-to-v3-design-gap-carried "Approval keys" -->
      <!-- adapted: the trigger (approval id on the item) has fired; the id rides in `version` -->
      done: `gui/src/v3/design-gap.test.tsx` › "a focused approval in this window's chat…", "a chat this window does not run…", "approval keys stay out of text fields…"; `adapter/actions.test.ts` › the three "approval keys" cases; `needs.test.tsx` key lines (D6, D7).

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
- [x] **6.4 Fix the flaky "one click on the stripe" test.**
      `gui/src/v3/adapter/reach-app.test.tsx` › "Library: one click on the stripe"
      timed out at 5000 ms on `gui macos-latest` (PR #187, run 42475900320, job
      128717091666) and passed on rerun; the log shows jsdom's "Not implemented:
      HTMLCanvasElement.prototype.getContext" around it. Find what the test waits
      on, make the wait deterministic (no raised timeout as the fix).
      verify: the test filtered and run 20 times in a row locally without a
      failure, and the next CI runs green on `gui macos-latest` without a rerun.
      done: cause — the window's "open the first live session" effect set the tab outright; when a click landed between the commit that brought the sessions and that effect, the effect overrode the Library tab (the page never came back, hence "Unable to find" / timeout, not slowness). It now keeps a pick already made. Red-then-green: `v3/design-gap.test.tsx` › "a page picked in the commit that brings the first sessions stays picked"; the reach test asserts synchronously, its 5 s wait and 15 s budget removed; 20/20 filtered runs locally. The CI half is seen on the next push.
      <!-- from: CI flake seen 2026-11-08, owner chose to track it here -->
- [ ] **6.5 Fix the flaky "a finished program … last screen stays readable" test.**
      `tests/tmux-host.test.ts` › "a finished program is reported as not alive
      and its last screen stays readable" failed on `ubuntu-latest · node 20`
      (PR #195, run 43421470798, job 131872269586) with `host.capture()`
      returning `''`, and passed on rerun. The program exits at once, so the
      pane is already dead when its output is read. Find whether the capture
      races the pane's `remain-on-exit`, and make it deterministic (no added
      sleep as the fix).
      verify: the test filtered and run 20 times in a row on Linux without a
      failure, and the next CI runs green on `ubuntu-latest · node 20` without a rerun.
      <!-- from: CI flake seen 2026-11-13, tracked like 6.4 -->

## Phase 7 — Updates that can be stopped and undone

> Carried from `later/road-to-agent-switch-native-updater.md`, archived on
> 2026-11-08 by the owner (option 1): no native Tauri updater. Updates keep
> running through the CLI (`agent-switch update` → `npm install -g`, called from
> `gui/src/ipc.ts:1154-1162`); the GUI follows the CLI version
> (`src/gui-launch.ts:1-8,174`). These steps harden that path. Signing stays in
> `later/road-to-a-trusted-install.md`.

- [x] **7.1 Kill-switch for a bad release.** Before the GUI installs a version,
      it checks whether that version is withdrawn (npm `deprecated` on the
      version, or a marker on its GitHub release) and then only notifies, with
      the reason. verify: an engine test seen red first — withdrawn version →
      `install` never called, notice says why; normal version → unchanged.
      done: `gui/src/redesign/engines/engines.test.ts` › "never installs a withdrawn version and says why…", "a withdrawn version is not announced as available…", "when the withdraw status cannot be read…"; `gui/src/updates.test.ts` › `withdrawnInNotes`, `fetchNpmDeprecation` (D8).
      follow-up: the manual "Update to" in Settings › Updates refuses a withdrawn version with the same reason (an unreadable status still installs on that click, as the automatic notice promises) — `settings.test.tsx` › "Updates › the manual update"; `hostedSessionsRunning` has its own test (`engines/hosted-running.test.ts`).
      <!-- from: road-to-agent-switch-native-updater P4.1 -->
      <!-- adapted: the parked step was a `yanked` flag in a Tauri `latest.json`; the update path is now npm, which has a native withdraw marker -->
- [x] **7.2 Restart when idle, never mid-session.** After a successful install
      the GUI says a restart is needed and restarts only when the user agrees or
      no session it hosts is running. verify: a test — install succeeds with a
      hosted session running → no restart, notice shown; no session → restart
      offered.
      done: `gui/src/redesign/engines/engines.test.ts` › "after an install with a hosted session running…", "…with no hosted session it offers the restart", "…cannot be read it counts them as running", "a failed or skipped install leaves nothing waiting…"; `settings.test.tsx` › "Updates" (D9).
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
