# Docs claims audit — README, landing page, Start here

Roadmap: `agents/roadmaps/road-to-must-have-docs.md`, Phase 7. Each factual
statement in the README, the docs landing page (`index.mdx`) and the three
Start-here pages, with the code that backs it. Checked 2026-11-01 against the
tree at the branch head (2.8.2).

| # | Statement (where) | Code reference | Verified |
|---|---|---|---|
| 1 | Supports Claude Code, Codex, Antigravity (README, landing) | `src/providers.ts:116`, `:130`, `:149` | yes |
| 2 | Each account has its own folder; switching moves a pointer, never a login (README, landing, why) | `src/providers.ts` `envVar` per provider; `src/profiles.ts` `configDir`; `src/shellenv.ts` wrapper exports the env var | yes |
| 3 | A new session goes to the account that would lose the most at its next reset (README, landing, why) | `src/balance.ts:1-12` (need = rest / hours to reset), `src/dir-resolve.ts:5` | yes |
| 4 | An account at its limit is skipped (README) | `src/balance.ts` `weigh` — capped at protection threshold → `usable:false` | yes |
| 5 | Folder rules pin a folder to an account or pool (README, landing) | `src/dir-resolve.ts:5-16`, `src/commands/routing.ts` `map` | yes |
| 6 | `dir --json` says which account and why (README, quick start) | `src/commands/routing.ts` `cmdDir`; demo recording `scripts/demo/record.sh` shows real output | yes |
| 7 | Balancing needs usage ≤ 10 min old; service refreshes every enabled account every 5 min; app refreshes count (quick start, which-account) | `src/dir-resolve.ts:33` `FRESH_USAGE_MS`; `src/daemon.ts:219` `POOL_POLL_INTERVAL_MS`, `selectPollTargets` with `pooled = names` (`:566`); README L77 of 2.8.2 (app writes `usage-latest.json`) | yes |
| 8 | The service polls Claude and Codex (README matrix: balanced starts for Codex) | `src/daemon.ts:115` `AUTO_PROVIDERS = ["claude","codex"]` | yes |
| 9 | Antigravity has no usage readout (README matrix, how-it-works) | `src/providers.ts` antigravity has no usage reader; `src/commands/usage.ts` only Claude/Codex | yes |
| 10 | `rebind` switches a running Claude session, macOS only (README, landing) | `src/commands/rebind.ts:80` platform check | yes |
| 11 | `takeover` moves a session and resumes it (README, landing) | `src/commands/takeover.ts` | yes |
| 12 | Idle Claude logins are kept fresh without spending quota, on by default (README) | `src/token-freshen.ts:1-24` (`claude doctor`), `src/profiles.ts:334` `keepSignedIn !== false` | yes |
| 13 | Keep-signed-in is Claude only (README matrix) | `src/auth-status.ts:45`, `src/token-freshen.ts` (Claude) | yes |
| 14 | Install: `npm install -g @event4u/agent-switch`, Node ≥ 20 (README, install) | `package.json` name, `engines.node >=20` | yes |
| 15 | `add <name>` runs the provider's own sign-in (README, quick start) | `src/commands/profiles.ts` `LOGIN_ARGS`, `cmdAdd` | yes |
| 16 | `shellenv install` writes ~/.zshrc, ~/.bashrc (~/.bash_profile on macOS), fish config, $PROFILE (quick start) | `src/shellenv.ts:234-237` | yes |
| 17 | Per-shell lines incl. PowerShell `\| Out-String \| Invoke-Expression` and fish `\| source` (quick start) | `src/shellenv.ts:178`, `:193`, `:218-220` | yes |
| 18 | Wrappers for `claude`, `codex`, `agy` and `asw`; a missing/broken agent-switch falls through to the real binary (quick start, how-it-works) | `src/shellenv.ts`; README 2.8.2 L116-119 | yes |
| 19 | Bare `agent-switch` starts the desktop app; no installer; macOS .app.tar.gz, Linux x64 AppImage, Windows x64 portable .exe; newest release with the build; newest cached offline; single instance (README, install) | `src/gui-launch.ts:1-21`, `:46-54`, `:118`, `:295` | yes |
| 20 | Release also carries .dmg/.msi/-setup.exe/.deb/.rpm; unsigned (install) | `gh release view 2.8.2` asset list; `.github/workflows/release.yml` | yes |
| 21 | The CLI-downloaded app is not quarantined on macOS (install) | `src/gui-launch.ts:7-8` | yes |
| 22 | `import` keeps the current login; the account shares it and is not balanced or refreshed until `login <name>` (quick start) | `src/commands/profiles.ts:205`, `:235` (`setSharesDefaultLogin`), `:169` (`cmdLogin` clears it); `src/dir-resolve.ts:97`, `:213` | yes |
| 23 | `doctor` checks PATH, shell integration, logins, API-key overrides (quick start) | `src/doctor.ts:63`, `:79`, `:104`, `:248-254` | yes |
| 24 | `service install` uses launchd / systemd --user / Task Scheduler (install) | `src/service.ts:136-160` | yes |
| 25 | `update` installs through npm and restarts the service (README, install) | `src/updates.ts:184`; help text `src/commands/help.ts` (`update`) | yes |
| 26 | `uninstall` lists, `--force` removes profiles, Claude keychain entries, mappings, state, service, launchers; default installs untouched; shell line and npm package stay (README, install) | `src/commands/system.ts:105-150` | yes |
| 27 | No proxy, no server, no telemetry, listens on no port (README, landing, security) | NON-GOALS.md; no listener in `src/` or `gui/src-tauri/src` (`ac.rs` is a client of agent-config's loopback server) | yes |
| 28 | Outbound: provider usage endpoints with own login; GitHub; npm (README) | `src/usage.ts`/`src/codex-usage.ts:22`; `src/updates.ts`, `src/gui-launch.ts` (GitHub); `gui/src/tool-updates.ts:37` (npm) | yes |
| 29 | A running session changes account only on confirmation (README, landing) | `src/daemon.ts:358` (suggest only), `rebind` interactive / explicit | yes |
| 30 | `asw` lists, `asw <name>` sets the preferred account (README) | `src/shellenv.ts` `asw` function | yes |
| 31 | `use` is a preference, not a pin (which-account) | `src/dir-resolve.ts:5` order rule > balanced > active | yes |
| 32 | Guard default `warn` for new installs; `block` gives way, shares when all busy (which-account, sessions) | `src/dir-resolve.ts:7-10`; help `guard` line | yes |
| 33 | Protection default on at 98 %, warns only (limits) | `src/protection.ts:3-12`, `:29` | yes |
| 34 | Usage notices at 75/90 % for the preferred account, on with the service (limits) | `src/usage.ts:218`; `src/daemon.ts:618-626` | yes |
| 35 | Limit suggestions off, 95 %, never switch (limits) | `src/profiles.ts:57`; `src/daemon.ts:358` | yes |
| 36 | Codex banked-reset notice only with limit suggestions on (limits) | `src/daemon.ts:635`, `:643-645` | yes |
| 37 | Context alerts off, 80/95 % (limits, sessions) | `src/notify.ts:21` | yes |
| 38 | Demo GIF output is the real CLI's (README, landing) | `scripts/demo/play.sh` runs `dist/index.js` against a seeded home | yes |

## Info image (D1)

| Tile | Backed by | Verified |
|---|---|---|
| Multi-Account Hub | profiles per provider | yes |
| Smart Routing — "Automatically pick the best account" | balanced starts, `src/balance.ts` | yes |
| Session Management — keep sessions alive & synchronized | keep-signed-in; `share` keeps settings in sync | yes |
| Usage & Limit Guard | usage readout + protection | yes |
| Works Everywhere — IDE, CLI, desktop | shell wrappers, desktop app, VS Code launcher (macOS) | yes |
| Usage Monitor · Limit Guard · Session Keep-Alive · Live Rebind | `status`, `protection`, `keep-signed-in`, `rebind` | yes |
| Smart Routing: Free Capacity · Balanced Starts · Limits & Quotas · Custom Rules | balance, protection, folder rules/pools | yes |
| Flow: Route → Run → Monitor → Suggest Switch → Completed | `dir` → wrapper → service → autoswitch suggestion | yes |
| More Providers | read as "more to come"; no claim of an existing provider | yes |

## Fresh-machine run (2026-11-01)

The README quick start, run from the packed tarball into a temp npm prefix with an empty `HOME` (paths shown as `~` and `<prefix>`):

```text
$ npm install -g @event4u/agent-switch   (packed tarball, temp prefix)
$ agent-switch --version
2.8.2
$ agent-switch shellenv install
Added the shell integration to ~/.zshrc. Open a new terminal (or run: source ~/.zshrc) and `type claude` uses agent-switch.
$ agent-switch shellenv install --shell bash
Added the shell integration to ~/.bash_profile. Open a new terminal (or run: source ~/.bash_profile) and `type claude` uses agent-switch.
$ zsh -i -c "whence -w claude codex agy asw"
claude: function
codex: function
agy: function
asw: function
$ bash -l -c "type -t claude codex agy asw"
function
function
function
function
$ asw   (zsh, no accounts yet)
No profiles yet. Create one with: agent-switch add <name> [--provider codex|antigravity]
$ agent-switch doctor | head -4
agent-switch doctor — platform darwin, node v26.7.0
  claude credential store: macOS Keychain (hashed per config dir), file fallback

✅  agent-switch is on PATH — <prefix>/bin/agent-switch
```

Not automatable here, and why:

- `agent-switch add <name>` hands off to the provider's own browser sign-in; it needs a person and a real account.
- `agent-switch service install` registers a real launchd agent on the machine running the check, so it was not run in the sandbox.

The balanced pick that step 3 enables is shown with the real CLI against a seeded home in `scripts/demo/record.sh` (the demo GIF).

Found and fixed by this run: `shellenv install --shell bash` reported "already installed" when only zsh had the line, so bash was never set up (`src/commands/system.ts` `cmdShellenv`; test `tests/shellenv-install-shell.test.ts`, red before the fix).
