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

- [ ] ADR-005: transparent always-on-top pet window — record the
      `macos-private-api` Cargo feature + `app.macOSPrivateApi: true`
      requirement, the user-trust implications (unsigned app + private API),
      and why in-app WebviewWindow beats a separate process. Include the
      council transport verdict (file/event seam now, Rust watcher later,
      WebSocket rejected for v1).
- [ ] Spike (throwaway branch): minimal transparent, decorations-off,
      always-on-top, skip-taskbar WebviewWindow with
      `set_ignore_cursor_events(true)` on macOS **and** Windows; verify
      click-through + a clickable region (bubble) can coexist
      (toggle ignore-cursor-events on hover region). Document Linux caveats
      (compositor-dependent; ship pet as best-effort there).
- [ ] Verify the version-bump chain stays intact (4-file version sync via
      `scripts/release.mjs`) when `tauri.conf.json` + `Cargo.toml` gain the
      new feature flags.

## Phase 1 — pet window foundation (hidden feature, default off)

- [ ] Rust: new `gui/src-tauri/src/pet.rs` modeled on the `ac.rs` satellite
      precedent — `PET_WINDOW_LABEL`, `pet_show` / `pet_hide` commands,
      window built with `.transparent(true).decorations(false)
      .always_on_top(true).shadow(false).skip_taskbar(true)`, position
      persisted per monitor (use `outer_position()` math, not `center()` —
      known multi-monitor bug precedent in `ac.rs`).
- [ ] Confirm the `on_window_event` guard (`main.rs`, non-`main` labels
      early-return) leaves the pet alive on main-window `CloseRequested`;
      pet must survive hide-on-close, die on `RunEvent::Exit`.
- [ ] Capabilities: new capability file for the `pet` window —
      `core:window:allow-set-always-on-top`, `allow-set-ignore-cursor-events`,
      `allow-set-position`, `allow-set-size`, `allow-start-dragging`;
      minimal grant, mirror the AC-satellite restraint.
- [ ] Frontend: second Vite entry `gui/pet.html` + `gui/src/pet-main.tsx`
      (add `build.rollupOptions.input` — currently defaults to `index.html`
      only). Pet state stays out of `App.tsx`.
- [ ] Settings: "Desktop pet" master toggle in Settings (default off),
      persisted in `gui/src/settings-store.ts`; toggle calls
      `pet_show`/`pet_hide`; re-show on app start when enabled. The toggle
      is the anchor for the full pet-settings section in Phase 3.
- [ ] Windows: re-assert `set_always_on_top` on a slow interval (openpets
      does 1 s; pick the cheapest interval that works).

## Phase 2 — rendering: sprites + reactions

> Assets exist already: the **event4u pet pack** (8 pets, generated 2026-07-27
> against the openpets contract — 1536×1872 lossless WebP, 8×9 grid à
> 192×208, `pet.json` per pet, previews + thumbnails, row map documented in
> the pack README). Imported 2026-07-27: assets tracked under
> `gui/public/pets/<id>/`, generator + validator under `scripts/pets/`.

- [ ] Adopt the openpets pet-package shape (MIT): `pet.json` manifest +
      `spritesheet.webp`; render via CSS `background-position` +
      `animation: steps(var(--frames))` with per-reaction CSS vars, row map
      per the pack README (idle / running-right / running-left / waving /
      jumping / failed / waiting / running / review).
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
- [ ] Reaction set v1 mapped onto the pack rows: success→jumping,
      error→failed, warning→waiting, info→waving, busy→running/review,
      plus idle loop.
- [ ] Idle behavior: subtle idle loop only (no wander/physics in v1 — keep
      the ticker off unless a transient reaction is playing; pause all
      animation when the pet is hidden).
- [ ] Reduce-motion: respect `prefers-reduced-motion` → static sprite +
      badge instead of animation (council accessibility finding).

## Phase 3 — notification wiring (the actual feature)

- [ ] Extend `syncNotifications()` in `gui/src/App.tsx` with a **third
      sink**: after the desktop/toast decision, `emit_to("pet", …)` the
      `AppNotification` (kind, title, message, id). Inherits dedup,
      per-kind muting, `osNotified` suppression, and the storm cap —
      do NOT duplicate the fan-out logic.
- [ ] Kind→reaction mapping via the existing `KIND_META`
      (`gui/src/notif-kind.tsx`): success→celebrating, error→error,
      warning→waiting/alert, info→wave. Speech bubble shows the
      notification title (sanitized, length-capped, ~6 s TTL, 10 s
      reaction cooldown — openpets numbers as starting point).
- [ ] Actionable bubble (the invariant-critical piece): bubble for
      "usage limit near / switch suggested" is clickable → `show_main()` +
      open `SwitchAccountDialog` with the suggested profile pre-selected
      (reuse the `notifOpenNonce`-style handshake). Click is navigation;
      the dialog is the confirmation. No other bubble is actionable in v1.
- [ ] Routing tiers (setting, per council convergence): `pet-only` (pet
      replaces OS notifications while enabled), `hybrid` (pet + OS, default),
      `os-only` (pet ignores notifications = decoration mode). Wire into
      the existing NotificationSettings panel next to per-kind mutes.
- [ ] Dedicated "Desktop pet" settings section (all keys in
      `gui/src/settings-store.ts`, applied live via `emit_to("pet", …)` —
      no restart required):
      - master enable/disable (Phase 1 toggle moves here),
      - pet picker: choose among the 8 bundled pets (thumbnails from the
        pack; live-swaps the spritesheet),
      - routing tier (above),
      - per-kind pet reactions on/off (success / error / warning / info —
        same kind set as the OS-notification mutes, but independent keys,
        so "pet reacts to errors only" is expressible),
      - speech bubbles on/off + bubble duration (short/normal/long),
      - pet size (small/medium/large → CSS scale),
      - animations full / reduced / off (off = static sprite + badge;
        default follows `prefers-reduced-motion`),
      - "Reset pet position" button (clears the persisted per-monitor
        position, pet returns to bottom-right default).
- [ ] Every pet setting has a sane default so enabling the master toggle
      alone yields the intended v1 experience; the section renders only
      when the master toggle is on (progressive disclosure).
- [ ] Dev-mode test trigger: extend `triggerNearLimitNotifyTest` so the
      existing dev button also drives the pet path end-to-end (council
      "testing multiplier" finding, adapted to the existing dev-mode gate).

## Phase 4 — ambient status mood

- [ ] Map `worstLiveContextPct` (`gui/src/transforms.ts`) to a persistent
      pet mood/badge (calm → concerned → alarmed) so the pet mirrors the
      tray tooltip as a glanceable usage meter.
- [ ] Busy states: while the active provider session is mid-work (context
      snapshots updating), show a subtle "working" badge; clear on idle.
- [ ] Screen placement: default bottom-right, draggable
      (`allow-start-dragging`), avoid colliding with the app's own Toaster
      corner; position persisted.

## Phase 5 — hardening, docs, release

- [ ] Multi-monitor: position restore per display; fall back to primary
      work area when the saved display is gone.
- [ ] Perf pass: zero timers while idle-hidden; animation paused when the
      window is occluded/hidden; measure webview memory and record it in
      the ADR (council perf finding).
- [ ] Cross-platform QA: macOS (private-api transparency), Windows
      (always-on-top re-assert, click-through), Linux best-effort note in
      docs.
- [ ] Starlight docs page: what the pet is, the three routing tiers, the
      click-to-switch flow, how to disable, Linux caveats.
- [ ] CI: pet code covered by existing gates (`vitest`, `tsc --noEmit`,
      `vite build`, `cargo check`); add unit tests for kind→reaction
      mapping + bubble-sanitizer (pure functions).

## Later / v2 candidates (explicitly deferred, not planned)

- [~] Rust-side watcher on `~/.agent-switch/notifications.json` so the pet
      works without the main webview (only needed if a pet-without-GUI-window
      mode becomes real).
- [~] `pet.say` / `pet.react` surface for external agents (MCP or local
      IPC, openpets-style lease + sanitizer) — needs the v1 pet to earn it.
- [~] Multi-pet / per-agent-session pets; pet marketplace / installable
      pet packages; generated custom sprites (the parametric generator from
      the pet-pack chat would be the seed — palette + props per variant).
