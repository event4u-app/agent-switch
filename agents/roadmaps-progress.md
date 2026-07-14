# Roadmap Progress

> Auto-generated — do not edit. Regenerate with `task roadmap-progress` or by running the `update_roadmap_progress` script for your install; rewritten on every roadmap create / execute / completion change (timestamp lives in git history).
>
> 1 open roadmap · 2 parked in [later/](roadmaps/later/) · [roadmaps/](roadmaps/) · [archive/](roadmaps/archive/)

## Overall

**24 / 24 open-roadmap steps done · 100%**

```text
████████████████████████████████████████   100%
```

## ⚠️ Iron Law 3 — unresolved deferred items

These roadmaps have `count_open == 0` but carry `[~]` deferred items. Per `roadmap-progress-sync` Iron Law 3 they do NOT auto-archive — the user must resolve the deferrals first (spawn follow-up, restore, or cancel). See [`roadmap-management § 4b`](../packages/core/.agent-src.uncondensed/skills/roadmap-management/SKILL.md).

| Roadmap | Done | Deferred | Cancelled |
|---|---:|---:|---:|
| [road-to-session-handoff.md](roadmaps/road-to-session-handoff.md) | 24 | 5 | 0 |

## Open roadmaps

| # | Roadmap | Phases | Steps | Open | Done | Deferred | Cancelled | Blocker | Progress |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | [road-to-session-handoff.md](roadmaps/road-to-session-handoff.md) | 6 | 29 | 0 | 24 | 5 | 0 | 0 | ██████████ 100% |

## Parked — [later/](roadmaps/later/)

Blocked-for-later: open work complete, remaining items gated on external triggers. Excluded from the open-roadmap totals above.

| Roadmap | Done | Deferred | Reason parked |
|---|---:|---:|---|
| [road-to-agent-switch-gui-service.md](roadmaps/later/road-to-agent-switch-gui-service.md) | 21 | 12 | Cross-platform tray/packaging (Windows/Linux) + GUI polish |
| [road-to-multi-provider-and-provider-settings.md](roadmaps/later/road-to-multi-provider-and-provider-settings.md) | 14 | 9 | Optional providers (Copilot, Cursor, Windsurf) — off by default |

---

## Per-roadmap phase breakdown

### [road-to-session-handoff.md](roadmaps/road-to-session-handoff.md)

**Session handoff between profiles (`sessions` + `takeover`)** — 24 / 24 done (100%)

| # | Phase | State | Open | Done | Deferred | Cancelled | % |
|---|---|---|---:|---:|---:|---:|---:|
| 0 | Verification spikes (falsification gates) | ✅ done | 0 | 2 | 3 | 0 | 100% |
| 1 | `agent-switch sessions` — inventory + `--json` | ✅ done | 0 | 7 | 0 | 0 | 100% |
| 2 | `agent-switch takeover` — per-session transfer (M2/M3) | ✅ done | 0 | 9 | 0 | 0 | 100% |
| 3 | `run --tmux` + in-place handoff (M4, POSIX, opt-in) | ✅ done | 0 | 3 | 0 | 0 | 100% |
| 4 | GUI — profile → session list → one-click takeover | ✅ done | 0 | 3 | 0 | 0 | 100% |
| 5 | Codex parity — per the G0.3 outcome | ⏸️ deferred | 0 | 0 | 2 | 0 | 0% |
