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
  at most once per 10 minutes per profile.
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

## References

- `src/token-freshen.ts` — the module this ADR describes.
- `docs/adr/ADR-003-narrow-credential-store-read-only-invariant-for-rebind.md` —
  the read-only invariant this decision leaves intact.
- `src/api.ts` — the read-only OAuth endpoints whose 401 started this.
