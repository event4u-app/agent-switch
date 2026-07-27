# ADR-005 — Pet overlay window lives inside the GUI shell (macOSPrivateApi accepted)

Status: accepted (2026-07-27)

## Context

The desktop-pet feature (road-to-desktop-pet roadmap) needs a frameless,
transparent, always-on-top overlay window that survives independently of the
main window. Three placement options were reviewed by an external council
(anthropic/claude-sonnet-4-5 + openai/gpt-4o, 2 rounds, 2026-07-27): a second
WebviewWindow inside the existing Tauri GUI, a separate lightweight process,
or an Electron-style companion app. Transparency on macOS requires the
`macos-private-api` Cargo feature plus `app.macOSPrivateApi: true` — a flag
that disqualifies an App Store distribution.

## Decision

1. **The pet is a second `WebviewWindow` inside the existing GUI shell**
   (`gui/src-tauri/src/pet.rs`, window label `pet`), following the
   AC-settings satellite-window precedent. No separate process, no second
   app artifact.
2. **`macOSPrivateApi: true` is accepted.** The app ships unsigned via
   GitHub Releases (README § install); it has never targeted the App Store,
   so the flag costs nothing on the current distribution path. Revisit-if:
   signed/notarized App Store distribution ever becomes a goal.
3. **Event transport for v1 is the existing in-webview notification fan-out**
   (`syncNotifications()` in `gui/src/App.tsx` gains the pet as a third
   sink via a Tauri event). The main webview is never destroyed (hide-on-close),
   so the pet stays fed while the GUI app runs. A Rust-side file watcher on
   `~/.agent-switch/notifications.json` is the v2 upgrade path if a
   pet-without-main-window mode becomes real. A WebSocket push channel from
   the daemon was **rejected** for v1: it adds port/lifecycle failure modes
   (collision, start ordering, half-open connections) with no user-visible
   gain at human perception granularity (~100 ms).
4. **The pet window gets its own minimal capability file**
   (`gui/src-tauri/capabilities/pet.json`) — window drag/position only,
   no shell execute, no notification permissions. The main window's
   capability set is not widened.

## Consequences

- The GUI build carries the pet assets (`gui/public/pets/`, ~224 KB) and the
  `macos-private-api` feature permanently once merged.
- Any future App Store ambition must first remove or feature-gate the
  transparency flag (pet degrades to a rectangular window without it).
- The pet inherits the notification pipeline's guarantees (30-min dedup,
  per-kind muting, storm cap) for free, and its failure mode is graceful:
  no events → idle pet, never a broken window.
- The no-automatic-switch invariant (road-to-live-rebind) is preserved by
  construction: the pet can only navigate to the existing confirmation UI,
  it holds no switch/rebind capability.

## Alternatives considered

- **Separate process/app** — full lifecycle + distribution cost (second
  artifact, own updater), no upside while the GUI shell already runs as a
  tray app. Rejected.
- **WebSocket daemon push** — see Decision 3. Rejected for v1.
- **In-main-window pet (DOM overlay)** — cannot float over other apps,
  defeats the ambient-notification purpose. Rejected.

## References

- `agents/roadmaps/road-to-desktop-pet.md` (plan + council convergence inline)
- `docs/adr/ADR-003-narrow-credential-store-read-only-invariant-for-rebind.md`
  (the invariant the pet must not weaken)
