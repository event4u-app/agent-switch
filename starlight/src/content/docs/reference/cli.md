---
title: CLI reference
description: Exhaustive command reference for the agent-switch CLI — profile lifecycle, session handoff, sharing, providers, and maintenance.
---

Every `agent-switch` command is listed below, grouped by task. Use it as a lookup; for workflows see the [guides](/agent-switch/guides/sessions-and-handoff/).

## Global conventions

- **Provider defaults to `claude`.** Target another provider with `--provider codex` or `--provider antigravity`.
- **Value-flags consume the next token:** `provider`, `shell`, `source`, `threshold`, `to`, `from`, `recent`, `kind`, `title`, `message`, `surface`, `tag`, `ack`, `brief`.
- **`run` is special.** Everything after the profile name passes straight through to the provider binary — see [Running / switching context](#running--switching-context).

```bash
# Default provider (claude)
agent-switch use work

# Target another provider
agent-switch use work --provider codex
```

## Profile lifecycle

| Command | Args / flags | What it does |
| --- | --- | --- |
| `add <name>` | `[--provider P]` | Create a profile and launch the binary for first login. |
| `import <name>` | `[--provider P]` | Migrate the default install into a profile — no re-login. |
| `use <name>` | `[--provider P]` | Set the active profile for a provider. |
| `deactivate` | `[--provider P]` | Clear the active profile — new sessions fall back to the default install. |
| `remove` / `rm <name>` | `[--provider P] [--force]` | Delete the profile, its Claude keychain entry, and prune mappings. Refuses if active or live without `--force`. |
| `rename <old> <new>` | `[--provider P]` | Rename a profile, carrying credential, active state, label, and mappings across. |
| `label <name> [Work\|Personal\|Other\|none]` | `[--provider P]` | Tag a profile. |

## Running / switching context

Precedence: **directory mapping (nearest ancestor) > active profile > default.**

| Command | Args / flags | What it does |
| --- | --- | --- |
| `run <name> [-- passthrough…]` | `[--provider P] [--tmux]` | Launch the provider CLI on a profile (one-shot, parallel). `--tmux` wraps it in a managed tmux session (POSIX). Args after `--` pass through, e.g. `run work -- --resume`. |
| `dir` | `[--provider P]` | Resolve the config dir for the current directory (mapping > active). Machine-consumed by the shell wrapper. |
| `map <name> [dir]` | `[--provider P]` | Map a directory (default: CWD) to a profile. |
| `unmap [dir]` | `[--provider P]` | Remove a directory mapping. |
| `mappings` | — | List directory mappings. |

```bash
# Resume the last conversation on the "work" profile
agent-switch run work -- --resume
```

## Listing / status

| Command | Args / flags | What it does |
| --- | --- | --- |
| `list` / `ls` | `[--provider P] [--json]` | List profiles grouped by provider, active marked `*`, with live-session count. `--json` is the GUI contract (no usage). |
| `status [name]` | `[--provider P] [--json]` | Identity, Claude/Codex usage, and the worst live-session context. `--json` returns the active profile only. |
| `current` | `[--provider P]` | Show the active profile(s). |
| `whoami [name]` | `[--provider P]` | Show a profile's account identity. |

## Sessions & handoff

| Command | Args / flags | What it does |
| --- | --- | --- |
| `sessions [profile]` | `[--recent N] [--json]` | Recent and live sessions per profile, with context %. |
| `sessions preview <id>` | `[--provider claude\|codex] [--from <profile>]` | Show the first few turns of a session. |
| `sessions rm <id>` | `[--provider] [--from] [--purge] [--yes] [--ack <id>] [--json]` | Delete a session (Claude trash-move; `--purge` hard-deletes; Codex native). `--yes` is mandatory and the command is live-guarded. |
| `sessions restore <handle>` | `[--provider codex] [--from <profile>]` | Undo a delete. |
| `takeover <id> --to <profile>` | `[--provider] [--from] [--keep-source] [--in-place] [--print-only] [--force] [--json]` | Move a session to another profile and resume. Move-by-default; `--keep-source` forks. Codex is move-only. |
| `handoff extract <id> --to <target-provider>` | `--from <profile> [--provider] [--print-only] [--json]` | Compose a metadata-only cross-provider brief (lossy, ADR-001). Written as a `0600` file. |
| `handoff seed --to <profile> --brief <path>` | `[--provider P] [--print-only]` | Open the target agent with a prompt referencing the brief. |
| `compact <profile>` | `[--clear] [--dry-run] [--force] [--provider]` | Type `/compact` (or `/clear`, `--force`-gated) into the managed tmux pane. Idle-guarded. |
| `alerts [on\|off\|status]` | `[--threshold 80,95] [--json]` | Toggle daemon threshold-crossing recording (off by default) and set thresholds. |

:::note
Cross-provider handoff via `handoff extract` is metadata-only and lossy by design — it carries a brief, not the full transcript.
:::

## Sharing (Claude-only)

| Command | Args / flags | What it does |
| --- | --- | --- |
| `share on\|sync\|off\|status` | `[--history] [--source <profile\|default>] [--json]` | Link `settings.json`, `CLAUDE.md`, skills, commands, and agents from a source into every profile. Directories write through; files fork on edit. `share sync` re-links. `--history` shares conversation history (POSIX only). |

## Browser / GUI apps

Registered apps: `claude-desktop`, `codex-ide` (VS Code), `codex-desktop`, `antigravity`.

| Command | Args / flags | What it does |
| --- | --- | --- |
| `web <name>` | — | Open claude.ai in a persistent per-profile Playwright Chromium. Needs the optional `playwright` dependency. |
| `apps` | `[--json]` | List registered launchable desktop apps and their installed state. |
| `open <app> [profile]` | — | Launch a desktop app isolated on a profile (macOS-only). |
| `gui` | — | Launch the tray/menubar GUI. Downloads the prebuilt binary from GitHub Releases on first use and caches it under `~/.agent-switch/gui/<version>/`. |

## Providers / auto-switch / rotation

| Command | Args / flags | What it does |
| --- | --- | --- |
| `providers enable\|disable\|status` | `[--provider P] [--surface cli\|ui] [--json]` | Enable or disable a provider's surfaces. Enabled by default: Claude + Codex. |
| `autoswitch on\|off\|status\|strategy` | `[--provider P] [--threshold 1-100] [--tag all\|work\|personal\|other] [--json]`; `strategy [reset-first\|rotation-first]` | Opt-in quota-driven rotation (globally OFF by default, Claude/Codex only). Prints a usage-policy warning. |
| `reset <profile> --provider codex` | — | Redeem one banked Codex rate-limit reset (consumes a credit). |

:::caution
Auto-switch ships against a unanimous internal review and may cross the providers' usage policies. It is globally off by default; enable it only if you understand the implications.
:::

## Notifications / daemon / maintenance

| Command | Args / flags | What it does |
| --- | --- | --- |
| `notifications [clear]` | `[--json]` | List or clear the notification log. |
| `notify --kind K --title T --message M` | `[--json]` | Record a notification event. Kinds: `success`, `error`, `warning`, `info`. |
| `os-notify [on\|off\|status]` | `[--json]` | Toggle daemon OS desktop notifications (default off). |
| `hooks install\|uninstall\|status [profile]` | — | Manage lifecycle push-hooks in Claude `settings.json` (additive, share-aware). |
| `service run\|start\|stop\|status\|install\|uninstall` | — | Background usage daemon. `install` wires launchd / systemd-user / Task Scheduler autostart. |
| `check-update` / `check-updates` | `[--json]` | Compare the running version against the latest GitHub release. |
| `update` / `upgrade` | — | Self-update via `npm install -g @latest`. |
| `shellenv` | `[--shell zsh\|bash\|fish\|powershell]` | Print the shell integration snippet. |
| `doctor` | — | Per-OS / per-provider self-check. Exits `1` on a hard error. |
| `uninstall` | `[--force]` | Remove all agent-switch data, keychain entries, and the daemon. Does **not** touch provider installs. |
| `help` / `--help` / `-h` | — | Show usage. |
