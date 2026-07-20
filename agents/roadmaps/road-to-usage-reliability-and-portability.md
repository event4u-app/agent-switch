---
complexity: standard
status: in-progress
---

# Roadmap: usage-reliability + portability adoptions (claude-swap comparison)

> Adoptions from the claude-swap comparison that have **nothing to do with
> rotation** — usage-signal quality, daemon reliability, credential health, and
> portability. Same spirit as `ADOPTED.md`: adopt the substance, diverge where
> our architecture differs.

## Out of scope (hard boundary)

**Rotation-engine expansion is NOT part of this roadmap** — configurable
threshold tuning, cooldown, hysteresis, unhealthyTicks, best/next-available
strategies, and per-model quota folding (`--model` to switch off an account
whose model quota is spent). That is the pooling-subscriptions-to-route-around-
rate-limits mechanism a unanimous review found crosses the providers' usage
policies (see `skipped/road-to-agent-switch-autoswitch-rejected.md` and the
1.0.1 disclosure work). It is deliberately not built here.

## Already shipped (1.0.1, do not re-plan)

- **Weekly-pace indicator** — `windowPace()` + GUI badge (informational, measured
  against `capturedAt`). Landed in the 1.0.1 review follow-up.
- **Share token-guard** — test locking `.claude.json` / `.credentials.json` out
  of `SHARED_ITEMS`. Landed in the same follow-up (the guard half of item 5).

## Phase 1 — Daemon poll discipline + fail-safe

Their adaptive polling is good API citizenship regardless of purpose; our daemon
polls more simply today.

- [x] Fail-safe on a usage-check error: keep the last-known-good snapshot
  (already retained — the failure branch never overwrites `state.profiles[key]`)
  and warn **once per outage** instead of every cycle, with a recovery log when
  the fetch succeeds again. Exponential backoff already exists (`nextIntervalMs`).
- [-] Adaptive "skip exhausted-until-reset" poll cadence — **not built (boundary).**
  The normal (non-`watchAll`) path already polls only the active + live-session
  profiles (flat traffic). The remaining skip-exhausted optimization only applies
  in `watchAll` mode, which is enabled **only when auto-switch is on** — i.e. it
  would optimize the rotation engine's candidate polling. That is the pooling
  mechanism outside this roadmap's scope, so it is deliberately not built.

Security: none (own-account, informational).

## Phase 2 — Dead-login / dead-token detection + surfacing

Our live profiles never go stale (CLAUDE_CONFIG_DIR isolation), but an expired
login still happens; today it fails silently per access.

- [x] Detect a dead/expired login read-only: `checkAuth()` in `src/api.ts`
  (probes the profile endpoint, never writes/refreshes a token) + a pure,
  tested `classifyAuthStatus()` (401/403 = expired; offline/other = unknown,
  never misreported as expired).
- [x] Surface it in `status` (precise "login expired — /login again" instead of
  the old vague message, only on the failure path) and `doctor` (parallel,
  graceful probe — offline degrades to a neutral note, never a false WARN).
- [~] GUI + `list` surfacing — **deferred.** `list` is a fast local listing and
  the GUI reads the daemon snapshot; both need a `loginState` plumbed through
  `DaemonState` → status JSON → `ProfileRow`, a wider ripple best done on its own.

Security: low (read-only credential-validity check; no token movement).

## Phase 3 — MCP-OAuth allowlist scoping for `share`

Builds on the 1.0.1 guard (which keeps the token-bearing files unshared). The
residual gap: `settings.json` is shared as a whole-file symlink with no per-key
allowlist — if a Claude Code version writes `mcpServers`/token material into it,
that would propagate across profiles.

- [x] Content guard in `src/share.ts` (`settingsSharingRisk`): before linking
  `settings.json` (in `applySharing`) or pushing a forked edit back (in
  `syncSharing`), inspect it and **skip** with a message if it carries
  `mcpServers` or token-/secret-shaped keys. Keeps the whole-file-symlink model
  untouched — closes the leak without the risky merge rewrite.
- [x] Tests: `settingsSharingRisk` flags `mcpServers`/token keys and passes
  clean settings (malformed JSON not blocked); `applySharing` skips a
  settings.json carrying `mcpServers` and links a clean one.

Security: yes (latent cross-profile leak) — now guarded.

## Phase 4 — Cross-machine transfer export/import — SECURITY-GATED

Concretely useful for one user with several accounts across machines. This is
the same item deferred in the 1.0.1 roadmap; consolidated here.

- [ ] **Threat-model first** (`security-sensitive-stop`) before any code.
- [ ] Default export = config-only (reuse the `SHARED_ITEMS` allowlist as the
  complement of the secret set); **strips** machine-bound state — the path-hashed
  macOS Keychain entry (`src/keychain.ts` `serviceNameFor`) and device/MCP-OAuth
  state are never exported.
- [ ] `--full` opt-in only, and never writes credentials for the user —
  encryption is left to the user (`| gpg -c`), matching the matured reference
  design. Default export must exclude `.credentials.json`.
- [ ] Tests: default export contains no credential/keychain material; `--full`
  is refused without the explicit flag; round-trip import lands config only.

Security: YES — `--full` bundles live OAuth refresh/access tokens (account-
takeover vector). Not an autonomous build. Feasibility: hard.

## Phase 5 — CLI-first text dashboard (TUI)

Their ~1.8k-LOC text dashboard runs on all three OSes for users without a GUI
install; our Tauri app is more capable but heavier to install.

- [~] A read-only text dashboard over the existing `status` / `list` / usage
  data (per-profile identity, usage bars, pace, live sessions), no new profile
  logic — a client of the CLI like the GUI is.
- [~] Decide the surface: a Node TUI (e.g. Ink) vs. an enriched `status --watch`.
  Record the choice as a short ADR.

**Deferred:** a TUI framework (Ink) is a new dependency + a new surface — a
design decision (`scope-control`: no new libraries without explicit sign-off).
Needs the surface choice (framework vs. no-dep `status --watch`) made first.
Security: none. Feasibility: medium-hard (new surface).

## Notes

- Optional companion: an `ADOPTED.md` analysis for Phases 1-3 + 5 in the existing
  format (source-cited, with the divergence rationale per phase). Offered by the
  review; do on request.
