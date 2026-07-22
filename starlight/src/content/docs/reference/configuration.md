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
  "switchStrategy": "reset-first"|"rotation-first",            // default reset-first
  "osNotifications": false
}
```

Readers normalize and migrate legacy shapes — for example a v1 `active` stored as a bare string, or a single global `autoSwitch` object.

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
| `AGENT_SWITCH_CONTRACT_TESTS` | Opt-in live tests. |

## Profile-name validation

Profile names must match:

```text
^[A-Za-z0-9_-]+$
```
