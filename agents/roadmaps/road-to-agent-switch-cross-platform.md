---
complexity: lightweight
parent_roadmap: road-to-agent-switch-core
execution:
  mode: autonomous
---

# Roadmap: agent-switch cross-platform foundation (macOS / Linux / Windows)

> Every v1 command works on macOS, Linux, and Windows (or degrades with an
> explicit documented message), backed by tests and a CI matrix.

## Goal

Port the Claude-Code-only v1 tool off macOS-only assumptions: a per-OS
credential/lock/symlink abstraction, shell integration for
zsh/bash/fish/PowerShell, a `doctor` self-check, and a green
`[macOS, Linux, Windows] × [node 18, 22]` CI matrix.

## Prerequisites

- [ ] Read `README.md`, `ADOPTED.md`,
      [`archive/road-to-agent-switch-core.md`](archive/road-to-agent-switch-core.md).
- [ ] `npm run build` green on the current tree.
- [ ] A real Claude Code install for the macOS keychain contract test.

## Context

- Foundation of the `road-to-agent-switch-*` family. Two siblings build on it:
  [`road-to-agent-switch-multi-provider.md`](road-to-agent-switch-multi-provider.md)
  (Codex + Gemini) and
  [`road-to-agent-switch-gui-service.md`](road-to-agent-switch-gui-service.md)
  (usage engine + daemon + GUI). Rejected ideas:
  [`skipped/road-to-agent-switch-autoswitch-rejected.md`](skipped/road-to-agent-switch-autoswitch-rejected.md).
- Three verification items were deferred from the parent (copied verbatim into
  Phase 1).
- Verified platform facts (Claude Code docs + issue tracker, 2026-07-13):
  - Linux/Windows credentials: plaintext `.credentials.json` under
    `CLAUDE_CONFIG_DIR` (docs-verified). macOS: Keychain (hashed per dir).
  - Claude Code's settings writer **replaces file symlinks on write** (atomic
    rename — issue #40857): v1's write-through claim for `settings.json` is
    stale. Directory links survive; individual `.json` links do not.
  - Windows directory **junctions** work without elevation; file symlinks need
    Developer Mode/admin.
  - No XDG support (#1455); `CLAUDE_CONFIG_DIR` is the only relocation knob.
  - VS Code extension ignores `CLAUDE_CONFIG_DIR` (#30538) — document as a
    known limitation, out of scope to fix.
  - `~/.local/state/claude/` may be shared across profiles — impact unknown,
    verified in Phase 1.

## Phase 1: Contract verification per OS

- [ ] **Step 1:** Test harness with `node:test` (zero new runtime deps);
      `npm test` runs `tests/*.test.ts` via tsc + node.
      <!-- verify: npm test -->
- [ ] **Step 2 (deferred from parent):** macOS keychain service-hash contract
      test against a real install — scratch profile, login, assert
      `security find-generic-password -s "Claude Code-credentials-<hash>"`
      hits. Integration test, gated by `AGENT_SWITCH_CONTRACT_TESTS=1`.
- [ ] **Step 3 (deferred from parent):** Usage API response-shape check against
      a live response (`five_hour`/`seven_day` + `utilization` + `resets_at`).
      Same integration gate.
- [ ] **Step 4 (deferred from parent):** Verify Claude Code's settings-writer
      symlink behavior on the current version: assert file symlink replacement
      (#40857); assert writes inside a symlinked directory (`skills/`,
      `agents/`) land in the share source.
- [ ] **Step 5:** Linux verification (container/VM): config layout,
      `.credentials.json` under `CLAUDE_CONFIG_DIR`, lock-dir protocol,
      `sessions/{pid}.json`, `import` end-to-end.
- [ ] **Step 6:** Windows verification (VM): `.credentials.json` under
      `CLAUDE_CONFIG_DIR`, junction creation without elevation
      (`fs.symlinkSync(src, dst, "junction")`), lock-dir mtime on NTFS,
      `sessions/{pid}.json`, path normalization (drive letters, backslashes,
      `%USERPROFILE%`).
- [ ] **Step 7:** Determine whether `~/.local/state/claude/` (or equivalent)
      leaks across profiles; document in `README.md § Notes & gotchas`.
- [ ] **Step 8:** Write the per-OS contract matrix into `ADOPTED.md`; correct
      the stale write-through claim.

**Exit criteria:** `npm test` green; per-OS contract matrix in `ADOPTED.md`
with verified/degraded/broken per mechanism.
**Rollback:** docs + tests only — revert affected files.

## Phase 2: Platform abstraction layer

- [ ] **Step 1:** `src/credentials.ts` — read-only `CredentialStore` interface
      (no `write()` by design): darwin = keychain-then-file, linux/win32 =
      file-only. `keychain.ts` becomes a darwin backend. `api.ts` credential
      read switches to it.
- [ ] **Step 2:** `remove` per OS: keychain deletion darwin-only; elsewhere
      profile-dir removal suffices. Live-session guard unchanged.
- [ ] **Step 3:** `import` per OS: source credential = keychain (darwin) or
      `~/.claude/.credentials.json` (linux/win32); keep the lock-cooperative
      read; treat Windows lock staleness conservatively (Phase 1 Step 6).
- [ ] **Step 4:** Path-handling audit: no hardcoded `/` joins on user input;
      `AGENT_SWITCH_HOME`/`CLAUDE_CONFIG_DIR` strings pass through unresolved (hash
      contract); win32 mappings normalization (case-insensitive drive letters,
      `realpathSync` behavior). <!-- verify: npm test -->
- [ ] **Step 5:** Rework `share`: directories (`skills/`, `commands/`,
      `agents/`) via symlink (POSIX) / junction (win32); files (`settings.json`,
      `keybindings.json`, `CLAUDE.md`) can no longer rely on write-through —
      link them, document that an in-profile `/config` write forks the file,
      and add `agent-switch share sync` to re-link forked files (manifest detects a
      replaced link). `--history` stays POSIX-only.
- [ ] **Step 6:** `web` on linux/win32 (Playwright user-data-dir is
      cross-platform; verify launch args); degrade with a clear message where
      unsupported.

**Exit criteria:** all v1 commands behave identically on macOS (`npm test`
green incl. the existing workflow test); linux/win32 paths unit-tested with
mocked FS where no VM is available.
**Rollback:** revert `src/`; v1 behavior restored (no data migrations).

## Phase 3: Shell integration + install + doctor

- [ ] **Step 1:** `shellenv --shell zsh|bash|fish|powershell` (auto-detect from
      `$SHELL`/platform): zsh/bash POSIX, fish variant, PowerShell `claude`
      wrapper + `asw` function.
- [ ] **Step 2:** cmd.exe fallback: `agent-switch run` works everywhere; document
      the no-wrapper limitation.
- [ ] **Step 3:** `agent-switch doctor` — per-OS self-check (claude binary on PATH,
      config-dir resolution, credential readability, share-link health) with
      actionable fixes. <!-- verify: node dist/index.js doctor -->
- [ ] **Step 4:** Install story: `npm install -g` / `npm link` documented per
      OS; `package.json` `files` + tarball hygiene. Native package managers
      (Homebrew/Scoop/winget) deferred. <!-- deferred: revisit after the tool is public -->
- [ ] **Step 5:** README: per-OS install + integration sections, degradation
      matrix.

**Exit criteria:** fresh-machine install path exercised per OS (VM/CI);
`agent-switch doctor` exits 0 on a healthy setup.
**Rollback:** revert; zsh-only `shellenv` keeps working.

## Phase 4: CI + release readiness

- [ ] **Step 1:** Unit-test coverage for `profiles`, `mappings`, `share`,
      `locks`, `credentials` (every exported function with logic has ≥1 test).
      <!-- verify: npm test -->
- [ ] **Step 2:** CI matrix (GitHub Actions): `[macos, ubuntu, windows] ×
      [node 18, 22]` — build + unit tests; contract tests stay opt-in local
      behind `AGENT_SWITCH_CONTRACT_TESTS`. <!-- blocked-by: repo-hosting -->
- [ ] **Step 3:** `npm pack` smoke: install the tarball into a temp prefix, run
      `agent-switch --help` + `doctor`.

**Exit criteria:** CI green on all three OSes; tarball smoke passes.
**Rollback:** CI/docs only — revert.

## Acceptance Criteria

- [ ] All v1 commands work on macOS, Linux, and Windows, or degrade with an
      explicit documented message (`agent-switch doctor` reflects the matrix).
- [ ] Zero runtime dependencies (`dependencies` stays empty; playwright
      optional).
- [ ] Read-only invariant holds: no code path writes Claude Code's credential
      storage or calls the OAuth token-refresh grant.
- [ ] `npm test` green; CI matrix green.

## Blockers

### blocker: repo-hosting
- **Status:** resolved            <!-- github.com/event4u-app/agent-switch, pushed 2026-07-13 -->
- **Owner:** user
- **Blocks:** Phase 4 — CI + release readiness
- **What to do:**
  1. ~~Decide hosting and initialize the git repo + remote.~~ **Done:**
     `event4u-app/agent-switch` (public), `main` pushed.
  2. ~~Tell the agent the remote.~~ Done — CI workflow can land in Phase 4.
- **Resolved when:** `git remote -v` shows a pushable remote with Actions
  available.

## Notes

- Known upstream limitations documented, not fixed: VS Code extension ignores
  `CLAUDE_CONFIG_DIR` (#30538); possible shared state dir (Phase 1 Step 7).
