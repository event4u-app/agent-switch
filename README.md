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
| `agent-switch web work` | claude.ai in a persistent per-profile browser (see below) |
| `agent-switch remove old --force` | delete a profile incl. its keychain entry |
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

## Browser sessions (claude.ai) without re-login

`agent-switch web <name>` launches a Playwright Chromium instance with a **persistent user-data-dir per profile** (`~/.agent-switch/<name>/browser`). You log in once per account; cookies and session live in that directory and are reused on every subsequent `agent-switch web <name>`. No cookie copying, no fragile session extraction — just isolated browser profiles.

Requires the optional dependency:

```bash
npm install playwright && npx playwright install chromium
```

(Alternative without any tooling: separate Chrome profiles or Firefox containers achieve the same thing.)

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
