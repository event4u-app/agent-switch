# Roadmap Progress

> Auto-generated — do not edit. Regenerate with `task roadmap-progress` or by running the `update_roadmap_progress` script for your install; rewritten on every roadmap create / execute / completion change (timestamp lives in git history).
>
> 4 open roadmaps · [roadmaps/](roadmaps/) · [archive/](roadmaps/archive/) · [skipped/](roadmaps/skipped/) · [later/](roadmaps/later/) · **5** open blockers

## Overall

**40 / 77 steps done · 52%**

```text
█████████████████████░░░░░░░░░░░░░░░░░░░   52%
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
| 2 | [road-to-ac-embedded-settings.md](roadmaps/road-to-ac-embedded-settings.md) | 4 | 30 | 21 | 9 | 0 | 0 | [3](#blockers-road-to-ac-embedded-settings) | ███░░░░░░░ 30% |
| 3 | [road-to-agent-setup-hub.md](roadmaps/road-to-agent-setup-hub.md) | 5 | 30 | 12 | 18 | 0 | 0 | [2](#blockers-road-to-agent-setup-hub) | ██████░░░░ 60% |
| 4 | [road-to-usage-reliability-and-portability.md](roadmaps/road-to-usage-reliability-and-portability.md) | 5 | 13 | 4 | 5 | 3 | 1 | 0 | ██████░░░░ 56% |

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

### [road-to-ac-embedded-settings.md](roadmaps/road-to-ac-embedded-settings.md)

**embedded AC settings — an AS user never has to launch the agent-config GUI** — 9 / 30 done (30%)

| # | Phase | State | Open | Done | Deferred | Cancelled | % |
|---|---|---|---:|---:|---:|---:|---:|
| 0 | Falsification spikes | 🟡 in progress | 1 | 3 | 0 | 0 | 75% |
| 1 | Discovery + lifecycle (no UI yet) | 🟡 in progress | 2 | 6 | 0 | 0 | 75% |
| 2 | The embedded view | ⬜ not started | 8 | 0 | 0 | 0 | 0% |
| 3 | Profile awareness (the piece only AS can do) | ⬜ not started | 10 | 0 | 0 | 0 | 0% |

<a id="blockers-road-to-ac-embedded-settings"></a>
**Blockers**

- **ac-embed-contract** (owner: maintainer (AC side)) — blocks Phase 2 entirely
  - **What to do:**
  - **Resolved when:** an AC release exposes the embed capability and AS can detect it via the capability flag.
- **ac-profile-config-root** (owner: maintainer (AC side)) — blocks Phase 3 (profile awareness)
  - **What to do:**
  - **Resolved when:** an AC release accepts the host-supplied config root and documents the flag/env.
- **cross-platform-webview-verification** (owner: maintainer) — blocks — (was: choosing the transport per OS) - **Decision:** transport is the stable separate `WebviewWindow` on **all** platforms. Researched evidence: Tauri's child-webview API is `unstable`-gated with open bugs on every engine (tauri#10011/#10131/#10420/#11170, wry#583); `WebviewWindowBuilder` + `WebviewUrl::External` is stable and IPC-isolated by default; top-level plain-HTTP loopback is a secure context in all three engines. Council transcript: `agents/runtime/council/responses/omni-route-spikes.json` (local-only).
  - **What to do:**
  - **Resolved when:** ~~per-OS results are recorded~~ — decided; the thin residual (window-lifecycle QA per platform) lives in S0.1/Phase 2 tests, not as a blocker.

### [road-to-agent-setup-hub.md](roadmaps/road-to-agent-setup-hub.md)

**agent setup hub — AS becomes the place the whole agent stack gets set up** — 18 / 30 done (60%)

| # | Phase | State | Open | Done | Deferred | Cancelled | % |
|---|---|---|---:|---:|---:|---:|---:|
| 0 | Falsification spikes (before any UI work) | ✅ done | 0 | 3 | 0 | 0 | 100% |
| 1 | Sidebar shell (structure only, zero new features) | ✅ done | 0 | 6 | 0 | 0 | 100% |
| 2 | Retire the banner into the Ecosystem section (net-negative chrome) | ✅ done | 0 | 6 | 0 | 0 | 100% |
| 3 | Tooling section: detect → explain → fix | ⬜ not started | 6 | 0 | 0 | 0 | 0% |
| 4 | Record the non-goals (an asset, not paperwork) | 🟡 in progress | 6 | 3 | 0 | 0 | 33% |

<a id="blockers-road-to-agent-setup-hub"></a>
**Blockers**

- **unattended-install-verification** (owner: maintainer) — blocks — (was: the "run" vs. copy-command variant of install buttons in Phases 2–3) - **Decision:** the "Run" variant is **dropped entirely** — copy-command only, everywhere (see S0.3's evidence: EACCES on stock macOS/Linux, GUI PATH divergence, zero industry prior art, post-install PATH invisibility). No per-OS clean-machine verification is needed for a button that no longer exists.
  - **What to do:**
  - **Resolved when:** ~~per-OS results are recorded~~ — decided by dropping the variant.
- **adoption-signal** (owner: user) — blocks knowing whether the Ecosystem section actually converts AS users into AC users
  - **What to do:**
  - **Resolved when:** ≥1 external AS user reports (issue/discussion/direct message) having installed agent-config through the hub.

### [road-to-usage-reliability-and-portability.md](roadmaps/road-to-usage-reliability-and-portability.md)

**usage-reliability + portability adoptions (claude-swap comparison)** — 5 / 9 done (56%)

| # | Phase | State | Open | Done | Deferred | Cancelled | % |
|---|---|---|---:|---:|---:|---:|---:|
| 1 | Daemon poll discipline + fail-safe | ✅ done | 0 | 1 | 0 | 1 | 100% |
| 2 | Dead-login / dead-token detection + surfacing | ✅ done | 0 | 2 | 1 | 0 | 100% |
| 3 | MCP-OAuth allowlist scoping for `share` | ✅ done | 0 | 2 | 0 | 0 | 100% |
| 4 | Cross-machine transfer export/import — SECURITY-GATED | ⬜ not started | 4 | 0 | 0 | 0 | 0% |
| 5 | CLI-first text dashboard (TUI) | ⏭️ skipped | 0 | 0 | 2 | 0 | 0% |

