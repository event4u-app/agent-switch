---
complexity: lightweight
---

# Roadmap: agent-switch core — multi-account switching for Claude Code (macOS)

> Switch between multiple Claude Code accounts with one shell command — no
> repeated login/logout, no browser round-trips after initial setup.

**Retroactive record.** This roadmap documents the initial build (completed
2026-07-13) so the project has an auditable baseline. All implementation work
below shipped; the three deferred verification items migrated to
[`road-to-agent-switch-cross-platform-service.md`](../road-to-agent-switch-cross-platform-service.md).

## Goal

A dependency-free TypeScript CLI that keeps every Claude Code account
live-logged-in in its own isolated `CLAUDE_CONFIG_DIR` profile, and makes
switching / parallel use / per-repo selection a one-command operation on macOS.

## Context

- Owner uses 3 accounts for separate contexts (private / company / client).
- Key architecture decision: **no keychain/folder snapshotting** — OAuth
  refresh tokens rotate on every refresh, so snapshots go stale within hours.
  Instead: `CLAUDE_CONFIG_DIR` isolation, each profile a live login.
- Seven mechanisms adopted from an external reference implementation, each
  verified against its source; see `ADOPTED.md` for the per-mechanism record.

## Phase 1: Profile core and switching

- [x] **Step 1:** Profile store under `~/.agent-switch/<name>/config`
      (`AGENT_SWITCH_HOME` override), `state.json` with active profile —
      `src/profiles.ts`.
- [x] **Step 2:** Profile name validation, existence checks, listing,
      account-email extraction from `.claude.json` (`oauthAccount` block).
- [x] **Step 3:** `add` (create + first login), `use`, `run` (parallel
      sessions without switching), `list`/`ls`, `current`, `whoami` —
      `src/index.ts`.
- [x] **Step 4:** `shellenv` zsh integration: `claude()` wrapper injecting the
      resolved profile's `CLAUDE_CONFIG_DIR`, `cs` shorthand.

## Phase 2: Adopted mechanisms (external reference, see ADOPTED.md)

- [x] **Step 1:** Hashed keychain service derivation
      (`"Claude Code-credentials-" + sha256(NFC(raw dir))[:8]`) —
      `src/keychain.ts`; used by `remove` (real entry deletion) and `status`
      (credential read).
- [x] **Step 2:** Login-free `import` of the default `~/.claude` install via
      plaintext `.credentials.json` seeding; stale keychain entry deleted
      before seed; `hasCompletedOnboarding` + `theme` set to avoid the
      onboarding loop — `cmdImport` in `src/index.ts`.
- [x] **Step 3:** Cooperation with Claude Code's proper-lockfile directory
      locks (`~/.claude.lock`, 10s staleness, touch cadence) around import
      reads — `src/locks.ts`; verified: fresh lock blocks ~9s and aborts
      cleanly, stale lock is taken over.
- [x] **Step 4:** Settings sharing via write-through symlinks
      (`settings.json`, `keybindings.json`, `CLAUDE.md`, `skills/`,
      `commands/`, `agents/`), manifest-guarded, history opt-in — `src/share.ts`.
- [x] **Step 5:** Directory → profile mappings with nearest-ancestor
      resolution (`map`/`unmap`/`mappings`/`dir`; precedence mapping > active
      profile > default) — `src/mappings.ts`.
- [x] **Step 6:** Read-only OAuth identity + 5h/7d usage for `status`
      (`/api/oauth/profile`, `/api/oauth/usage`, beta header) — `src/api.ts`.
- [x] **Step 7:** Live-session detection from `<config>/sessions/{pid}.json`;
      `list` shows counts, `remove` refuses without `--force` — `src/api.ts`.

## Phase 3: Browser sessions and removal

- [x] **Step 1:** `web <name>` — persistent per-profile Playwright Chromium
      user-data-dir under `~/.agent-switch/<name>/browser` (playwright as
      optionalDependency, dynamic import).
- [x] **Step 2:** `remove` — keychain entry first, then profile dir, state
      reset, mapping pruning; active-profile and live-session guards.

## Phase 4: Documentation

- [x] **Step 1:** `README.md` — architecture rationale, install, daily-use
      table, gotchas (never `claude auth logout`; running sessions unaffected
      by switch; shared OAuth lineage after import).
- [x] **Step 2:** `ADOPTED.md` — per-mechanism source verification record,
      deliberately-not-adopted list, open verification points.

## Acceptance Criteria

- [x] `tsc` strict compiles with zero errors.
- [x] add/use/list/run/remove workflow passes end-to-end (verified with a
      fake `claude` binary).
- [x] All adopted mechanisms carry a source citation in `ADOPTED.md`.

## Deferred — migrated to follow-up

- [~] Keychain service-hash contract test against a real Claude Code install.
      <!-- deferred: migrated to road-to-agent-switch-cross-platform-service -->
- [~] Usage API response-shape verification against a live response.
      <!-- deferred: migrated to road-to-agent-switch-cross-platform-service -->
- [~] Write-through symlink behavior of Claude Code's settings writer on
      current versions. <!-- deferred: migrated to road-to-agent-switch-cross-platform-service -->

## Notes

- Deliberately not adopted from the reference implementation: the
  quota-based auto-rotation engine (usage-policy conflict), the OAuth
  token-refresh grant (would rotate tokens under live sessions), snapshot
  switch machinery, cross-machine credential transfer, TUI/menubar. See
  `ADOPTED.md § Deliberately not adopted`.
- Invariants established here: zero runtime dependencies, read-only API
  paths, never write Claude Code's credential storage (seeding via the
  supported plaintext-file path only).
