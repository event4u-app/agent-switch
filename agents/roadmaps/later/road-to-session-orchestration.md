---
complexity: large
status: planned
---

# Roadmap: session orchestration (needs real machines, providers and time)

> **Source:** `agents/tmp.old/inbox-2026-10-a/` — v14 releases R0–R5 and the AUTH /
> RB / PL work packages, the Claude-line proposal, the transcript. Parked in `later/`
> because every item here needs real multi-OS runs, live provider logins or a soak
> window that a single session cannot provide honestly.
>
> Pull trigger: [`road-to-honest-foundations.md`](../archive/road-to-honest-foundations.md)
> closed (data model, readouts and defects in place).

## Phase 1 — Real session protection (pause and resume)

- [ ] Claude CLI: detect native `autoContinueAtUsageLimit`; hook-based stop at a turn
      boundary at the threshold; `-p` / detached tmux (#91535) / sleep-wake E2E.
- [ ] Codex: app-server turn gate only where documented and tested; else `unsupported`.
- [ ] Session states `pause-requested → parked → resuming` reported by the backend;
      staggered resume after a reset; "why paused?" in the session sheet.
- [ ] Journal for AS-run work items: no duplicate side effect after a crash.

## Phase 2 — Scheduling of new sessions

- [ ] Multi-session leases per profile with fencing; `openSessions` vs `modelActive`.
- [ ] Repo / org bindings (`git remote` match) next to folder bindings; first match wins.
- [ ] "Ask me" and "default account" policies for unbound starts; plain `claude`
      profile resolution documented end to end (v5 AS-018).
- [ ] Owner decision recorded: placement by remaining capacity across private
      subscriptions inside an explicit pool (transcript turn 5) vs v14's ban
      (v14 §0.10, §6) — the redesign implements the pool variant; confirm or narrow.

## Phase 3 — Sign-in lifecycle

- [ ] Keep dormant profiles fresh (D37) via the provider's own tool, singleflight per
      store, persisted cooldown, never during a running session of that account.
- [ ] Reauth wizard with identity verification (wrong account → nothing saved).
- [ ] Codex credential backends (file/keyring/auto/ephemeral); 90-day simulation.

## Phase 4 — Surfaces and providers

- [ ] Antigravity stop-the-line: macOS keychain audit (empty-password keychain, D34);
      Linux/Windows isolation spikes before any credential-changing `add`/`run`.
- [ ] Claude Desktop extra instance without `CLAUDE_CONFIG_DIR` (D21); Desktop chat vs
      code identity; opt-in managed launchers with undo.
- [ ] Gemini: re-check the Google-login availability claimed shut down (proposal,
      18.06.2026) before any adapter; until then "Planned".
- [ ] IDE surfaces (VS Code / JetBrains / Antigravity extensions) only after tests.
- [ ] Live rebind per-session isolation: today a rebind switches the whole profile
      store, so every session of that profile follows — warn, then isolate or refuse.

## Phase 5 — Polish carried from earlier revisions

- [ ] Claude sporadic reset assistant (transcript turn 26, v14 R5-01): today the app
      opens claude.ai for the account ("Check at Claude"); a verified-offer readout,
      once a documented source exists, with consent and never counted as capacity.
- [ ] German/English localisation of the GUI.
- [ ] Quiet hours for notifications; KPIs from v6 measured against real tasks.
- [ ] Per-profile GitHub/MCP sharing matrix.
