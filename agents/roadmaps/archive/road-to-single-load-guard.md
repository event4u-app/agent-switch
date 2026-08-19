---
complexity: standard
status: done
---

# Roadmap: single-load guard — one profile, one live session

> A profile must not be loaded twice. Today nothing stops two terminals from
> running `claude` on the same profile at the same time: `agent-switch use`
> writes a global pointer, and the shell wrapper resolves it fresh on every
> invocation, so every terminal silently lands on the same account.

## Why this is worth building

Two live sessions on one account are not a harmless duplicate:

- **Shared rate limits, invisibly.** Both sessions draw from one 5h/7d window.
  The user sees two independent-looking terminals and one unexplained limit.
- **OAuth token rotation.** Claude Code rotates the refresh token on every
  refresh (the premise the whole `CLAUDE_CONFIG_DIR` isolation design rests on,
  README § "Why not keychain snapshot swapping" and ADR-004). Two processes
  refreshing one store is exactly the race `src/locks.ts` documents — Claude
  Code's own advisory locks make it survivable, not desirable.
- **The mental-model failure is the real cost.** The user believes terminal B
  is on `privat` because they typed `asw privat` there — but `use` is global,
  not per-shell, so terminal A's next `claude` moves too. A duplicate load is
  the symptom the user actually notices.

## Ground truth (verified in this tree, not assumed)

| Fact | Source |
|---|---|
| A live Claude session writes `<config>/sessions/<pid>.json` | `src/api.ts` `liveSessionPids`, already used by `list`/`status`/`rebind` |
| Dead pids are filtered (`process.kill(pid, 0)`) | `src/api.ts` `pidAlive` — stale files self-heal, no cleanup job needed |
| Every wrapper start funnels through one command | `src/shellenv.ts` — `claude()` calls `agent-switch dir --provider claude` |
| The wrapper swallows stderr (`2>/dev/null`) | `src/shellenv.ts` `posixWrapper` — a guard message cannot reach the user through today's wrapper |
| The wrapper is re-evaluated on every shell start | `eval "$(agent-switch shellenv)"` — a wrapper change propagates on the next new shell, no user migration step |
| Codex/Antigravity write no pid files | `src/sessions.ts` `listCodexSessions` — date-partitioned rollouts only, no live-process signal |

**Consequence for scope:** the guard is *real* for Claude and *inert* for
codex/antigravity. That is stated, not papered over — an inert guard that
pretends to protect is worse than none.

## Design

**Detection.** A profile is loaded when its config dir carries a live session
pid. Pure function over an injected `livePidsOf`, so every branch is unit-tested
without touching real processes (the `detectRunningClaudeProfile` precedent).

**The nested-session carve-out.** A `claude` started *inside* a Claude session
inherits `CLAUDE_CONFIG_DIR` in its environment. When the env var already points
at exactly the config dir we are about to load, the load is a deliberate child
of the running session — allowed, never refused. This is the discriminator that
keeps sub-agents, `--resume` inside a session, and tooling working.

**Enforcement points**, from strongest to weakest signal:

1. `agent-switch run <profile>` — agent-switch spawns the binary itself. Refuse.
2. The shell wrapper — `agent-switch dir --guard` returns the path on stdout as
   today, writes the human message to **stderr**, and exits `86` on a refusal.
   The wrapper stops swallowing stderr and blocks **only** on exit 86, so a
   missing or older `agent-switch` (127, 1, 2 …) can never prevent a `claude`
   start. Fail-open is deliberate: this tool must never be the reason the user
   cannot reach their assistant.
3. `agent-switch use <profile>` — warns, never blocks. `use` loads nothing; it
   states an intent, and a warning there is the cheapest possible early signal.

**Policy, three settings** (`agent-switch guard <block|warn|off>`, persisted in
`state.json` next to the other per-tool settings, default `block`):

- `block` — refuse the second load, name the running session, offer the way out.
- `warn` — print the same information and continue.
- `off` — fully inert.

Two overrides, both discoverable from the refusal message itself:
`AGENT_SWITCH_ALLOW_DUPLICATE=1` (this one invocation — the only override that
survives the shell wrapper, since a `--force` flag there would be passed
through to `claude`) and `--force` on `agent-switch run`.

**User-friendliness is the message, not the mechanism.** A refusal that only
says "no" moves the problem to the user. The refusal names the pid, how long it
has been running, and its working directory, then lists the concrete next
actions.

## Phase 1 — detection core

- [x] `src/single-load.ts`: pure `inspectLoad(configDir, { livePidsOf, env, cwdOf })`
      → `{ loaded: boolean; sessions: LoadedSession[]; nested: boolean }`.
      `LoadedSession` carries pid, cwd (best-effort via the existing `pidCwd`),
      and start time from the pid-file mtime.
- [x] Pure policy resolution: `guardVerdict(state, inspection, override)` →
      `"allow" | "warn" | "refuse"`. No I/O, exhaustively unit-tested.
- [x] Human-readable renderer `renderGuardMessage(...)` — one function, so the
      CLI, the wrapper path, and `use` all say the same thing.
- [x] Unit tests: no session, one session, several sessions, dead pid, nested
      (env matches / env points elsewhere), each policy value, override set.

## Phase 2 — settings

- [x] `GuardPolicy` in `state.json` (`readGuard` / `setGuard`), normalized like
      the existing `autoSwitch` — unknown value degrades to the default, never
      throws.
- [x] `agent-switch guard [block|warn|off]` — bare form prints the current
      policy plus which profiles are currently loaded.
- [x] Migration safety: an absent key resolves to `block`. Verified by test.

## Phase 3 — enforcement

- [x] `agent-switch run` — refuse before `launch()`, honour `--force`.
- [x] `agent-switch dir --guard` — stdout unchanged, message to stderr, exit 86
      on refusal. Without `--guard` the command behaves exactly as today
      (nothing that consumes `dir` today changes behaviour).
- [x] `agent-switch use` — warn-only line when the target is already loaded.
- [x] `shellenv` — all four shells call `dir --guard` and block on exit 86 only.

## Phase 4 — visibility

- [x] `doctor` — one line per provider: guard policy, and any profile currently
      carrying more than one live session (the state the guard exists to prevent,
      reported rather than silently tolerated when the policy is `warn`/`off`).
- [x] `list` already prints `[n live sessions]`; make `n > 1` visually distinct
      so a duplicate is legible in the one command users run most.

## Phase 5 — docs + verification

- [x] `starlight/src/content/docs/reference/cli.md` — `guard` command.
- [x] `starlight/src/content/docs/reference/configuration.md` — policy + env override.
- [x] `README.md` — one paragraph under the isolation section.
- [x] `task ci` green (445 CLI tests + 328 GUI tests, 0 failures) and `astro check` clean.

## Explicit non-goals

- **No cross-machine coordination.** The guard is host-local; two machines on
  one account are outside what a pid file can see.
- **No codex/antigravity enforcement.** No live-process signal exists for them
  in this tree. The guard reports `unknown` there and never refuses.
- **No lease/lockfile of our own.** A lease needs a holder process; the shell
  wrapper hands control to `claude` and exits, so an agent-switch-owned lease
  would leak on every crash. Claude Code's own pid files are the ground truth
  and they self-heal.
- **No blocking on a stale pid.** Liveness is checked per pid, every time.
