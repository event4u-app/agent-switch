---
complexity: lightweight
parent_roadmap: road-to-agent-switch-core
execution:
  mode: autonomous
---

# Roadmap: agent-switch multi-provider (Claude Code + Codex + Gemini)

> One tool switches accounts for all three CLI assistants via the same
> isolated-config-dir architecture, each provider keyed independently.

## Goal

Generalize the profile model from Claude-Code-only to a `(provider, name)`
model covering `claude` (`CLAUDE_CONFIG_DIR`), `codex` (`CODEX_HOME`), and
`gemini` (`GEMINI_CLI_HOME`), each with its own credential contract, shell
wrapper, and one-shot invocation — no behavior change for existing Claude
profiles.

## Prerequisites

- [x] [`road-to-agent-switch-cross-platform.md`](archive/road-to-agent-switch-cross-platform.md)
      Phase 2 (platform abstraction) landed — provider abstraction layers on
      top of it. (Completed & archived — PR #1.)
- [x] `codex` and `gemini` binaries available for the contract tests.

## Context

- Sibling of the `road-to-agent-switch-*` family; depends on the cross-platform
  foundation. Consumed by
  [`road-to-agent-switch-gui-service.md`](road-to-agent-switch-gui-service.md) (usage per
  provider, GUI provider tabs).
- **Verified live (2026-07-13)** — the isolation architecture holds for all
  three; env vars confirmed by running each CLI against a scratch dir:

  | Provider | Env var | Config-dir semantics | Credential file | One-shot |
  |---|---|---|---|---|
  | `claude` | `CLAUDE_CONFIG_DIR` | = the dir | Keychain (macOS, hashed) / `.credentials.json` (Lin/Win) | `claude -p` |
  | `codex` | `CODEX_HOME` | = the dir | `$CODEX_HOME/auth.json` (0600 plaintext) | `codex exec` |
  | `gemini` | `GEMINI_CLI_HOME` | contains `.gemini/` subdir | `$GEMINI_CLI_HOME/.gemini/oauth_creds.json` (0600) + `google_accounts.json` | `gemini -p --output-format json` |

  Codex/Gemini are *simpler* than Claude on macOS: credentials are plaintext
  files inside the config dir (no keychain hash contract). Multi-account =
  one dir per profile, log in once each. Gemini/Codex OAuth consent must be
  granted interactively once (browser), same as Claude.
- **Anti-rotation lock applies unchanged** to Codex (OpenAI) and Gemini
  (Google) accounts — see
  [`skipped/road-to-agent-switch-autoswitch-rejected.md`](skipped/road-to-agent-switch-autoswitch-rejected.md).

## Phase 1: Provider abstraction

- [x] **Step 1:** `src/providers.ts` — a `Provider` interface:
      `id` (`claude`/`codex`/`gemini`), `binary`, `envVar`, `configDirFor(profileRoot)`
      (claude/codex = the dir; gemini = `<dir>/.gemini`), `credentialPath`,
      `readIdentity()`, `oneShotArgs(prompt)`. One implementation per provider.
- [x] **Step 2:** Extend the profile model to `(provider, name)`. On-disk
      layout: `~/.agent-switch/<provider>/<name>/config` (rename root from
      `.agent-switch`, with a one-time migration of existing Claude
      profiles from `~/.agent-switch/<name>` → `~/.agent-switch/claude/<name>`).
      <!-- verify: npm test -->
      <!-- done: migrateLegacyLayout() runs once on first command; copy-then-verify, re-seeds the credential across the macOS keychain-hash change (file move suffices on lin/win), idempotent, skips name clashes. Unit-tested + live CLI smoke. -->
- [x] **Step 3:** Per-provider active state in `state.json`
      (`{ active: { claude, codex, gemini } }`); `use`/`current` take an
      optional `--provider` (default: infer from a provided binary name or the
      profile's provider).
- [x] **Step 4:** Keychain contract stays Claude-only (darwin): codex/gemini
      credential read/delete is file-based (0600). Wire into `remove`.

**Exit criteria:** existing Claude profiles migrate losslessly (`npm test`
covers the migration); `providers.ts` unit-tested per provider with mocked FS.
**Rollback:** migration is copy-then-verify; on failure keep the old root and
abort. Revert `src/`.

## Phase 2: Commands across providers

- [x] **Step 1:** `add`/`import`/`use`/`run`/`list`/`status`/`remove` gain a
      `--provider` dimension; `list` groups by provider; bare `asw` lists all.
- [x] **Step 2:** `import` per provider from the default install:
      claude (existing), codex (`~/.codex`), gemini (`~/.gemini`). Seed the
      credential file into the profile dir; set each tool's
      onboarding/first-run flags where required (verified in Phase 1).
      <!-- done: claude = existing lock+seed+onboarding path; codex/gemini copy their credential/identity files (auth.json; oauth_creds.json + google_accounts.json) via provider.importFiles. codex/gemini needed no extra first-run flag to accept a seeded credential. Interactive OAuth login (add without an existing install) stays integration-gated. -->
- [x] **Step 3:** `run` uses the provider's one-shot/interactive invocation
      (`claude`, `codex`, `gemini`) with the right env var injected.
- [x] **Step 4:** Directory mappings become provider-aware:
      `agent-switch map <provider> <name> [dir]`; the shell wrapper resolves per
      binary. <!-- verify: npm test -->

**Exit criteria:** add→use→run→remove cycle works for a codex and a gemini
profile on the dev machine (integration-gated); unit tests cover the
provider-aware command routing.
**Rollback:** revert `src/`; Claude-only commands unaffected.

## Phase 3: Shell integration for all three binaries

- [x] **Step 1:** `shellenv` emits wrappers for `claude`, `codex`, and
      `gemini`, each injecting its provider's env var from the resolved
      profile (mapping > active-for-provider > default).
- [x] **Step 2:** `asw <provider> <name>` shorthand; bare `asw` lists all
      providers' profiles.
- [x] **Step 3:** PowerShell/fish/bash/zsh parity for all three wrappers
      (extends the cross-platform Phase 3 shell work).
      <!-- verify: node dist/index.js shellenv --shell bash -->
- [x] **Step 4:** `agent-switch doctor` checks all three binaries + per-provider
      credential readability.

**Exit criteria:** a new shell session auto-selects the correct account for
each of the three binaries per directory mapping.
**Rollback:** revert; single-binary `claude` wrapper still works.

## Acceptance Criteria

- [x] A profile can be added, used, run, and removed for each of `claude`,
      `codex`, `gemini`.
      <!-- Command mechanics verified live: list/use/current/dir/map/remove per provider + `run` launching the real `codex --version` with CODEX_HOME injected. The interactive OAuth login inside `add` (browser consent) is inherently manual → integration-gated, like the Claude keychain contract test. -->
- [x] Existing Claude profiles migrated with zero re-login.
- [x] Zero runtime dependencies preserved.
- [x] Read-only + anti-rotation invariants hold for all three providers.
- [x] `npm test` green.

## Notes

- Codex has a native `-p/--profile` (config.toml layering) — that is config
  profiles, **not** account isolation; agent-switch's per-account isolation is
  orthogonal and layers above it.
- Gemini's config dir is `$GEMINI_CLI_HOME/.gemini` (the env var names the
  *parent*), unlike claude/codex where the env var names the dir itself —
  `configDirFor()` encapsulates this difference.
- Usage sources differ per provider and are handled in the gui-service
  roadmap; Claude has the OAuth `/usage` endpoint, Codex/Gemini usage
  readouts are verified there (may be unavailable — degrade gracefully).
