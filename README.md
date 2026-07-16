# agent-switch

Switch between multiple Claude Code accounts on macOS, Linux, and Windows with a single shell command — no repeated login/logout, no browser round-trips after the initial setup.

```
$ asw work        # switch active account
$ claude         # runs on the "work" account
$ asw            # list all profiles, active one marked *
* work             matze@company.example
  privat           matze@personal.example
  event4u          dev@event4u.example
```

## Why not keychain snapshot swapping?

Most naive switchers snapshot the macOS Keychain entry (`Claude Code-credentials`) per account and restore it on switch. This breaks: Claude Code's OAuth **refresh tokens rotate on every refresh**, so a stored snapshot goes stale within hours and you're back to browser logins.

`agent-switch` uses **`CLAUDE_CONFIG_DIR` isolation** instead. Each profile gets its own config directory under `~/.agent-switch/<name>/config`. Claude Code derives a *separate* keychain entry per config dir, so every account stays logged in **live and independently**. Switching only changes which directory new `claude` invocations point at — nothing is snapshotted, nothing goes stale, and each account logs in via browser exactly once.

## Install

From source (any OS — needs Node ≥ 18):

```bash
npm install          # or: npm ci
npm run build
npm link             # puts `agent-switch` on your PATH (npm creates a .cmd shim on Windows)
```

Native package managers (Homebrew / Scoop / winget) are planned once the tool
is public; for now `npm link` (local) or `npm install -g agent-switch` (once
published) is the install path on every OS.

Then add the shell integration — `agent-switch shellenv` auto-detects your shell,
or pass `--shell`:

| Shell | One-time setup |
|---|---|
| **zsh** (macOS default) | add `eval "$(agent-switch shellenv)"` to `~/.zshrc` |
| **bash** | add `eval "$(agent-switch shellenv)"` to `~/.bashrc` |
| **fish** | add `agent-switch shellenv --shell fish \| source` to `~/.config/fish/config.fish` |
| **PowerShell** (Windows) | add `agent-switch shellenv --shell powershell \| Out-String \| Invoke-Expression` to `$PROFILE` |
| **cmd.exe** | no wrapper — use `agent-switch run <name>` directly (see below) |

This defines:
- a `claude` wrapper that injects the active profile's `CLAUDE_CONFIG_DIR`
- `asw <name>` as shorthand for `agent-switch use <name>`, and bare `asw` for `agent-switch list`

Open a new terminal afterwards, then run `agent-switch doctor` to self-check the setup.

**cmd.exe has no function-wrapper story**, so there is no `claude` shadow there:
run a profile explicitly with `agent-switch run <name>` (which sets
`CLAUDE_CONFIG_DIR` for that one invocation). PowerShell is the recommended
Windows shell.

## Setup your accounts

```bash
# Adopt your existing default install as the first profile (keeps history/settings):
agent-switch import privat
agent-switch run privat        # then /login once so this profile owns its own credential

# Add the other accounts — each opens Claude Code for a one-time login:
agent-switch add work
agent-switch add event4u
```

## Daily use

| Command | Effect |
|---|---|
| `asw work` | switch active account (new sessions) |
| `asw` | list profiles (live sessions shown) |
| `agent-switch run event4u` | one-shot session on another account **without** switching — all accounts can run in parallel |
| `agent-switch run work -- --resume` | pass any flags through to `claude` |
| `agent-switch status` | identity + 5h/7d usage for every profile |
| `agent-switch map work ~/projects/kunde-a` | `claude` in that repo always uses this account — no switching |
| `agent-switch share on` | one settings/skills/commands/agents tree for all profiles |
| `agent-switch sessions` | recent + live Claude sessions per profile |
| `agent-switch takeover <id> --to work` | move a session to another account and resume it there (see below) |
| `agent-switch web work` | claude.ai in a persistent per-profile browser (see below) |
| `agent-switch remove old --force` | delete a profile incl. its keychain entry |
| `agent-switch label work Work` | tag a profile (`Work` / `Personal` / `Other`, or `none` to clear) |
| `agent-switch providers status` | which providers are enabled (default: Claude + Codex; others off) |
| `agent-switch providers enable --provider gemini` | enable a provider (or `disable`; `--surface cli\|ui` for one surface) |
| `agent-switch autoswitch on --threshold 90` | opt-in auto-switch on limit (Claude-only; globally off by default; see below) |
| `agent-switch uninstall --force` | remove all agent-switch data, keychain entries, and the daemon |
| `agent-switch doctor` | per-OS self-check (claude on PATH, config, creds, share links) |

## Per-repo accounts (directory mappings)

```bash
agent-switch map work ~/projects/firma
agent-switch map privat ~/projects/hobby
```

The `claude` shell wrapper resolves the current directory to the nearest mapped
ancestor. Precedence: **mapping > active profile > default**. `agent-switch mappings`
lists, `agent-switch unmap` removes.

## Shared settings across accounts

```bash
agent-switch share on             # settings.json, CLAUDE.md, skills/, commands/, agents/
agent-switch share on --history   # additionally share conversation history (--resume, POSIX only)
agent-switch share sync           # re-link any file a /config edit forked (see below)
agent-switch share off            # removes only agent-switch-created links
```

Sharing links from `~/.claude` (or `--source <profile>`) into each profile.
Two behaviors, because Claude Code's settings writer writes atomically:

- **Directories** (`skills/`, `commands/`, `agents/`) write **through** the link
  — an edit in any profile lands in the shared source. This is the payoff.
  Linked as a symlink on macOS/Linux, a junction on Windows (no admin needed).
- **Files** (`settings.json`, `keybindings.json`, `CLAUDE.md`) are linked too,
  but an in-profile `/config` edit **forks** the file (the atomic rename
  replaces the link). Run `agent-switch share sync` to push a fork back into the
  shared source and re-link it (last sync wins across profiles). On Windows,
  file symlinks need Developer Mode or admin; without it, only the directories
  are shared and files are skipped with a message.

Account-scoped state (credentials, `.claude.json`, plugins) always stays per
profile.

## Session handoff between accounts (takeover)

Switching the account should not cost the conversation. A Claude Code session is
a transcript file scoped to its project directory — and an *account* handoff
keeps that directory constant, so the session can move between profiles:

```bash
agent-switch sessions                       # recent + live sessions, per profile (* = live)
agent-switch takeover <session-id> --to work        # move it, then resume on "work"
agent-switch takeover <session-id> --to work --keep-source   # copy + fork instead (source keeps its own)
```

- **Move by default.** The transcript is transferred copy→verify→delete; the
  original account no longer owns the session afterwards (no same-id divergence).
- **`--keep-source` forks.** The target resumes with `--fork-session` (fresh
  session id there); the source's transcript stays untouched. Session-scoped
  permission approvals do not carry into a fork — Claude asks once more.
- **Guard rails.** Takeover refuses when the source profile has live sessions
  (close them first, or `--force`), never overwrites an existing transcript on
  the target, and detects `share on --history` (nothing to move — profiles
  already see one history tree).
- In an interactive terminal the takeover resumes the session directly; use
  `--print-only` to just print the resume command. Transcripts are treated as
  opaque blobs — moved whole, never parsed or rewritten.

## Context monitoring

See how full each live session's context window is *before* the "97% of context
used" wall, get warned at a threshold, and act — all from own-session data read
locally (no API calls, own-profile only, never a cross-account comparison).

```bash
agent-switch sessions                 # live sessions carry a context column: 67% · 134k/1000k
agent-switch status                   # active profile's worst live session's context, one line
agent-switch alerts on --threshold 80,95   # daemon records ONE coalesced notification per cycle on a crossing
agent-switch compact work             # type /compact into work's agent-switch-managed tmux pane (idle-guarded)
```

- **Context %** is read from the session's own transcript (the last finalized
  main-chain turn's input side, matching Claude Code's own `/context`); the
  window (200k / 1M) comes from a small per-model table. Unknown model → raw
  tokens, no guessed percentage. Codex context comes in-band from its rollout.
- **Alerts** are **off by default** and, when on, name only the project +
  percentage + a suggested `/compact` — never another profile. Enable per-session
  liveness/compaction signals with `agent-switch hooks install` (adds additive,
  reversible, share-aware hooks to the profile's `settings.json`).
- **Compaction is never automatic.** `agent-switch compact <profile>` only types
  into an agent-switch-*managed* tmux pane (`run --tmux`), refuses while a turn
  is in flight (`--force` to override), and prints the manual command anywhere
  else. `/clear` is gated behind `--force` (it discards the conversation).

## Browser sessions (claude.ai) without re-login

`agent-switch web <name>` launches a Playwright Chromium instance with a **persistent user-data-dir per profile** (`~/.agent-switch/<name>/browser`). You log in once per account; cookies and session live in that directory and are reused on every subsequent `agent-switch web <name>`. No cookie copying, no fragile session extraction — just isolated browser profiles.

Requires the optional dependency:

```bash
npm install playwright && npx playwright install chromium
```

(Alternative without any tooling: separate Chrome profiles or Firefox containers achieve the same thing.)

## GUI apps (experimental, macOS)

Beyond the CLIs, agent-switch can launch **desktop/GUI clients** on an isolated
profile. Two strategies, picked per app:

- **env** — export the provider's config-dir env var (the same mechanism the
  CLIs use, e.g. `CODEX_HOME`) when launching the app. Reuses the profile's
  config dir.
- **user-data-dir** — pass Chromium's `--user-data-dir` to an Electron app, so
  each profile gets its own isolated data dir and profiles run **in parallel**.

```bash
agent-switch apps                 # list launchable GUI apps + installed state
agent-switch open <app> [profile] # launch an app on a profile (active if omitted)
```

**Supported now:**

- **Claude Desktop** (`agent-switch open claude-desktop <profile>`) —
  `user-data-dir` strategy, parallel accounts.
- **Codex desktop** (`agent-switch open codex-desktop <profile>`) — **two
  layers** in one launch: `CODEX_HOME` (agent auth, reuses the codex profile) +
  `--user-data-dir` (the ChatGPT web session).
- **Codex in VS Code** (`agent-switch open codex-ide <profile>`) — `CODEX_HOME`
  only (the extension reads it from the editor's env).

More clients land via their roadmaps in `agents/roadmaps/`.

Caveats (why this is experimental):
- **macOS-only for now**; launched via the `open` command, not a Finder/Dock
  double-click (a plain launch doesn't carry the flag/env → no isolation).
- **Unofficial / version-fragile** — no vendor ships a built-in account
  switcher; an app update can change launcher behaviour. Re-verify per app.
- The profile's data dir is never swapped on a live app (that risks
  SingletonLock/DB corruption); isolation is by launch flag/env only. Claude
  Desktop's own default install (`~/Library/Application Support/Claude`) is
  never touched — each profile gets its own dir.
- **Claude Desktop login is a web session** (not a refreshable token): each
  profile signs in once and expires on its own schedule. Because an OAuth
  callback can reach the wrong live window, **quit other Claude windows before
  signing into a new account.**
- **Codex** — the desktop app lists only the *latest* session when a custom
  `CODEX_HOME` is set (upstream openai/codex#14389; cosmetic, not an isolation
  failure). For `codex-ide`, `CODEX_HOME` reaches a *newly launched* editor
  process — if your editor is already running, quit it first so the new account
  takes effect (also re-check openai/codex#7971 on your extension version).

Verify a candidate Electron app honours `--user-data-dir` on your machine:

```bash
open -n -a "<App>" --args --user-data-dir="$HOME/Library/Application Support/<App>-test"
pgrep -lf "<App>.app/Contents/MacOS"        # ≥2 processes ⇒ parallel instances
ls "$HOME/Library/Application Support/<App>-test"   # populated ⇒ flag honoured
```

## Platform support

Every command works on macOS, Linux, and Windows, or degrades with an explicit
message. `agent-switch doctor` reports the live status for your machine.

| Capability | macOS | Linux | Windows |
|---|---|---|---|
| Profiles, switch, run, status, mappings | ✅ | ✅ | ✅ |
| Credential store | Keychain (per-dir), file fallback | plaintext file per profile | plaintext file per profile |
| `import` (login-free) | ✅ | ✅ | ✅ |
| Share **directories** (skills/commands/agents) | ✅ symlink | ✅ symlink | ✅ junction (no admin) |
| Share **files** (settings.json, …) | ✅ (forks on edit → `share sync`) | ✅ (same) | ⚠️ needs Developer Mode/admin; else skipped |
| `share --history` | ✅ | ✅ | ❌ POSIX-only |
| Shell wrapper | zsh/bash | zsh/bash/fish | PowerShell (cmd.exe → `run`) |
| `web` (claude.ai browser) | ✅ | ✅ desktop session | ✅ |

Full per-mechanism contract (verified/degraded/broken with sources) lives in
[`ADOPTED.md`](ADOPTED.md#per-os-contract-matrix).

## Notes & gotchas

- **Never use `claude auth logout` to switch** — it revokes the token server-side. Switching via `agent-switch` never touches the other accounts' credentials.
- **Running sessions are unaffected by a switch.** Claude Code reads its config at startup; only *new* sessions pick up the new profile. Restart a session if you want it on the other account.
- `agent-switch remove` deletes the config dir **and** the profile's hashed keychain entry, and prunes its directory mappings.
- After `agent-switch import`, the imported profile and the old default login share one OAuth lineage — the first side to refresh wins. Stop using the bare default login afterwards.
- Profiles are fully isolated by default; use `agent-switch share on` for a managed shared-settings setup.
- Override the profile root with `AGENT_SWITCH_HOME` if you don't want `~/.agent-switch`.
- **`CLAUDE_CONFIG_DIR` relocates only the config home, not the OS state dir.** On Linux, Claude Code may also write to `~/.local/state/claude/` (XDG state), which is *not* per-profile — so any state kept there (not credentials, which live in each profile's config dir) is effectively shared across all profiles. Impact is limited and the exact contents vary by version; flagged here so a surprising cross-profile artifact there is not mistaken for a leak of account data. Credentials, `.claude.json`, and history stay per profile.
- **VS Code extension ignores `CLAUDE_CONFIG_DIR`** (upstream #30538) — the extension always uses the default `~/.claude`. Use the CLI (`agent-switch run` / the `claude` wrapper) for per-profile sessions; the extension is out of scope.

## Background service & tray GUI (optional)

The CLI is fully usable on its own. Two optional layers add convenience:

- **Usage daemon** — a background service polls each profile's **own** usage
  (only profiles with a live session + the active one), caches it, and notifies
  on the active profile's threshold crossings (75% / 90% by default):

  ```bash
  agent-switch service install    # launchd (macOS) / systemd --user (Linux) / Task Scheduler (Windows)
  agent-switch service status     # health, last poll, cached profiles
  agent-switch service start|stop # manual control (no install)
  ```

- **Tray/menubar GUI** (`gui/`, Tauri) — a small panel to see per-profile usage
  and switch/open sessions. It is a **client of the CLI** (`agent-switch <cmd>
  --json`) and never re-implements profile logic; the CLI core stays
  dependency-free. See [`gui/README.md`](gui/README.md).

Usage readout is per-provider: Claude exposes an OAuth `/usage` endpoint;
**Codex and Gemini have no usage readout**, so they show identity only (never a
fabricated number).

### Automatic account rotation (opt-in, off by default)

By default `agent-switch` only switches when **you** ask, and shows **your own**
usage per profile (the same information the vendors' native `/usage` surfaces
show). It never nags or ranks unless you turn rotation on.

Auto-switch is **globally off by default** and must be explicitly enabled. It is
available **only for Claude** — the one provider with a usage readout to trigger
on; Codex and Gemini have none, so they are profile-switch only and never show an
auto-switch control. When enabled (`agent-switch autoswitch on [--threshold N]`),
the background daemon moves the active Claude profile to the account with the most
headroom once the active one hits the threshold. Switching only affects **new**
sessions; running ones keep their environment.

Earlier this rotation was rejected outright; that decision was later reversed in
favour of the opt-in design above. Historical context:
[`agents/roadmaps/skipped/road-to-agent-switch-autoswitch-rejected.md`](agents/roadmaps/skipped/road-to-agent-switch-autoswitch-rejected.md).

## Layout

```
~/.agent-switch/
  state.json               # { "active": "work" }
  work/
    config/                # CLAUDE_CONFIG_DIR for this account (.claude.json, settings, history)
    browser/               # persistent Playwright profile for claude.ai
  privat/
    config/
  event4u/
    config/
```
