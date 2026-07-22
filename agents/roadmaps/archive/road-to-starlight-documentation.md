---
complexity: standard
status: done
---

# Roadmap: Starlight documentation site

> Stand up an Astro/Starlight documentation site for `@event4u/agent-switch`,
> matching the design and structure of the `event4u/data-helpers` docs
> (Rapide theme, orange accent, `starlight/` subdir, GitHub Pages deploy) and
> the `event4u-app/agent-config` README banner layout. The goal is a **good
> overview**, not exhaustive reference bloat: ~10 focused pages across three
> sidebar groups (Getting Started · Guides · Reference), plus a splash home.
> Published at `https://event4u-app.github.io/agent-switch/`.

## Ground truth (analysis findings — do not re-derive)

- **Reference stack** (pinned to match data-helpers): `astro@^5.6.1`,
  `@astrojs/starlight@^0.36.1`, `starlight-theme-rapide@^0.5.2`,
  `astro-mermaid@^1.1.0`, `sharp@^0.34.2`. Only Starlight plugin is Rapide;
  `astro-mermaid` is a top-level Astro integration. No component overrides.
- **Design**: orange/terracotta accent via `custom.css` accent-token overrides
  (light `#c74624`/`#a33a1d`/`#e85a32`, dark `#ff7a50`/`#ff9470`/`#e85a32`),
  splash-hero button override, rounded code blocks, styled tables/callouts.
  `public/favicon.png` doubles as favicon **and** logo.
- **Astro config**: `site: 'https://event4u-app.github.io'`,
  `base: '/agent-switch'`, `trailingSlash: 'always'`, hand-authored sidebar,
  `editLink.baseUrl` → `…/edit/main/starlight/`. Every absolute asset URL must
  be `base`-prefixed (`/agent-switch/…`).
- **README banner** (agent-config pattern, verbatim shape):
  `<p align="center"><a href="https://event4u.app"><img alt="event4u Agent Switch" src=".github/assets/banner.png"></a></p>` — line 1, centered, linked.
- **Product model**: agent-switch is **multi-provider** — Claude **+ Codex +
  Antigravity** (`agy`), via per-provider config-dir isolation. Docs present the
  three-provider model, NOT Claude-only (the README is Claude-framed; the code
  in `src/providers.ts` is the source of truth).
- **Node requirement**: `>=20` per `package.json` (README's "≥18" is stale —
  document ≥20).

## Decisions (locked for this roadmap)

1. **No root `docs →` symlink.** The reference uses `docs → starlight/src/content/docs`,
   but this repo already has a real `docs/adr/` (ADR-001, ADR-002). ADRs stay in
   `docs/adr/` untouched; Starlight content lives only in
   `starlight/src/content/docs/`. Avoids the symlink/real-dir conflict.
2. **Local npm, no Docker.** data-helpers runs docs in a `node:18-alpine`
   container because it is a PHP-only host. agent-switch is already a Node
   project, so docs build via local npm scripts + Taskfile `docs:*` tasks (Node
   20, matching CI). Simpler, one fewer moving part.
3. **Scope cap**: ~10 content pages + splash. Each page focused. No auto-generated
   API dump. Prefer one good "CLI reference" page over per-command pages.

## Phase 1 — Scaffold the Starlight site

- [x] Create `starlight/package.json` with the pinned deps above + stock scripts
  (`dev`/`start`/`build`/`preview`/`astro`), `"type": "module"`, `name: "docs"`.
- [x] Create `starlight/astro.config.mjs`: `site`/`base: '/agent-switch'`/`trailingSlash`,
  `starlight({...})` with title `agent-switch`, description, `favicon`, `logo.src`,
  `social` (github → repo; heart → sponsor/`event4u.app`), `editLink`,
  `customCss`, `plugins: [starlightThemeRapide()]`, `sidebar` (three groups, see
  below), and top-level `mermaid()` integration.
- [x] Create `starlight/tsconfig.json` (extends `astro/tsconfigs/strict`) and
  `starlight/src/content.config.ts` (docsLoader + docsSchema, Astro-5 shape).
- [x] Create `starlight/src/styles/custom.css` — copy the data-helpers accent
  theme verbatim (orange tokens, hero-button override, tables, callouts).
- [x] Assets: `starlight/public/favicon.png` (favicon+logo) and
  `starlight/public/banner.png`. Reuse `.github/assets/banner.png` for the
  banner; generate/derive a small favicon (fallback: use the banner-derived or a
  simple placeholder if no favicon source exists — note it if placeholder).
- [x] Add `starlight/.gitignore` (`dist/`, `.astro/`, `node_modules/`).
- [x] `npm install` inside `starlight/` resolves cleanly (lockfile committed).

Sidebar groups (hand-authored):
- **Getting Started** (`collapsed: false`): Introduction · Installation & Setup · Your First Accounts
- **Guides** (`collapsed: true`): Per-Repo Mappings & Shared Settings · Sessions, Context & Handoff · Providers & Auto-Switch · The Tray GUI
- **Reference** (`collapsed: true`): CLI Command Reference · Configuration Reference · Platform Support & Troubleshooting

Security: none (static docs tooling).

## Phase 2 — Content: Getting Started + splash

- [x] `src/content/docs/index.mdx` — `template: splash`, hero (title, tagline,
  two actions → Introduction + GitHub), banner image (`/agent-switch/banner.png`),
  then `<CardGrid>` of the core capabilities (multi-provider, per-repo accounts,
  sessions/handoff, tray GUI).
- [x] `getting-started/introduction.md` — the concept: config-dir isolation vs
  keychain-snapshot swapping; why it stays live (refresh-token rotation); the
  three-provider model (Claude/Codex/Antigravity table: binary, env var,
  credential location, usage-readout availability).
- [x] `getting-started/installation.md` — npm global / npx, Node **≥20**, `bin`,
  the required `eval "$(agent-switch shellenv)"` shell integration (+ `--shell`
  override, cmd.exe → `run`), what shellenv defines (`asw`, per-provider
  wrappers), post-install `doctor`.
- [x] `getting-started/first-accounts.md` — `import <name>` (adopt existing
  install, login-free) → `add <name>` (new login) → `use`/`deactivate`; daily
  workflow (`asw`, `asw <name>`, `asw <provider> <name>`); `list`/`status`/`current`.

Security: none.

## Phase 3 — Content: Guides

- [x] `guides/mappings-and-sharing.md` — directory→profile mappings
  (`map`/`unmap`/`mappings`, precedence: mapping > active > default) and Claude
  config sharing (`share on|sync|off|status`, `--history`, `--source`;
  write-through dirs vs fork-on-edit files).
- [x] `guides/sessions-and-handoff.md` — `sessions` (+ `preview`/`rm`/`restore`),
  `takeover --to` (move/fork, live-guarded), `handoff extract`/`seed`
  (cross-provider lossy metadata bridge, ADR-001), `compact`, `alerts`,
  context-monitoring (own-session only; anti-rotation boundary).
- [x] `guides/providers-and-autoswitch.md` — `providers enable|disable|status`;
  `autoswitch on|off|status|strategy` (**opt-in, globally off**, Claude/Codex
  only, `reset-first`/`rotation-first`, `--threshold`/`--tag`) WITH the
  usage-policy caveat surfaced prominently; `reset` (Codex banked reset).
- [x] `guides/tray-gui.md` — `agent-switch gui` (downloads prebuilt artifact from
  Releases, caches under `~/.agent-switch/gui/<version>/`); Tauri tray app,
  per-provider tabs, embedded terminal, sessions panel; in-app auto-updates
  ("Update now", bump-kind gating); the agent-config companion banner; unsigned-
  build first-launch note.

Security: note the auto-switch usage-policy caveat verbatim from the README; no code changes.

## Phase 4 — Content: Reference

- [x] `reference/cli.md` — one exhaustive but scannable command reference, grouped
  (Profile lifecycle · Running/switching · Listing/status · Sessions & handoff ·
  Sharing · GUI/apps · Providers/auto-switch · Notifications/daemon/maintenance).
  Table per group: command · args/flags · what it does. Global convention
  (provider defaults to `claude`, `--provider` override; `run` passthrough).
- [x] `reference/configuration.md` — profile root (`AGENT_SWITCH_HOME` / `~/.agent-switch`),
  on-disk layout tree, `state.json` schema (active/labels/autoSwitch/providers/
  switchStrategy/osNotifications), `telemetry-config.json`, env vars
  (`CLAUDE_CONFIG_DIR`/`CODEX_HOME`/`HOME`/`CFFIXED_USER_HOME`), profile-name
  validation, v1→v2 layout migration.
- [x] `reference/platform-support.md` — the ADOPTED.md per-OS matrix in brief
  (verified/degraded), Windows specifics (junctions, Developer Mode, cmd.exe →
  `run`), unsigned-build Gatekeeper/SmartScreen workarounds, `doctor` self-check,
  known isolation gotchas (Linux XDG state, VS Code extension ignores the env var).

Security: none.

## Phase 5 — README banner + docs link

- [x] Prepend the centered, linked banner block to `README.md` (agent-config
  pattern; alt `event4u Agent Switch`, src `.github/assets/banner.png`), above the
  existing `# agent-switch` H1.
- [x] Add a docs-site link near the top (badge or line) →
  `https://event4u-app.github.io/agent-switch/`.
- [x] Track `.github/assets/banner.png` (currently untracked).
- [x] Fix the stale Node version in README (≥18 → ≥20) — one-line correction, in
  scope because the docs assert ≥20 and the two must agree.

Security: none.

## Phase 6 — Build, deploy wiring, Taskfile

- [x] Add `.github/workflows/build-docs.yml` — adapted from data-helpers: trigger
  `release: [published]` + `workflow_dispatch`; **Node 20**;
  `working-directory: starlight`; `npm ci` → `npm run build`; upload + deploy to
  GitHub Pages (`configure-pages`/`upload-pages-artifact`/`deploy-pages`), deploy
  job gated on `release`.
- [x] Add `docs:*` tasks to `Taskfile.yml` (local Node, no Docker):
  `docs:install`, `docs:dev`, `docs:build`, `docs:preview`, `docs:check`,
  `docs:clean`.

Security: workflow uses `pages: write` + `id-token: write` scoped to the deploy job only (standard GH Pages OIDC). No secrets.

## Phase 7 — Verify

- [x] `cd starlight && npm run build` succeeds (Astro build + type-safe content).
- [x] `npm run astro -- check` (or `astro check`) reports no content/link errors.
- [x] Spot-check the built `starlight/dist/` — home renders the banner, sidebar
  shows all three groups, `base: /agent-switch` prefixes are correct.
- [x] Confirm no broken internal doc links (relative slugs resolve).

Security: none. This is the completion gate — no "done" claim without a green build.

## Acceptance criteria

- Starlight site builds green with the Rapide orange theme, matching data-helpers.
- ~10 focused pages across Getting Started / Guides / Reference + splash home.
- Multi-provider model (Claude/Codex/Antigravity) presented correctly; auto-switch
  usage-policy caveat surfaced.
- README carries the centered agent-config-style banner + a docs-site link.
- GitHub Pages deploy workflow + Taskfile `docs:*` tasks in place.
