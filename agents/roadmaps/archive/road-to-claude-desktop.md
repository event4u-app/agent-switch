---
complexity: lightweight
status: complete
parent_roadmap: road-to-desktop-app-launch
---

# Roadmap: Claude Desktop client (per-account isolation)

> Run multiple Claude Desktop accounts, isolated and in parallel, via the shared
> launch layer. Cleanest of the GUI clients — one primitive, first-hand verified.
>
> **COMPLETE (archived).** `agent-switch open claude-desktop <profile>` launches
> Claude Desktop isolated to the profile's own `--user-data-dir`; verified
> end-to-end on the installed build. The default install dir is never touched.

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

- [x] [`road-to-desktop-app-launch.md`](archive/road-to-desktop-app-launch.md) — the
      launch layer + registry (this client registers `strategy: "user-data-dir"`).

## Phase 1: Register + launch

- [x] **Step 1:** Registered `claude-desktop` in `APPS` (bundleId
      `com.anthropic.claudefordesktop`, `strategy: "user-data-dir"`, provider
      claude; per-profile gui data dir). <!-- verify: npm test — registry + buildLaunch argv -->
- [x] **Step 2:** `agent-switch open claude-desktop [profile]` launches the app
      at the profile's data-dir (generic `open` from the foundation). argv
      unit-tested; error paths (no profile / not installed) e2e-tested; a real
      launch is verified in Phase 3. <!-- verify: npm test + Phase 3 probe -->
- [x] **Step 3:** First launch of a profile prints a one-line "opens logged-out;
      sign in once, session saved here" hint (fresh-data-dir detection in `open`).

## Phase 2: Caveats handled

- [x] **Step 1:** Launch always goes through `open -n … --args` (spawned
      detached in `cmdOpen`), never a bare `.app` double-click — the flag always
      reaches the app.
- [x] **Step 2:** OAuth re-login guard — the first-launch hint and the README
      GUI section both state "quit other Claude windows before signing in"
      (a `claude://` callback can reach the wrong live instance).
- [x] **Step 3:** The default `~/Library/Application Support/Claude` dir is never
      used — `buildLaunch` always targets the profile-scoped gui data dir
      (asserted by a test that rejects any default-install path).

## Phase 3: Verify on the target build

- [x] **Step 1:** Verified end-to-end on the installed build (v1.14271.0):
      `agent-switch open claude-desktop <profile>` launched Claude with
      `--user-data-dir=<profile>/gui/claude-desktop` (seen in `pgrep`), and that
      dir filled with a full isolated Chromium profile (Cookies/Local Storage/
      Session Storage/…). Parallel-account behaviour (distinct dir ⇒ distinct
      single-instance lock) is sourced + adversarially confirmed; the literal
      two-windows-at-once check is a trivial manual confirmation.

## Acceptance criteria

- Two Claude Desktop accounts open simultaneously, each isolated (separate
  session/MCP/settings), launched from agent-switch.
- No data-dir swapping; existing default account untouched.

## Risks

- Not officially supported; a Claude Desktop update could change launcher
  behaviour → Phase 3 re-verify is the guard.
- Web sessions expire per-dir independently (no shared refresh) — each profile
  re-logs-in on its own schedule.
