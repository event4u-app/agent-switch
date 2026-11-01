# ADR-004 — Delegating OAuth token refresh to Claude Code instead of performing the grant

- **Status:** Accepted (2026-07-25) — mechanism verified against CC 2.1.x on
  macOS (see *Evidence*).
- **Upholds:** the Phase-4 lock that rejected an out-of-band refresh grant, and
  `ADR-003`'s read-only credential-store invariant (writes only via `rebind`).

## Context

A Claude profile's OAuth access token lives ~8 hours; its refresh token ~3
weeks. `src/api.ts` calls the read-only `oauth/profile` and `oauth/usage`
endpoints with whatever access token the credential store holds. Once that token
expires the endpoints answer 401, `oauthGet` returns null, and the daemon's
fail-safe keeps serving the last good snapshot — so usage silently freezes.

It freezes for exactly the profiles the operator is *not* running, which is the
whole point of a multi-account usage readout: you look at agent-switch to decide
which account still has headroom, and those accounts are precisely the ones
whose tokens went stale. The observed workaround was "start the CLI on that
account for a moment", which works because Claude Code refreshes on startup.

The Phase-4 lock (recorded in the rejected auto-switch roadmap) had already
rejected the obvious fix — porting the refresh grant — on two grounds: an
out-of-band refresh **rotates the refresh token underneath a live session**, and
it delivered **no benefit**. The rotation ground is correct and was confirmed
here. The no-benefit ground no longer holds: a frozen usage readout is the
feature failing at its job.

Per the decision-revisit gate this is surfaced rather than silently built
against — but the resolution does not need the lock reopened.

## Decision

**Let Claude Code do the refresh.** When a profile's stored `expiresAt` is
inside a 5-minute buffer, agent-switch runs Claude Code's own local health check
(`claude doctor`) against that profile's `CLAUDE_CONFIG_DIR`, then re-reads the
credential and proceeds with the usage call.

`claude doctor` runs no completion and consumes no quota, but it goes through
Claude Code's auth path — so an expired token is refreshed by the process that
owns the token family, under that process's own lock, into its own store.

The path is deliberately narrow:

1. **One module.** All of it lives in `src/token-freshen.ts`; call sites
   (`daemon.ts`, `index.ts`) only ask for `freshAccessToken(configDir)`.
2. **No writes.** agent-switch still never writes the credential store outside
   `rebind`. `src/credentials.ts` keeps having no `write()`.
3. **Evidence, not optimism.** Whether the refresh worked is decided by
   re-reading the store, never assumed from the health check's exit code.
4. **Cooldown floor (10 min/profile), persisted to a file.** A genuinely dead
   login cannot be healed by retrying, and the GUI reads usage by spawning a
   fresh CLI per profile — an in-process guard would reset every read and spawn
   a process per refresh cycle forever.
5. **No evidence, no spawn.** An unreadable credential or a missing `expiresAt`
   is *not* treated as expired — a profile that has never run must not spawn a
   health check on every poll.

## Consequences

- Usage keeps updating for idle accounts without the operator touching the CLI.
- A background `claude doctor` process may briefly appear for an idle profile,
  at most once per 10 minutes per profile. It runs with `DISABLE_AUTOUPDATER=1`:
  a background health check never reinstalls Claude Code (on 2026-10-30 three
  npm updates of `@anthropic-ai/claude-code` racing each other left no install).
- agent-switch grows a runtime dependency on the `claude` binary for *freshness*
  (it already depends on it for `run`). If the binary is absent the freshen is a
  clean no-op and behaviour degrades to exactly what it was before.
- A poll cycle can stall up to 30 s on one profile (the health-check timeout).
- The Phase-4 lock and ADR-003 stay in force, unamended.

## Evidence

Probed on macOS against CC 2.1.x, 2026-07-25, on a real profile with `expiresAt`
forced into the past (original credential backed up and restored):

- `claude auth status` → **no refresh**. It reports the stored credential; the
  token stayed spent. Not usable as the trigger.
- `claude doctor` → **refresh**. Access token *and* refresh token both rotated,
  `expiresAt` moved ~8 h out. The refresh-token rotation is the direct
  confirmation of the Phase-4 hazard: had agent-switch run the grant itself, the
  refresh token Claude Code still held would have been invalidated.
- End-to-end with an access token the API actually rejects (401) and a valid
  refresh token: the `main` build returns `usage: null`; this build returns the
  three usage windows and the store ends with a valid token.

## Alternatives considered

- **Perform the refresh grant ourselves and write the rotated credential back
  under Claude Code's lock** (a second sanctioned writer, extending ADR-003).
  Works headlessly with no spawn, but reopens the rejected Phase-4 decision and
  adds a second security-sensitive write path whose failure mode is a broken
  login. Rejected: the delegated path reaches the same outcome without the
  write.
- **Refresh in memory only, never persist.** Rejected outright: rotation is
  confirmed, so the un-persisted new refresh token would strand Claude Code with
  a dead one — the exact failure the lock exists to prevent.
- **Surface the expiry instead of healing it** (badge the profile "login
  expired — start the CLI"). Honest, but leaves the operator doing the manual
  step the tool exists to remove. Kept as the fallback shape: when the freshen
  cannot heal a login, the read fails exactly as it did before.
- **`claude -p "…"` as the trigger.** Refreshes, but spends quota on a usage
  monitor — self-defeating.

## Amendment (2026-10-31) — "Keep accounts signed in"

The freshen is now the backend of the GUI's *Keep accounts signed in* switch
(`agent-switch keep-signed-in on|off`, stored as `keepSignedIn` in
`state.json`, default **on**). The mechanism is unchanged; what changed is who
may trigger it. `loginRefreshAllowed` in `src/token-freshen.ts` is the single
rule every usage read goes through — the daemon's poll and the CLI's `status`:

- **Setting off** → never refreshed; a stored token is used only while valid.
- **Login shared with the default install** → never refreshed (as before).
- **A session runs on the profile** → never refreshed. That session's Claude
  Code refreshes its own login; a second refresher only adds a race. Before
  this amendment a live profile could be freshened.

Default on, including for a `state.json` that predates the key, because that is
what the service already did for every enabled profile (it polls each one at
least every 5 minutes). Scope stays Claude: Codex and Antigravity have no
verified equivalent of `claude doctor` — tracked in
`agents/roadmaps/archive/road-to-keep-signed-in-codex-antigravity.md`, and
closed by the next amendment.

## Amendment (2026-11-01) — Codex and Antigravity

"Keep accounts signed in" now covers Codex everywhere and Antigravity on macOS
(`src/login-keepalive.ts`). The decision is the same one: the provider's own CLI
refreshes, under its own lock, into its own store; agent-switch only decides
when and judges the result by re-reading the store's expiry. Verified on
2026-11-01:

| Provider | Trigger | Verified on | Evidence |
|---|---|---|---|
| Codex | `codex app-server`, then JSON-RPC `account/read { refreshToken: true }` | codex-cli 0.166.0 | `last_refresh` in `auth.json` moved from 2026-10-28 to the run. The protocol documents the flag as "the normal refresh-token flow". |
| Antigravity | `agy models` | agy 1.1.3 | `token.expiry` in the keychain item moved from 2026-09-01 to the run + 1 h. |

Neither trigger sends a model request: `account/read` reads the account (the
server lists models on start), and `agy models` lists models.

**Rejected for Codex.** `codex doctor` and `codex login status` do not refresh:
doctor's WebSocket check uses the stored token as it is and gets a 401.
`codex app-server` also exits on stdin EOF before it answers, so the request
keeps stdin open until the reply arrives.

**Refresh-token lifetime.** Both Codex profiles on the test machine had been
unused since 2026-07-14. After 110 days their refresh was rejected ("Your access
token could not be refreshed. Please log out and sign in again."), so an unused
Codex login does lapse and the feature is needed. The Antigravity login, unused
for 61 days, still refreshed. Neither lifetime was measured more closely,
because that needs time to pass.

**When it runs.** Codex: once the access token has expired. It lives about 10
days and Codex refreshes after 8 when it runs, so an expired one means nothing
has run on the account. Antigravity: 7 days after the access token expired. It
lives one hour; what lapses is the refresh token after long disuse, so a weekly
renewal is enough. Both share the 10-minute cooldown with Claude, and the daemon
checks them once per poll cycle, before the usage reads.

**The session guard.** Neither CLI writes a live-session marker
(`hasLiveSessionSignal: false`). The guard reads the environment of every
running `codex` / `agy` process (`ps -E` on macOS, `/proc/<pid>/environ` on
Linux). A process whose `CODEX_HOME` / `HOME` is the profile counts as a
session, and so does a process whose environment cannot be read. The other two
rules of `loginRefreshAllowed` apply unchanged: the setting must be on, and a
login shared with the default install is never refreshed. Disabled profiles are
skipped, as they are by the usage poll.

**Antigravity is macOS only** because its login sits in a per-profile macOS
keychain. Elsewhere its expiry cannot be read, so nothing runs and Settings ›
Sign-ins says so.

## References

- `src/token-freshen.ts` — the module this ADR describes.
- `src/login-keepalive.ts` — the Codex and Antigravity counterpart (2026-11-01 amendment).
- `docs/adr/ADR-003-narrow-credential-store-read-only-invariant-for-rebind.md` —
  the read-only invariant this decision leaves intact.
- `src/api.ts` — the read-only OAuth endpoints whose 401 started this.
