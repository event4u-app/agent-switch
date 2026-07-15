# Roadmap Progress

> Auto-generated — do not edit. Regenerate with `task roadmap-progress` or by running the `update_roadmap_progress` script for your install; rewritten on every roadmap create / execute / completion change (timestamp lives in git history).
>
> 2 open roadmaps · [roadmaps/](roadmaps/) · [archive/](roadmaps/archive/) · [skipped/](roadmaps/skipped/) · [later/](roadmaps/later/)

## Overall

**72 / 72 steps done · 100%**

```text
████████████████████████████████████████   100%
```

## ⚠️ Iron Law 3 — unresolved deferred items

These roadmaps have `count_open == 0` but carry `[~]` deferred items. Per `roadmap-progress-sync` Iron Law 3 they do NOT auto-archive — the user must resolve the deferrals first (spawn follow-up, restore, or cancel). See [`roadmap-management § 4b`](../packages/core/.agent-src.uncondensed/skills/roadmap-management/SKILL.md).

| Roadmap | Done | Deferred | Cancelled |
|---|---:|---:|---:|
| [road-to-agent-switch-session-telemetry.md](roadmaps/road-to-agent-switch-session-telemetry.md) | 44 | 3 | 0 |
| [road-to-session-handoff.md](roadmaps/road-to-session-handoff.md) | 28 | 1 | 0 |

## Open roadmaps

| # | Roadmap | Phases | Steps | Open | Done | Deferred | Cancelled | Blocker | Progress |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | [road-to-agent-switch-session-telemetry.md](roadmaps/road-to-agent-switch-session-telemetry.md) | 9 | 47 | 0 | 44 | 3 | 0 | 0 | ██████████ 100% |
| 2 | [road-to-session-handoff.md](roadmaps/road-to-session-handoff.md) | 6 | 29 | 0 | 28 | 1 | 0 | 0 | ██████████ 100% |

---

## Per-roadmap phase breakdown

### [road-to-agent-switch-session-telemetry.md](roadmaps/road-to-agent-switch-session-telemetry.md)

**Session telemetry — context monitor + token/cost tracking** — 44 / 44 done (100%)

| # | Phase | State | Open | Done | Deferred | Cancelled | % |
|---|---|---|---:|---:|---:|---:|---:|
| 0 | Contract verification spikes (falsification gates) | ✅ done | 0 | 7 | 0 | 0 | 100% |
| 1 | telemetry adapter — the single sanctioned transcript reader | ✅ done | 0 | 8 | 0 | 0 | 100% |
| 2 | CLI surface — see it | ✅ done | 0 | 3 | 0 | 0 | 100% |
| 2.5 | hooks — lifecycle push channel (moved from Phase 7, council #2) | ✅ done | 0 | 5 | 0 | 0 | 100% |
| 3 | daemon — get warned | ✅ done | 0 | 7 | 0 | 0 | 100% |
| 4 | actions — one keypress, owned terminals only | ✅ done | 0 | 4 | 0 | 0 | 100% |
| 5 | tokens + cost — ccusage-delegated (council D2) | ✅ done | 0 | 6 | 0 | 0 | 100% |
| 6 | GUI — surfaces | ✅ done | 0 | 4 | 0 | 0 | 100% |
| 7 | (deferred): nice-to-haves | ⏭️ skipped | 0 | 0 | 3 | 0 | 0% |

### [road-to-session-handoff.md](roadmaps/road-to-session-handoff.md)

**Session handoff between profiles (`sessions` + `takeover`)** — 28 / 28 done (100%)

| # | Phase | State | Open | Done | Deferred | Cancelled | % |
|---|---|---|---:|---:|---:|---:|---:|
| 0 | Verification spikes (falsification gates) | ✅ done | 0 | 5 | 0 | 0 | 100% |
| 1 | `agent-switch sessions` — inventory + `--json` | ✅ done | 0 | 7 | 0 | 0 | 100% |
| 2 | `agent-switch takeover` — per-session transfer (M2/M3) | ✅ done | 0 | 9 | 0 | 0 | 100% |
| 3 | `run --tmux` + in-place handoff (M4, POSIX, opt-in) | ✅ done | 0 | 3 | 0 | 0 | 100% |
| 4 | GUI — profile → session list → one-click takeover | ✅ done | 0 | 3 | 0 | 0 | 100% |
| 5 | Codex parity — per the G0.3 outcome | ✅ done | 0 | 1 | 1 | 0 | 100% |

