---
complexity: large
status: planned
---

# Roadmap: session orchestration (needs real machines, providers and time)

> **Owner question (/roadmap:triage-parked, 2026-11-07):** the pull trigger fired (`archive/road-to-honest-foundations.md` exists) and the parking reason (live logins, multi-OS, soak) is false for 11 of the 29 open steps: P2.2, P2.3, P2.4 (ask-me), P4.8 (warn part), P5.3 (quiet hours), P6.2, P6.3, P6.4, P6.5 (shapes), P6.6 (local fixtures), P6.8 are local code/docs/tests. Four steps conflict with a recorded choice: P2.5 (pool placement — `src/balance.ts` already places by need), P5.4 (MCP sharing vs `src/share.ts:173-188` never-shared), P6.1 (team seats — needs a team credential), P4.7 (IDE scope undefined). P3.2 found a live defect: `login` writes the profile before the GUI's wrong-account check (`src/commands/profiles.ts:205-224`), so a wrong account IS saved.
> Candidates: (1) split — the local set into an active roadmap, the rest re-parked with per-phase entry conditions; (2) promote this whole file as `draft`; (3) leave parked.
> **Decided 2026-11-07 (owner, option 1):** the local set and the P3.2 defect moved to [`road-to-the-ready-remainders.md`](../road-to-the-ready-remainders.md) (phases 1–3, 6); each source step carries a `moved-to:` pointer. Still open here for the owner: P2.5, P5.4, P6.1, P4.7. P2.5 decided 2026-11-08 (pool variant confirmed, narrowed — see the step); P5.4 cancelled by the owner 2026-11-08; P6.1 moved to ready-remainders 3.8 (2026-11-08); P4.7 moved to later/road-to-open-in-with-the-right-account.md (2026-11-08). No owner question left open here.

> **Source:** `agents/tmp.old/inbox-2026-10-a/` — v14 releases R0–R5 and the AUTH /
> RB / PL work packages, the Claude-line proposal, the transcript. Parked in `later/`
> because every item here needs real multi-OS runs, live provider logins or a soak
> window that a single session cannot provide honestly.
>
> **Arrivals:** 4 — latest `inbox-2026-10-d` (2026-10-31, switchboard comparison:
> pause instead of abort → Phase 1; detection and display of the native wait moved to
> `road-to-signals-the-host-already-sends` Phase 3); earlier: `inbox-2026-10-c`,
> `inbox-2026-10-b`, `inbox-2026-10-a`.
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
- [ ] Start admission: profile, guard or usage can change between `dir --guard` and the <!-- moved-to: road-to-the-ready-remainders.md 2.1 (2026-11-07) -->
      spawn — fail on a changed identity, or state that routing is advisory.
- [ ] Repo / org bindings (`git remote` match) next to folder bindings; first match wins. <!-- moved-to: road-to-the-ready-remainders.md 2.2 (2026-11-07) -->
- [ ] "Ask me" and "default account" policies for unbound starts; plain `claude` <!-- moved-to: road-to-the-ready-remainders.md 2.3 (2026-11-07) -->
      profile resolution documented end to end (v5 AS-018).
- [x] Owner decision recorded: placement by remaining capacity across private
      subscriptions inside an explicit pool (transcript turn 5) vs v14's ban
      (v14 §0.10, §6) — the redesign implements the pool variant; confirm or narrow. <!-- shipped: owner decision 2026-11-08, recorded in archive/road-to-agent-switch-autoswitch-rejected.md — pool variant confirmed, narrowed: placement by remaining capacity for starts and pools is allowed (src/balance.ts:1-14), only a switch without user interaction stays forbidden -->

## Phase 3 — Sign-in lifecycle

- [x] Keep dormant profiles fresh (D37) via the provider's own tool, singleflight per <!-- shipped: src/token-freshen.ts:179, src/login-keepalive.ts:1-19,278; archive/road-to-keep-signed-in-codex-antigravity.md (triage 2026-11-07) -->
      store, persisted cooldown, never during a running session of that account.
- [ ] Reauth wizard with identity verification (wrong account → nothing saved). <!-- moved-to: road-to-the-ready-remainders.md 1.1–1.2 (2026-11-07) -->
- [ ] Codex credential backends (file/keyring/auto/ephemeral); 90-day simulation.

## Phase 4 — Surfaces and providers

- [ ] Antigravity stop-the-line: the macOS keychain password (D34) moved to
      `road-to-the-rows-where-others-lead.md` step 0.3; Linux/Windows isolation
      spikes before any credential-changing `add`/`run` stay here.
- [x] Claude Desktop extra instance without `CLAUDE_CONFIG_DIR` (D21); Desktop chat vs <!-- shipped: src/apps.ts:46-58 user-data-dir strategy; src/desktop-sessions.ts:14-17; archive/road-to-claude-desktop.md (triage 2026-11-07) -->
      code identity.
- [x] Opt-in managed launchers with undo — macOS: `launcher add|remove|list|repair`,
      a switch per app × account in Tools › Apps; `open` focuses a running instance.
- [ ] Windows launchers: blocked while Claude Desktop ships as MSIX — its packaged exe
      cannot be started with its own arguments, and the community workaround needs
      admin rights plus a portable copy per update. Revisit on a supported launch path.
- [ ] Moving Desktop Code / Cowork sessions between accounts: they are local
      (`claude-code-sessions/`, `local-agent-mode-sessions/`) but filed per account id;
      needs a two-account spike before any copy. Chats, Projects and memory are
      server-side and cannot move.
- [ ] Gemini: re-check the Google-login availability claimed shut down (proposal,
      18.06.2026) before any adapter; until then "Planned".
- [ ] IDE surfaces (VS Code / JetBrains / Antigravity extensions) only after tests. <!-- moved-to: later/road-to-open-in-with-the-right-account.md (2026-11-08, owner: plan it for later instead of cancelling) -->
- [ ] Live rebind per-session isolation: today a rebind switches the whole profile <!-- moved-to: road-to-the-ready-remainders.md 3.3 (warn part) (2026-11-07) -->
      store, so every session of that profile follows — warn, then isolate or refuse.

## Phase 5 — Polish carried from earlier revisions

- [ ] Claude sporadic reset assistant (transcript turn 26, v14 R5-01): today the app
      opens claude.ai for the account ("Check at Claude"); a verified-offer readout,
      once a documented source exists, with consent and never counted as capacity.
- [-] German/English localisation of the GUI — moved to `road-to-the-rows-where-others-lead.md` Phase 5.
- [ ] Quiet hours for notifications; KPIs from v6 measured against real tasks. <!-- moved-to: road-to-the-ready-remainders.md 3.5 (quiet hours; KPIs stay here) (2026-11-07) -->
- [-] Per-profile GitHub/MCP sharing matrix. <!-- cancelled by the owner 2026-11-08: MCP, login and credential settings are account-scoped and never shared (src/share.ts:173-188); that invariant stays the line -->

## Phase 6 — Release hardening carried from the PR #102 review

> From `inbox-2026-10-b`; the executable part went to `road-to-a-start-the-user-can-predict.md`.

- [ ] Team / Enterprise seats are never balanced: needs the plan from the stored
      credential's metadata (not read by any probe so far — unverified); unknown
      plan counts as not balanceable. <!-- moved-to: road-to-the-ready-remainders.md 3.8 (2026-11-08, owner: allowlist pro/max) -->
- [ ] Eligibility before scoring across orgs (same email in two orgs) and a <!-- moved-to: road-to-the-ready-remainders.md 3.1 (2026-11-07) -->
      conservative capacity score where the reset time is unknown (`src/balance.ts`
      assumes 7 days).
- [ ] Desktop sessions: `live` is a transcript touched in the last 2 minutes <!-- moved-to: road-to-the-ready-remainders.md 3.2 (2026-11-07) -->
      (`src/desktop-sessions.ts` `DESKTOP_LIVE_MS`) — label it "recently active"
      unless a process proves it.
- [ ] `gui/src/redesign/PARITY.md` as executable journeys; a11y/axe and screenshot <!-- moved-to: road-to-the-ready-remainders.md 6.1 (2026-11-07) -->
      baselines; tray and main window read one timestamped cache.
- [ ] Autostart on macOS/Windows/Linux login, upgrade and OS denial; versioned, <!-- moved-to: road-to-the-ready-remainders.md 6.2 (shapes; autostart stays here) (2026-11-07) -->
      scrubbed shapes for `doctor`, `auth-status` and `activity` (fake-token tests).
- [ ] Upgrade fixtures from 2.1.0 (labels, alerts, protection, guard, history, <!-- moved-to: road-to-the-ready-remainders.md 6.3 (fixtures; per-OS smoke + threat review stay here) (2026-11-07) -->
      bindings, pet flag); desktop/security smoke per OS; a final threat review of
      tray IPC, process spawning and shell integration.
- [ ] Lock crash tests on real macOS/Linux/Windows: abrupt exit, orphan and stale lock,
      permission denied (`withFileLockSync`).
- [ ] The reason for a pick on every surface — tray and project bindings too, not only <!-- moved-to: road-to-the-ready-remainders.md 2.4 (2026-11-07) -->
      `dir --json` and the start dialog.
