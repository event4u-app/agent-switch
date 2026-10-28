---
complexity: large
status: in-progress
---

# Roadmap: honest foundations for the session-control redesign

> **Source:** `agents/tmp.old/inbox-2026-10-a/` — the roadmap revision set v4…v14
> (v14 operative), the Claude-line proposal `road-to-a-session-that-knows-its-account.md`
> (defect register, pinned at `60bb238` = current `main`), the ChatGPT transcript, and
> the redesign bundle. Verified against the tree on 2026-10-28.
>
> Sibling: [`road-to-the-session-control-redesign.md`](road-to-the-session-control-redesign.md)
> renders what this roadmap produces. Everything that needs real multi-OS / provider
> runs is parked in [`later/road-to-session-orchestration.md`](later/road-to-session-orchestration.md).

## Goal

Give the new screens real, honest data and close the verified defects that make the
current product say or do something it should not — without changing how anyone's
tools start. Every new readout says how old it is and what it does not know.

## Owner constraints (from the transcript, binding)

- Tools keep working undisturbed; nothing automatic changes how a tool starts.
- Session protection: per account, **default on, 98 %**, separate from the existing
  95 % near-limit notification.
- New sessions are placed sensibly by remaining capacity — inside explicitly created
  pools only; unknown usage is never "free".
- Start at login: **default on**, a user's `off` survives every update.
- Logins should lapse as rarely as the provider allows — never by storing passwords.
- The Pet intro stays byte-exact and once-only.
- A running session changes its account only by an explicit, confirmed user action.
- Labels (Work/Personal/Other) and pools are separate; pools are opt-in, zero by default.

## Phase 0 — Truth (docs and defaults that say the wrong thing)

- [x] D20: README advertises `agent-switch setup`, which does not exist — remove the
      claim (README is rewritten in the redesign roadmap anyway).
- [x] `src/daemon.ts` header and `NON-GOALS.md` describe what the daemon really does
      (notify/suggest, Codex reset handling after D3, no automatic switch).
- [x] `PET_WELCOME` byte-exact regression test.

## Phase 1 — Verified defects

- [x] D3: the daemon redeems Codex reset credits on its own (`src/daemon.ts:396-411`) —
      becomes an explicit user action (CLI + GUI "Redeem one", confirmed); the daemon
      only notifies.
- [x] D16: rebind marker stores tokens in plaintext — store only what the restore
      needs outside the keychain; tokens never land in a plain file.
- [x] D22: `remove` deletes without confirmation — confirm on a TTY, `--yes` for scripts.
- [x] D29: PowerShell `asw` wrapper uses the POSIX `command` builtin.
- [x] D36: Pet intro once-flag moves out of `localStorage` into the GUI settings file,
      with migration of the old flag.
- [x] D5: an API-key env var (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, …) silently
      overrides the profile login — `doctor` reports it.

## Phase 2 — Start at login, done right

- [x] Autostart preference model `unset | enabled(first-run|user) | disabled(user)`;
      first-run transaction enables, reads the OS state back, and only then persists;
      a failure stays retryable and shows as `degraded`; legacy
      `agent-switch-autostart-defaulted` migrated without overriding a user `off`.
- [x] Silent start: the main window stays hidden on an autostart launch. (Already
      true — the window is created hidden and only a user action shows it; now
      locked by `gui/src/silent-start.test.ts`.)

## Phase 3 — Readouts the screens need (CLI `--json`, no secrets)

- [x] `doctor --json`: readiness + checks (`id, status, title, detail, fix?`) — CLI on
      PATH, shell integration, autostart, sign-in isolation, API-key overrides,
      Antigravity on this OS.
- [x] `auth-status --json`: per profile `state` (connected / expiring / sign-in-needed /
      unknown), `expiresAt`, `lastRefreshAt`, `keptFreshBy` — read from the provider
      store metadata, never a token value.
- [x] Activity log: append-only, size-capped JSONL of AS's own events (switch, rebind,
      login, redeem, autostart, guard, update) with a reason; `activity --json`.

## Phase 4 — Protection and pools (data model + resolver)

- [x] Session protection policy per profile `{enabled: true, thresholdPct: 98}`,
      `protection` CLI (`--json`, `set`), independent from `autoswitch`/alerts; the
      threshold is shown as the meter tick (data via `protection --json`; the tick
      itself is drawn by the redesign roadmap). The daemon notifies at the threshold with
      "pause" wording only where a pause really happens (Claude native auto-continue);
      everywhere else it says "warn". (Claude's native auto-continue cannot be
      verified from here, so every notice says "warn" for now.)
- [x] Pools: additive store, zero pools after upgrade, many-to-many membership,
      `pool` CLI (list/create/rename/delete/add/remove, `--json`); labels and
      `autoSwitch.tag` untouched; "suggest from tags" is a preview until confirmed.
- [x] Bindings: existing folder mappings may target a pool; `dir` resolves a pool to
      the member with the most fresh headroom, skipping stale/unknown and signed-out
      members, and explains why (`dir --json` → `{profile, why[]}`).
- [x] Single-load guard default `warn` for new installs; an explicitly stored mode is kept.

## Acceptance

- Root `npm test` and `cd gui && npm test` green; `tsc` clean in both.
- Upgrade from a 2.1.0 config: labels, mappings, alerts, autoswitch, guard choice and
  autostart choice unchanged; zero pools.
- No CLI JSON output, log line or activity entry contains a token.

## Risks

| Risk | Mitigation |
|---|---|
| Pool routing read as subscription pooling | opt-in pools only, never across labels implicitly, no added-up limits, explanation per pick |
| Auth expiry metadata differs per provider/version | `unknown` is first-class; no state inferred from usage |
| Changing defaults surprises existing users | defaults apply to fresh installs; stored values migrate untouched |
