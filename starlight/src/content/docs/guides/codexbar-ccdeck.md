---
title: Show agent-switch accounts in CodexBar / ccdeck
description: Point CodexBar or ccdeck at agent-switch to show your Claude profiles and their cached usage — read-only, through the claude-swap list schema v1.
---

CodexBar and ccdeck can show the accounts of
claude-swap by running
`cswap --list --json` and reading its *list schema v1*. agent-switch speaks the
same schema, so either tool can show your agent-switch Claude profiles instead.

## Point the tool at agent-switch

Wherever the tool asks for the claude-swap (`cswap`) binary, give it the path of
the `agent-switch` binary:

```bash
which agent-switch     # e.g. /opt/homebrew/bin/agent-switch
```

The tool then runs:

```bash
agent-switch --list --json
# the same output, spelled the agent-switch way:
agent-switch list --json --format cswap-v1
agent-switch --version   # prints the installed version, e.g. 2.6.3
```

## What the list contains

Claude profiles only — Codex and Antigravity profiles are not part of the schema.

```json
{
  "schemaVersion": 1,
  "supportsAccountSwitching": false,
  "activeAccountNumber": 1,
  "accounts": [
    {
      "number": 1,
      "email": "you@example.com",
      "alias": "work",
      "active": true,
      "disabled": false,
      "usageStatus": "ok",
      "usage": {
        "fiveHour": { "pct": 42, "resetsAt": "2026-11-01T15:00:00Z" },
        "sevenDay": { "pct": 17, "resetsAt": "2026-11-05T09:00:00Z" }
      },
      "usageFetchedAt": "2026-11-01T11:59:00.000Z",
      "usageAgeSeconds": 60
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `number` | A stable number per profile. It is stored in `~/.agent-switch/cswap-numbers.json` and never handed out again once its profile is gone — a removed and re-added profile gets a new number. A renamed profile counts as a new one. |
| `alias` | The profile name. |
| `email` | The account's email from the profile's own Claude Code metadata, or `null` before the first sign-in. |
| `active` / `activeAccountNumber` | The active Claude profile (`agent-switch use`), or `null` when none is set. |
| `disabled` | `agent-switch disable` was run on the profile. |
| `usageStatus` | `ok` — the cached usage is as fresh as agent-switch itself trusts a cached read (the background service's slowest polling cadence plus one minute). `stale` — older than that, still shown. `unavailable` — nothing is cached; `usage` is then `null`. |
| `usage.fiveHour` / `usage.sevenDay` | `pct` (0–100) and `resetsAt` per window; a window the cache does not hold is `null`. |
| `usageFetchedAt` / `usageAgeSeconds` | When the cached usage was read, and how long ago. |

An error is printed as `{"schemaVersion":1,"error":{"code":"…","message":"…"}}`
with a non-zero exit — for example `unsupported_format` for an unknown
`--format`.

## Read-only by design

- **No switching.** `supportsAccountSwitching` is always `false`, so the tool
  never offers to switch accounts. Switch with agent-switch itself (`use`, or
  the desktop app).
- **Cache only.** The list is built from what agent-switch already stored: the
  background service's last reads and each profile's last usage snapshot. It
  makes no network request and reads no login token; it answers in well under
  300 ms. Keep the [background service](/agent-switch/reference/cli/#notifications--daemon--maintenance)
  running (`agent-switch service install`) so the numbers stay fresh — without
  it, usage turns `stale` and then stays at the last value read.
- **No token in the output.** The list carries account emails and usage
  percentages, nothing that signs in.
