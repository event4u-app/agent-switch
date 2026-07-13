---
complexity: structural
parent_roadmap: road-to-agent-switch-core
execution:
  mode: autonomous
---

# Roadmap: agent-switch usage engine + background service + tray GUI

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

- [ ] [`road-to-agent-switch-cross-platform.md`](road-to-agent-switch-cross-platform.md)
      complete (per-OS abstraction + CI).
- [ ] [`road-to-agent-switch-multi-provider.md`](road-to-agent-switch-multi-provider.md)
      complete (the GUI shows all three providers).
- [ ] GUI stack decided (see `## Blockers § gui-stack`).

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

- [ ] **Step 1:** `src/usage.ts` — harden the OAuth read client: real
      `User-Agent` header (429 avoidance — extension-verified), timeout,
      defensive parsing of `five_hour`/`seven_day`(+`seven_day_opus`/
      `seven_day_sonnet`)/`utilization`/`resets_at`, plus per-model and Claude
      Code `routines` (used/limit) when present.
- [ ] **Step 2:** Verify Codex + Gemini usage readouts (docs/endpoints/CLI);
      record findings in `ADOPTED.md`. Implement where a source exists; where
      none exists, the provider reports "usage unavailable" (no fabrication).
- [ ] **Step 3:** Own-profile 30-day usage history store (≤720 samples) per
      profile, mode 0600 — sparkline data.
- [ ] **Step 4:** Threshold detection for the **active profile only**
      (configurable, default 75%/90% on each window), edge-triggered (fire once
      per crossing, reset on `resets_at`). No cross-account comparison.
- [ ] **Step 5:** `agent-switch status` keeps the one-shot all-profile table; add
      `agent-switch status --json` for the **active profile only** (statusline/GUI).
      No machine-readable cross-account output (anti-rotation boundary).
- [ ] **Step 6:** Unit tests: parser shapes, edge-trigger semantics, history
      windowing. <!-- verify: npm test -->

**Exit criteria:** `npm test` green; a live profile shows correct windows +
history; unsupported providers degrade cleanly (integration-gated).
**Rollback:** additive module — remove wiring; `status` falls back to v1.

## Phase 2: Background service

- [ ] **Step 1:** `src/daemon.ts` — single-instance daemon (pidfile under the
      profile root), poll loop from Phase 1, writes `daemon-state.json`
      (last poll, per-profile snapshot, last error), mode 0600, SIGTERM-clean.
- [ ] **Step 2:** Poll discipline: minimum interval ≥ 60s, jitter, exponential
      backoff on 401/403/429/5xx, and **poll only profiles with a live session**
      (`sessions/*.json` PIDs) plus the active profile — never a busy-poll of
      idle accounts.
- [ ] **Step 3:** CLI: `agent-switch service start|stop|status|run` (`run` =
      foreground for debugging / service managers).
- [ ] **Step 4:** `agent-switch service install|uninstall` per OS — launchd user
      LaunchAgent (macOS), systemd user unit (Linux `systemctl --user`),
      Windows Task Scheduler logon trigger (`schtasks`); manifest records every
      generated file so uninstall removes exactly what was installed.
- [ ] **Step 5:** Log file with size cap + single-generation rotation;
      `service status` tails it.
- [ ] **Step 6:** Failure modes: stale-pidfile takeover, credential-unreadable
      (log once, back off, never prompt from the daemon), sleep/wake drift,
      endpoint-shape change (→ "usage unavailable", keep running).
- [ ] **Step 7:** `status`/GUI read `daemon-state.json` when fresh (< poll
      interval) instead of hitting the API — daemon is a cache; CLI works
      without it. Unit tests for the state-file protocol + service-file golden
      generation per OS. <!-- verify: npm test -->

**Exit criteria:** install→start→status→stop→uninstall on the dev OS leaves no
orphaned files (manifest-verified); grep-gate: no switch-mutation code path is
reachable from `daemon.ts`.
**Rollback:** `agent-switch service uninstall` per manifest; delete
`daemon-state.json`; CLI-only operation unaffected.

## Phase 3: GUI/tray app foundation (separate package)

- [ ] **Step 1:** `gui/` sub-package (own `package.json`, own deps — CLI core
      stays dep-free). Stack: **Tauri** (Rust `src-tauri/` for tray/window/
      autostart + React `src/`; decided 2026-07-13). Adds a Rust toolchain to
      the GUI build only.
- [ ] **Step 2:** IPC boundary: the GUI invokes the `agent-switch` binary
      (`list --json`, `status --json`, `service status`) and reads
      `daemon-state.json` — it never re-implements profile logic. Define a
      typed command surface (`agent-switch <cmd> --json`) as the contract.
      <!-- verify: node dist/index.js list --json -->
- [ ] **Step 3:** Tray/menubar presence: icon in the macOS menubar and Windows
      system tray; left-click opens the panel, the icon/tooltip reflects the
      active profile + nearest-limit headroom (own profile).
- [ ] **Step 4:** Launch-at-login wiring shares the Phase 2 service installer
      (the tray app is the service's user-facing face; one install path).
- [ ] **Step 5:** Linux tray = best-effort (AppIndicator where available),
      documented as degraded; CLI + `status` remain the Linux baseline.

**Exit criteria:** the tray app launches, shows the active profile, and opens a
window on click on macOS + Windows; `gui/` builds in CI.
**Rollback:** `gui/` is isolated — drop it; CLI + daemon unaffected.

## Phase 4: React UI

- [ ] **Step 1:** React app: profile list grouped by provider
      (claude/codex/gemini), per-profile color, active marker, live-session
      badge.
- [ ] **Step 2:** Usage view: session (5h) + weekly bars, per-model breakdown,
      Claude Code routines, 30-day sparkline (extension-inspired) — **per
      profile, no cross-account ranking**.
- [ ] **Step 3:** Actions: switch active profile (calls `agent-switch use`), open a
      new session (`agent-switch run`), open claude.ai in the persistent browser
      (`agent-switch web`) — all through the CLI contract.
- [ ] **Step 4:** Profile management: add (launches CLI login flow), rename,
      remove, import/export profiles as JSON (extension-inspired), color
      picker.
- [ ] **Step 5:** Settings: theme (auto/light/dark), notifications toggle,
      thresholds, poll interval; persisted via the CLI settings surface.
- [ ] **Step 6:** Accessibility + theme parity pass (light/dark), and a
      component/unit test pass for the UI logic. <!-- verify: npm --prefix gui test -->

**Exit criteria:** from the tray panel a user can see per-profile usage and
switch/open a session for any of the three providers; UI tests green.
**Rollback:** revert `gui/` React layer; tray shell from Phase 3 still runs.

## Phase 5: Packaging, docs, CI

- [ ] **Step 1:** Package the tray app per OS (`.app`/`.dmg` macOS, `.msi`/
      `.exe` Windows via the chosen stack's bundler); code-signing is a
      documented follow-up, not required for local install.
      <!-- deferred: signing/notarization needs developer accounts -->
- [ ] **Step 2:** Extend CI: build `gui/` on macOS + Windows runners; the
      CLI matrix stays as in the cross-platform roadmap.
      <!-- blocked-by: repo-hosting -->
- [ ] **Step 3:** README + `gui/README`: install (CLI-only vs CLI+GUI), the
      tray/service story, screenshots, and the FAQ "Why no autoswitch?"
      pointing at `skipped/road-to-agent-switch-autoswitch-rejected.md`.

**Exit criteria:** a packaged tray app installs and runs from a build artifact
on macOS + Windows; CI builds the GUI.
**Rollback:** ship CLI-only; GUI packaging is independent.

## Acceptance Criteria

- [ ] Background service installs/runs on macOS, Windows, and Linux (Linux
      headless; tray best-effort).
- [ ] Tray/menubar app on macOS + Windows shows per-profile usage for all three
      providers and switches accounts via the CLI.
- [ ] The tool is fully usable from **either** the CLI **or** the GUI.
- [ ] CLI core keeps zero runtime dependencies; all GUI/tray deps live in
      `gui/`.
- [ ] Read-only + anti-rotation invariants hold: no code path ranks accounts by
      headroom, recommends a switch target, or switches from the daemon —
      verified by test + a code-review note in the PR description.
- [ ] `npm test` + `gui` tests green; CI green.

## Rejected scope — locked (do not relitigate casually)

Quota-based **automated account rotation** and its decision support
(cross-account headroom ranking, "switch to X" prompts, switch-on-limit,
failover strategies, hysteresis/cooldown) are **permanently out of scope** for
all three providers. Pooling subscriptions to route around rate limits violates
the vendors' usage policies; the decision engine minus the final `switch()` is
the same violation.

- Settled-by-decision, twice: v1 adoption analysis (`ADOPTED.md`) and council
  re-evaluation (claude-sonnet-4-5 + gpt-4o, 2 rounds, 2026-07-13 — unanimous).
  Full idea capture: `skipped/road-to-agent-switch-autoswitch-rejected.md`.
- `scope:` automated/semi-automated cross-account failover on usage/quota
  signals, incl. ranking and prompt-to-switch UX. **Not** covered: own-usage
  display, active-profile threshold notifications (vendor-native info),
  directory-based auto-selection (`map` — context-driven, not quota-driven).
- `revisit-if:` a vendor publishes an official multi-account/usage-pooling
  policy or API that permits it, or ships native profile switching that moots
  the question.

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
