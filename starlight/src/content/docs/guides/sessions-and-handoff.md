---
title: Sessions & Handoff
description: Inspect, move, and hand off agent sessions across profiles and providers, plus context monitoring.
---

agent-switch tracks the sessions each profile has run, lets you move them between profiles, and bridges work between providers. This guide covers the session inventory, the difference between a same-provider **takeover** and a cross-provider **handoff**, and how context monitoring works.

## Session inventory & lifecycle

| Command | What it does |
| --- | --- |
| `agent-switch sessions [profile] [--recent N] [--json]` | List recent + live sessions per profile, with a context % column |
| `agent-switch sessions preview <id> [--provider claude\|codex] [--from <profile>]` | Show the first few turns of a session |
| `agent-switch sessions rm <id> [...]` | Delete a session |
| `agent-switch sessions restore <handle> [--provider codex] [--from <profile>]` | Undo a delete |

```bash
# Recent sessions for the "work" profile
agent-switch sessions work --recent 10

# Peek at a session before acting on it
agent-switch sessions preview 3f2a9c --from work
```

`sessions preview` is a bounded reader — it returns empty for Codex or when reading fails, rather than dumping an unbounded transcript.

### Deleting sessions

```bash
agent-switch sessions rm 3f2a9c --from work --yes
```

| Flag | Effect |
| --- | --- |
| `--yes` | **Mandatory** — confirms the deletion |
| `--purge` | Claude only: hard delete instead of the recoverable trash-move |
| `--ack <id>` | Required to delete a shared-history session |
| `--provider` / `--from` | Target a specific provider / source profile |

For Claude, a delete is a recoverable trash-move; `--purge` makes it permanent. For Codex, deletion uses the native archive/delete. Live sessions are guarded against accidental removal.

:::caution
`--yes` is required for every deletion. Shared-history deletions additionally need `--ack <id>` so you can't remove history that other profiles rely on without acknowledging it.
:::

## Takeover vs. handoff

There are two distinct ways to continue work elsewhere, and they are **not** the same operation.

- **Takeover** (same provider): a full move + resume of a live session's state into another profile.
- **Handoff** (cross provider): a lossy, metadata-only brief — a bridge, not a resume.

### Takeover — move & resume within a provider

```bash
agent-switch takeover 3f2a9c --to personal --from work
```

| Flag | Effect |
| --- | --- |
| `--keep-source` | Fork instead of move (uses `--fork-session`) |
| `--in-place` | Take over without moving the config dir |
| `--print-only` | Show what would happen without doing it |
| `--force` | Override guards |
| `--provider` / `--from` | Target provider / source profile |

Takeover is **move-by-default**: it copies the session to the target, verifies the copy, then deletes the source. Pass `--keep-source` to fork instead. It **refuses on a live source**, is shared-history aware, and for Codex is **move-only**.

### Handoff — bridge across providers

Handoff composes a metadata-only brief to continue work in a **different** provider. Per [ADR-001](/agent-switch/reference/adr/), this is a lossy bridge — it does not restore full conversation state.

```bash
# 1. Extract a brief from a Claude session, targeting Codex
agent-switch handoff extract 3f2a9c --to codex --from work

# 2. Open the target agent with a prompt referencing the brief
agent-switch handoff seed --to personal --brief ~/.agent-switch/briefs/3f2a9c.md
```

| Command | Purpose |
| --- | --- |
| `handoff extract <id> --to <target-provider> --from <profile> [--print-only] [--json]` | Compose a metadata-only brief (writes a `0600` file) |
| `handoff seed --to <profile> --brief <path> [--provider P] [--print-only]` | Open the target agent interactively, referencing the brief by path |

:::caution
A handoff carries a **metadata brief only**, not the session. Treat it as a summary to seed a fresh conversation — expect to lose the fine-grained context a same-provider takeover preserves.
:::

## Context monitoring & compaction

`agent-switch sessions` reports a context % column matching Claude's own `/context`. This is read **locally** and is strictly **own-session only**.

:::caution[Anti-rotation boundary]
Context monitoring is never a cross-account comparison. It reads your own session's usage locally — it does not, and cannot, compare context across accounts to drive rotation.
:::

Compact or clear a profile's managed session:

```bash
agent-switch compact work            # type /compact into the managed pane
agent-switch compact work --clear --force   # /clear is force-gated
```

`compact` types `/compact` (or `/clear`) into the profile's **managed tmux pane only**, and is idle-guarded. `--dry-run` previews the action.

Record threshold crossings with the daemon:

```bash
agent-switch alerts on --threshold 80,95
agent-switch alerts status --json
```

`alerts` toggles daemon recording of context/usage threshold crossings (**OFF by default**) and sets the thresholds.

## See also

- [CLI reference](/agent-switch/reference/cli/)
- [Providers & auto-switch](/agent-switch/guides/providers-and-autoswitch/)
