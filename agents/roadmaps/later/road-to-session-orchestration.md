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
- [ ] Start admission: profile, guard or usage can change between `dir --guard` and the
      spawn — fail on a changed identity, or state that routing is advisory.
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

## Phase 6 — Release hardening carried from the PR #102 review

> From `inbox-2026-10-b`; the executable part went to `road-to-a-start-the-user-can-predict.md`.

- [ ] Team / Enterprise seats are never balanced: needs the plan from the stored
      credential's metadata (not read by any probe so far — unverified); unknown
      plan counts as not balanceable.
- [ ] Eligibility before scoring across orgs (same email in two orgs) and a
      conservative capacity score where the reset time is unknown (`src/balance.ts`
      assumes 7 days).
- [ ] Desktop sessions: `live` is a transcript touched in the last 2 minutes
      (`src/desktop-sessions.ts` `DESKTOP_LIVE_MS`) — label it "recently active"
      unless a process proves it.
- [ ] `gui/src/redesign/PARITY.md` as executable journeys; a11y/axe and screenshot
      baselines; tray and main window read one timestamped cache.
- [ ] Autostart on macOS/Windows/Linux login, upgrade and OS denial; versioned,
      scrubbed shapes for `doctor`, `auth-status` and `activity` (fake-token tests).
- [ ] Upgrade fixtures from 2.1.0 (labels, alerts, protection, guard, history,
      bindings, pet flag); desktop/security smoke per OS; a final threat review of
      tray IPC, process spawning and shell integration.
- [ ] Lock crash tests on real macOS/Linux/Windows: abrupt exit, orphan and stale lock,
      permission denied (`withFileLockSync`).
- [ ] The reason for a pick on every surface — tray and project bindings too, not only
      `dir --json` and the start dialog.
