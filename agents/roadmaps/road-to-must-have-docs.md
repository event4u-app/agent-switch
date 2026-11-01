---
complexity: large
status: planned
---

# Roadmap: Make agent-switch a must-have — positioning, README and docs

> agent-switch already does something no comparable tool does: every new
> session goes to the account that would otherwise **waste the most paid quota
> at its reset**, accounts stay signed in in the background, and a running
> session can move to another account. Almost nobody finds out. The GitHub repo
> has no description, no topics and no homepage. The npm description says
> "Claude Code" only and has no keywords. The README is 578 lines that start
> selling and then turn into a CLI reference. The Starlight site is
> concept-first, CLI-first, and partly wrong.
>
> This roadmap rewrites **every user-facing document** against the code, not
> against the previous texts. It turns the README into a sales page that gets a
> developer from "what is this" to "it works" in 60 seconds. It rebuilds the
> Starlight site to the data-helpers standard and beyond, with
> `.github/assets/info-image.png` as the new banner in both places.
>
> Source: an external growth analysis of agent-config and agent-switch, plus
> five verification passes over this tree (2026-11-01). No text of the old
> README, docs or the analysis is taken as given. Every claim was re-derived
> from code, or is listed below as unverified.

## Strategy

### Who it is for

Developers who pay for **more than one AI coding subscription**: work plus
personal, several Claude Max or Pro seats, Claude plus ChatGPT/Codex. Their
pains, in their words:

1. "I keep logging out and back in to switch accounts."
2. "One account hits its 5-hour limit mid-task while the other one resets
   unused." That is money spent on quota that expires.
3. "I don't know which account has what left until it's too late."
4. "My client work and my side projects end up on the wrong account."

### Message house

- **Promise (tagline, test against the code before shipping):**
  *Every AI coding account you pay for, signed in side by side — and every
  session on the one with the most to give.*
- **Pillars, each backed by code:**
  1. **Never log in twice.** Isolated profiles per account
     (`CLAUDE_CONFIG_DIR` / `CODEX_HOME` / `HOME`). Switching moves a pointer,
     never a credential (`src/profiles.ts`). Claude logins are kept fresh in
     the background without spending quota (`src/token-freshen.ts`, ADR-004).
  2. **Never waste a paid limit.** Plain starts are balanced by "what each
     account would lose at its reset" (`src/balance.ts`). Folder rules and
     pools pin projects (`src/dir-resolve.ts`). Protection stops a start on an
     account at its limit.
  3. **See everything, move anything.** The menu-bar app shows 5-hour and
     weekly meters, live sessions and context %. `takeover` moves a session to
     another account. `rebind` swaps the account of a running Claude session
     (macOS).
- **Trust line:** Your tokens never leave your machine except to the provider
  they belong to. No telemetry, no account, no server (verified endpoint list
  below).
- **Voice:** Benefit first, one idea per sentence, concrete numbers over
  adjectives, no internal jargon on the first screen. "Window", "pool",
  "guard", "isolation dir" and "filed under" are explained or moved down a
  layer. German UI exists; docs stay English (repo convention). A German
  Starlight locale is a later option.

### Layering — every surface answers one question

| Surface | Question it answers | Length budget |
|---|---|---|
| GitHub description, topics, npm description | "Is this for me?" | 1 line |
| README | "Do I want it, and how do I start?" | ≤ 220 lines, no reference tables |
| Docs → Start here | "How do I get it working for my setup?" | 3 pages |
| Docs → Concepts / Guides | "How does it decide, and how do I do X?" | 1 task per page |
| Docs → Reference | "What exactly does flag Y do?" | complete, generated where possible |

The README links into the docs and never duplicates reference material. That
duplication (14 topics in both today) is the main source of drift.

## Ground truth (verified 2026-11-01 — do not re-derive)

- **Package.** `@event4u/agent-switch` 2.8.2, Node ≥ 20, bin `agent-switch`.
  Install paths that exist: `npm i -g`, self-update (`agent-switch update` →
  npm), and the desktop app.
- **Desktop app — changed in 2.8.2** (`src/gui-launch.ts`, PR #126). A bare
  `agent-switch` or `agent-switch gui` downloads a **runnable app, never an
  installer**, caches it under `~/.agent-switch/gui/<version>/` and starts it:
  - macOS: `*.app.tar.gz`;
  - Linux x64: `*.AppImage`;
  - Windows x64: `*_x64-portable.exe`.

  It takes the newest release that already carries the build, so a release
  still building never breaks `gui`. With no network it starts the newest
  cached build. The release still attaches installers for people who want
  them: universal `.dmg`, `.msi`, `-setup.exe`, `.deb`, `.rpm` (checked on
  2.8.2). Docs lead with `agent-switch` (no installer) and list the installers
  as the alternative. Homebrew, Scoop, winget and a curl script do **not**
  exist.
- **Providers** (`src/providers.ts`).
  - Claude (`claude`), Codex (`codex`) and Antigravity (`agy`) are supported.
  - Claude and Codex are on by default. Antigravity is off by default
    (`src/profiles.ts:89`).
  - Usage readouts exist for Claude (OAuth usage) and Codex (`wham/usage`),
    but not for Antigravity.
  - Live detection, single-load guard, share, hooks/alerts, `rebind`, `web`
    and keep-signed-in are Claude-only.
- **Which account a start uses.** The order is: folder rule (profile or pool)
  → balanced across all of that provider's profiles → active profile on a tie
  or with no fresh usage. `use` sets a preference, not a pin. The current docs
  present it as "the" switch, which is wrong (`src/dir-resolve.ts`,
  `src/balance.ts`). Every pick is logged (`picks`).
- **Autoswitch never switches.** It notifies and suggests. The only live switch
  is a user-confirmed `rebind` (optionally `--when-idle`), and it is macOS-only
  (`src/commands/rebind.ts:80`).
- **Single-load guard.** One profile, one live session. New installs start on
  `warn`.
- **Platform splits.**
  - Core, shell wrappers and service work on macOS, Linux and Windows.
  - Shells: zsh, bash, fish and PowerShell, but not cmd.exe.
  - macOS-only: `rebind`, `open`, `launcher`, `app-settings`, `--browser`
    wrappers, and Antigravity identity and keychain isolation.
  - POSIX-only: tmux features and `share --history`.
- **Desktop app.** Tauri 2 with React, not Electron. It has a menu-bar popover,
  an overview ("needs you / running now / what's left"), accounts, sessions,
  projects and pools, apps, activity, health, notifications, an embedded
  terminal, a desktop pet (8 sprite packs), English and German, and a 24-hour
  update check.
- **Already built — reuse, don't rebuild.**
  - The in-app GitHub-star ask and share links (`gui/src/star-ask.ts`).
  - The anonymized terminal screenshot generator
    (`starlight/screenshots/generate.mjs`).
- **Network egress — the complete list.**
  - `api.anthropic.com` (OAuth usage and profile, with the user's own token).
  - `chatgpt.com/backend-api/wham/usage` (Codex usage, with the user's own
    token).
  - `api.github.com` (release check) and `github.com` (GUI download).
  - `registry.npmjs.org` (update check).
  - Nothing else. `src/telemetry.ts` is a **local transcript reader**, not
    phone-home. Never call it "telemetry" in user docs.
- **Discoverability today.** The repo has 2 stars, an empty description, no
  topics and no homepage. `package.json` has no `keywords` or `homepage`, and
  its description is Claude-only. There is no CHANGELOG; only GitHub
  Releases. Docs deploy only on a release tag, with no PR build.
- **Starlight today.**
  - 13 pages and 1 splash. Only Card/CardGrid are used.
  - `banner.png` sits in the hero.
  - One CSS selector is dead because it lacks the base path, and `.callout` is
    unused.
  - The env-var link in `configuration.md` lacks the base and is broken.
  - `app-sessions.png` is unreferenced. `settings.png` is unreferenced in the
    README.
  - `info-image.png` is referenced nowhere yet. It is staged in the main
    checkout but not committed; a copy is in this worktree.
- **data-helpers benchmark.** It is plain Starlight with the Rapide theme and
  Mermaid. The banner is raw HTML under the splash hero, the same image as the
  README, wrapped in a link. Every page has `title` and `description`, and ends
  with See also / Next steps. Its weaknesses, which this roadmap must beat:
  - no OG/Twitter meta;
  - favicon used as the logo;
  - hardcoded base paths;
  - almost no Starlight components (no Steps, Tabs, FileTree, LinkCard);
  - no link validation.

### Known false or stale statements to remove

- README:
  - Setup says "import … then /login once". `import` needs no login.
  - The browser dir is the v1 path. It is `<provider>/<name>/browser` now.
  - The installer formats are listed wrong.
  - It says shellenv defines only `claude`. It also defines `codex`, `agy` and
    `asw`.
  - It says bash writes `~/.bashrc`. On macOS it writes `~/.bash_profile`.
- Starlight:
  - The `eval` line for PowerShell and fish is wrong; they use
    `| Invoke-Expression` and `| source`.
  - `shellenv install` is never mentioned.
  - The configuration layout misses 8 files.
  - It says the `--version` example prints "2.6.3".
  - "Nothing goes stale" overpromises.
  - "Verified on 2.1.316" links into internal `agents/evidence/`.
  - The platform page defers to the internal `ADOPTED.md`.
- `help` omits `handoff`, `sessions rm|restore|preview`,
  `providers link|unlink` and `gui-settings`.
- Code bug found while verifying: `--path` is missing from `VALUE_FLAGS`
  (`src/args.ts:17`). So `providers link --path <bin>` always exits with its
  usage line, and the GUI calls exactly that (`gui/src/ipc.ts:486`).

## Decisions (locked for this roadmap)

- **D-A** `info-image.png` replaces `info-banner.png` as the top image of the
  README and the banner of the docs landing page. It is linked to the docs site.
  The README uses an absolute `raw.githubusercontent.com` URL so it renders on
  npm too. `info-banner.png` and `banner.png` stay in the repo until Phase 7
  confirms no references, then they are removed.
- **D-B** The README is marketing-first and reference-free. Everything with a
  flag table moves to the docs.
- **D-C** Docs are English. Code examples use anonymized `*.example` identities
  only (screenshot-hygiene).
- **D-D** No claim ships without a code reference in the Phase 7 claims audit.
  The info-image is held to the same bar (see D1).
- **D-E** Starlight stays on the Rapide theme, and pages stay `.md`/`.mdx`. The
  new tools are Starlight's own components (Steps, Tabs, LinkCard, FileTree,
  Aside, Badge) and `starlight-links-validator`. No custom framework.

## Decision D1 — resolved 2026-11-01: edit the image

- [x] **D1 — the info-image advertises two things the code does not do.**
  **Decision (maintainer, 2026-11-01): option 1, edit the image.** Rename
  "Model Preference" to "Balanced Starts" and "Auto Failover" to "Live Rebind".
  A third false claim was found while preparing the edit: the bottom process
  step "Auto-Switch (if needed)" also implies automatic switching. Rename it to
  "Suggest Switch". Phase 5 carries the edit. Phase 2 and Phase 3 embed the corrected image only.
  Revisit if: model preference or automatic failover is ever implemented.
  "Smart Routing → Model Preference" has no implementation (grep: zero hits).
  "Auto Failover" contradicts "autoswitch never switches". The other tiles hold
  up:
  - Usage Monitor
  - Limit Guard (`protection`)
  - Session Keep-Alive (`keep-signed-in`)
  - Smart Routing (folder rules, pools, balanced starts)
  - Custom Rules (folder rules)
  - IDE (VS Code launcher, macOS)
  - "More Providers", read as "more to come"

  Options:
  - edit the image (rename "Model Preference" → "Balanced Starts", and "Auto
    Failover" → "Live Rebind" or "Limit Protection");
  - ship it as-is with a caption;
  - build the two features first.

## Phase 0 — Make the code match what the docs will say

- [x] **Fix `--path` in `VALUE_FLAGS`, with a regression test.**
  `providers link --provider codex --path /x/codex` must link the binary, not
  print usage. Prove it red first, then green.
- [x] **Complete `help` output.** List `handoff`, `sessions rm|restore|preview`,
  `providers link|unlink` and `gui-settings`, or mark them internal on
  purpose. The CLI reference is generated from or checked against this list in
  Phase 7.
- [x] **Fix `package.json` metadata.**
  - `description`: multi-provider and benefit-first, ≤ 120 characters.
  - `keywords`: claude-code, codex, antigravity, multi-account, account
    switcher, rate limit, usage, ai coding.
  - `homepage`: the docs URL.
  - `bugs`: the issues URL.
- [x] **Align the stale header comment in `src/usage.ts`.** It says Codex has
  no usage readout, but it does.

## Phase 1 — Positioning assets (internal, reviewed before any public text)

- [ ] **Write `docs/positioning.md`.** It holds the message house above in its
  final wording:
  - tagline;
  - 3 pillars with proof (file refs);
  - the trust line;
  - the 4 pains with their one-line answers;
  - objection handling ("Is this against the ToS?", "Will it touch my
    credentials?", "Why not just set `CLAUDE_CONFIG_DIR`?", "Why not
    claude-swap?");
  - a vocabulary table (internal term → user term).

  Every later text quotes from this file.
- [ ] **Decide the demo storyboard (≤ 20 s).**
  - Two accounts in the menu bar. `claude` starts on the one with the most to
    give. One nears its limit, a notification fires, and the next start goes
    to the other account.
  - A second ≤ 10 s clip: a project folder pinned to the work account.

## Phase 2 — README rewrite

- [ ] **Hero.** `info-image.png` (D-A, absolute URL, alt text that states the
  promise). Then the one-line promise, 5 badges (npm version, downloads, CI,
  docs, license), and a single line "Claude Code · Codex · Antigravity — macOS,
  Linux, Windows".
- [ ] **"Sound familiar?"** — the 4 pains as 4 short lines, each answered in
  one sentence.
- [ ] **Quick start in 60 seconds — three steps.**
  1. `npm i -g @event4u/agent-switch`
  2. `agent-switch import work` (keeps your current login) and
     `agent-switch add personal`
  3. `agent-switch shellenv install`, restart the shell, run `claude`

  Then one sentence: "Prefer a window? Run `agent-switch` — the desktop app
  opens." Every command is verified in Phase 7 on a clean `AGENT_SWITCH_HOME`.
- [ ] **Demo GIF** from Phase 5 directly under the quick start.
- [ ] **"What you get"** — the 3 pillars, each with one screenshot or terminal
  snippet and a "Learn more →" docs link.
- [ ] **"Your tokens stay yours"** — the trust line, the egress list in one
  sentence, and a link to Security & privacy.
- [ ] **Platform matrix (compact)** — providers × OS, with ✅/➖ only. Details
  link to the docs.
- [ ] **Docs, FAQ, non-goals, contributing, sponsor, license** as a link
  block. Remove "Behaviour changes in this release", the Daily-use table, the
  Layout section and all `agents/evidence/` links from the README.
- [ ] **Check the README in three renderers:** GitHub light, GitHub dark, and
  npmjs.com (images absolute, no broken anchors). It must stay ≤ 220 lines.

## Phase 3 — Starlight foundation

- [ ] **Landing page (`index.mdx`) rebuilt.**
  - A splash hero with the tagline from Phase 1 and the actions "Get started in
    60 s" (→ Quick start), "Download the app" (→ Install) and "GitHub".
  - `info-image.png` as the banner under the hero. Copy it into
    `starlight/public/`, link it, and keep it base-safe.
  - The pains section, then a pillars CardGrid, then the demo GIF, then a trust
    Aside, then "Next steps" LinkCards.
- [ ] **New sidebar** (labels = page titles, no drift):
  - **Start here**: Why agent-switch · Quick start · Install, update &
    uninstall
  - **Concepts**: How it works · Which account a session uses · Limits &
    protection · Sessions & context
  - **Guides**:
    - Everyday workflow
    - Projects & pools
    - Move a session (takeover, rebind, handoff)
    - The desktop app
    - Notifications & desktop pet
    - Share settings across accounts
    - Codex
    - Antigravity
    - Desktop apps & launchers (macOS)
    - CodexBar & ccdeck
  - **Trust**: Security & privacy · What agent-switch will never do
    (NON-GOALS)
  - **Reference**: CLI · Configuration & files · Environment variables ·
    Platform matrix · Troubleshooting & FAQ · Glossary · Release notes (→
    GitHub Releases)
- [ ] **Head meta.**
  - OG and Twitter image: a 1200×630 crop of info-image.
  - `og:description`.
  - `lastUpdated: true`.
  - A wordmark logo with `replacesTitle`, so the favicon is no longer used as
    the logo.
- [ ] **Components and conventions.**
  - Steps for every procedure.
  - Tabs for macOS / Linux / Windows and zsh / bash / fish / PowerShell.
  - FileTree for the on-disk layout.
  - Badge for "macOS only" and "Claude only".
  - LinkCard for every "Next steps".
  - Every page has `title`, `description`, and a See also / Next steps ending.
- [ ] **Base-safe links and clean CSS.**
  - No hardcoded `/agent-switch/` in content links.
  - Remove the dead hero selector and `.callout`.
  - Fix the broken env-var link.
- [ ] **Add `starlight-links-validator`** and a docs build job in `ci.yml` on
  pull requests. Deploy stays release-gated.

## Phase 4 — Starlight content (one task per page, written from the code)

- [ ] **Why agent-switch.** The 4 pains with before/after. Comparison with
  manual `CLAUDE_CONFIG_DIR`, keychain snapshot swappers and the claude.ai
  browser extension, rewritten for users from `ADOPTED.md` and
  `EXTENSION-ANALYSIS.md`, no internal references.
- [ ] **Quick start.**
  - Steps, with Tabs per shell.
  - The app path and the CLI path side by side.
  - "Check it worked" with `agent-switch status` / `doctor`.
- [ ] **Install, update & uninstall.**
  - npm; desktop downloads per OS with the real asset names (re-check the 2.8.0
    assets); the unsigned-build notes for macOS and Windows.
  - `update` and the in-app updater.
  - A full uninstall: what `uninstall` removes, the shell line, the service,
    the app and launchers.
- [ ] **How it works.** Isolation per provider (a table: env var, credential
  location per OS), pointer switching, and why there are no snapshots. Use a
  Mermaid diagram.
- [ ] **Which account a session uses.**
  - The resolution order as a diagram: folder rule → balanced → active.
  - What `use` really means (a preference, not a pin).
  - Reading `picks` and `dir --json`, with a worked example using numbers.
- [ ] **Limits & protection.**
  - 5-hour and weekly windows in plain words.
  - Protection thresholds (default 98%) and `protection wait`.
  - Autoswitch suggestions, stated clearly: "it never switches by itself".
  - Codex banked resets.
- [ ] **Sessions & context.** The session list, context %, alerts and hooks,
  `compact`, and the single-load guard with its 3 policies.
- [ ] **Guides.** One page per sidebar entry above, each as Steps with real
  commands and a Badge for platform or provider limits. Antigravity and Codex
  get their own pages, so the support differences are not hidden in tables.
- [ ] **Security & privacy.**
  - Where tokens live per OS. Linux and Windows store them as plaintext files
    under the profile; state this.
  - What agent-switch reads, and the complete egress list.
  - The read-only guarantee outside `rebind` (ADR-003, ADR-004).
  - No telemetry, no account.
  - How to report a vulnerability. Add `SECURITY.md` if it is missing.
- [ ] **Reference pages.**
  - CLI: every command from `src/index.ts`, grouped. Long behaviour moves out
    of table cells into sections.
  - Configuration: the complete file list from the ground truth, as a FileTree.
  - Environment variables.
  - Platform matrix: feature × OS × provider.
  - Troubleshooting & FAQ: "Sign-in needed", wrong account picked, API-key env
    overrides, the VS Code extension, cmd.exe.
  - Glossary.
- [ ] **Retire `introduction.md`, `first-accounts.md` and `installation.md`.**
  Add redirects from their old slugs (`redirects` in `astro.config.mjs`) so
  existing links keep working.

## Phase 5 — Visual proof

- [x] **Correct `info-image.png` (D1).** Change exactly three labels:
  "Model Preference" becomes "Balanced Starts", "Auto Failover" becomes "Live
  Rebind", and the process step "Auto-Switch (if needed)" becomes "Suggest
  Switch". Keep layout, size (1774×887), colours and typography identical.
  Done 2026-11-01. All three labels were checked visually, the spelling is
  exact, the image is 1774×887, and nothing else in the image advertises a
  feature the code lacks.
- [ ] **Derive the image crops.** From the corrected file, derive the 1200×630
  OG crop (Phase 3) and the 1280×640 social-preview crop (Phase 6).
- [ ] **Record the demo GIF and clip from the Phase 1 storyboard.** Use
  anonymized accounts, keep each ≤ 3 MB, and ship a poster image for the docs.
- [ ] **Refresh app screenshots against the 2.8 UI.** Cover the overview, the
  tray popover, the near-limit notification, the session sheet, settings ›
  protection, and the desktop pet (missing today). Use one source folder,
  `.github/assets/screenshots/`, and copy it into `starlight/public/` at build
  time instead of keeping byte-identical duplicates.
- [ ] **Regenerate terminal SVGs** with `starlight/screenshots/generate.mjs` for
  every command shown on Start-here pages.
- [ ] **Run screenshot hygiene on every image.** No real names, emails, paths or
  tokens.

## Phase 6 — Discoverability (repo-side only, no outbound posting)

- [ ] **Prepare GitHub repo metadata.**
  - The description: the tagline.
  - The homepage: the docs URL.
  - Topics: claude-code, codex, antigravity, ai-coding, multi-account,
    account-switcher, rate-limits, developer-tools, cli, tauri.
  - A social preview: a 1280×640 crop of info-image.

  Applying them is a repo-settings change the maintainer makes or confirms.
- [ ] **Docs SEO.** Each Start-here and Guide page carries the search phrase a
  user would type ("switch claude code accounts", "multiple claude max
  accounts", "codex multiple accounts", "claude code rate limit") in its title
  or description, written naturally.
- [ ] **Release-notes link.** The docs and README link to GitHub Releases. A
  generated CHANGELOG is out of scope; note it as a follow-up if wanted.

## Phase 7 — Verify

- [ ] **Claims audit.** Write a table in `agents/evidence/docs-claims-audit.md`
  with one row per factual statement in the README, the landing page and the
  Start-here pages: statement, code reference, verified yes/no. No row may be
  "no" at merge. The info-image is audited the same way (D1).
- [ ] **Fresh-machine run.** Run the README quick start on a clean
  `AGENT_SWITCH_HOME` in zsh and one other shell, and paste the transcript into
  the audit.
- [ ] **Docs build and links.** `npm run build` in `starlight/` passes, and
  `starlight-links-validator` reports zero broken links.
- [ ] **CLI-reference drift check.** A test asserts that every command
  dispatched in `src/index.ts` appears in `reference/cli.md` (or is on an
  explicit internal list).
- [ ] **Remove orphans.**
  - `info-banner.png` and `banner.png` once nothing references them.
  - `app-sessions.png`.
  - The duplicated `starlight/public/screenshots/app-*.png`.
- [ ] **README render check** on GitHub (light and dark) and on npmjs.com after
  the next publish.

## Acceptance criteria

- A developer who has never heard of agent-switch can say what it does and why
  they want it after the first screen of the README, and has it working after
  the three quick-start steps.
- The corrected `info-image.png` (D1) is the top image of the README and the
  banner of the docs landing page, and every claim it makes is true.
- No user-facing page states something the claims audit cannot back with code.
- The README is ≤ 220 lines and contains no reference tables. Starlight
  contains every reference detail the README dropped.
- The repo has a description, topics, a homepage and a social preview, and npm
  has keywords and a homepage.
- The docs build in CI on every PR with zero broken links.

## Not in this roadmap

- Outbound distribution: Reddit/HN/Product Hunt launches, awesome-list PRs,
  maintainer outreach. These are a follow-up roadmap once this one ships the
  page those posts would link to. Every outbound post needs the maintainer's
  explicit go per action.
- agent-config (AC) positioning and skill packaging. That belongs in the AC
  repo.
- Benchmarks of balanced starts ("quota saved"). This would be the strongest
  proof point, but it needs a measurement design first. Candidate follow-up.
- A German Starlight locale.
