---
complexity: standard
status: done
---

# Roadmap: Keep accounts signed in — Codex and Antigravity

> Follow-up to "Keep accounts signed in" for Claude (ADR-004 § Amendment
> 2026-10-31). For Claude the background service lets Claude Code refresh a
> lapsed login through `claude doctor`, which is local and spends no quota. Codex
> and Antigravity have no verified equivalent yet, so their logins are renewed
> only when the user runs their CLI, and an unused account can still lapse. The
> Settings › Sign-ins page says so ("not covered yet"). This roadmap closes that
> gap for each provider, or records why it cannot be closed safely.

## Constraints carried from ADR-003 / ADR-004

- agent-switch never performs a refresh grant itself and never writes a
  credential store outside `rebind`. Refreshing stays with the provider's own
  CLI, under that CLI's own lock.
- A refresh must spend no model quota. A completion request is not a keep-alive.
- A refresh never runs while a session is running on that account, and never for
  a login shared with the default install. These are the same three guards as
  `loginRefreshAllowed` in `src/token-freshen.ts`.
- The `keepSignedIn` switch covers every provider this lands for. There is no
  second switch per provider unless a provider needs its own off-ramp.

## Phase 1 — Codex

- [x] **Find a local, quota-free command that makes `codex` refresh its login.**
      Codex keeps `tokens.refresh_token` and `last_refresh` in the profile's
      `auth.json` (`codexAuthStatus` in `src/auth-status.ts`). Test the codex
      CLI's non-model subcommands against an expired access token in an isolated
      `CODEX_HOME`: does any of them rotate the token and move `last_refresh`?
      Record which version was tested and what the output was.
      → codex-cli 0.166.0: `codex app-server` + `account/read { refreshToken: true }`
      moved `last_refresh` to the run. `codex doctor` / `codex login status` do not
      refresh. Evidence: ADR-004 § Amendment 2026-11-01.
- [x] **Measure the refresh-token lifetime** for a Codex login: how long an
      untouched account stays refreshable. That number decides the cadence, and
      whether the feature is needed at all.
      → Upper bound only: two logins unused for 110 days were rejected, so it is
      needed. Cadence follows the access token instead (refresh once it expired,
      ~10 days), which needs no exact lifetime.
- [x] **If a safe trigger exists:** generalise `token-freshen.ts` into a
      per-provider trigger behind `loginRefreshAllowed`. Codex has no live-session
      signal today (`hasLiveSessionSignal`), so decide how the session guard holds
      for it before wiring, or keep Codex out. Tests: the guards, the cooldown,
      and that no refresh happens for an API-key login.
      → `src/login-keepalive.ts`; the session guard reads running `codex`
      processes' `CODEX_HOME` (unreadable = live). Tests: `tests/login-keepalive.test.ts`.
- [-] **If none exists:** record that in ADR-004 and keep the Sign-ins page's
      "not covered" line for Codex.
      → Not applicable: a trigger exists.

## Phase 2 — Antigravity

- [x] **Find out where an `agy` login expires and what renews it.** The login
      sits in a per-profile keychain that agent-switch does not read
      (`antigravityAuthStatus`). First establish whether the expiry can be
      observed at all without reading the secret.
      → `token.expiry` in the go-keyring item; parsed in process, only that field
      is read. The item cannot be read without reading the secret, so only its
      expiry leaves the parser.
- [x] **Find a local, quota-free `agy` command that renews the login**, tested
      the same way as Codex in Phase 1, with the version recorded.
      → agy 1.1.3: `agy models` moved `token.expiry` from 2026-09-01 to the run + 1 h.
- [x] **Wire it or record why not**, with the same guards and tests as Phase 1.

## Phase 3 — Surface

- [x] **Update Settings › Sign-ins and `keptFreshByFor`** so every provider
      states truthfully who keeps its login fresh, and update the
      `keep-signed-in` row in `starlight/src/content/docs/reference/cli.md`.
      → Done, plus the platform matrix, configuration, troubleshooting and
      security pages (`cli.mdx`; the `.md` name was out of date).
