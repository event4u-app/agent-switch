---
complexity: structural
parent_roadmap: road-to-agent-switch-gui-service
execution:
  mode: manual
---

# Roadmap: native in-app auto-update (Tauri updater)

> Parked follow-up to the shipped check-and-notify update flow. Turns the GUI's
> "a new version exists → open the download page" experience into a real
> self-installing updater (download + verify + relaunch), gated behind the
> release/signing infrastructure and the CLI-versioning decision it depends on.

## Status: LATER (parked, not planned)

This is deliberately parked under `later/` — it is **not** scheduled work. It
records the design so the decision and its prerequisites are not lost. The
lightweight path (GitHub-release check + notify, `gui/src/updates.ts` +
Settings → Updates) already ships and covers the day-to-day need. Promote this
roadmap to the active tree only when the prerequisites below are actually being
tackled.

## Goal

Replace the browser-download step with a native Tauri updater: the app checks a
signed `latest.json`, downloads the matching signed installer, verifies its
signature, installs it, and relaunches — with a user-chosen update mode
(Automatic / Notify / Manual) defaulting to **Notify**, never silent-Automatic,
until rollback + telemetry exist.

## Why this is parked, not built now

- **No release/signing infrastructure exists.** CI only builds + tests; there is
  no signed-artifact pipeline, no published GitHub Releases, no `latest.json`,
  and no updater signing keypair. The native updater cannot function without all
  of these — building the plugin first would be dead code.
- **The CLI↔GUI split is an unresolved load-bearing decision** (see below). The
  native updater updates only the GUI binary; the `agent-switch` CLI is a
  separate npm package. Shipping GUI auto-update without resolving version skew
  turns a bad release into a support incident.
- The shipped check-and-notify flow already gives users a good "you're out of
  date → here's the download" experience at zero infrastructure cost, so there
  is no urgency that justifies the larger build now.

## Context — council convergence

**Council (claude-sonnet-4-5 + gpt-4o, design lens, 2 rounds, 2026-07-16)**
reviewed the update-experience design. Both members converged, host-accepted:

- **"On by default" should mean Notify, not silent install.** The update mode is
  a three-way choice — Automatic (silent) / Notify (auto-download, prompt before
  restart) / Manual (check on demand). For a developer tray tool, **Notify** is
  the least-surprising default (VS Code's model); silent-Automatic waits until
  rollback + adoption telemetry exist. This is why the shipped flow and this
  roadmap both default to notify, not silent.
- **The CLI↔GUI split is the load-bearing decision**, not the update mechanism.
  Two independent update channels (Tauri updater for the GUI, npm for the CLI)
  create version-skew risk. Preferred resolution: bundle the CLI into the GUI so
  one artifact updates atomically; the alternative is an explicit
  `--json`-contract version negotiation.
- **B needs rollback/kill-switch.** The Tauri updater has no built-in rollback;
  auto-install is otherwise a one-way door.
- **Distribution is a prerequisite.** The updater needs a real distribution
  channel (public GitHub Releases already exist for the repo — `event4u-app/
  agent-switch`) and a signed `latest.json` endpoint.
- **Linux caveat (deferred):** the Tauri updater does not update Flatpak/Snap/apt
  packages; those channels self-update. Currently moot — the bundle targets are
  macOS + Windows only (`app/dmg/msi/nsis`), no Linux target. Revisit if a Linux
  build target is added.

## Phase 1: Release + signing infrastructure

- [ ] **Step 1:** Generate an updater signing keypair (`tauri signer generate`);
      store the private key + password as CI secrets (user-provided), embed the
      public key in `tauri.conf.json` (`plugins.updater.pubkey`).
- [ ] **Step 2:** Release workflow (tag-triggered) that builds signed installers
      per platform (macOS `.dmg`/`.app`, Windows `.msi`/`.nsis`) and uploads them
      to a GitHub Release.
- [ ] **Step 3:** Publish a signed `latest.json` update manifest (the updater
      endpoint) as part of the release — platform → { version, url, signature }.
- [ ] **Step 4:** Document the release process (how to cut a version, where the
      secrets live, how a release maps to `latest.json`).

**Exit criteria:** a tagged release produces signed, downloadable installers plus
a `latest.json` the updater can read.
**Rollback:** the release workflow is additive; disable it and manual downloads
still work.

## Phase 2: Resolve the CLI↔GUI versioning decision

- [ ] **Step 1:** Decide: bundle the CLI inside the GUI (one artifact, atomic
      update) **or** keep them separate with an explicit `--json`-contract version
      negotiation (GUI checks CLI version at startup, degrades/blocks on
      incompatibility). Record as an ADR.
- [ ] **Step 2:** Implement the chosen path. If bundling: ship the CLI binary
      inside the app bundle and point the GUI at it. If separate: add the version
      handshake + a clear "CLI update needed" path in the UI.

**Exit criteria:** a GUI update can never leave the app talking to an
incompatible CLI without the user being told exactly what to do.
**Rollback:** the versioning handshake is additive.

## Phase 3: Tauri updater integration

- [ ] **Step 1:** Add `tauri-plugin-updater` (Rust) + `@tauri-apps/plugin-updater`
      (JS) + the `updater:default` capability.
- [ ] **Step 2:** Replace the browser-download button in Settings → Updates with
      the native flow (download → verify → install), keeping the existing
      check-and-notify status display.
- [ ] **Step 3:** Implement the three-way update mode (Automatic / Notify /
      Manual), default **Notify**; persist the choice. The existing
      `agent-switch-auto-update-check` flag becomes the Manual↔auto toggle;
      Automatic is a separate opt-in.
- [ ] **Step 4:** Restart UX — defer the relaunch until the user is idle / closes
      the window; never interrupt mid-session for a tray app that runs for weeks.

**Exit criteria:** from a real signed release, the app updates itself end-to-end
on macOS + Windows with a Notify-mode prompt.
**Rollback:** feature-flag the native path; fall back to check-and-notify.

## Phase 4: Rollback / kill-switch + failure handling

- [ ] **Step 1:** Kill-switch — a way to halt auto-update rollout for a bad
      release (e.g. a `yanked` flag in `latest.json` the client honours).
- [ ] **Step 2:** Download/verify failure handling — never install an
      unverified artifact; surface failures without blanking the app; retry with
      backoff.
- [ ] **Step 3:** Document the rollback story (how to pull a bad release, how
      clients recover).

**Exit criteria:** a bad release can be stopped centrally, and a failed update
never leaves the app broken.

## Phase 5: Packaging, Linux, docs

- [ ] **Step 1:** Code-signing / notarization for macOS (Developer ID) and
      Windows (Authenticode) so installers pass Gatekeeper/SmartScreen.
- [ ] **Step 2:** Linux strategy — if a Linux target is added, use AppImage
      self-update or defer to package-manager channels (Flatpak/Snap/apt);
      document the degraded path. Skip while there is no Linux build target.
- [ ] **Step 3:** README + `gui/README`: update channels, mode choices, how to
      verify a release.

**Exit criteria:** signed installers pass OS gatekeepers; the update story is
documented per platform.

## Acceptance Criteria

- [ ] A tagged release ships signed installers + a signed `latest.json`.
- [ ] The GUI updates itself (download → verify → install → relaunch) on macOS +
      Windows from a real release.
- [ ] The update mode defaults to Notify; Automatic is a deliberate opt-in.
- [ ] CLI↔GUI version skew is impossible or clearly surfaced to the user.
- [ ] A bad release can be halted centrally (kill-switch); a failed update never
      breaks the app.

## Blockers

### blocker: updater-signing-key
- **Status:** open
- **Owner:** user
- **Blocks:** Phase 1 — the private key + password must be created and stored as
  CI secrets by the maintainer; the agent never generates or holds signing keys.
- **Resolved when:** the keypair exists, the public key is in `tauri.conf.json`,
  and the private key + password are set as CI secrets.

### blocker: distribution-channel
- **Status:** open
- **Owner:** user
- **Blocks:** Phase 1 — confirm GitHub Releases (public repo `event4u-app/
  agent-switch`) is the distribution + updater endpoint, or name another.
- **Resolved when:** the release + `latest.json` hosting location is confirmed.

## Notes

- The shipped check-and-notify implementation (`gui/src/updates.ts`, Settings →
  Updates, `agent-switch-auto-update-check` default ON) is the fallback and the
  status surface this roadmap builds on — it stays even after the native updater
  lands (it renders version state; the updater performs the install).
- Default discipline: never silent-Automatic before Phase 4 (rollback) +
  adoption telemetry exist. Notify is the ceiling until then.
