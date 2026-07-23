---
title: Tray GUI
description: Launch the tray/menubar desktop app — a Tauri client of the agent-switch CLI with an embedded terminal, usage bars, and in-app updates.
---

The tray/menubar GUI wraps the whole CLI in a desktop app. It's a client of the CLI's `--json` contract — it never re-implements profile or credential logic — with an embedded terminal so login, run, and takeover happen in-app.

![Mock of the agent-switch tray GUI showing per-provider tabs (Claude active), and three anonymized profile cards with usage bars and active/live badges](/agent-switch/screenshots/gui-main.svg)

## Launching

```bash
agent-switch gui
```

On first use, `gui` downloads the prebuilt artifact from the matching GitHub Release, caches it under `~/.agent-switch/gui/<version>/`, then launches it. Launch-at-login is enabled by default on the first run.

| Platform | Artifact |
| --- | --- |
| macOS | `.app.tar.gz` |
| Linux | `.AppImage` |
| Windows | `-setup.exe` |

:::note[Unsigned builds]
Desktop installers are not yet code-signed or notarized. First launch needs the Gatekeeper (macOS) / SmartScreen (Windows) workaround — see [platform support](/agent-switch/reference/platform-support/) for the exact steps.
:::

## What it is

The GUI is a **Tauri app**: a Rust tray/window shell with a React frontend. It is strictly a **client** of the CLI's `--json` contract and never re-implements profile or credential logic. It embeds an xterm.js terminal driven by a Rust pty, so in-app login, run, and takeover happen inside the window — no external terminal opens.

## Features

- **Per-provider tabs** — Claude / Codex / Antigravity (only enabled providers are shown), each with usage bars.
- **Profile management** — create, use, deactivate, rename, label, delete.
- **Embedded terminal** — in-app login/run/takeover via the Rust pty.
- **Sessions panel** — preview, takeover, compact, delete, restore, handoff.
- **Notifications** — notification bell, toasts, and OS notifications.
- **Codex "redeem reset"** — bank/redeem a rate-limit reset from the UI.
- **Settings sub-tabs** — General, Alerts, Providers, Design (theme), Updates, Uninstall.

The sessions panel lists each profile's sessions with a context-usage bar and inline actions (takeover, preview, compact, handoff):

![Mock of the agent-switch sessions panel showing three sessions with context bars and a live session marked with a green dot](/agent-switch/screenshots/gui-sessions.svg)

## In-app updates

A 24-hour auto-check loop plus an **"Update now"** button (Settings › Updates) keep the app current. When a newer release matches an enabled bump-kind (major / minor / patch), the app self-updates in place — it runs `agent-switch update` (`npm i -g @latest`) and toasts "restart to apply". Otherwise it only notifies. Checks are deduped per version.

## agent-config companion banner

The GUI detects the companion `@event4u/agent-config` CLI (repo `event4u-app/agent-config`) and shows an install/update banner with one-click install/upgrade. The banner also includes a share toggle that links your global `~/.claude` skills, commands, and agents into every profile.

## Related desktop-app commands

The CLI can also launch and isolate other apps per profile:

| Command | What it does |
| --- | --- |
| `agent-switch apps` | List launchable desktop apps |
| `agent-switch open <app> [profile]` | Launch a desktop app isolated on a profile (macOS-only) |
| `agent-switch web <name>` | Open claude.ai in a persistent per-profile Playwright Chromium |

:::note
`agent-switch web` needs the optional `playwright` dependency installed.
:::

## See also

- [CLI reference](/agent-switch/reference/cli/)
- [Providers & auto-switch](/agent-switch/guides/providers-and-autoswitch/)
- [Platform support](/agent-switch/reference/platform-support/)
