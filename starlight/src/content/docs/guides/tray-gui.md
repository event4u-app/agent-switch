---
title: Desktop app
description: The agent-switch desktop app — what needs you, which session runs on which account, what is left — a Tauri client of the CLI with a menu-bar popover.
---

The desktop app wraps the whole CLI in one window plus a menu-bar popover. It's a client of the CLI's `--json` contract — it never re-implements profile or credential logic — with an embedded terminal so login, run, and takeover happen in-app.

![The Overview: what needs you, what runs right now, and what each account has left](/agent-switch/screenshots/app-overview.png)

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

The window has four places in the top bar — **Overview**, **Sessions**, **Accounts**,
**Tools** — and on the right **Health**, **Activity**, **Notifications** and
**Settings**. `⌘K` searches sessions, accounts, projects and pages; `⌘N` starts a
session; `⌘,` opens Settings.

- **Overview** — what needs you (near-limit, sign-in, updates), what runs now, and
  what each account has left, ranked by fresh headroom. Every number says how old it is.
- **Sessions** — every session with its account; the session sheet shows a preview,
  why it got that account, and an explicit **Move to another account** (switch live,
  take over, hand off). Nothing moves on its own.
- **Accounts** — sign-in state, capacity windows, session protection per account,
  usage history, and **Projects & pools**: folder rules that start on an account or a
  pool, and the pools themselves — create one with **New pool**, add or remove its
  accounts on its card, rename or delete it from the card's ⋯ menu. A pool's start goes
  to the member that would lose the most at its next reset.
- **Tools** — agent-config, rtk and the agent CLIs: installed, current, what's new;
  installs and updates run in the built-in terminal so you see every line.
- **Health** — readiness, start-at-login state and checks, with a repair where
  agent-switch can make the change itself.
- **Activity** — what agent-switch did, and why.
- **Menu-bar popover** — a left click on the menu-bar icon shows the accounts that
  need you and starts sessions; a right click keeps the classic Show / Quit menu.
  Each signed-in account whose tool has a desktop app (Claude Desktop, Codex,
  Antigravity) gets a button that opens that app as the account, isolated from the others.

The session sheet lists the details of one session and the explicit ways to move it:

![The session sheet: details, preview, why this account, and moving it to another account](/agent-switch/screenshots/app-session.png)

## In-app updates

A 24-hour auto-check loop plus an **"Update now"** button (Settings › Updates) keep the app current. When a newer release matches an enabled bump-kind (major / minor / patch), the app self-updates in place — it runs `agent-switch update` (`npm i -g @latest`) and toasts "restart to apply". Otherwise it only notifies. Checks are deduped per version.

## agent-config companion banner

The app detects the companion `@event4u/agent-config` CLI (repo `event4u-app/agent-config`) and shows an install/update banner with one-click install/upgrade. The banner also includes a share toggle that links your global `~/.claude` skills, commands, and agents into every profile.

### Reading what an update contains

When an update is available, every surface that announces it also lets you read
it — no browser round-trip:

- **Tools › agent-config** is its home: "What's new" with the release highlights.
- The **Overview** lists the update under *Needs you* with a **See updates** button.
- The **notification** carries the release's own first highlight and points at
  Tools for the rest.

If you are several versions behind, each skipped release is listed separately
(newest first) rather than only the last one. Every panel ends with a link to the
full notes on GitHub.

The notes come from that repo's GitHub Releases, fetched unauthenticated in the
same hourly check that detects the update. When they cannot be fetched — offline,
or the GitHub API's 60-requests-per-hour limit reached — **no panel is shown at
all**: the update button behaves exactly as before, and nothing is invented. The
same applies to a release published with an empty body.

The CLI equivalent is `agent-switch tooling notes` (see the
[CLI reference](/agent-switch/reference/cli/#ecosystem-tooling)); it renders the
same content from the same source.

## Related desktop-app commands

The CLI can also launch and isolate other apps per profile:

| Command | What it does |
| --- | --- |
| `agent-switch apps` | List launchable desktop apps |
| `agent-switch open <app> [profile]` | Launch a desktop app isolated on a profile, or bring its window to the front (macOS-only) |
| `agent-switch launcher add <app> <profile>` | A Dock/Spotlight launcher for that account — also a switch per account in **Tools → Apps** (macOS) |
| `agent-switch app-settings copy claude-desktop --from default --to <profile>` | Copy Claude Desktop's MCP servers, preferences and extensions into an account — also in the account's ⋯ menu under **Tools → Apps** |
| `agent-switch web <name>` | Open claude.ai in a persistent per-profile Playwright Chromium |

:::note
`agent-switch web` needs the optional `playwright` dependency installed.
:::

## See also

- [CLI reference](/agent-switch/reference/cli/)
- [Providers & auto-switch](/agent-switch/guides/providers-and-autoswitch/)
- [Platform support](/agent-switch/reference/platform-support/)
