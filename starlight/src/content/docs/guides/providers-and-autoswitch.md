---
title: Providers & Auto-switch
description: Enable or disable provider surfaces and configure opt-in, quota-driven profile rotation.
---

agent-switch is multi-provider. You can enable or disable each provider's surfaces, and optionally turn on quota-driven rotation between profiles. Auto-switch is **off by default** — read the caution below before enabling it.

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

## Auto-switch — opt-in quota rotation

Auto-switch rotates between profiles based on quota usage, so a rate-limited account hands off to another. It is **Claude/Codex only** and **globally OFF by default**.

```bash
agent-switch autoswitch status --json
agent-switch autoswitch on --threshold 90 --tag work
agent-switch autoswitch strategy reset-first
agent-switch autoswitch off
```

| Argument | Purpose |
| --- | --- |
| `on` / `off` / `status` | Toggle or inspect auto-switch |
| `strategy [reset-first\|rotation-first]` | Set the rotation strategy |
| `--threshold 1-100` | Usage % that triggers a switch |
| `--tag all\|work\|personal\|other` | Which profiles participate |
| `--provider P` / `--json` | Target provider / machine-readable output |

- **`reset-first`** tries a banked reset before rotating to another profile.
- **`rotation-first`** rotates to another profile first.
- **`--tag`** filters which profiles participate in rotation.

:::caution[Usage-policy caveat]
Auto-switch pools subscriptions to route around rate limits. It ships **opt-in and OFF by default**, against a unanimous internal review that found it crosses the providers' usage policies. It is documented here as a feature — enabling it prints a usage-policy warning, and you are responsible for whether its use complies with your providers' terms. This documentation does not endorse using it to evade limits.
:::

## Redeeming a Codex reset

```bash
agent-switch reset work --provider codex
```

`reset` redeems **one banked Codex rate-limit reset**, which consumes a real credit. `reset-first` auto-switch uses this same mechanism before rotating.

## See also

- [CLI reference](/agent-switch/reference/cli/)
- [Sessions & handoff](/agent-switch/guides/sessions-and-handoff/)
