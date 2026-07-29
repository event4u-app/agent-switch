---
complexity: standard
status: planned
---

# Roadmap: consolidated deferred follow-ups

> One home for the still-wanted `[~]` deferrals carried out of six roadmaps that
> completed and were archived on 2026-07-29 (desktop-pet, live-rebind,
> ac-embedded-settings, agent-setup-hub, 1.0.1-review-followup,
> usage-reliability-and-portability). Pure v2/later ideas (pet marketplace /
> multi-pet / pet MCP surface / Rust pet-watcher; a read-only usage TUI /
> dashboard; GUI `list` surfacing) were **not** carried here — they stay
> documented in the archived files and are revisited by un-archiving. This
> roadmap holds only the deferrals that are genuinely wanted, grouped by what
> unblocks them.

## Provenance

Each step names the archived roadmap it came from. Nothing here is new scope —
it is the parked-but-wanted tail of already-shipped work, consolidated so it
stays visible and tracked instead of being buried in an archive.

## Phase 1 — macOS-doable now (no external blocker)

- [-] **Config-only export + opt-in `--full`** (from `road-to-1.0.1-review-followup`).
      Config-only export reuses the `share.ts` allowlist; the `--full` variant
      bundles live OAuth refresh/access tokens, so it needs its own
      threat-modelled pass with mandatory user encryption and must never export
      the path-hashed macOS Keychain entry. A leaked `--full` bundle is an
      account-takeover vector — gate accordingly.
      <!-- resolved 2026-07-29: config-only export ALREADY ships
      (src/config-transfer.ts exportConfig/importConfig, wired in index.ts).
      The `--full` half is the actual work, and the threat-modelled pass it
      called for was run via the AI council
      (agents/runtime/council/responses/full-export-decision.json) → verdict:
      KEEP `--full` REFUSED. OAuth tokens are machine-bound session state, not
      portable config; even AES-256-GCM + Argon2id can't fix the threat-model
      shift (cloud-sync / malware+keylogger / phishing / offline brute-force);
      the 30s `config import → auth login` path covers the real need; industry
      practice (aws/gh/kubectl) never exports credentials. Reversing
      assertNotFull() requires the repo OWNER's explicit sign-off, not agent
      convergence — so this is marked [-] cancelled, not built. Shipped instead:
      the FULL_REFUSAL message now points to the config-import→auth-login
      migration path, and the assertNotFull() docstring records the council
      re-affirmation. Owner may reopen as a separate audited capability. -->
- [x] **rebind config-home live auto-detection** (from `road-to-live-rebind`
      Phase 2). `--profile <p>` + active-profile default already ship; the
      deferred piece is live pid/process → config-dir auto-detection (`hooks.ts`
      only decodes config-dir → profile today; a live-process lookup is net-new).
      <!-- done 2026-07-29: pure detectRunningClaudeProfile(profiles, configDirOf,
      livePidsOf) in src/sessions.ts — a profile is "running" when its config dir
      carries a live session pid (liveSessionPids); returns single ONLY when
      exactly one profile is running (a credential write must never guess across
      ambiguity), else none/ambiguous. Wired into cmdRebind: with no --profile it
      now prefers the profile whose session is actually LIVE (rebind's whole point
      is the running session, which may differ from the active default) and prints
      a note; ambiguous/none keep the prior active-profile fallback — strictly
      non-regressing. 4 unit tests; task ci green (328). -->

## Phase 2 — cross-platform + real-machine QA (needs a non-macOS box / human eyes)

- [ ] **rebind Linux/Windows backend (R0.1)** (from `road-to-live-rebind`). The
      `.credentials.json` file backend is unproven off macOS; `rebind` must not
      ship on Linux/Windows until R0.1 (live-reload after a file swap) passes on
      a real machine there. Pairs with the CC-version canary already shipped.
- [ ] **Desktop-pet cross-platform runtime QA** (from `road-to-desktop-pet`).
      Windows (always-on-top re-assert, transparency) and Linux (compositor
      caveats) need a real windowed machine; CI already covers compile/test/
      cargo-check on those platforms.
- [ ] **Desktop-pet visual QA of pet states** (from `road-to-desktop-pet`).
      Geometric QA is automated + green (`scripts/pets/validate.py` in CI); the
      remaining human sign-off — does each pose read as a coherent character on
      the shipped `states.png` — needs eyes.
- [ ] **Desktop-pet pet-window memory reading** (from `road-to-desktop-pet`,
      council perf finding). ADR-005 carries the measurement method + an
      architecture-bounded estimate; record the live resident figure once, from a
      real WKWebView/WebKitGTK/WebView2 run.
- [ ] **AC-embedded window-lifecycle QA (S0.1)** (from
      `road-to-ac-embedded-settings`). Transport is settled (separate
      `WebviewWindow`); what remains is thin per-platform verification —
      parent-close propagates with no orphan, and positioning lands on the
      parent's monitor (Tauri `center()` targets the primary monitor).

## Phase 3 — blocked on agent-config (AC) ecosystem contracts

- [ ] **rtk detection real delegation** (from `road-to-agent-setup-hub`). The
      fallback output-signature probe ships (`src/tooling.ts probeRtkIdentity`);
      the real delegation activates only when agent-config exposes its rtk
      detection contract (AC-side rtk roadmap Phase 3). One implementation, not
      two — wire the seam when that contract lands.
- [ ] **Per-profile AC settings via config-root flag** (from
      `road-to-ac-embedded-settings`). Pass the active profile's config dir to
      the spawned AC server (documented AC-side flag/env) so per-profile AC
      settings become possible ("work profile has the strict ruleset, private
      doesn't"). Blocked on the AC-side host-supplied config-root flag
      (reciprocal-ecosystem Phase 2).
- [ ] **Share-collision guard + tests** (from `road-to-ac-embedded-settings`,
      lands with the config-root flag above). When `share on` is active for a
      path AC writes to (`settings.json`, `keybindings.json`, `CLAUDE.md`,
      `skills/`, `commands/`, `agents/` — `share.ts:37-43`), warn before a
      per-profile write that would land through the symlink and affect every
      profile; add the share-collision guard unit test (symlinked target →
      warning surfaced).

## Notes

- Phase 1 is actionable today; Phases 2–3 are gated on a real non-macOS machine
  or on agent-config-side contracts, so they may sit until those unblock. That
  is expected — this roadmap exists to keep the work visible, not to force it.
- If Phase 2/3 stay blocked long-term, move this roadmap to `agents/roadmaps/later/`
  rather than letting it read as active-but-stalled.
