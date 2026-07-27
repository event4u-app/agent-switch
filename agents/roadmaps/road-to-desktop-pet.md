---
complexity: standard
status: planned
---

# Roadmap: desktop pet as a global notification surface

> An optional animated desktop companion (openpets/Codex-pets pattern): a
> frameless, transparent, always-on-top pet window rendered by the existing
> Tauri GUI. Primary job: **ambient notification surface** — usage-limit-near,
> context-threshold, switch-suggested, and daemon-error events become pet
> reactions + speech bubbles the user sees without switching windows.
> Secondary job: the fun/companion layer (idle animation, busy moods).
> Default **off**; a settings toggle enables it.

## Why / enabling insight

The daemon already produces every event the pet needs
(`~/.agent-switch/notifications.json`, kinds `success|error|warning|info`,
30-min dedup) and the GUI already has the single fan-out seam that decides
desktop-notification vs toast (`gui/src/App.tsx` `syncNotifications()`).
A pet is therefore **a third notification sink, not a new event system** —
it inherits dedup, per-kind muting, the 5-event storm cap, and the mount-time
watermark for free. Rendering is cheap and proven: the openpets format (MIT)
is just `spritesheet.webp` + `pet.json`, animated with a CSS `steps()`
animation — no canvas, no game engine.

Council (anthropic/claude-sonnet-4-5 + openai/gpt-4o, 2 rounds, 2026-07-27)
reviewed the design brief. Convergence: pet as a second Tauri
`WebviewWindow` inside the existing GUI (not a separate process); strict v1
scope cut (no marketplace / multi-pet / MCP); three-tier notification
routing (pet-only / hybrid / OS-only); macOSPrivateApi is a user-trust risk
that needs an explicit decision record. Divergence: daemon→pet transport —
WebSocket push vs file-based; host resolution: v1 reuses the existing
in-webview fan-out (smallest diff, main webview never unmounts — hide-on-close
keeps it alive), a Rust-side file watcher is the v2 upgrade path, WebSocket
rejected for v1 (new port/lifecycle failure modes without user-visible gain
at ~100 ms perception granularity).

## Out of scope — hard boundary

- **No automatic switch, ever.** A pet speech bubble that suggests a profile
  switch is **navigation only**: click → show main window → open the existing
  `SwitchAccountDialog` (pre-selected suggestion, user confirms). The pet
  never calls switch/rebind itself. Same invariant as
  `road-to-live-rebind.md` ("no switch without a user interaction").
- **No marketplace, no multi-pet, no custom sprite generation, no MCP/IPC
  server for external agents** in this roadmap — v2+ candidates only,
  gated on real usage of v1.
- **No analytics/telemetry upload** for pet engagement (council suggestion
  rejected: conflicts with the project's privacy stance / NON-GOALS.md).
  Local settings only.
- **No separate pet process / second app.** The pet lives inside the
  existing Tauri app or not at all.
- **No daemon protocol change in v1.** The daemon keeps writing
  `notifications.json`; the pet consumes what exists.

## Phase 0 — decisions + platform spike

- [x] ADR-005 (`docs/adr/ADR-005-pet-overlay-window-inside-the-gui-shell.md`):
      pet as in-app WebviewWindow, `macOSPrivateApi` accepted for the
      unsigned GitHub-Releases distribution, v1 transport = third sink of
      `syncNotifications()`, WebSocket rejected, minimal pet capability.
- [x] Spike built (2026-07-27, kept in-branch instead of throwaway — user
      evaluated and approved): transparent, decorations-off, always-on-top,
      skip-taskbar WebviewWindow rendering all 8 pets; click cycles
      reactions, right-click cycles pets, drag strip moves it. Click-through
      (`set_ignore_cursor_events`) deferred to Phase 5 polish — the spike
      showed the window is small enough that full click-through is not
      needed for v1 (sprite clicks are a feature, not a bug).
- [x] Version-bump chain verified: `scripts/release.mjs` patches the
      `"version"` lines by regex; the added `macOSPrivateApi` key and
      Cargo feature don't touch them.

## Phase 1 — pet window foundation (hidden feature, default off)

- [x] Rust: `gui/src-tauri/src/pet.rs` (AC-satellite pattern) —
      `PET_WINDOW_LABEL`, `pet_show` / `pet_hide` / `pet_reset_position`
      commands, transparent/frameless/always-on-top/skip-taskbar window,
      default bottom-right of the primary work area (monitor-origin math,
      not `center()`). Drag position persisted webview-side (shared
      localStorage) and restored with monitor validation.
- [x] `on_window_event` guard confirmed: non-`main` labels early-return, so
      the pet survives main-window hide-on-close and dies on `RunEvent::Exit`.
- [x] Capabilities: `gui/src-tauri/capabilities/pet.json` — drag,
      set-position/size, outer-position, available-monitors, scale-factor;
      no shell, no notification permissions. (`set-ignore-cursor-events`
      not granted — click-through deferred, sprite clicks are a feature.)
- [x] Frontend: second Vite entry `gui/pet.html` + `gui/src/pet-main.ts`
      via `build.rollupOptions.input`; pet state fully out of `App.tsx`
      (pure model in `gui/src/pet/model.ts`).
- [x] Settings: "Desktop pet" master toggle (default off) in the new
      own "Pet" sidebar section (above Settings); persisted in
      `settings-store.ts`; main webview
      shows the pet on mount when enabled (Rust never auto-opens).
- [x] Windows: `set_always_on_top` re-asserted every 5 s from a Rust thread
      that ends itself when the window is gone.

## Phase 2 — rendering: sprites + reactions

> Assets exist already: the **event4u pet pack** (8 pets, generated 2026-07-27
> against the openpets contract — 1536×1872 lossless WebP, 8×9 grid à
> 192×208, `pet.json` per pet, previews + thumbnails, row map documented in
> the pack README). Imported 2026-07-27: assets tracked under
> `gui/public/pets/<id>/`, generator + validator under `scripts/pets/`.

- [x] Adopt the openpets pet-package shape (MIT): `pet.json` manifest +
      `spritesheet.webp`; render via CSS `background-position` +
      `animation: steps(frames)` with per-reaction CSS vars, row map per
      the pack README — `gui/src/pet/model.ts` (row table) +
      `gui/src/pet-main.ts` (painter).
- [x] Import the event4u pet pack into the repo as tracked assets —
      `gui/public/pets/<id>/{pet.json,spritesheet.webp,thumbnail.png,states.png}`
      (Vite `public/` dir, bundled into the GUI build automatically) + pack
      README; all 8 pets, ids + 1536×1872 dimensions verified. Default =
      `agent-switch-007`.
- [x] Asset provenance secured: generator + validator (`petgen.py`,
      `package_pets.py`, `validate.py`) recovered from the pack ZIP into
      `scripts/pets/`.
- [ ] Visually QA each pet's states once (the 5 newer pets were only
      geometrically validated, per the generation chat) — `states.png`
      per pet ships alongside the sprites for exactly this.
- [ ] Wire `scripts/pets/validate.py` as an optional CI gate for sprite
      geometry (needs Pillow — not available on the dev machine today;
      run it in CI or a venv).
- [x] Reaction set v1 mapped onto the pack rows: success→jumping,
      error→failed, warning→waiting, info→waving, plus idle loop
      (`KIND_TO_REACTION` in `gui/src/pet/model.ts`, unit-tested).
- [x] Idle behavior: idle loop only, no wander/physics, no JS ticker (pure
      CSS keyframes); animation play-state paused while the window is
      hidden (`visibilitychange`).
- [x] Reduce-motion: Animations setting `auto` (default — follows
      `prefers-reduced-motion`) / `on` / `off`; static first frame when off.

## Phase 3 — notification wiring (the actual feature)

- [x] `syncNotifications()` third sink via `decidePetRouting()` +
      `petEmitNotification()` — runs inside the existing fresh-events loop,
      so dedup, `osNotified` suppression, and the storm cap are inherited;
      the pet's per-kind gate is its own (see below), desktop mutes stay
      untouched.
- [x] Kind→reaction mapping (`KIND_TO_REACTION`): success→jumping,
      error→failed, warning→waiting, info→waving. Speech bubble shows the
      sanitized, 140-char-capped title; TTL short/normal/long
      (4 s / 6.5 s / 10 s), 10 s reaction cooldown.
- [x] Actionable bubble: only the switch-suggestion event
      (`isSwitchSuggestion`) is clickable → `show_window` +
      `pet-open-switch` event → main opens `SwitchAccountDialog` with the
      active profile (flyout fallback when no candidate set). Click is
      navigation; the dialog is the confirmation.
- [x] Routing tiers: `hybrid` (default) / `pet-only` (pet replaces desktop
      + toast for kinds it handles) / `os-only` (decoration); in the
      Pet sidebar section.
- [x] Dedicated "Desktop pet" settings surface (own sidebar entry; keys in
      `settings-store.ts`, applied live via the cross-window `storage`
      event — no restart required):
      - master enable/disable (Phase 1 toggle moves here),
      - pet picker: choose among the 8 bundled pets (thumbnails from the
        pack; live-swaps the spritesheet),
      - routing tier (above),
      - per-kind pet reactions on/off (success / error / warning / info —
        same kind set as the OS-notification mutes, but independent keys,
        so "pet reacts to errors only" is expressible),
      - speech bubbles on/off + bubble duration (short/normal/long),
      - pet size (small/medium/large; medium = half the native frame size —
        full size proved too dominant; the window resizes with the sprite
        and re-anchors on the corner nearest the display edge, so growing
        never pushes the pet off-screen),
      - animations full / reduced / off (off = static sprite + badge;
        default follows `prefers-reduced-motion`),
      - "Reset pet position" button (clears the persisted per-monitor
        position, pet returns to bottom-right default).
- [x] Every pet setting has a sane default so enabling the master toggle
      alone yields the intended v1 experience; the section renders only
      when the master toggle is on (progressive disclosure).
- [x] Dev-mode test trigger: the existing dev generator
      (`generateTestNotifications`) records real events through the CLI log
      and `syncNotifications()`, so it drives the pet path end-to-end with
      no extra wiring (all four kinds exercised).
- [x] Dev-mode pose picker (Pet section, gated by dev mode): one button per
      spritesheet row; the pet holds the pose in a loop until the next pick
      ("idle" restores normal behavior) — the visual-QA tool for the pack.
- [x] Bubble polish: quadrant-aligned (right/left-bound to the pet's screen
      half; above the sprite in the bottom half, below in the top half) with
      a per-kind color accent on the alignment edge; dev-mode bubble-test
      buttons (one per kind + the clickable switch suggestion, cooldown
      bypassed). Events pet↔main use exact WebviewWindow targets.
- [x] Drag rework: manual drag (mousemove deltas, openpets approach) instead
      of the native OS drag — click waves, hold/move drags, and ESC while
      the button is still down cancels the move (snap back); after release
      ESC is a no-op. Dev-only state label toggle (default off).

## Phase 4 — ambient status mood

- [x] `worstLiveContextPct` → pet mood dot (`contextMood`: quiet <60 %,
      amber watch 60–79 %, pulsing red alarm ≥80 %) — same number as the
      tray tooltip, emitted from the same refresh block.
- [ ] Busy states: while the active provider session is mid-work (context
      snapshots updating), show a subtle "working" badge (running/review
      rows are ready in the row map); clear on idle.
- [x] Screen placement: default bottom-right above the Toaster corner,
      draggable via the top strip, position persisted + monitor-validated
      on restore.

## Phase 5 — hardening, docs, release

- [x] Multi-monitor: saved position validated against `availableMonitors()`
      on restore; falls back to the Rust-side default corner when the saved
      display is gone.
- [ ] Perf pass: zero JS timers while idle and keyframes paused when hidden
      are done; still open: measure webview memory of the pet window and
      record it in ADR-005 (council perf finding).
- [ ] Cross-platform QA: Windows (always-on-top re-assert, transparency)
      and Linux (compositor caveats) need a real machine; macOS covered by
      dev use.
- [x] Starlight docs page (`guides/desktop-pet`): what the pet is, routing
      tiers, click-to-switch flow, settings, platform notes, pet-author
      format pointer.
- [x] CI: pet code covered by the existing gates (`vitest`, `tsc --noEmit`,
      `vite build`, `cargo check`); `gui/src/pet/model.test.ts` unit-tests
      the row map, kind mapping, routing decision, sanitizer, and mood
      thresholds (309 GUI tests green).

## Later / v2 candidates (explicitly deferred, not planned)

- [~] Rust-side watcher on `~/.agent-switch/notifications.json` so the pet
      works without the main webview (only needed if a pet-without-GUI-window
      mode becomes real).
- [~] `pet.say` / `pet.react` surface for external agents (MCP or local
      IPC, openpets-style lease + sanitizer) — needs the v1 pet to earn it.
- [~] Multi-pet / per-agent-session pets; pet marketplace / installable
      pet packages; generated custom sprites (the parametric generator from
      the pet-pack chat would be the seed — palette + props per variant).
