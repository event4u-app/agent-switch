---
complexity: standard
status: parked
review_by: 2027-02-23
entry_condition:
  what: "Either the opt-in statusline (road-to-agent-switch-statusline-usage, ADR-011) is in use and a user with their own statusLine asks to keep it and record quota, OR the owner asks for chaining. Before any build: the lifecycle test below is written and passes on macOS, Linux and Windows."
  when: "Checked at every /roadmap:triage-parked; review_by 2027-02-23."
  who: "owner / users"
---

# Roadmap: record quota under a user's own statusLine

> **Source:** carried from `road-to-agent-switch-statusline-usage.md` on 2026-11-23 by the
> AI council's v1 cut (both seats, converged; ADR-011 rule 2; record
> `agents/runtime/council/responses/2026-11-23-statusline-install.md`, gitignored). The
> Phase-0 wrap prototype passed (byte-identical stdout and exit code, about 50 ms per render
> for a shell wrapper); both seats asked for a lifecycle test before a user's bar depends on
> the Agent Switch binary.

## Goal

A profile whose `settings.json` already runs its own statusLine command can record
`rate_limits` too, and its bar renders exactly as before — through upgrade, relocation and
removal of Agent Switch, and when quota collection fails.

## Steps

- [ ] **1 Lifecycle test first.** Cross-platform test that the original bar survives: Agent
      Switch upgraded, moved, uninstalled without `statusline off`; an install interrupted
      between the stash write and the settings write; a user edit to `settings.json` during
      `off`. Added tail latency measured at the real render cadence. verify: CI on three
      platforms; the render budget is written down before the build.
- [ ] **2 Durable stash.** The user's original statusLine value stashed verbatim in
      user-private storage, keyed to the shared SOURCE dir, schema-versioned, written before
      `settings.json` changes; excluded from sharing and from diagnostics. verify:
      round-trip suite across no-prior, command+padding, command+unknown keys,
      user-replaced-after-install and shared-collapse; a missing stash never deletes the slot.
- [ ] **3 Chain delegate.** After the cache write, spawn the original with full env and cwd,
      re-feed stdin, relay stdout and exit code byte-for-byte, time-boxed; on timeout or
      failure emit nothing and never block. verify: a dummy bar printing ANSI is
      byte-identical through the wrapper; a hung child → empty within the box, cache still
      written; exit code relayed.
- [ ] **4 `statusline on` offers chaining** where a statusLine exists, naming every profile a
      shared file serves. verify: CLI test.
- [ ] **5 `doctor`** reports a wrapped bar whose original no longer runs. verify: doctor test.
