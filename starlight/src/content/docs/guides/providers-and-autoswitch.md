---
title: Providers & Auto-switch
description: Enable or disable provider surfaces and configure opt-in near-limit notifications.
---

agent-switch is multi-provider. You can enable or disable each provider's surfaces, and optionally turn on near-limit notifications that suggest another profile. They are **off by default**, and nothing ever switches on its own.

## Managing providers

```bash
agent-switch providers status --json
agent-switch providers disable --provider antigravity --surface ui
agent-switch providers enable --provider codex
```

| Argument | Purpose |
| --- | --- |
| `enable` / `disable` / `status` | Turn a provider's surfaces on/off or inspect them |
| `--provider P` | Target provider (defaults to `claude`) |
| `--surface cli\|ui` | Scope to the CLI or the GUI surface |
| `--json` | Machine-readable output |

Disabling a provider **hides** it without deleting anything. **Claude and Codex are enabled by default.**

## Near-limit notifications (`autoswitch`)

Despite the command name, nothing switches automatically. With `autoswitch on`, the background daemon watches your profiles and, once the active one crosses the threshold, **notifies** you and **suggests** the profile with the most headroom. Switching stays your action (`agent-switch use`, `agent-switch rebind`, or the app). Claude/Codex only, **off by default**.

```bash
agent-switch autoswitch status --json
agent-switch autoswitch on --threshold 90 --tag work
agent-switch autoswitch off
```

| Argument | Purpose |
| --- | --- |
| `on` / `off` / `status` | Toggle or inspect the notifications |
| `--threshold 1-100` | Usage % that triggers the notice (default 95) |
| `--tag all\|work\|personal\|other` | Which profiles may be suggested |
| `--provider P` / `--json` | Target provider / machine-readable output |

On Codex, when the active profile is over the threshold and holds a banked reset, the notice also says a reset is available. It is never redeemed for you.

Separate from this, **session protection** (`agent-switch protection`) is on for every profile at 98 % and warns when a profile reaches it. It does not pause sessions.


## Redeeming a Codex reset

```bash
agent-switch reset work --provider codex
```

`reset` redeems **one banked Codex rate-limit reset**, which consumes a real credit, so it asks first on a terminal (`--yes` skips the question). Redeeming is always your action: when the active Codex profile is near its limit and holds a reset, the background daemon only *tells* you one is available — it never redeems it.

## See also

- [CLI reference](/agent-switch/reference/cli/)
- [Sessions & handoff](/agent-switch/guides/sessions-and-handoff/)
