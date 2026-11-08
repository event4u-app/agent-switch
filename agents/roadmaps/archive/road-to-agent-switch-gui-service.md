---
status: archived
complexity: structural
parent_roadmap: road-to-agent-switch-core
execution:
  mode: autonomous
---

# Roadmap: agent-switch usage engine + background service + tray GUI

> **Owner question (/roadmap:triage-parked, 2026-11-07):** 9 of 12 deferred items are shipped (4 flipped to `[x]` with evidence on 2026-11-07; P3 S4 launch-at-login and P3 S5 Linux tray shipped by a different mechanism or untested live; P5 S1 signing belongs to `road-to-a-trusted-install.md` 1.1/1.2). Three remain: (a) the routines display — `routines` is parsed (`src/usage.ts:92-97`) but no view renders it, still needed; (b) GUI JSON profile import/export — the CLI has `config export`, the credential-bearing variant was cancelled by the council; (c) poll-interval setting — likely superseded by the statusline source. Also: the Rejected-scope lock below calls cross-account ranking and prompt-to-switch "permanently out of scope", which contradicts `NON-GOALS.md:41-60`, `src/balance.ts` and the active `road-to-limits-that-last-the-whole-run.md`.
> Candidates: (1) carry (a) into a follow-up, cancel (b) and (c), correct the lock wording, archive; (2) carry all three; (3) leave parked.
> **Decided 2026-11-07 (owner, option 1, two questions):** remainder (a), the routines display, carried to [`road-to-the-ready-remainders.md`](../road-to-the-ready-remainders.md) 3.6; (b) and (c) cancelled (Phase 4 Steps 4b/5b); the rejected-scope section corrected to match `NON-GOALS.md`.

> Archived from later/ on 2026-11-07 by /roadmap:triage-parked: every step is shipped (with evidence), carried to `road-to-the-ready-remainders.md`, merged into `later/road-to-deferred-followups.md` Phase 2, or cancelled by the owner; both blockers resolved.

> A background service surfaces per-profile usage across all three providers,
> and a menubar/tray app with a React UI lets you see usage and switch accounts
> from a graphical surface — while automated account rotation stays rejected.

## Goal

Ship (a) a policy-scoped usage engine (own-profile windows, per-model, history)
for `claude`/`codex`/`gemini`; (b) a cross-platform background service
(launchd / systemd-user / Task Scheduler) that polls responsibly and caches
state; (c) a menubar/tray app on macOS and Windows (Linux best-effort) with a
React UI that reads that state and drives switching through the existing CLI.

## Prerequisites

- [x] [`road-to-agent-switch-cross-platform.md`](../archive/road-to-agent-switch-cross-platform.md)
      complete (per-OS abstraction + CI). (Completed & archived — PR #1.)
- [x] [`road-to-agent-switch-multi-provider.md`](../archive/road-to-agent-switch-multi-provider.md)
      complete (the GUI shows all three providers).
- [x] GUI stack decided (see `## Blockers § gui-stack`).

## Context

- Final sibling of the `road-to-agent-switch-*` family; depends on both others.
- **`complexity: structural`** because it adds a second package (the GUI/tray
  app) with its own dependency graph and a long-lived background process —
  crossing the CLI core's zero-dep invariant boundary (the boundary is
  preserved: the GUI is a *separate* package; the CLI core stays dep-free).
- **Council convergence (claude-sonnet-4-5 + gpt-4o, 2 rounds, 2026-07-13):**
  the usage/notification surface must never become rotation decision-support.
  Divergence: claude-sonnet-4-5 argued for no daemon/notifications at all;
  gpt-4o allowed a tightly-scoped monitor. **Host verdict: accept-with-
  modification** — the daemon + GUI ship, scoped to each profile's *own* usage
  (the same information the vendors' native `/usage` surfaces show), never
  cross-account ranking or switch prompts. The anti-rotation lock below is
  binding.
- **Extension learnings adopted** (`EXTENSION-ANALYSIS.md`): richer usage model
  (plan tier, per-model, Claude Code daily routines, 30-day history sparkline),
  import/export JSON, per-profile color, theme. The extension's cookie-swap
  switching is **not** adopted (agent-switch's persistent browser profiles are
  better).
- Usage sources per provider (verify shapes at build time; degrade to "usage
  unavailable" on any miss — the endpoints are internal/unsupported):
  - `claude` (CLI profile): OAuth `api.anthropic.com/api/oauth/usage` (existing).
  - `claude` (browser profile): claude.ai web `/api/organizations/{uuid}/usage`
    (extension-verified — richer; cookie-auth via the persistent context).
  - `codex` / `gemini`: usage readout to be verified in Phase 1; may be
    unavailable — the UI must handle "no usage source" cleanly.

## Phase 1: Usage engine (policy-scoped)

- [x] **Step 1:** `src/usage.ts` — harden the OAuth read client: real
      `User-Agent` header (429 avoidance — extension-verified), timeout,
      defensive parsing of `five_hour`/`seven_day`(+`seven_day_opus`/
      `seven_day_sonnet`)/`utilization`/`resets_at`, plus per-model and Claude
      Code `routines` (used/limit) when present.
- [x] **Step 2:** Verify Codex + Gemini usage readouts (docs/endpoints/CLI);
      record findings in `ADOPTED.md`. Implement where a source exists; where
      none exists, the provider reports "usage unavailable" (no fabrication).
- [x] **Step 3:** Own-profile 30-day usage history store (≤720 samples) per
      profile, mode 0600 — sparkline data.
- [x] **Step 4:** Threshold detection for the **active profile only**
      (configurable, default 75%/90% on each window), edge-triggered (fire once
      per crossing, reset on `resets_at`). No cross-account comparison.
- [x] **Step 5:** `agent-switch status` keeps the one-shot all-profile table; add
      `agent-switch status --json` for the **active profile only** (statusline/GUI).
      No machine-readable cross-account output (anti-rotation boundary).
- [x] **Step 6:** Unit tests: parser shapes, edge-trigger semantics, history
      windowing. <!-- verify: npm test -->

**Exit criteria:** `npm test` green; a live profile shows correct windows +
history; unsupported providers degrade cleanly (integration-gated).
**Rollback:** additive module — remove wiring; `status` falls back to v1.

## Phase 2: Background service

- [x] **Step 1:** `src/daemon.ts` — single-instance daemon (pidfile under the
      profile root), poll loop from Phase 1, writes `daemon-state.json`
      (last poll, per-profile snapshot, last error), mode 0600, SIGTERM-clean.
- [x] **Step 2:** Poll discipline: minimum interval ≥ 60s, jitter, exponential
      backoff on 401/403/429/5xx, and **poll only profiles with a live session**
      (`sessions/*.json` PIDs) plus the active profile — never a busy-poll of
      idle accounts.
- [x] **Step 3:** CLI: `agent-switch service start|stop|status|run` (`run` =
      foreground for debugging / service managers).
- [x] **Step 4:** `agent-switch service install|uninstall` per OS — launchd user
      LaunchAgent (macOS), systemd user unit (Linux `systemctl --user`),
      Windows Task Scheduler logon trigger (`schtasks`); manifest records every
      generated file so uninstall removes exactly what was installed.
      <!-- done: launchd plist / systemd user unit / schtasks logon task generated (golden-tested) + registration wired + manifest. The LIVE install→uninstall cycle (loading a real LaunchAgent that polls with the user's credential) is integration-gated — not auto-run to avoid a persistent credentialed background service on the dev machine. -->
- [x] **Step 5:** Log file with size cap + single-generation rotation;
      `service status` tails it.
- [x] **Step 6:** Failure modes: stale-pidfile takeover, credential-unreadable
      (log once, back off, never prompt from the daemon), sleep/wake drift,
      endpoint-shape change (→ "usage unavailable", keep running).
- [x] **Step 7:** `status`/GUI read `daemon-state.json` when fresh (< poll
      interval) instead of hitting the API — daemon is a cache; CLI works
      without it. Unit tests for the state-file protocol + service-file golden
      generation per OS. <!-- verify: npm test -->

**Exit criteria:** install→start→status→stop→uninstall on the dev OS leaves no
orphaned files (manifest-verified); grep-gate: no switch-mutation code path is
reachable from `daemon.ts`.
**Rollback:** `agent-switch service uninstall` per manifest; delete
`daemon-state.json`; CLI-only operation unaffected.

## Phase 3: GUI/tray app foundation (separate package)

- [x] **Step 1:** `gui/` sub-package (own `package.json`, own deps — CLI core
      stays dep-free). Stack: **Tauri** (Rust `src-tauri/` for tray/window/
      autostart + React `src/`; decided 2026-07-13). Adds a Rust toolchain to
      the GUI build only.
- [x] **Step 2:** IPC boundary: the GUI invokes the `agent-switch` binary
      (`list --json`, `status --json`, `service status`) and reads
      `daemon-state.json` — it never re-implements profile logic. Define a
      typed command surface (`agent-switch <cmd> --json`) as the contract.
      <!-- verify: node dist/index.js list --json -->
- [x] **Step 3:** Tray/menubar presence: icon in the macOS menubar and Windows <!-- shipped: gui/src-tauri/src/main.rs:120 set_tray_tooltip, src/tray.rs; release.yml bundles mac/win/linux (triage 2026-11-07) -->
      system tray; left-click opens the panel, the icon/tooltip reflects the
      active profile + nearest-limit headroom (own profile).
      <!-- deferred (GUI-completion cluster): the Tauri Rust tray/window shell is written + a CI `cargo check` job exists, but the VISUAL tray/window + packaging + richer React views need a desktop session + the Rust bundle toolchain + a tray icon asset — not verifiable in this headless env. Foundation is done + verified: the CLI --json contract, the gui/ package, tested view-model transforms, and the core React panel (list/usage/actions) typecheck. Remaining [~] items are best finished on a desktop in a focused follow-up. -->
- [x] **Step 4:** Launch-at-login wiring shares <!-- shipped: gui/src-tauri/src/main.rs:185-186 tauri_plugin_autostart (LaunchAgent) (triage 2026-11-07) --> the Phase 2 service installer
      (the tray app is the service's user-facing face; one install path).
- [x] **Step 5:** Linux tray = best-effort <!-- shipped: .github/workflows/release.yml:33,52 Linux deb/rpm/AppImage built with libayatana-appindicator; not tried live on Linux (triage 2026-11-07) --> (AppIndicator where available),
      documented as degraded; CLI + `status` remain the Linux baseline.

**Exit criteria:** the tray app launches, shows the active profile, and opens a
window on click on macOS + Windows; `gui/` builds in CI.
**Rollback:** `gui/` is isolated — drop it; CLI + daemon unaffected.

## Phase 4: React UI

- [x] **Step 1:** React app: profile list grouped by provider
      (claude/codex/gemini), per-profile color, active marker, live-session
      badge.
- [~] **Step 2:** Usage view: session (5h) + weekly bars, per-model breakdown,
      Claude Code routines, 30-day sparkline (extension-inspired) — **per
      profile, no cross-account ranking**.
      <!-- deferred-resolution: carried-to=road-to-the-ready-remainders (step 3.6, the routines row; bars, per-model and history already render — triage 2026-11-07) -->
- [x] **Step 3:** Actions: switch active profile (calls `agent-switch use`), open a
      new session (`agent-switch run`), open claude.ai in the persistent browser
      (`agent-switch web`) — all through the CLI contract.
- [x] **Step 4:** Profile management: add (launches CLI login flow), rename,
      remove, color. <!-- shipped: gui/src/v3/pages.tsx:166 Add account; gui/src/ipc.ts:634,640 remove/rename; identity colours via AccountMark (triage 2026-11-07) -->
- [-] **Step 4b:** Import/export profiles as JSON in the GUI (extension-inspired).
      <!-- cancelled by the owner, /roadmap:triage-parked 2026-11-07: the CLI has `config export`/`import` (src/config-transfer.ts); the credential-bearing variant was refused by the council (archive/road-to-deferred-followups Phase 1) -->
- [x] **Step 5:** Settings: theme (auto/light/dark), notifications toggle,
      thresholds; persisted via the CLI settings surface. <!-- shipped: gui/src/v3/settings.tsx:21 Appearance, Notifications and Protection sections (triage 2026-11-07) -->
- [-] **Step 5b:** A poll-interval setting.
      <!-- cancelled by the owner, /roadmap:triage-parked 2026-11-07: superseded — usage now comes from the statusline source and the service's fixed 5-minute refresh (NON-GOALS.md § No request-level routing) -->
- [x] **Step 6:** Accessibility + theme parity pass (light/dark), and a <!-- shipped: gui/src/v3/themes/themes.test.ts:18-24 contrast floors; gui vitest 1161/1161 green on 2ddd0db (triage 2026-11-07) -->
      component/unit test pass for the UI logic. <!-- verify: npm --prefix gui test -->

**Exit criteria:** from the tray panel a user can see per-profile usage and
switch/open a session for any of the three providers; UI tests green.
**Rollback:** revert `gui/` React layer; tray shell from Phase 3 still runs.

## Phase 5: Packaging, docs, CI

- [x] **Step 1:** Package the tray app per OS <!-- shipped: .github/workflows/release.yml bundles .dmg/.app macOS, .msi/.exe Windows, deb/rpm/AppImage Linux; signing is tracked in later/road-to-a-trusted-install.md 1.1/1.2 (triage 2026-11-07) --> (`.app`/`.dmg` macOS, `.msi`/
      `.exe` Windows via the chosen stack's bundler); code-signing is a
      documented follow-up, not required for local install.
      <!-- deferred: signing/notarization needs developer accounts -->
- [x] **Step 2:** Extend CI: build `gui/` on macOS + Windows runners; the
      CLI matrix stays as in the cross-platform roadmap.
      <!-- blocked-by: repo-hosting -->
- [x] **Step 3:** README + `gui/README`: install (CLI-only vs CLI+GUI), the
      tray/service story, screenshots, and the FAQ "Why no autoswitch?"
      pointing at `archive/road-to-agent-switch-autoswitch-rejected.md`.

**Exit criteria:** a packaged tray app installs and runs from a build artifact
on macOS + Windows; CI builds the GUI.
**Rollback:** ship CLI-only; GUI packaging is independent.

## Acceptance Criteria

- [~] Background service installs/runs on macOS, Windows, and Linux (Linux
      headless; tray best-effort).
      <!-- deferred-resolution: merged-into=road-to-deferred-followups (Phase 2, live service install/run on Linux and Windows; macOS runs live as the launchd engine, the other units are golden-tested only — triage 2026-11-07) -->
- [x] Tray/menubar app on macOS + Windows shows per-profile usage <!-- shipped: gui/src/v3/tray.tsx + tray.test.tsx; release 2.13.2 on macOS and Windows (triage 2026-11-07) --> for all three
      providers and switches accounts via the CLI.
- [x] The tool is fully usable from **either** the CLI **or** the GUI. <!-- shipped: GUI drives the CLI contract (gui/src/ipc.ts runCli); release 2.13.2 (triage 2026-11-07) -->
- [x] CLI core keeps zero runtime dependencies; all GUI/tray deps live in
      `gui/`.
- [x] Read-only + anti-rotation invariants hold: no code path ranks accounts by
      headroom, recommends a switch target, or switches from the daemon —
      verified by test + a code-review note in the PR description.
      <!-- superseded 2026-11-07 (owner, /roadmap:triage-parked): NON-GOALS.md § No request-level routing now places new sessions on the own account with the most headroom and suggests a switch; what this criterion still guards is that nothing switches without the user's confirmation. -->
- [x] `npm test` + `gui` tests green; CI green. <!-- shipped: gui vitest 1161/1161 and CI success on 2ddd0db (triage 2026-11-07) -->

## Rejected scope — corrected 2026-11-07

> Corrected by the owner in `/roadmap:triage-parked` (2026-11-07). The earlier
> wording called cross-account headroom ranking and "switch to X" prompts
> "permanently out of scope"; that contradicted `NON-GOALS.md` (§ No pooling,
> § No request-level routing) and `src/balance.ts`, which the owner had since
> decided. The text below is aligned with `NON-GOALS.md`.

Still rejected: **switching an account without the user's confirmation** —
quota-based automated rotation of a running session, switch-on-limit and
failover with no user step, for all three providers, and any pooling of
accounts that are not the user's own.

Allowed, because `NON-GOALS.md` now says so: placing a **new** session on the
user's own account with the most fresh headroom (folder rule, a pool the user
created, or the default balance), saying why, and **suggesting** a switch for a
running session that happens only when the user confirms it.

- History: settled twice as a full ban — v1 adoption analysis (`ADOPTED.md`) and
  a council re-evaluation on 2026-07-13 — then narrowed by the owner's later
  decisions recorded in `NON-GOALS.md`. Idea capture:
  `archive/road-to-agent-switch-autoswitch-rejected.md`.
- `revisit-if:` a vendor publishes a policy or API that permits switching
  without confirmation, or forbids own-account placement.

## Blockers

### blocker: gui-stack
- **Status:** resolved            <!-- decided Tauri, 2026-07-13 -->
- **Owner:** user
- **Blocks:** Phase 3 — GUI/tray app foundation
- **What to do:**
  1. ~~Choose the GUI/tray stack.~~ **Decided: Tauri** (Rust core + React
     frontend) — native tray, ~3-10 MB bundle, cross-platform.
  2. Ensure the Rust toolchain is available in the GUI dev/CI environment
     (not required for the CLI core).
- **Resolved when:** ~~the stack is named~~ — done; Rust toolchain provisioned
  in CI is verified in Phase 5 Step 2.

### blocker: repo-hosting
- **Status:** resolved            <!-- github.com/event4u-app/agent-switch, pushed 2026-07-13 -->
- **Owner:** user
- **Blocks:** Phase 5 — Packaging, docs, CI
- **What to do:**
  1. ~~Initialize the git repo + remote.~~ **Done:** `event4u-app/agent-switch`
     (public), `main` pushed.
- **Resolved when:** ~~`git remote -v` shows a pushable remote~~ — done.

## Notes

- Council dissent on record: claude-sonnet-4-5 (round 2) recommended cutting
  the daemon and notifications entirely ("no defensible job description") and
  keeping only one-shot `status`. Host deviated because the surfaced info is
  identical to the vendors' native `/usage`, and the owner explicitly asked for
  a background-tray GUI. Conservative fallback if preferred: cut Phase 1
  Step 4 (thresholds) + Phase 2 (daemon) and make the GUI a foreground-only
  app polling on open — the rest stands.
- The GUI never re-implements profile/credential logic; it is a client of the
  CLI (`--json` command contract) + `daemon-state.json`. This keeps one source
  of truth and preserves the CLI core's zero-dep invariant.
