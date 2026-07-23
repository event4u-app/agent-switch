---
title: Installation & Setup
description: Install agent-switch, wire up shell integration, and verify with doctor.
---

## Requirements

- Node.js **>= 20**
- The package is `@event4u/agent-switch` (the bare `agent-switch` name on npm is an unrelated project — always use the scoped name).

## Install

Global install (all operating systems) puts `agent-switch` on your PATH:

```bash
npm install -g @event4u/agent-switch
```

Run a single command without installing:

```bash
npx @event4u/agent-switch <cmd>
```

From source:

```bash
npm install && npm run build && npm link
```

## Shell integration

Shell integration is **required** for the `claude` / `codex` / `agy` wrappers and the `asw` helper. Add this to your shell rc file:

```bash
eval "$(agent-switch shellenv)"
```

It auto-detects the shell. Override detection when needed:

```bash
eval "$(agent-switch shellenv --shell zsh)"   # or bash | fish | powershell
```

`shellenv` defines:

- A **function wrapper per provider binary** that injects the provider's env var (pointing at the resolved config dir, falling back to the real binary if empty).
- The **`asw` helper**: bare `asw` runs `list`; `asw <name>` switches the active Claude profile; `asw <provider> <name>` switches that provider.

On `cmd.exe` there is no wrapper — use `agent-switch run` instead.

## Verify

Run the post-install self-check:

```bash
agent-switch doctor
```

`doctor` runs a per-OS, per-provider self-check and exits non-zero on a hard error:

![Terminal showing agent-switch doctor output with green checkmarks for shell integration, Claude and Codex, and a warning that the optional agy binary is not on PATH](/agent-switch/screenshots/doctor.svg)

## Next

Continue to [Your First Accounts](/agent-switch/getting-started/first-accounts/).
