# A browser agent-switch controls — probe

Roadmap: `road-to-a-chat-that-reads-well` 5.1–5.3. Run 2026-11-05 on the
owner's Mac (macOS 26, Chrome 156.0.8078.80, Claude Code 2.1.316,
codex-cli 0.166.0), in throw-away config folders. No account was signed in.

## Verified

| Check | How | Result |
|---|---|---|
| Claude Code follows `$BROWSER` with one URL argument (was verified for 2.1.312 only) | `CLAUDE_CONFIG_DIR=<tmp> BROWSER=<logging wrapper> claude auth login`, killed after 20 s | the wrapper got exactly one argument, `https://claude.com/cai/oauth/authorize?code=true&client_id=…&redirect_uri=http%3A%2F%2Flocalhost%3A59863%2Fcallback&…` |
| The sign-in finishes locally, whatever browser opens it | the `redirect_uri` above | `http://localhost:<random port>/callback` — Claude Code's own listener; nothing to intercept |
| The isolated wrapper starts Chrome with the account's own profile | `isolatedWrapperScript("darwin", Chrome, <tmp>)` as `$BROWSER` | a new `Google Chrome --user-data-dir=<tmp>` process; the folder filled with a fresh profile; the owner's running Chrome (another process) untouched; the probe instance was closed by its folder |
| No automation flag | the wrapper text (unit test) | only `--user-data-dir`, `--no-first-run`, `--no-default-browser-check` |
| Codex's sign-in port | `CODEX_HOME=<tmp> codex login`, `lsof` on its pid | `127.0.0.1:1455 (LISTEN)`, "Starting local login server on http://localhost:1455" — fixed, so two at once collide |
| Codex's way around it | `codex login --help` | `--device-auth` exists (undocumented in the help text) |

## Not verified here — needs the owner

- **Google SSO in the isolated profile.** A real sign-in needs the owner's
  Google account. The browser is the owner's own Chrome binary started without
  automation flags, so Google sees a normal Chrome with a new profile — an
  inference, not a measurement.
- **A device-code Codex sign-in to the end.** The flag exists and is chosen
  when port 1455 is taken; completing it needs a ChatGPT account (and the
  device-code option may have to be enabled in ChatGPT's security settings).
- **The Playwright fallback against Google.** It starts Chromium without
  `--enable-automation`, but Playwright still drives it over CDP; Google may
  refuse SSO there, which the CLI says when it picks this path.

## Not offered

- An embedded webview (Tauri window): Google blocks OAuth in embedded webviews
  (`disallowed_useragent`, Google developers blog, 2021).
- Arc and Dia: Chromium-based, but they manage profiles themselves; whether
  they honour `--user-data-dir` is not established.
- Codex isolation: codex-cli on macOS opens the system default browser and
  ignores `$BROWSER`, so an isolated profile cannot be handed to it.
