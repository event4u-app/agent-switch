# ADR-011 — quota from the statusLine is opt-in, and v1 never wraps a user's own bar

- **Status:** Accepted (2026-11-23) — `road-to-agent-switch-statusline-usage` Phase 2 Step 1.
- **Reopens:** the earlier council verdict that parked chaining a statusLine (recorded in the
  roadmap's Context), on a changed condition: the polled usage endpoint answers 429 without
  `Retry-After` when many accounts poll, and Claude Code 2.1.316 now sends `rate_limits` on the
  statusLine stdin (Phase-0 GO, 2026-11-23).

## Context

Agent Switch learns each Claude account's quota by polling an HTTP endpoint with the account's
OAuth token. Claude Code 2.1.316 passes `rate_limits.five_hour` / `seven_day` to the command set as
`statusLine` in a profile's `settings.json`, after the first API response, with `CLAUDE_CONFIG_DIR`
in its environment. A managed statusLine command can therefore record each account's quota with no
network call and no token read.

Two choices were open: how the command gets installed, and what happens to a statusLine the user
already has. Hooks, the closest precedent, are opt-in (`agent-switch hooks install`).

## Decision

Put to the AI council (both seats, converged; record
`agents/runtime/council/responses/2026-11-23-statusline-install.md`, gitignored):

1. **Opt-in.** `agent-switch statusline on|off|status [profile]`. Nothing installs it on upgrade or
   on profile add. Where profiles share one `settings.json`, `on` and `off` name every profile the
   file serves before writing.
2. **v1 never wraps an existing statusLine.** A profile whose `settings.json` already has a
   `statusLine` is left untouched; `on` reports it and changes nothing. Chaining a user's bar —
   stash, relay, byte-exact restore — is carried to
   `agents/roadmaps/later/road-to-statusline-chaining.md` and waits for a cross-platform
   lifecycle test (upgrade, relocation, removal, interrupted install).
3. **The managed command prints nothing.** Turning collection on does not change what the user sees.
4. **The polled endpoint stays as the fallback**, used only when the statusline sample is missing
   or stale.
5. **A sample is attributed only to a registered profile** whose config dir equals
   `CLAUDE_CONFIG_DIR`; an unknown or ambiguous dir drops the sample.
6. **Within one reset window, a window's `used_percentage` never goes down.** Several sessions on
   one account render the last payload they saw; an idle session must not overwrite a busy one's
   newer, higher reading with an older one. A later `resets_at` starts a new window.
7. **Off is ours only.** `off` removes the statusLine only when it is still the managed command;
   a user's later replacement is reported and kept.

Settled by decision, not by measurement.

## Consequences

- Users who never run `statusline on` keep today's polling, 429s included; the CLI may suggest the
  command where a poll answered 429.
- No sidecar and no relay exist in v1, so there is nothing to restore except removing one key.
- The quota a sample carries is "as of this session's last API response". A short freshness window
  and rule 6 bound how wrong it can be; the poll fills windows the statusline does not send
  (per-model windows).

## Revisit if

The opt-in rollout shows that profiles without a statusLine carry a large share of the remaining
429s (then: install automatically where no statusLine exists), or a lifecycle test shows a wrapped
bar survives upgrade, relocation, removal and collection failures within an agreed render budget
(then: lift rule 2 via the chaining roadmap).
