# Roadmap Progress

> Auto-generated — do not edit. Regenerate with `task roadmap-progress` or by running the `update_roadmap_progress` script for your install; rewritten on every roadmap create / execute / completion change (timestamp lives in git history).
>
> 3 open roadmaps · [roadmaps/](roadmaps/) · [archive/](roadmaps/archive/) · [skipped/](roadmaps/skipped/) · [later/](roadmaps/later/)

## Overall

**53 / 64 steps done · 83%**

```text
█████████████████████████████████░░░░░░░   83%
```

## ⚠️ Iron Law 3 — unresolved deferred items

These roadmaps have `count_open == 0` but carry `[~]` deferred items. Per `roadmap-progress-sync` Iron Law 3 they do NOT auto-archive — the user must resolve the deferrals first (spawn follow-up, restore, or cancel). See [`roadmap-management § 4b`](../packages/core/.agent-src.uncondensed/skills/roadmap-management/SKILL.md).

| Roadmap | Done | Deferred | Cancelled |
|---|---:|---:|---:|
| [road-to-agent-switch-gui-service.md](roadmaps/road-to-agent-switch-gui-service.md) | 21 | 12 | 0 |
| [road-to-multi-provider-and-provider-settings.md](roadmaps/road-to-multi-provider-and-provider-settings.md) | 14 | 9 | 0 |

## Open roadmaps

| # | Roadmap | Phases | Steps | Open | Done | Deferred | Cancelled | Blocker | Progress |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | [road-to-agent-switch-gui-service.md](roadmaps/road-to-agent-switch-gui-service.md) | 5 | 33 | 0 | 21 | 12 | 0 | 0 | ██████████ 100% |
| 2 | [road-to-multi-provider-and-provider-settings.md](roadmaps/road-to-multi-provider-and-provider-settings.md) | 6 | 23 | 0 | 14 | 9 | 0 | 0 | ██████████ 100% |
| 3 | [road-to-session-handoff.md](roadmaps/road-to-session-handoff.md) | 6 | 29 | 11 | 18 | 0 | 0 | 0 | ██████░░░░ 62% |

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

### [road-to-multi-provider-and-provider-settings.md](roadmaps/road-to-multi-provider-and-provider-settings.md)

**Multi-provider expansion + Providers settings tab + auto-switch default-off** — 14 / 14 done (100%)

| # | Phase | State | Open | Done | Deferred | Cancelled | % |
|---|---|---|---:|---:|---:|---:|---:|
| 1 | Provider + surface enable/disable (CLI-backed) | ✅ done | 0 | 3 | 0 | 0 | 100% |
| 2 | GUI Providers settings tab | ✅ done | 0 | 6 | 0 | 0 | 100% |
| 3 | Auto-switch — global default OFF, no ToS warning, signal-gated | ✅ done | 0 | 4 | 0 | 0 | 100% |
| 4 | GitHub Copilot CLI provider (profile-switch only) | ⏭️ skipped | 0 | 0 | 4 | 0 | 0% |
| 5 | Cursor + Windsurf (apps layer, profile isolation) | ⏭️ skipped | 0 | 0 | 3 | 0 | 0% |
| 6 | Docs | ✅ done | 0 | 1 | 2 | 0 | 100% |

### [road-to-session-handoff.md](roadmaps/road-to-session-handoff.md)

**Session handoff between profiles (`sessions` + `takeover`)** — 18 / 29 done (62%)

| # | Phase | State | Open | Done | Deferred | Cancelled | % |
|---|---|---|---:|---:|---:|---:|---:|
| 0 | Verification spikes (falsification gates) | 🟡 in progress | 3 | 2 | 0 | 0 | 40% |
| 1 | `agent-switch sessions` — inventory + `--json` | ✅ done | 0 | 7 | 0 | 0 | 100% |
| 2 | `agent-switch takeover` — per-session transfer (M2/M3) | ✅ done | 0 | 9 | 0 | 0 | 100% |
| 3 | `run --tmux` + in-place handoff (M4, POSIX, opt-in) | ⬜ not started | 3 | 0 | 0 | 0 | 0% |
| 4 | GUI — profile → session list → one-click takeover | ⬜ not started | 3 | 0 | 0 | 0 | 0% |
| 5 | Codex parity — per the G0.3 outcome | ⬜ not started | 2 | 0 | 0 | 0 | 0% |

