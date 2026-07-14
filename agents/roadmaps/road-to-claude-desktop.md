---
complexity: lightweight
status: draft
parent_roadmap: road-to-desktop-app-launch
---

# Roadmap: Claude Desktop client (per-account isolation)

> Run multiple Claude Desktop accounts, isolated and in parallel, via the shared
> launch layer. Cleanest of the GUI clients — one primitive, first-hand verified.

## Goal

`agent-switch open claude-desktop --profile <name>` launches Claude Desktop
signed into that profile's own account, isolated from the others, with multiple
accounts able to run side-by-side.

## Context (verified 2026-07-14)

- Claude Desktop is an Electron app (`com.anthropic.claudefordesktop`); the
  account is a **Chromium web session** (Cookies / Local Storage / Session
  Storage), not the CLI's token file. So its own login is unrelated to
  `CLAUDE_CONFIG_DIR` (which the app only references via its embedded Claude Code).
- **Strategy: `--user-data-dir`.** First-hand probe: `open -n -a "Claude" --args
  --user-data-dir=<dir>` created a full isolated profile. Distinct dir ⇒ distinct
  single-instance lock ⇒ **parallel accounts**. Confirmed by community tooling
  and adversarially re-checked.
- Sources: electron/electron#24447 (lock keyed on DIR_USER_DATA);
  philippstracker.com/multiple-claude-instances; melkon.tech/blog/two-claude-accounts-mac;
  github.com/jmdarre-v/claude-multiprofile; github.com/Zoltak-Dev/ai-multi-instance.

## Dependencies

- [ ] [`road-to-desktop-app-launch.md`](road-to-desktop-app-launch.md) — the
      launch layer + registry (this client registers `strategy: "user-data-dir"`).

## Phase 1: Register + launch

- [ ] **Step 1:** Register `claude-desktop` (bundleId `com.anthropic.claudefordesktop`,
      `strategy: "user-data-dir"`, profile GUI dir per app).
- [ ] **Step 2:** `agent-switch open claude-desktop --profile <name>` launches
      the app pointed at the profile's data-dir.
      <!-- verify: manual — new dir populated with Cookies/Local Storage, window logged-out -->
- [ ] **Step 3:** First run of a profile is logged-out (expected — web session);
      surface a one-line hint that the user logs in once per profile.

## Phase 2: Caveats handled

- [ ] **Step 1:** Ensure the flag reaches the app on every launch (spawn the
      inner binary or `open -n --args`; never rely on a bare `.app` double-click).
- [ ] **Step 2:** OAuth re-login guard: a `claude://` callback can reach the
      wrong live instance. Document "quit other Claude windows before
      re-logging-in a profile" (and/or detect + warn).
- [ ] **Step 3:** Leave the default `~/Library/Application Support/Claude` dir
      untouched (existing account); new profiles get new dirs.

## Phase 3: Verify on the target build

- [ ] **Step 1:** Re-run the probe on the installed version (behaviour is
      version-dependent): launch with a test data-dir, confirm a 2nd process
      spawned (`pgrep -lf "Claude.app/Contents/MacOS"`) and the dir populated.
      Fall back to duplicate `.app` bundles only if a future build drops the flag.

## Acceptance criteria

- Two Claude Desktop accounts open simultaneously, each isolated (separate
  session/MCP/settings), launched from agent-switch.
- No data-dir swapping; existing default account untouched.

## Risks

- Not officially supported; a Claude Desktop update could change launcher
  behaviour → Phase 3 re-verify is the guard.
- Web sessions expire per-dir independently (no shared refresh) — each profile
  re-logs-in on its own schedule.
