# Roadmap Progress

> Auto-generated — do not edit. Regenerate with `task roadmap-progress` or by running the `update_roadmap_progress` script for your install; rewritten on every roadmap create / execute / completion change (timestamp lives in git history).
>
> 3 open roadmaps · [roadmaps/](roadmaps/) · [archive/](roadmaps/archive/) · [skipped/](roadmaps/skipped/) · [later/](roadmaps/later/) · **2** open blockers

## Overall

**0 / 76 steps done · 0%**

```text
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   0%
```

## Open roadmaps

| # | Roadmap | Phases | Steps | Open | Done | Deferred | Cancelled | Blocker | Progress |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | [road-to-agent-switch-cross-platform.md](roadmaps/road-to-agent-switch-cross-platform.md) | 4 | 26 | 26 | 0 | 0 | 0 | [1](#blockers-road-to-agent-switch-cross-platform) | ░░░░░░░░░░ 0% |
| 2 | [road-to-agent-switch-gui-service.md](roadmaps/road-to-agent-switch-gui-service.md) | 5 | 33 | 33 | 0 | 0 | 0 | [1](#blockers-road-to-agent-switch-gui-service) | ░░░░░░░░░░ 0% |
| 3 | [road-to-agent-switch-multi-provider.md](roadmaps/road-to-agent-switch-multi-provider.md) | 3 | 17 | 17 | 0 | 0 | 0 | 0 | ░░░░░░░░░░ 0% |

---

## Per-roadmap phase breakdown

### [road-to-agent-switch-cross-platform.md](roadmaps/road-to-agent-switch-cross-platform.md)

**agent-switch cross-platform foundation (macOS / Linux / Windows)** — 0 / 26 done (0%)

| # | Phase | State | Open | Done | Deferred | Cancelled | % |
|---|---|---|---:|---:|---:|---:|---:|
| 1 | Contract verification per OS | ⬜ not started | 8 | 0 | 0 | 0 | 0% |
| 2 | Platform abstraction layer | ⬜ not started | 6 | 0 | 0 | 0 | 0% |
| 3 | Shell integration + install + doctor | ⬜ not started | 5 | 0 | 0 | 0 | 0% |
| 4 | CI + release readiness | ⬜ not started | 7 | 0 | 0 | 0 | 0% |

<a id="blockers-road-to-agent-switch-cross-platform"></a>
**Blockers**

- **repo-hosting** (owner: user) — blocks Phase 4 — CI + release readiness
  - **What to do:**
    1. Decide hosting (GitHub private/public, org vs personal) and initialize the
    git repo + remote.
    2. Tell the agent the remote so the CI workflow lands in the right place.
  - **Resolved when:** `git remote -v` shows a pushable remote with Actions available.

### [road-to-agent-switch-gui-service.md](roadmaps/road-to-agent-switch-gui-service.md)

**agent-switch usage engine + background service + tray GUI** — 0 / 33 done (0%)

| # | Phase | State | Open | Done | Deferred | Cancelled | % |
|---|---|---|---:|---:|---:|---:|---:|
| 1 | Usage engine (policy-scoped) | ⬜ not started | 6 | 0 | 0 | 0 | 0% |
| 2 | Background service | ⬜ not started | 7 | 0 | 0 | 0 | 0% |
| 3 | GUI/tray app foundation (separate package) | ⬜ not started | 5 | 0 | 0 | 0 | 0% |
| 4 | React UI | ⬜ not started | 6 | 0 | 0 | 0 | 0% |
| 5 | Packaging, docs, CI | ⬜ not started | 9 | 0 | 0 | 0 | 0% |

<a id="blockers-road-to-agent-switch-gui-service"></a>
**Blockers**

- **repo-hosting** (owner: user) — blocks Phase 5 — Packaging, docs, CI
  - **What to do:**
    1. Initialize the git repo + remote (see the cross-platform roadmap's
    matching blocker).
  - **Resolved when:** `git remote -v` shows a pushable remote with Actions.

_1 blocker resolved._

### [road-to-agent-switch-multi-provider.md](roadmaps/road-to-agent-switch-multi-provider.md)

**agent-switch multi-provider (Claude Code + Codex + Gemini)** — 0 / 17 done (0%)

| # | Phase | State | Open | Done | Deferred | Cancelled | % |
|---|---|---|---:|---:|---:|---:|---:|
| 1 | Provider abstraction | ⬜ not started | 4 | 0 | 0 | 0 | 0% |
| 2 | Commands across providers | ⬜ not started | 4 | 0 | 0 | 0 | 0% |
| 3 | Shell integration for all three binaries | ⬜ not started | 9 | 0 | 0 | 0 | 0% |

