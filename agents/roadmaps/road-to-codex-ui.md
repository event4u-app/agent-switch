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

- [x] [`road-to-desktop-app-launch.md`](archive/road-to-desktop-app-launch.md) — the
      launch layer (this client uses `strategy: "env"` for the IDE, and
      `env` + `user-data-dir` combined for the desktop app).
- [x] Existing Codex CLI `CODEX_HOME` profiles (reused as-is).

## Phase 1: Codex IDE extension (env strategy)

- [x] **Step 1:** Registered `codex-ide` (`strategy: "env"`, `envVar: CODEX_HOME`,
      provider codex, reuses the codex profile config dir; targets VS Code
      `com.microsoft.VSCode`, other editors future). <!-- verify: npm test — registry + argv -->
- [x] **Step 2:** `agent-switch open codex-ide [profile]` launches the editor
      with `CODEX_HOME` exported. The `open --env` delivery is verified (the
      Codex.app probe populated a custom `CODEX_HOME`); the extension picking it
      up is a manual check (see Step 3). <!-- verify: npm test (argv) + open --env delivery proven -->
- [~] **Step 3:** Re-verify openai/codex#7971 (extension hardcoding a project-local
      `config.toml`) on the target version — DEFERRED: the Codex VS Code
      extension is not installed in this environment, so the extension-level
      `CODEX_HOME` pickup can't be live-verified here. Run with the extension
      installed; documented as a caveat.

## Phase 2: Codex / ChatGPT desktop app (two-layer strategy)

- [x] **Step 1:** Registered `codex-desktop` (`com.openai.codex`,
      `strategy: "env+user-data-dir"`): `CODEX_HOME` → the codex profile config
      dir (agent auth) + `--user-data-dir` → the per-profile gui dir (web
      session), both set in one launch.
- [x] **Step 2:** Verified end-to-end on the installed build (Codex v26): a
      controlled `agent-switch open codex-desktop <profile>` filled BOTH layers —
      the CODEX_HOME dir (`config.toml`, `.codex-global-state.json`) and the
      user-data-dir (Chromium web-session files) — and the process ran with the
      per-profile `--user-data-dir`. Both `--user-data-dir` and `CODEX_HOME` were
      each independently confirmed honored by Codex.app first-hand.
      <!-- verify: controlled launch probe — both layers populated -->
- [x] **Step 3:** Documented the session-history bug (openai/codex#14389 — a
      custom `CODEX_HOME` makes the desktop app list only the latest session) as
      a known upstream limitation in the roadmap Context + README.

## Phase 3: Docs

- [x] **Step 1:** README "GUI apps" section lists Codex desktop (two-layer) and
      Codex-in-VS-Code (CODEX_HOME only), plus the caveats (#14389 session-list,
      #7971 re-verify, editor-must-be-freshly-launched).

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
