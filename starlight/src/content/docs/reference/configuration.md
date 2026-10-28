---
title: Configuration
description: On-disk layout, state.json schema, telemetry config, and environment variables for agent-switch.
---

This page documents where agent-switch stores its data, the shape of its state files, and the environment variables that drive per-provider isolation.

## Profile root

The profile root is resolved from the `AGENT_SWITCH_HOME` environment variable, falling back to `~/.agent-switch`.

## On-disk layout

```text
~/.agent-switch/
  state.json                      # global state (0600)
  .layout-v2                      # one-time v1→v2 migration marker
  telemetry-config.json           # { notify, contextThresholds }
  daemon.log (+ .log.1)           # daemon output, 1MB single-gen rotation
  service-manifest.json           # installed service files (for clean uninstall)
  gui/<version>/                  # cached downloaded GUI binary
  <provider>/<name>/config/       # THE isolation dir (the env-var value)
  <provider>/<name>/browser/      # persistent Playwright profile
  <provider>/<name>/gui/<appId>/  # per-profile desktop-app user-data dir
```

:::note
v1 Claude profiles at `~/.agent-switch/<name>` are auto-migrated to `~/.agent-switch/claude/<name>` on first run. The migration re-seeds the keychain credential across the path change.
:::

## `state.json` schema

Global state, JSON, `0600`:

```jsonc
{
  "active":   { "claude": "work"|null, "codex": null, "antigravity": null },
  "labels":   { "claude/work": "Work"|"Personal"|"Other" },   // flat "provider/name" keys
  "autoSwitch": { "claude": { "enabled": false, "threshold": 95, "tag": "all" } },
  "providers":  { "claude": { "cli": true, "ui": true } },     // default on: claude+codex
  "osNotifications": false,
  "guard": "block"|"warn"|"off"                                // single-load guard: warn on new installs, block when absent from an older file
}
```

Readers normalize and migrate legacy shapes — for example a v1 `active` stored as a bare string, or a single global `autoSwitch` object. When there is no `state.json` and no profile yet (a fresh install), `guard` resolves to `warn` and is written on the first write to `~/.agent-switch`. Profiles without a `state.json` (a 2.1.0 install where `add` ran but `use` never did) count as an upgrade and resolve to `block`. In an existing file an absent or unrecognized `guard` resolves to `block`, so an upgrade never changes the guard a user already had.

Additive files next to it, all `0600`: `protection.json` (per-profile session protection; absent entry = on at 98 %; the warning fires only for profiles the background service polls — see [`protection`](/agent-switch/reference/cli/)), `pools.json` (optional pools; absent = none), `gui-settings.json` (the desktop app's Pet-intro flag and start-at-login preference), and `activity.jsonl` (the activity log, newest 2000 entries).

## `telemetry-config.json`

Kept separate from `state.json`:

| Key | Type | Default |
| --- | --- | --- |
| `notify` | `boolean` | `false` |
| `contextThresholds` | `number[]` | `[80, 95]` |

## Environment variables

| Variable | Role |
| --- | --- |
| `AGENT_SWITCH_HOME` | Override the profile root. |
| `CLAUDE_CONFIG_DIR` | Per-provider isolation, injected at launch. |
| `CODEX_HOME` | Per-provider isolation, injected at launch. |
| `HOME` | Per-provider isolation, injected at launch. |
| `CFFIXED_USER_HOME` | Pinned to `HOME` for the antigravity keychain. |
| `AGENT_SWITCH_ALLOW_DUPLICATE` | Waive the [single-load guard](/reference/cli/#single-load-guard) for one invocation. Any value except empty, `0`, or `false`. |
| `AGENT_SWITCH_CONTRACT_TESTS` | Opt-in live tests. |

## Profile-name validation

Profile names must match:

```text
^[A-Za-z0-9_-]+$
```
