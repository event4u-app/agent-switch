# Roadmap Progress

> Auto-generated — do not edit. Regenerate with `task roadmap-progress` or by running the `update_roadmap_progress` script for your install; rewritten on every roadmap create / execute / completion change (timestamp lives in git history).
>
> 2 open roadmaps · [roadmaps/](roadmaps/) · [archive/](roadmaps/archive/) · [skipped/](roadmaps/skipped/) · [later/](roadmaps/later/)

## Overall

**38 / 38 steps done · 100%**

```text
████████████████████████████████████████   100%
```

## ⚠️ Iron Law 3 — unresolved deferred items

These roadmaps have `count_open == 0` but carry `[~]` deferred items. Per `roadmap-progress-sync` Iron Law 3 they do NOT auto-archive — the user must resolve the deferrals first (spawn follow-up, restore, or cancel). See [`roadmap-management § 4b`](../packages/core/.agent-src.uncondensed/skills/roadmap-management/SKILL.md).

| Roadmap | Done | Deferred | Cancelled |
|---|---:|---:|---:|
| [road-to-agent-switch-gui-service.md](roadmaps/road-to-agent-switch-gui-service.md) | 21 | 12 | 0 |

## ✅ Completed — pending archival

These roadmaps are **complete** (`count_open == 0`, `count_deferred == 0`) but still sit in the active tree. They should be in `agents/roadmaps/archive/`. Run the archival sweep `archive_completed_roadmaps --all` (untracked-safe), or follow the manual fallback documented in the `roadmap-management` skill, then regenerate this dashboard.

| Roadmap | Done | Total |
|---|---:|---:|
| [road-to-agent-switch-review-round-2.md](roadmaps/road-to-agent-switch-review-round-2.md) | 17 | 17 |

## Open roadmaps

| # | Roadmap | Phases | Steps | Open | Done | Deferred | Cancelled | Blocker | Progress |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | [road-to-agent-switch-gui-service.md](roadmaps/road-to-agent-switch-gui-service.md) | 5 | 33 | 0 | 21 | 12 | 0 | 0 | ██████████ 100% |
| 2 | [road-to-agent-switch-review-round-2.md](roadmaps/road-to-agent-switch-review-round-2.md) | 4 | 17 | 0 | 17 | 0 | 0 | 0 | ██████████ 100% |

---

## Per-roadmap phase breakdown

### [road-to-agent-switch-gui-service.md](roadmaps/road-to-agent-switch-gui-service.md)

**agent-switch usage engine + background service + tray GUI** — 21 / 21 done (100%)

| # | Phase | State | Open | Done | Deferred | Cancelled | % |
|---|---|---|---:|---:|---:|---:|---:|
| 1 | Usage engine (policy-scoped) | ✅ done | 0 | 6 | 0 | 0 | 100% |
| 2 | Background service | ✅ done | 0 | 7 | 0 | 0 | 100% |
| 3 | GUI/tray app foundation (separate package) | ✅ done | 0 | 2 | 3 | 0 | 100% |
| 4 | React UI | ✅ done | 0 | 2 | 4 | 0 | 100% |
| 5 | Packaging, docs, CI | ✅ done | 0 | 4 | 5 | 0 | 100% |

### [road-to-agent-switch-review-round-2.md](roadmaps/road-to-agent-switch-review-round-2.md)

**agent-switch review round-2 fixes (argv blocker, migration, CLI tests, hardening)** — 17 / 17 done (100%)

| # | Phase | State | Open | Done | Deferred | Cancelled | % |
|---|---|---|---:|---:|---:|---:|---:|
| 1 | Argv parser — fix the destructive value-leak (F1) | ✅ done | 0 | 2 | 0 | 0 | 100% |
| 2 | Migration credential freshness (F2) | ✅ done | 0 | 2 | 0 | 0 | 100% |
| 3 | CLI-layer test strategy (F3) | ✅ done | 0 | 2 | 0 | 0 | 100% |
| 4 | Hardening minors (a–f) | ✅ done | 0 | 11 | 0 | 0 | 100% |

