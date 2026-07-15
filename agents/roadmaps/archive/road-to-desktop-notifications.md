---
complexity: standard
status: complete
---

# Roadmap: Desktop + in-window notifications

> Surface the things the user currently has to notice by staring at the bars:
> a usage-limit fetch that failed, a successful auto-switch, a redeemed Codex
> reset. Push them to the OS as desktop notifications when permitted, and always
> keep an in-window record (a bell + flyout of the last 25). The event log is
> owned by the CLI so the background daemon and the GUI write to one place.

## Goal

1. **Shared event log** — one CLI-owned ring buffer (`~/.agent-switch/notifications.json`,
   last 25, deduplicated) that both the daemon and the GUI append to. It is the
   single source of truth and the guaranteed "internal system" fallback.
2. **Desktop notifications** — the GUI pushes new events to the OS via the Tauri
   notification plugin (permission-gated); when permission is denied it falls
   back to the in-window surface.
3. **In-window bell + flyout** — a header bell with an unread badge that opens a
   flyout listing the last 25 events with a relative timestamp.
4. **Event sources** — usage-fetch failures (GUI + daemon), successful
   auto-switches, and redeemed Codex resets (daemon).

## Context — architecture ground truth

| Fact | Detail |
|---|---|
| Two writers | The background daemon (`agent-switch service`, a separate process) performs auto-switches + polls; the GUI polls the active provider itself. Both can produce events. |
| One store | A CLI-owned JSON ring buffer is the single source of truth; both writers append via `src/notifications.ts` (daemon) or `agent-switch notify` (GUI). |
| GUI is the notifier | The GUI is a menu-bar app that is normally always running; it reads the log on each refresh, renders the bell/flyout, and fires desktop notifications for events newer than app-start. |
| Desktop is best-effort | Permission may be denied; the bell/flyout is the guaranteed fallback. |
| Dedup | An identical `kind+title+message` within 30 min is dropped so a persistent failure polled every N minutes never spams (and never re-fires a desktop notification). |

## Dependencies

- [x] `src/daemon.ts` — `pollProvider` auto-switch + reset-redeem + poll-failure sites.
- [x] `src/profiles.ts` — `ROOT` (`~/.agent-switch`) base dir.
- [x] GUI `ipc.ts` — the `agent-switch --json` contract the GUI drives.
- [x] Tauri v2 plugin ecosystem (shell, autostart already wired).

## Phase 1: Core notification pipeline (done)

- [x] `src/notifications.ts` — ring buffer (`readNotifications`, `appendNotification`
  with dedup window, `clearNotifications`), capped at 25.
- [x] `src/daemon.ts` — append events on successful auto-switch, redeemed Codex
  reset, and usage-fetch failure (wording aligned with the GUI so cross-writer
  duplicates dedup).
- [x] `src/index.ts` — `agent-switch notifications [clear] [--json]` and
  `agent-switch notify --kind K --title T --message M [--json]`.
- [x] `tests/notifications.test.ts` — append/dedup/window-expiry/cap/clear.
- [x] GUI `notifications.ts` — desktop wrapper (`sendDesktopNotification`) with
  permission request + safe fallback; shared `AppNotification` type.
- [x] GUI `ipc.ts` — `listNotifications` / `recordNotification` / `clearNotifications`.
- [x] GUI `NotificationBell.tsx` — bell + unread badge + flyout (last 25, kind
  icon, relative timestamp, clear).
- [x] GUI `App.tsx` — poll the log on refresh, desktop-notify new events (from
  app-start, no history blast), record own fetch failures, render the bell.
- [x] `settings-store.ts` — persisted read-watermark for the unread badge.
- [x] Tauri: `tauri-plugin-notification` (Cargo + `main.rs`), `@tauri-apps/plugin-notification`,
  `notification:default` capability.
- [x] Tests: bell renders + flyout lists + unread badge + records-on-failure +
  clear (GUI vitest); CLI + GUI suites green.

## Phase 2: In-window active toast fallback

> Today the in-window surface is the bell + unread badge. When desktop
> permission is denied, a transient toast makes a new event visible without the
> user opening the flyout.

- [x] A lightweight toast component (auto-dismiss, stacked) rendered on a new
  event when `sendDesktopNotification` returned false (`Toaster.tsx`, shared
  `notif-kind.tsx` icon map).
- [x] Respect the same dedup so a toast never repeats a persistent failure
  (inherited from the CLI log dedup — toasts derive from already-deduped events).
- [x] Tests: toast appears on a denied-desktop new event, not on a granted one.

## Phase 3: Daemon-side immediate OS notifications (headless timeliness)

> When the GUI is closed, an auto-switch notification only reaches the desktop
> on the next GUI poll. For headless timeliness the daemon could fire the OS
> notification itself.

- [x] Cross-platform OS-notify from Node in the daemon (`osascript` on macOS,
  `notify-send` on Linux, PowerShell balloon on Windows), best-effort
  (`os-notify.ts`, pure `buildOsNotifyCommand` + `osNotify`).
- [x] Guard against double-notify with the GUI (the log dedup + an `osNotified`
  marker set by the daemon; the GUI skips events already OS-notified).
- [x] Gate behind a setting (`osNotifications` in state, default off;
  `agent-switch os-notify [on|off|status]`; daemon reads it before firing).

## Phase 4: Preferences + more event kinds

- [x] Per-kind enable/disable — mute toggles (localStorage `mutedKinds`) that
  suppress a kind from desktop, toast, flyout, and the unread badge.
- [x] Surface threshold crossings the daemon already logs
  (`threshold: … crossed N%`) as `info` notifications.
- [x] A settings toggle for desktop notifications (mirror the OS permission
  state + a re-request path) — plus a background (daemon) toggle and the mute
  controls, in a dedicated **Alerts** settings tab.
