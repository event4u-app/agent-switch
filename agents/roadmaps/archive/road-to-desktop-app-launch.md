---
complexity: structural
status: complete
---

# Roadmap: desktop/GUI app launch layer (shared foundation)

> **COMPLETE (archived).** All phases closed: the generic launch layer (registry
> + pure `buildLaunch` for both strategies + `open`/`apps` CLI + GUI wiring +
> docs) ships with an empty registry. End-to-end launch against a *real* app is
> proven by the first per-client roadmap (`road-to-claude-desktop`).

> Extend agent-switch's per-profile isolation beyond the three CLIs to GUI /
> desktop clients (Claude Desktop, Codex UI, …). This is the shared foundation
> the per-client roadmaps depend on; it adds a **launch layer** and an **app
> registry** with two isolation strategies. No client-specific logic lives here.

## Goal

`agent-switch open <app> --profile <name>` launches a supported GUI client with
the chosen profile fully isolated, reusing agent-switch's existing profile
directories. Two isolation strategies, one dispatcher.

## Context (verified in the 2026-07-14 spike)

Isolation for GUI clients reduces to two primitives:

1. **Env-var config-dir** — the mechanism agent-switch already uses for the CLIs
   (`CLAUDE_CONFIG_DIR` / `CODEX_HOME` / `GEMINI_CLI_HOME`). GUI surfaces that
   read the same env var isolate the same way; the only added work is launching
   the GUI with the env var set (GUI apps do not inherit the shell env).
2. **`--user-data-dir` launch flag** — for Electron/Chromium apps. A distinct
   user-data-dir gets a distinct single-instance lock (Electron keys the lock on
   `DIR_USER_DATA`), so profiles run **in parallel**, isolated
   (cookies/localStorage/session). Verified first-hand against Claude Desktop
   and by community tooling; sources in the per-client roadmaps.

Key constraints this layer must honour:
- **Launch must carry the flag/env.** A Finder/Dock/Spotlight double-click does
  not pass `--args`, so daily use needs a wrapper/launcher, not a bare `.app`.
- **Never swap/symlink a live app's data-dir** (SingletonLock stranding +
  SQLite/LevelDB corruption). The launch-flag/env approach avoids this entirely.
- **Unofficial + version-fragile.** No vendor ships a built-in switcher; an app
  update can change behaviour. Re-verify per client after major updates.

## Dependencies

- [x] CLI profile model + per-profile dirs (`road-to-agent-switch-core`, merged).
- [x] Spike complete: mechanisms verified (this roadmap's Context).

## Phase 1: App registry

- [x] **Step 1:** App descriptor `{ id, displayName, bundleId, provider,
      strategy: "env" | "user-data-dir", envVar? }` + `isInstalled()` (macOS
      bundle-id probe via `mdfind`) + `findApp()`. `src/apps.ts`.
      <!-- verify: npm test (apps.test.ts) -->
- [x] **Step 2:** Pure `buildLaunch(app, name)` returning the exact `open` argv
      for each strategy (env → `--env VAR=<configDir>`; user-data-dir →
      `--args --user-data-dir=<guiDataDir>`), no side effects.
      <!-- verify: npm test — both strategies' argv asserted -->
- [x] **Step 3:** Per-profile GUI data-dir scheme `<root>/<provider>/<name>/gui/<appId>/`
      via `guiDataDir()`; created lazily at launch (Phase 2 `open`).

## Phase 2: CLI

- [x] **Step 1:** `agent-switch open <app> [profile]` — resolve the profile
      (explicit name > active for the app's provider), lazily create the
      per-profile GUI data dir, `buildLaunch`, spawn detached (`open -n …`).
- [x] **Step 2:** `agent-switch apps` — list registered apps + installed dot
      (empty-registry message in the foundation).
- [x] **Step 3:** Errors: unknown app, unsupported OS (macOS-only), profile
      missing/not-found, app-not-installed → actionable messages.
      <!-- verify: npm test (cli-e2e: apps empty, open usage + unknown-app) -->

## Phase 3: GUI integration

- [x] **Step 1:** IPC wrappers `listApps()` (parses `apps --json`, `[]` on
      failure) / `openApp(appId, name)` (runs `open <app> <profile>`).
- [x] **Step 2:** Per-profile row shows an "Open in <app>" button for each
      registered+installed app matching the row's provider (nothing while the
      registry is empty). <!-- verify: vitest — ipc builders + affordance-click launches -->

## Phase 4: Docs + safety

- [x] **Step 1:** README "GUI apps (experimental, macOS)" section — the two
      strategies, `apps`/`open` commands, empty-registry status, and the caveats
      (macOS-only, `open`-launched not double-click, unofficial, no live swap).
- [x] **Step 2:** A "verify a candidate Electron app honours --user-data-dir"
      snippet users can run (in the same README section).

## Acceptance criteria

- `buildLaunch` is a pure, unit-tested function covering both strategies.
- `agent-switch open` launches at least one real client isolated (proven by the
  first per-client roadmap that lands on top of this).
- No data-dir swapping anywhere; no launch path that silently drops the flag.

## Risks

- Vendors may change launcher behaviour → each client roadmap owns a re-verify step.
- macOS-only initially; Linux/Windows launch differ (out of scope until asked).
