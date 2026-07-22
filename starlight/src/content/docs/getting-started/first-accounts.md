---
title: Your First Accounts
description: Adopt your current install, add more accounts, and switch between them in daily use.
---

## Adopt your current account

Start by importing your existing default install into a profile — this is login-free, so your current account keeps working without re-authenticating:

```bash
agent-switch import work
```

## Add more accounts

Create a new profile and open the provider CLI for a one-time login. Repeat per further account:

```bash
agent-switch add client
```

Each account logs in via the browser exactly once, then stays live thanks to config-dir isolation.

## Switch the active profile

```bash
agent-switch use client        # set the active profile (per provider)
agent-switch deactivate        # clear it — new sessions fall back to the default install
```

Every command is `--provider` aware and defaults to `claude`; add `--provider codex` or `--provider antigravity` to target another provider.

## Daily use with `asw`

Once shell integration is set up, the `asw` helper is the fast path:

```bash
asw                # list profiles (active marked with *)
asw client         # switch the active Claude profile
asw codex work     # switch the codex profile
```

Then just run `claude` (or `codex` / `agy`) as normal — it runs on the active profile.

## Inspect state

| Command | Shows |
|---|---|
| `agent-switch list` | Profiles grouped by provider (`--json` for tooling) |
| `agent-switch status [name]` | Identity + usage |
| `agent-switch current` | The active profile |
| `agent-switch whoami [name]` | Account identity |

## Next

See the full [CLI reference](/agent-switch/reference/cli/) and the [Guides](/agent-switch/guides/tray-gui/) for mappings, sessions, and the tray GUI.
