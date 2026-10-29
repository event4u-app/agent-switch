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
| `add <name>` | `[--provider P] [--browser B]` | Create a profile and sign it in with the provider's own sign-in (`claude auth login`, `codex login`); Claude's first-run setup screens are skipped. `--browser` opens Claude's sign-in in that browser (see `browsers`). An unfinished sign-in keeps the profile and exits `1`; finish it with `login`. |
| `login <name>` | `[--provider P] [--browser <id>]` | Sign an existing profile in again with the provider's own sign-in (`claude auth login`, `codex login`; Antigravity: `agy` prompts on start). Exits non-zero unless a stored login is back afterwards. Use it when `auth-status` says `sign-in-needed`. `--browser` opens the Claude sign-in in that browser (ids from `browsers`; macOS and Linux). Codex opens the system default itself — its printed link works in any browser. |
| `browsers` | `[--json]` | Browsers `login --browser` can open: installed apps on macOS, binaries on PATH on Linux, none on Windows. |
| `import <name>` | `[--provider P]` | Migrate the default install into a profile — no re-login. When the default install's credential is seeded, the profile shares one login with it: agent-switch marks it, never refreshes it (whichever side refreshes first signs the other out) and never starts it by balancing; `doctor` names it, and `login <name>` gives it its own login and clears the mark. |
| `mark-shared <name>` | `[--provider P] [--off]` | Mark a profile as sharing the default install's login — for imports made before `import` set the mark. A marked profile is never refreshed, rebound or started by balancing; `--off` clears the mark, and `login <name>` gives it its own login. `doctor` names unmarked profiles signed into the same account as the default install. |
| `use <name>` | `[--provider P]` | Set the active profile for a provider. |
| `deactivate` | `[--provider P]` | Clear the active profile — new sessions fall back to the default install. |
| `remove` / `rm <name>` | `[--provider P] [--force] [--yes]` | Delete the profile, its Claude keychain entry, and prune mappings. Refuses if active, live, carrying an active `rebind`, or if its account is currently borrowed by another profile's `rebind`, without `--force` (restore first with `rebind --restore --profile <holder>`). With `--force`: a rebind on this profile is dropped (stashed Keychain credentials deleted, the borrowed login handed back to its own profile); a profile borrowing this account is restored to its own login first — if that restore refuses, nothing is removed. Asks for confirmation on a terminal; `--yes` skips it. Off a terminal it proceeds as before and notes on stderr that `--yes` makes it explicit. |
| `rename <old> <new>` | `[--provider P]` | Rename a profile, carrying credential, active state, label, and mappings across. |
| `label <name> [Work\|Personal\|Other\|none]` | `[--provider P]` | Tag a profile. |
| `activate` | `[--json]` | Make this CLI the one terminals and the background service use: writes its path to `~/.agent-switch/active-cli`, which the shell wrapper calls (falling back to `agent-switch` on `PATH` when the file is missing or the path is gone), and re-installs a background service that runs another CLI onto this one. The desktop app runs it on every start, so the dev build (`task gui:dev`) and the installed app each bring their own CLI. `--json` prints `{cli, service}` with `service` one of `repointed`, `unchanged`, `not-installed`. |
| `disable <name>` / `enable <name>` | `[--provider P]` | Keep a profile (login, history, settings) but stop using it: it leaves the active slot, `use` refuses it, pools and folder rules skip it (`dir --json` says so), and the background service stops polling it. `enable` turns it back on. `list --json` reports `disabled`. Follows a rename. |
| `color <name> [orange\|red\|yellow\|green\|teal\|blue\|purple\|pink\|none]` | `[--provider P]` | Pick a profile's colour in the app (`colour` works too). Unset, the app derives one from the name. Follows a rename; `list --json` reports it as `color`. |

## Running / switching context

Precedence: **directory mapping (nearest ancestor) > active profile > default.**

| Command | Args / flags | What it does |
| --- | --- | --- |
| `run <name> [-- passthrough…]` | `[--provider P] [--tmux] [--force] [--cwd DIR]` | Launch the provider CLI on a profile (one-shot, parallel). `--cwd` starts it in that folder. `--tmux` wraps it in a managed tmux session (POSIX). `--force` overrides the [single-load guard](#single-load-guard). Args after `--` pass through, e.g. `run work -- --resume`. |
| `dir` | `[--provider P] [--guard] [--json] [--plain]` | Resolve the config dir for the current directory: a folder rule first; without one, the start is balanced across every enabled account, and only then the active profile. Balancing (also for a rule that points at a pool) picks the account that would lose the most at its next reset — the rest of its longest window divided by the hours until that window resets — on usage checked within 10 minutes; stale, unknown, signed-out, disabled and at-limit accounts (any window at its protection threshold) are skipped, under `guard block` so is one that already has a live session. Accounts within 5 % of each other are level: the active profile wins a level tie (then one without a live session, then the one with the most room in its fullest window — so an account about to hit its 5-hour limit loses to one that is not); with none left the active profile is used. A rule that points at one account refuses the start when that account is disabled or removed. A rule that points at a pool never leaves the pool: with no fresh member it takes the active profile if that is a member, else the first usable member; when the pool no longer exists or has no usable member the start is refused (exit `86`, the reason on stderr, `blocked` in `--json`). `--plain` ignores folder rules (what a start outside any rule would do). No network call is made: the usage comes from the cache the background service writes (`service install`; it refreshes every enabled account every 5 minutes) or the desktop app's refresh (every successful `status --json` read is kept in the profile's `usage-latest.json`, and `dir` takes the newest source) — without either, starts fall back to the active profile. `--json` prints `{profile, configDir, why[], blocked?}`. Machine-consumed by the shell wrapper. With `--guard`, also runs the [single-load guard](#single-load-guard): the path stays on stdout, the guard writes to stderr and exits `86` on a refusal. |
| `guard [block\|warn\|off]` | `[--json]` | Read or set the [single-load guard](#single-load-guard) policy. The bare form also lists which profiles are loaded right now. |
| `map <name\|pool:<id>> [dir]` | `[--provider P]` | Map a directory (default: CWD) to a profile or to a [pool](#pools). |
| `map --pause\|--resume [dir]` | `[--provider P]` | Pause a mapping without removing it — it stays in `mappings` (`paused: true` in `--json`, `[paused]` in text) but resolution skips it — or resume it. Re-mapping a paused folder keeps it paused. |
| `unmap [dir]` | `[--provider P]` | Remove a directory mapping. |
| `mappings` | `[--json]` | List directory mappings; `--json` gives `[{path, provider, target}]` (`target` is a profile or `pool:<id>`). |

```bash
# Resume the last conversation on the "work" profile
agent-switch run work -- --resume
```


## Single-load guard

One profile, one live session. Without it, `use` writes a **global** active
pointer that every shell re-reads, so two terminals silently land on the same
account — sharing its rate-limit windows and both refreshing one rotating OAuth
token, while the user believes they are on two different accounts.

```bash
agent-switch guard              # current policy + what is loaded right now
agent-switch guard warn         # report a second load, but allow it
agent-switch guard off          # disable the check
```

| Policy | Behaviour |
| --- | --- |
| `block` | A second session on a loaded profile is refused, naming the running session and the profiles that are free. The default for installs that predate 2.2. |
| `warn` *(default on new installs)* | The same information is printed, then the session starts. |
| `off` | No check at all. |

Overrides, both named in the refusal itself:

```bash
AGENT_SWITCH_ALLOW_DUPLICATE=1 claude    # this one start, any shell
agent-switch run work --force            # this one start, via run
```

### What it never does

- **Never refuses a nested start.** A `claude` launched from inside a running
  session inherits `CLAUDE_CONFIG_DIR`; when that already points at the profile
  being loaded, the start is a child of that session, not a duplicate.
- **Never refuses on a crashed session.** Liveness is `kill(pid, 0)` against
  Claude Code's own `sessions/<pid>.json`, checked on every read, so a leftover
  file from a crash is simply not counted. agent-switch holds no lock of its own.
- **Never blocks a start because agent-switch itself failed.** The shell wrapper
  blocks on exit code `86` and on nothing else — a missing, older, or broken
  `agent-switch` falls straight through to the real binary.
- **Codex and Antigravity are not covered.** Neither CLI registers a running
  session on disk, so there is no signal to tell a second load from a first, and
  the guard stays inert for them rather than guessing.

The guard lives in the shell wrapper, so it applies to plain `claude` — not just
to `agent-switch run`. Re-run your shell integration (a new shell is enough if
you use `eval "$(agent-switch shellenv)"`) after upgrading.

## Listing / status

| Command | Args / flags | What it does |
| --- | --- | --- |
| `list` / `ls` | `[--provider P] [--json]` | List profiles grouped by provider, active marked `*`, with live-session count. `--json` is the GUI contract (no usage). |
| `status [name]` | `[--provider P] [--json]` | Identity, Claude/Codex usage, and the worst live-session context. `--json` returns the active profile only. |
| `current` | `[--provider P]` | Show the active profile(s). |
| `whoami [name]` | `[--provider P]` | Show a profile's account identity. |

A Claude profile's OAuth access token lives about 8 hours, and a profile nobody
is running never refreshes it — so its usage numbers used to freeze on the last
cached values until you started the CLI on that account. When a token has
expired, agent-switch now runs Claude Code's own local health check
(`claude doctor`) against that profile's config dir first: Claude Code refreshes
its own token, under its own lock, and the usage read then succeeds. The check
consumes no quota, is skipped while the token is still valid, and runs at most
once every 10 minutes per profile — so a genuinely dead login (one that needs
`/login` again) never spawns a process per refresh cycle. agent-switch never
performs the refresh itself.

## Sessions & handoff

| Command | Args / flags | What it does |
| --- | --- | --- |
| `sessions [profile]` | `[--recent N] [--json]` | Recent and live sessions per profile, with context %. Claude also lists sessions run from Claude Desktop (the Code tab and agent mode, `surface: "desktop-app"`), filed under the account they ran on — matched through the account folder Desktop stores them under, not through which Desktop window ran them. Their transcripts stay Desktop's: `rm`, `takeover` and `compact` don't apply to them. |
| `desktop` | `[--json]` | Which accounts ran sessions in each Claude Desktop window — the regular app and every profile's own instance (`app open`). `mismatch: true` = a profile's own window is signed in with another account, so its sessions count against that one. |
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
| `share on\|sync\|off\|status` | `[--history] [--source <profile\|default>] [--json]` | Link `settings.json`, `CLAUDE.md`, skills, commands, and agents from a source into every profile. Directories write through; files fork on edit. `share sync` re-links. The prompt history (`history.jsonl`, what ↑ and Ctrl+R search) is always shared; a profile's own file is merged in and kept as `history.jsonl.pre-share`. `--history` also shares conversations and plans (POSIX only). `status --json` reports `prompts` per profile. |

## Browser / GUI apps

Registered apps: `claude-desktop`, `codex-ide` (VS Code), `codex-desktop`, `antigravity`.

| Command | Args / flags | What it does |
| --- | --- | --- |
| `web <name>` | — | Open claude.ai in a persistent per-profile Playwright Chromium. Needs the optional `playwright` dependency. |
| `apps` | `[--json]` | List registered launchable desktop apps and their installed state. |
| `open <app> [profile]` | — | Launch a desktop app isolated on a profile (macOS-only). When that profile's instance already runs, its window is brought to the front instead. |
| `launcher add\|remove <app> <profile>` · `list` · `repair` | `[--json]` (list) | macOS. A Dock/Spotlight app per account in `~/Applications/Agent Switch/` that runs `open <app> <profile>`. Built locally with `osacompile`, signed ad hoc, carries the app's icon; the original app is untouched. Every launcher is recorded, so `remove`, profile `remove`/`rename` and `uninstall` touch exactly those; `repair` rebuilds them after Node or agent-switch moved. |
| `app-settings copy <app>` | `--from <profile\|default> --to <profile> [--json]` | Copy desktop settings into a profile — Claude Desktop: MCP servers, preferences, installed extensions. Never the token cache (`config.json`), cookies, web storage, session folders or preferences scoped to one account. Replaced files are kept as `*.pre-copy`. Refuses while the app runs on the target profile. |
| `gui` | — | Launch the tray/menubar GUI. Downloads the prebuilt binary from GitHub Releases on first use and caches it under `~/.agent-switch/gui/<version>/`. |

## Providers / auto-switch / rotation

| Command | Args / flags | What it does |
| --- | --- | --- |
| `providers enable\|disable\|status` | `[--provider P] [--surface cli\|ui] [--json]` | Enable or disable a provider's surfaces. Enabled by default: Claude + Codex. |
| `autoswitch on\|off\|status` | `[--provider P] [--threshold 1-100] [--tag all\|work\|personal\|other] [--json]` | Opt-in near-limit notifications (OFF by default, Claude/Codex only): the daemon notifies and suggests the profile with the most headroom; it never switches on its own. |
| `reset <profile> --provider codex` | `[--yes]` | Redeem one banked Codex rate-limit reset (consumes a credit). Asks on a terminal. The daemon never redeems on its own — it only notifies. |
| `protection` | `[--json]`; `set <provider/name> [--on\|--off] [--threshold 1-100]` | Session protection per profile — default on at 98 %, separate from `autoswitch`. The background service (`service install`) warns when a profile it polls reaches its threshold — the active Claude/Codex profile, Claude profiles with a live session, members of pools a folder rule points at, and with `autoswitch on` every profile of that provider. Antigravity is never covered (no usage readout), and nothing warns while the service is stopped. It does not pause sessions. |

:::note
`autoswitch` only notifies and suggests; it never changes an account on its own. Switching stays a user action (`use`, `rebind`).
:::

## Pools

Pools are optional groups of profiles a folder rule can point at. There are none until you create one; labels and `autoswitch --tag` are unaffected.

| Command | Args / flags | What it does |
| --- | --- | --- |
| `pool [list]` | `[--json]` | List pools, their members and the folder rules that use them. |
| `pool create <name>` | `[--json]` | Create a pool; its id is the slug of the name. |
| `pool rename <id> <name>` | `[--json]` | Change the display name; the id and rules stay. |
| `pool delete <id>` | `[--json]` | Delete a pool. Refused while a folder rule points at it. |
| `pool add\|remove <id> <provider/name>` | `[--json]` | Change membership. A profile may be in several pools. |
| `pool suggest` | `[--confirm] [--json]` | Preview one pool per label in use; nothing is created until `--confirm`. |

## Ecosystem tooling

| Command | Args / flags | What it does |
| --- | --- | --- |
| `tooling` | `[--json]` | Readout of the ecosystem tools agent-switch knows about (`agent-config`, `rtk`, `claude`, `codex`, `agy`): present, version, path, health. Fully local — no network call; `--json` is the contract the app's Tools page renders. |
| `tooling install\|upgrade <tool>` | — | Run that tool's per-platform install/upgrade command as a visible child process. `agy` is refused (its CLI ships with the Antigravity app). |
| `tooling notes [<tool>]` | `[--latest] [--json]` | Read what a release actually contains. Default tool: `agent-config`. Prints every release newer than the installed version, newest first, so several skipped versions are all readable; `--latest` limits it to one. |

`tooling notes` **fetches from GitHub** — unlike `tooling`, which is offline by
contract. Only tools with a verified release source are supported
(`agent-config`, `rtk`); the others print why they have none instead of guessing
a source. Offline or rate-limited (the GitHub API allows 60 unauthenticated
requests per hour per IP), it says so and shows whatever it had.

```bash
agent-switch tooling notes                 # what's new in agent-config since your version
agent-switch tooling notes rtk --latest    # just the newest rtk release
agent-switch tooling notes --json          # structured blocks, for scripting
```

## Notifications / daemon / maintenance

| Command | Args / flags | What it does |
| --- | --- | --- |
| `notifications [clear]` | `[--json]` | List or clear the notification log. |
| `notify --kind K --title T --message M` | `[--json] [--repeat]` | Record a notification event. Kinds: `success`, `error`, `warning`, `info`. A notice identical to the last one within 30 minutes is collapsed into it; `--repeat` records it anyway (each occurrence is its own moment, e.g. a session waiting again). |
| `os-notify [on\|off\|status]` | `[--json]` | Toggle daemon OS desktop notifications (default off) — Linux and Windows. On macOS the daemon shows nothing itself (a script notification would appear as Script Editor); the Agent Switch app shows the notice while it runs. A failed usage read is never a desktop notification: it goes to the app's log, and only after reads have failed for 15 minutes. |
| `hooks install\|uninstall\|status [profile]` | — | Manage lifecycle push-hooks in Claude `settings.json` (additive, share-aware). |
| `service run\|start\|stop\|status\|install\|uninstall` | — | Background usage daemon. `install` wires launchd / systemd-user / Task Scheduler autostart. |
| `check-update` / `check-updates` | `[--json]` | Compare the running version against the latest GitHub release. |
| `update` / `upgrade` | — | Self-update via `npm install -g @latest`. Afterwards it keeps the background service on the new version: an installed service of this CLI is re-installed (and so restarted); with none installed it asks in a terminal whether to install it, and off a terminal (the desktop app's update) it only prints a hint. A service that runs another agent-switch build is left alone. |
| `shellenv` | `[--shell zsh\|bash\|fish\|powershell]` | Print the shell integration snippet. |
| `shellenv install` | `[--shell S] [--json]` | Add the loader line to the shell's startup file (`~/.zshrc`; bash: `~/.bash_profile` on macOS, `~/.bashrc` elsewhere; fish: `~/.config/fish/config.fish`; PowerShell: the `$PROFILE` the shell reports — `pwsh`, then Windows PowerShell — falling back to `Documents/PowerShell/Microsoft.PowerShell_profile.ps1`). Does nothing when any of those already loads it. `--json` prints `{shell, file, alreadyInstalled}`. |
| `doctor` | `[--json]` | Per-OS / per-provider self-check: CLI on PATH, shell integration, start at login, API-key env vars that override profile logins, Antigravity support on this OS, logins, guard. `--json` prints `{readiness, platform, checks[{id, status, title, detail, fix?}]}`. Exits `1` on a hard error. |
| `auth-status` | `[--provider P] [--json]` | Per-profile login state from the provider's own store (`connected`, `expiring`, `sign-in-needed`, `unknown`) with `expiresAt`, `lastRefreshAt`, `keptFreshBy` — the background service for Claude profiles it polls, "only you, by using it" for a profile sharing the default install's login. Never prints a token. |
| `activity` | `[--limit N] [--json]` (`N` ≥ 1) | What agent-switch itself did and why (switch, rebind, login, redeem, autostart, guard, update, protection, pool, remove). Kept to the newest 2000 entries; never contains a token. |
| `uninstall` | `[--force]` | Remove all agent-switch data, keychain entries, and the daemon. Does **not** touch provider installs. |
| `help` / `--help` / `-h` | — | Show usage. |
