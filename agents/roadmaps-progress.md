# Roadmap Progress

> Auto-generated — do not edit. Regenerate with `task roadmap-progress` or by running the `update_roadmap_progress` script for your install; rewritten on every roadmap create / execute / completion change (timestamp lives in git history).
>
> 2 open roadmaps · [roadmaps/](roadmaps/) · [archive/](roadmaps/archive/) · [skipped/](roadmaps/skipped/) · [later/](roadmaps/later/)

## Overall

**13 / 17 steps done · 76%**

```text
██████████████████████████████░░░░░░░░░░   76%
```

## ⚠️ Iron Law 3 — unresolved deferred items

These roadmaps have `count_open == 0` but carry `[~]` deferred items. Per `roadmap-progress-sync` Iron Law 3 they do NOT auto-archive — the user must resolve the deferrals first (spawn follow-up, restore, or cancel). See [`roadmap-management § 4b`](../packages/core/.agent-src.uncondensed/skills/roadmap-management/SKILL.md).

| Roadmap | Done | Deferred | Cancelled |
|---|---:|---:|---:|
| [road-to-1.0.1-review-followup.md](roadmaps/road-to-1.0.1-review-followup.md) | 8 | 1 | 0 |

## Open roadmaps

| # | Roadmap | Phases | Steps | Open | Done | Deferred | Cancelled | Blocker | Progress |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | [road-to-1.0.1-review-followup.md](roadmaps/road-to-1.0.1-review-followup.md) | 4 | 9 | 0 | 8 | 1 | 0 | 0 | ██████████ 100% |
| 2 | [road-to-usage-reliability-and-portability.md](roadmaps/road-to-usage-reliability-and-portability.md) | 5 | 13 | 4 | 5 | 3 | 1 | 0 | ██████░░░░ 56% |

---

## Per-roadmap phase breakdown

### [road-to-1.0.1-review-followup.md](roadmaps/road-to-1.0.1-review-followup.md)

**1.0.1 — review follow-up (rotation integrity + claude-swap adoptions)** — 8 / 8 done (100%)

| # | Phase | State | Open | Done | Deferred | Cancelled | % |
|---|---|---|---:|---:|---:|---:|---:|
| 1 | Rotation integrity (feedback option 2) | ✅ done | 0 | 4 | 0 | 0 | 100% |
| 2 | Pace usage enrichment (informational, NOT a rotation signal) | ✅ done | 0 | 3 | 0 | 0 | 100% |
| 3 | MCP-OAuth share guard (latent-leak hardening) | ✅ done | 0 | 1 | 0 | 0 | 100% |
| 4 | Cross-machine transfer export — DEFERRED (security-sensitive) | ⏭️ skipped | 0 | 0 | 1 | 0 | 0% |

### [road-to-usage-reliability-and-portability.md](roadmaps/road-to-usage-reliability-and-portability.md)

**usage-reliability + portability adoptions (claude-swap comparison)** — 5 / 9 done (56%)

| # | Phase | State | Open | Done | Deferred | Cancelled | % |
|---|---|---|---:|---:|---:|---:|---:|
| 1 | Daemon poll discipline + fail-safe | ✅ done | 0 | 1 | 0 | 1 | 100% |
| 2 | Dead-login / dead-token detection + surfacing | ✅ done | 0 | 2 | 1 | 0 | 100% |
| 3 | MCP-OAuth allowlist scoping for `share` | ✅ done | 0 | 2 | 0 | 0 | 100% |
| 4 | Cross-machine transfer export/import — SECURITY-GATED | ⬜ not started | 4 | 0 | 0 | 0 | 0% |
| 5 | CLI-first text dashboard (TUI) | ⏭️ skipped | 0 | 0 | 2 | 0 | 0% |

