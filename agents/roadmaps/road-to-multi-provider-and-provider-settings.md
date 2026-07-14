---
complexity: standard
status: active
---

# Roadmap: Multi-provider expansion + Providers settings tab + auto-switch default-off

> Widen agent-switch beyond Claude/Codex/Gemini to the coding assistants worth
> supporting, put provider enable/disable behind a dedicated Settings tab, and
> make auto-switch globally off by default. Grounded in a 4-surface sourced
> research pass and an AI-council review (2026-07-14).

## Goal

1. A **Providers** settings tab lets the user enable/disable each provider (and
   its CLI / UI surfaces). Default enabled: **Claude (CLI + Desktop), Codex
   (CLI + UI)**; every other provider is available but **off by default**.
2. **Auto-switch is globally OFF by default** — the mechanic stays, but nothing
   auto-rotates until the user explicitly turns it on. The auto-switch toggle
   only appears for providers that have a real usage readout (Claude today).
3. New **profile-isolation** providers land: **GitHub Copilot CLI**, **Cursor**,
   **Windsurf** — profile-switch only, no auto-switch, off by default.

Auto-switch is **profile-switch's opposite in ToS terms**: profile-switch
separates contexts (legitimate); auto-switch pools accounts to route around rate
limits (ToS-adverse). This roadmap keeps the auto-switch mechanic the project
already shipped, defaults it off, and never wires it to a provider that lacks a
usage signal.

## Context — research findings (verified 2026-07-14, sourced)

Two value props drive every provider decision:
- **Profile-switch** (separate work / personal / client) — broadly legitimate,
  ToS-clean.
- **Auto-switch** (daemon moves the active account to the one with most headroom
  at a threshold) — needs (a) a reliable usage-remaining readout to trigger on,
  (b) a subscription/hard-limit model where pooling helps, (c) ToS tolerance.
  Pooling subscription accounts to dodge limits is ToS-violating across OpenAI
  (explicit: "circumvent any rate limits"), Anthropic (cumulative: no account
  sharing / no bot access / no bypassing protective measures), and Google
  (implicit + APIs ToS §2d). The lawful scale path for all three is metered API
  keys, not multiplied consumer subscriptions.

Per-provider capability matrix:

| Provider | Surface | Isolation mechanism | Usage readout | Profile-switch | Auto-switch |
|---|---|---|---|---|---|
| Claude Code | CLI | `CLAUDE_CONFIG_DIR` (have) | ✅ `/usage` | YES | opt-in only; the only provider with a real signal |
| Claude Desktop | GUI | `--user-data-dir` (road-to-claude-desktop) | — | YES | — |
| Codex | CLI | `CODEX_HOME` (have) | ❌ | YES | none (no signal) |
| Codex UI | GUI/IDE | env + `--user-data-dir` (road-to-codex-ui) | ❌ | YES | — |
| Gemini | CLI | `GEMINI_CLI_HOME` (have) | ❌ (`/stats` is session-only) | YES | **none** — 1000 req/day free ceiling rarely hit; real limiter is the 60 req/min burst which rotation can't fix; no readout; ToS §2d-adverse |
| GitHub Copilot CLI | CLI | `COPILOT_HOME` + per-profile `COPILOT_GITHUB_TOKEN` (creds live in OS keychain, not the config dir) | ❌ (unreliable `/usage`) | YES (new) | none — metered credit billing; strict "one free account" ToS |
| Cursor | GUI (Electron) | `--user-data-dir` (apps layer) | (readable, unused) | YES (new) | none — "circumvent access controls" AUP + ~3-accounts/machine fingerprint |
| Windsurf | GUI (Electron) | portable / `--user-data-dir` (apps layer) | (readable, unused) | YES (new) | none — explicit "circumvent access controls" AUP |
| Amazon Q / Kiro | CLI | **no config-dir env var**; product migrating to Kiro CLI | ❌ | deferred (needs bespoke isolation) | none |
| BYO-key (Aider, Goose, Continue, Cline, Roo, OpenCode) | CLI/IDE | varies; limits are key-tied | n/a | marginal | none |

Council review (anthropic/claude-sonnet-4-5 + openai/gpt-4o, 2026-07-14):
unanimous that the auto-switch rotation engine is a ToS violation regardless of
guardrails, and recommended removal in favour of a display-only usage view +
manual switch. **Decision by the owner:** keep the mechanic, ship it globally
off by default, and **omit the ToS warning text** — a written "this may violate
ToS" is itself a documentation-liability (scienter) the council flagged, so the
mechanic ships without an in-product legal admission and defaults off. See
`## Council notes`.

## Dependencies

- [x] `src/providers.ts` — provider abstraction (claude/codex/gemini).
- [x] `src/apps.ts` — GUI launch layer (`env` / `user-data-dir`); registry empty.
- [x] `src/profiles.ts` — per-provider `AutoSwitchConfig` (`DEFAULT_AUTOSWITCH = { enabled: false }`).
- [x] `gui/src/App.tsx` — SettingsView (General / Design / Uninstall) + provider tabs.
- [ ] [`road-to-claude-desktop.md`](road-to-claude-desktop.md) — the Claude Desktop "UI" surface a Providers toggle exposes.
- [ ] [`road-to-codex-ui.md`](road-to-codex-ui.md) — the Codex "UI" surface a Providers toggle exposes.

## Phase 1: Provider + surface enable/disable (CLI-backed)

Model an enabled-set so the GUI stays a thin `--json` client (never re-implements
logic). A provider has surfaces (`cli`, `ui`); a surface is enable/disable-able.

- [x] **Step 1:** Define the enabled-set config in `src/profiles.ts` (mirrors the
      `AutoSwitchMap` shape): per provider a `{ cli: boolean, ui: boolean }`.
      Default: `claude {cli, ui}` on, `codex {cli, ui}` on, everything else off.
- [x] **Step 2:** `agent-switch providers status|enable|disable [--surface cli|ui] [--json]`
      in `src/index.ts` (mirror `cmdAutoswitch`). `--json` returns the full map.
      <!-- verify: `agent-switch providers status --json` shows claude+codex on, gemini off ✓ -->
- [x] **Step 3:** `list` respects the enabled-set — a disabled provider is not
      offered (explicit `--provider` still works). Disabling never deletes
      profiles (reversible); a provider with existing profiles defaults to
      enabled so an upgrade never hides an account.
      <!-- verify: profiles.test.ts covers default set + no-hide-existing + toggle persistence ✓ -->

## Phase 2: GUI Providers settings tab

- [x] **Step 1:** Add `"providers"` to `SettingsTab` in `gui/src/App.tsx`
      (`SETTINGS_TABS`), and a `ProvidersSettings` component.
- [x] **Step 2:** `ipc.ts` thin wrappers `getProviders()` / `setProvider(id, surface, on)`
      over the `providers --json` command (pattern: `getAutoSwitch`/`setAutoSwitch`).
- [x] **Step 3:** The tab lists every provider with per-surface (CLI / UI)
      toggles; the main-view provider tab-strip renders only enabled providers.
      <!-- verify: App.test.tsx — providers-tab toggle + disabled-provider hides its tab ✓ -->
- [x] **Step 4:** The main-view tab-strip is derived from the enabled-set
      (`enabledIds`), not the hardcoded literal; the strip's grid is dynamic and
      a disabled active provider auto-jumps to the first enabled one.

## Phase 3: Auto-switch — global default OFF, no ToS warning, signal-gated

- [x] **Step 1:** Flipped the GUI global default: `gui/src/settings-store.ts`
      `getAutoSwitchGlobal()` returns **false** unless the value is literally
      "on". Doc comment updated.
      <!-- verify: App.test.tsx "auto-switch UI is hidden by default" ✓ -->
- [x] **Step 2:** Removed the ToS note from `cmdAutoswitch` (the "Pooling
      accounts to route around limits may conflict…" lines); kept the operational
      guidance. GeneralSettings carries no ToS warning (none was added). Mechanic
      intact.
- [x] **Step 3:** Modelled `hasUsageReadout` on the provider (claude only); the
      per-tab dot and footer toggle render only for providers with a readout, and
      the CLI refuses `autoswitch on` for providers without one.
      <!-- verify: providers.test.ts + App.test.tsx (codex/gemini no toggle) + functional reject ✓ -->
- [x] **Step 4:** Gemini auto-switch removed as a concept — no GUI toggle, CLI
      refuses it, and `src/daemon.ts` was already Claude-only. Gemini keeps
      profile-switch untouched.

## Phase 4: GitHub Copilot CLI provider (profile-switch only)

Copilot is the highest-uncertainty new provider: creds live in the OS keychain,
so `COPILOT_HOME` alone isolates config/history but **not** the account. True
isolation needs a per-profile `COPILOT_GITHUB_TOKEN`. This phase front-loads that
unknown before wiring the UI.

- [ ] **Step 1 (verify first):** On a real install, confirm the isolation model:
      does `COPILOT_HOME=<profile>` + a per-profile `COPILOT_GITHUB_TOKEN` give a
      fully isolated account, and where does the token come from (PAT vs the
      CLI's own `/login`)? Record the verified mechanism before coding.
      <!-- verify: two COPILOT_HOME dirs + two tokens → two distinct signed-in accounts -->
- [ ] **Step 2:** Extend the `Provider` interface for a token-via-env export
      (an optional map of extra env vars set on `run`/launch), since Copilot's
      credential is not a file in the config dir. Add the `copilot` provider
      (`binary: "copilot"`, `envVar: "COPILOT_HOME"`, extra env `COPILOT_GITHUB_TOKEN`).
- [ ] **Step 3:** `add`/`import`/`run` flow for Copilot profiles; store the
      per-profile token where the other secrets live (keychain-backed where
      available, file fallback). No usage readout → identity-only status.
- [ ] **Step 4:** Copilot ships **off by default** in the Providers tab; no
      auto-switch. IDE surface is out of scope (no env-var mechanism).

## Phase 5: Cursor + Windsurf (apps layer, profile isolation)

Both are Electron IDEs with no config-dir env var — isolation is the launch-time
`--user-data-dir` the apps layer already supports. They are **apps**, not CLI
providers.

- [ ] **Step 1 (verify first):** Re-verify on real installs: `open -n -b <bundleId>
      --args --user-data-dir=<dir>` yields an isolated, parallel instance; and
      re-check the reported ~3-accounts-per-machine hardware-fingerprint cap
      (forum-sourced, unofficial) — note the real limit found.
      <!-- verify: 2nd process spawns (pgrep), data-dir populated, both windows independent -->
- [ ] **Step 2:** Register `cursor` and `windsurf` in `src/apps.ts`
      (`strategy: "user-data-dir"`, real bundle ids). `agent-switch open cursor <profile>`
      / `open windsurf <profile>` launch isolated instances.
- [ ] **Step 3:** Both surface as **UI** providers in the Providers tab, off by
      default; profile-isolation only, no auto-switch. Document the login-once-
      per-profile behaviour and the fingerprint caveat.

## Phase 6: Docs

- [ ] **Step 1:** README — a provider capability matrix (isolation mechanism /
      usage-readout / profile-switch / auto-switch) mirroring the Context table.
- [ ] **Step 2:** README — the Providers settings tab, default-enabled set, and
      that auto-switch is globally off by default and Claude-only.
- [ ] **Step 3:** README — Copilot CLI (token-per-profile), Cursor/Windsurf
      (user-data-dir isolation + caveats). Note IDE-Copilot / Amazon Q as out of
      scope with the reason.

## Acceptance criteria

- A fresh install shows Claude + Codex enabled (CLI + UI), Gemini and all new
  providers off; enabling one in the Providers tab makes its tab appear.
- Auto-switch is globally OFF on a fresh install and must be explicitly enabled;
  the toggle appears only for Claude; no ToS warning text anywhere.
- `agent-switch open cursor <profile>` / `open windsurf <profile>` launch
  isolated parallel instances; a Copilot profile runs on its own isolated account.
- Disabling a provider hides it without deleting its profiles.

## Considered and NOT built (with reasons)

- **Auto-switch for any non-Claude provider** — no usage readout to trigger on
  (Codex/Gemini/Copilot) and/or ToS-adverse pooling; the mechanic exists but is
  never offered where there is no signal.
- **Copilot IDE (VS Code / JetBrains)** — account is GUI/OAuth-bound; no env-var
  or user-data-dir mechanism agent-switch can drive.
- **Amazon Q Developer CLI** — no config-dir env var (isolation would need a
  bespoke `~/.aws/amazonq` + auth-store swap), 50-req/**month** free cap, and the
  product is migrating to **Kiro CLI**. Revisit as Kiro if demand appears.
- **BYO-key tools (Aider, Goose, Continue, Cline, Roo, OpenCode)** — limits are
  tied to the API key, not the tool, so auto-switch is pointless; several already
  ship native profiles (Roo) or a config-dir env var (OpenCode). Low marginal
  value; deferred unless requested.

## Risks

- **Copilot credential isolation** is the least-certain path (keychain-shared
  creds; token-per-profile is the lever) → Phase 4 Step 1 verifies before coding.
- **Cursor/Windsurf** are unofficial to multi-account; a build update can change
  `--user-data-dir` behaviour and the device-fingerprint cap is unofficial →
  Phase 5 Step 1 re-verifies.
- **Auto-switch** remaining in the tree (even off + signal-gated) is a residual
  policy exposure the council flagged; kept per owner decision, contained to
  Claude, default off, no in-product warning.

## Council notes (2026-07-14)

- **Members:** anthropic/claude-sonnet-4-5, openai/gpt-4o (2-round independent
  review). Both **DISAGREED** with shipping auto-switch in any form: the rotation
  engine itself is the ToS violation (consistent with the earlier 2026-07-13
  council), default-off + a warning is an insufficient guardrail, and a "may
  violate ToS" warning is a documentation-liability (scienter). New load-bearing
  point: Anthropic could revoke API access for the whole user base if it detects
  the multi-account `/usage`-poll + rotation pattern.
- **Owner decision (revisit-if new provider offers a first-party pooling/quota
  API, or a provider explicitly permits multi-account pooling):** keep the
  auto-switch mechanic, ship it globally **off by default**, and **omit the ToS
  warning text** entirely (the warning is the liability, not the guardrail).
  Contain it to the only provider with a usage signal (Claude); never offer it
  where there is no signal.
- **Council dissent recorded:** the council also recommended dropping GitHub
  Copilot CLI (strict "one free account" ToS). Kept here as an owner-requested,
  off-by-default, profile-switch-only provider — legitimately-separate accounts
  (e.g. personal + a work seat) are a real isolation case — with the caveat noted.
