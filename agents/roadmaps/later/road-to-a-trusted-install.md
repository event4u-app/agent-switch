---
complexity: standard
status: parked
relates:
  - slug: road-to-the-rows-where-others-lead
    relation: split-from
    note: "Its Phase 1, moved here when the owner chose npm-only for now (D1 = 3)."
  - slug: road-to-agent-switch-native-updater
    relation: unblocks
    note: "Signing was that roadmap's first prerequisite; archived 2026-11-08 (owner: no native updater), its signing step merged here."
review_by: 2027-02-07
entry_condition:
  what: "The D1 row in agents/roadmaps/later/road-to-the-rows-where-others-lead.md records an owner choice other than (3), or the owner asks for a Homebrew or winget listing."
  when: "Checked at every /roadmap:triage-parked; review_by 2027-02-07."
  who: "owner (Apple Developer ID is a ~99 USD/year spend decision)"
---

# Road to a trusted install

> Last triaged: 2026-11-07 — resume condition unmet: D1 is still "(3) none for now" (`later/road-to-the-rows-where-others-lead.md:71,109`); `.github/workflows/release.yml` carries no `APPLE_*` or signing env. All 5 steps still needed. Steps 1.1/1.2 are the same work as native-updater Phase 5 Step 1 — keep signing tracked here only.

> **Source:** Phase 1 of `road-to-the-rows-where-others-lead.md` (review of
> 2026-11-01, `agents/tmp.old/inbox-2026-11-a/`). Parked on 2026-11-01: the owner
> chose to keep npm as the only install path for now (D1 = 3).
>
> Release builds are unsigned and not notarised; macOS needs "Open Anyway".
> Homebrew stops accepting casks that fail Gatekeeper from 2026-09-01
> (Homebrew/brew#20755), so an official cask needs 1.1 first.
>
> _Resume when:_ the owner wants Gatekeeper-clean installs, a Homebrew or winget
> listing. (The native updater was dropped by the owner on 2026-11-08,
> `archive/road-to-agent-switch-native-updater.md`; its signing step lives here.)
> Then decide first: pay for the Apple Developer ID (~99 USD/year, full path) or
> ship the unsigned tap with a quarantine caveat plus winget.

## Phase 1 — An install the OS trusts

- [ ] **1.1 macOS signing and notarisation in `release.yml`** (Tauri `APPLE_*`
      secrets, stapled universal `.dmg`; the job fails when a secret is missing).
      verify: `spctl -a -vv -t install` and `xcrun stapler validate` on the release `.dmg`.
- [ ] **1.2 Windows signing (optional within D1).**
      verify: `Get-AuthenticodeSignature` → `Valid`, or the SmartScreen note in the release text.
- [ ] **1.3 Homebrew** — own tap `event4u-app/homebrew-tap`; official cask only after 1.1. No `--no-quarantine` advice.
      verify: `brew install --cask event4u-app/tap/agent-switch` on a clean runner.
- [ ] **1.4 winget** manifest (silent switch, direct `InstallerUrl`, SHA-256), submitted to `microsoft/winget-pkgs`, updated from `release.yml`.
      verify: `winget install event4u.agent-switch` then `agent-switch --version`.
- [ ] **1.5 README and docs** list brew/winget/npm. <!-- adapted 2026-11-08: the native-updater roadmap it was to notify is archived -->
      verify: `task docs:check` → 0.
