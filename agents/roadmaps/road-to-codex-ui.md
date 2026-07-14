---
complexity: lightweight
status: draft
parent_roadmap: road-to-desktop-app-launch
---

# Roadmap: Codex UI client (IDE extension + desktop app)

> Per-account isolation for OpenAI Codex's graphical surfaces. The IDE extension
> reuses the CLI's `CODEX_HOME` mechanism; the desktop app needs a second layer.

## Goal

Launch the Codex IDE extension and the Codex/ChatGPT desktop app on a chosen
profile's account, isolated, reusing agent-switch's existing `CODEX_HOME`
profiles where possible.

## Context (verified 2026-07-14)

- **"Codex UI" is two surfaces:** the **IDE extension** (VS Code / JetBrains)
  and the **desktop app** (macOS/Windows; folding into the ChatGPT desktop app).
- **IDE extension — one layer.** `CODEX_HOME` governs auth/config/sessions and
  applies to the extension per OpenAI docs — the same env var agent-switch
  already sets for the Codex CLI. Only added work: launch the editor with
  `CODEX_HOME` set (GUIs don't inherit the shell env).
- **Desktop app — two layers.** `CODEX_HOME` isolates the Codex agent's
  auth/config, but the surrounding ChatGPT web session needs its own Electron
  **`--user-data-dir`**. Real tools set **both** (github.com/ccheney/codex-multi-account,
  github.com/Ducksss/codex-profiles). The earlier "Codex ignores --user-data-dir"
  claim was **refuted** in the adversarial pass — the flag is not ignored; the
  two just isolate different layers.
- **Known defect:** with a custom `CODEX_HOME` the desktop app lists only the
  latest session (openai/codex#14389) — cosmetic session-history bug, not an
  auth-isolation failure. And openai/codex#7971 (extension hardcoding a
  project-local `config.toml`) should be re-checked on the target version.
- Sources: learn.chatgpt.com/docs/config-file/environment-variables;
  developers.openai.com/codex/app; developers.openai.com/codex/ide;
  openai/codex#14389, #7971, #12029.

## Dependencies

- [ ] [`road-to-desktop-app-launch.md`](road-to-desktop-app-launch.md) — the
      launch layer (this client uses `strategy: "env"` for the IDE, and
      `env` + `user-data-dir` combined for the desktop app).
- [ ] Existing Codex CLI `CODEX_HOME` profiles (reused as-is).

## Phase 1: Codex IDE extension (env strategy)

- [ ] **Step 1:** Register `codex-ide` (`strategy: "env"`, `envVar: CODEX_HOME`,
      reusing the existing Codex profile dir). Detect installed editor(s).
- [ ] **Step 2:** `agent-switch open codex-ide --profile <name>` launches the
      editor with `CODEX_HOME=<profile>` exported.
      <!-- verify: manual — editor's Codex panel shows that account's sessions -->
- [ ] **Step 3:** Re-verify openai/codex#7971 on the target extension version
      (hardcoded config path); note the result.

## Phase 2: Codex / ChatGPT desktop app (two-layer strategy)

- [ ] **Step 1:** Register `codex-desktop` with a combined launch: `CODEX_HOME`
      env + Electron `--user-data-dir` (per-profile), since the ChatGPT web
      session and the Codex agent auth are separate layers.
- [ ] **Step 2:** `agent-switch open codex-desktop --profile <name>` launches
      with both set. <!-- verify: manual — signed into the right ChatGPT account AND Codex agent auth -->
- [ ] **Step 3:** Document the session-history bug (#14389) as a known upstream
      limitation with a custom `CODEX_HOME`.

## Phase 3: Docs

- [ ] **Step 1:** README: Codex UI = IDE (one layer) vs desktop (two layers),
      with the caveats and the re-verify note.

## Acceptance criteria

- `agent-switch open codex-ide --profile X` shows account X's Codex sessions,
  reusing the existing `CODEX_HOME` profile.
- `agent-switch open codex-desktop --profile X` is signed into X on both layers.
- No new isolation concept for the IDE — it reuses the CLI's `CODEX_HOME`.

## Risks

- Codex surfaces are consolidating into the ChatGPT desktop app; behaviour may
  shift → Phase 2 needs re-verification before shipping.
- Two-layer desktop isolation is the least-documented path — verify on the real
  app before relying on it.
