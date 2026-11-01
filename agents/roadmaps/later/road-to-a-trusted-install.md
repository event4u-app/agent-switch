---
complexity: standard
status: parked
relates:
  - slug: road-to-the-rows-where-others-lead
    relation: split-from
    note: "Its Phase 1, moved here when the owner chose npm-only for now (D1 = 3)."
  - slug: road-to-agent-switch-native-updater
    relation: unblocks
    note: "Signing is that roadmap's first prerequisite."
---

# Road to a trusted install

> **Source:** Phase 1 of `road-to-the-rows-where-others-lead.md` (review of
> 2026-11-01, `agents/tmp.old/inbox-2026-11-a/`). Parked on 2026-11-01: the owner
> chose to keep npm as the only install path for now (D1 = 3).
>
> Release builds are unsigned and not notarised; macOS needs "Open Anyway".
> Homebrew stops accepting casks that fail Gatekeeper from 2026-09-01
> (Homebrew/brew#20755), so an official cask needs 1.1 first.
>
> _Resume when:_ the owner wants Gatekeeper-clean installs, a Homebrew or winget
> listing, or starts the native updater (`road-to-agent-switch-native-updater.md`).
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
- [ ] **1.5 README and docs** list brew/winget/npm; `later/road-to-agent-switch-native-updater.md` gets "prerequisite 1 met".
      verify: `task docs:check` → 0.
