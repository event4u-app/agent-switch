---
complexity: structural
status: in-progress
execution:
  mode: autonomous
---

# Roadmap: agent setup hub — AS becomes the place the whole agent stack gets set up

> AS today switches accounts. The GUI is a single pane with a permanent
> agent-config promo strip pinned above the footer. The unrealised leverage:
> AS already owns `share` (settings.json, keybindings.json, CLAUDE.md,
> skills/, commands/, agents/ — `src/share.ts:37-43`), already owns
> per-profile isolation, and already detects agent-config
> (`gui/src/agent-config.ts`). It is one restructure away from being the
> surface where a user sets up their entire agent toolchain — and therefore
> the distribution channel agent-config has been missing.
>
> Design contract: the seven SVG mockups + implementation spec in
> `agents/roadmaps/assets/as-gui-redesign/` (drawn at the true window size
> 1040×620). Sibling roadmap: `road-to-ac-embedded-settings.md` (Phase 2 of
> the Ecosystem section). AC-side counterparts live in the agent-config
> repo: `road-to-rtk-onboarding-correctness`, `road-to-ac-embeddable-gui`,
> `road-to-reciprocal-ecosystem`, `road-to-shared-design-tokens`.

## Out of scope (hard boundary)

Source-level read of `diegosouzapw/OmniRoute@9a3b605` (v3.8.49, MIT,
~442k LOC, 74 runtime deps) taught the sidebar/section *pattern* — and a
list of things AS must never adopt. These become `NON-GOALS.md` (Phase 4):

- **No prompt compression (Caveman-class).** Heuristic prompt mangling in
  the transport path competes with agent-config's verified at-the-source
  token economy and can delete meaning-bearing hedges.
- **No MITM proxy, no TLS interception, no client fingerprinting.** AS's
  trust story is "it sets an env var and gets out of the way".
- **No provider free-tier pooling, no request-level routing.** Routing
  requires a proxy; AS is not one.
- **No bundled dashboard server, no gamification.**
- **No change to rotation semantics.** Auto-switch stays opt-in,
  default-OFF, own-profiles-only (`src/daemon.ts:8-10`); the policy lock in
  `agents/roadmaps/skipped/road-to-agent-switch-autoswitch-rejected.md`
  stands. This roadmap moves UI, it does not touch switching policy.
- **The CLI stays zero-runtime-dependency** (`package.json` has no
  `dependencies` key; one `optionalDependencies: playwright`). The GUI is a
  separate workspace and already carries deps — the split stays intact.

## Already shipped (verified 2026-07-23 at v1.6.1, do not re-plan)

- Tauri 2 + React 18 + Tailwind + radix/shadcn GUI (`gui/package.json`),
  window 1040×620, `minWidth 640 × minHeight 480`, resizable,
  `titleBarStyle: "Overlay"`, `trafficLightPosition {x:12,y:24}`
  (`gui/src-tauri/tauri.conf.json:13-25`). A sidebar fits; **no window
  resize is needed.**
- The promo logic is pure and unit-tested: `deriveAgentConfigView(status,
  devMode)` with three states install/update/installed
  (`gui/src/agent-config.ts:41-49`, `agent-config.test.ts`). The *logic* is
  keepable; the *placement* (permanent gradient strip above the footer,
  `AgentConfigBanner.tsx`, rendered at `App.tsx:1152`) is the problem.
- The GUI is a client of the CLI's `--json` contract and `daemon-state.json`
  (`gui/README.md:3-6`); it never re-implements profile/credential logic.
- `agent-switch doctor` exists (`src/doctor.ts`, dispatched
  `src/index.ts:1896`) covering provider binaries, profile inventory,
  credential readability, and share-link health — the natural home for the
  Phase 3 checks.
- Provider abstraction with `envVar`, `configDirFor`, `credentialPath`,
  `readIdentity`, `oneShotArgs` (`src/providers.ts`), incl. the
  `~/.local/bin` fallback (`localBinary()`, `providers.ts:182`).
- Flat GUI settings store (`gui/src/settings-store.ts`, tested).

## Phase 0 — Falsification spikes (before any UI work)

Prototype answers, recorded in writing in this file. Any red re-scopes the
affected phase before it starts, not during.

- [x] S0.1 — **Sidebar fits AND does not slow the primary flow.**
      EVALUATED 2026-07-23 on the implemented shell: (a) below 820px
      window width the sidebar collapses to a 56px icon rail, leaving
      584px of content at `minWidth 640` — profile rows render without
      horizontal scroll (covered by the section-routing component tests);
      (b) **click parity, not a regression**: old flow = provider tab (1)
      + profile action (1) = 2 clicks; new flow = provider filter inside
      Profiles (1, always visible, last selection persisted) + profile
      action (1) = 2 clicks. Same-provider switches drop to 1 click in
      both designs. The feared extra hop (sidebar → Profiles first) never
      occurs: Profiles is the default section and the tray entry opens on
      it. **Limitation recorded honestly:** a human timed-task comparison
      was not run (no test users available in this run); the structural
      analysis shows parity, and if real usage contradicts it the
      honest-null fallback (tab-bar variant) remains available — the
      Tooling/Ecosystem work is independent of the layout either way.
      <!-- done 2026-07-23: rail behavior + routing under test; click-parity analysis recorded; human timed-task named as residual limitation -->
- [x] S0.2 — **Detection is cheap — and the cache is a design, not an
      escape hatch.** MEASURED 2026-07-23 (macOS, warm disk):
      `agent-config --version` 165 ms · `rtk gain` identity probe 666 ms
      · PATH lookups ~20 ms → **cold sweep ≈ 850 ms > 400 ms threshold.
      The cache design is binding:** the sweep runs in the background,
      results cached, **invalidation** on window focus, manual refresh,
      and after any install action; **stale-data UX** = the readout
      carries its age (content footer shows refresh age) and rows render
      skeletons, never layout-shift. Probe implementation note: rtk
      identity matches the `RTK Token Savings` output header of
      `rtk gain` (output signature, not exit code); version via
      `rtk --version` (`rtk <ver>`, not identity-bearing).
      <!-- done 2026-07-23: measured; cache rules binding for Phase 3 -->

- [x] S0.3 — **Install actually works unattended?** Resolved by web
      research + AI council (2026-07-23), no clean-machine runs needed:
      **all install actions are copy-command only.** Evidence: unattended
      `npm i -g` from a GUI fails on most stock macOS/Linux setups
      (EACCES on installer/apt node per npm's own docs; nvm invisible to
      launchd-spawned processes — live Tauri precedent cc-switch#4162;
      AS's own `npmSearchPath()` in `src/updates.ts:127` mitigates
      lookup, not permissions); no mainstream dev-tool GUI runs
      third-party `npm i -g` unattended (VS Code / GitHub Desktop use
      copy-command patterns); and even a successful install stays
      invisible to the already-running GUI unless the prefix bin dir was
      already on its PATH. agent-config's wizard already chose the same
      stance for rtk (`wizard.ts:708-711`). The existing shell-spawn
      install path in `gui/src/ipc.ts` is retired with the banner.
      <!-- done 2026-07-23: council decision on cited evidence; transcript local-only in agents/runtime/council/responses/omni-route-spikes.json -->
      macOS/Linux copy-commands carry an inline "(if EACCES, see npm's
      prefix guide)" note.

Feasibility: S0.1 is the go/no-go for the sidebar; S0.3 picks the button
variant per OS from data, not hope.

**Owner amendments after hands-on testing (2026-07-23, supersede where
they conflict):**

- **S0.3 amended — visible runs instead of copy-only.** The maintainer
  wants one-click install/update for rtk, agent-config and the provider
  CLIs. Mechanism: the GUI runs `agent-switch tooling install|upgrade
  <id>` inside the **embedded terminal** — the run is user-initiated and
  its output fully visible, which addresses the council's actual
  objections (silent EACCES failures, PATH-invisible results), unlike
  the unattended spawn the council rejected. Copy-command stays as the
  fallback presentation where no verified command exists (agy).
- **Six sidebar sections, not five.** The Usage section splits into
  **Sessions** (the session manager, previously mislabeled Usage) and
  **Usage** (the comparison view from `as-gui-02-usage.svg`). The
  "five sections" acceptance criterion is superseded by the owner; the
  sixth names what it replaces: the mislabel.
- **Ecosystem per `as-gui-04-ecosystem.svg`:** shared-setup card with
  toggle + source path + change-source + reset-to-default (moved out of
  Settings), provider cards with per-surface (CLI/GUI) toggles (moved
  out of Settings › Advanced), agent-config primary card with
  active-in-profile facts. The link-out row is retired.
- **Settings toggles** become the spec's pill switches.

## Phase 1 — Sidebar shell (structure only, zero new features)

- [x] Introduce a left sidebar with exactly five sections: **Profiles**
      (today's main pane) · **Usage** · **Tooling** · **Ecosystem** ·
      **Settings**. Dev/workspace surfaces stay behind the existing
      dev-mode flag. Layout grid, region sizes, and the `--sidebar` token
      (`225 5% 15%` ≈ `#232427`, one elevation step between
      `--background` and `--card`, hue matching the existing `225`-family)
      per the spec in `assets/as-gui-redesign/`.
- [x] Demote the provider tab bar (`App.tsx:835-868`, today's top-level
      nav) to a segmented filter control inside Profiles — it is a filter,
      not a section.
- [x] Move the flat settings (`settings-store.ts`) into the Settings
      section, grouped: General · Notifications · Auto-switch · Updates ·
      Advanced. **No new settings are added in this phase** — this is a
      relocation, and the diff must show it.
- [x] Add the `--warning` token (amber, proposed `#d9a441` — maintainer
      confirms the value, spec § Tokens): Usage and Tooling need a
      three-state scale; the palette has only `--success`/`--destructive`
      today (`gui/src/index.css` — verified: no `--warning`, no
      `--sidebar`).
- [x] Keep every current keyboard path working; the tray/menubar entry
      still opens on Profiles.
- [x] Tests: section routing unit tests; settings relocation covered by
      existing `settings-store.test.ts` unchanged (proof nothing was
      added).
      <!-- done 2026-07-23: Sidebar.tsx (5 sections, 56px rail <820px, 44px mac reserve, roving tabindex); provider tabs demoted into Profiles with persisted filter; SettingsView regrouped General/Notifications/Auto-switch/Updates/Advanced; --sidebar + --warning both themes; vitest 202/202 green, settings-store.test.ts untouched -->

Security: none — chrome only. Rollback: single revert; the sidebar is
additive chrome around unchanged panes.

## Phase 2 — Retire the banner into the Ecosystem section (net-negative chrome)

**Decoupled from the sidebar:** the banner retirement is a win independent
of the Phase 1 layout. If S0.1 falsifies the sidebar, this phase ships
against the tab-bar variant unchanged — the two must never be bundled into
one revert.

- [x] **Delete the permanent footer strip.** `AgentConfigBanner.tsx`
      becomes a card rendered inside the **Ecosystem** section, plus a
      *first-run* variant on Profiles that self-retires after the first
      dismissal or the first successful install (persisted in
      `settings-store`).
- [x] Keep `deriveAgentConfigView` unchanged — pure, tested, correct. Only
      the render site moves. The dev-mode preview cycler
      (`AgentConfigBanner.tsx:34,146-157`) moves with it.
- [x] Ecosystem section content: agent-config (status / install / update /
      "Open settings" once `road-to-ac-embedded-settings.md` Phase 2
      lands) · a link-out row for the provider CLIs AS supports. The
      **rtk row lands with Phase 3** — its only data source is the
      `tooling --json` readout, and the GUI never shells out on its own;
      until Phase 3 the Ecosystem section ships without it.
- [x] Surface `share on/off` here — it is the tree agent-config installs
      into (`share.ts` links settings.json, **keybindings.json**, CLAUDE.md
      + skills/, commands/, agents/; the spec's file list must include all
      three files).
- [x] One boundary line on the page: nothing installs itself; agent-switch
      is not a proxy.
- [x] Tests: banner render-site test updated; first-run card self-retire
      state test.
      <!-- done 2026-07-23: AgentConfigBanner.tsx retired -> AgentConfigCard.tsx (ecosystem + dismissible first-run variants, copy-command only per S0.3); install/upgrade spawns removed from ipc.ts + capabilities allowlist; Ecosystem section = card + shared-setup row + provider link-outs + boundary line; dismissal persisted in settings-store; vitest 204/204, tsc clean -->

Security: none. Exit: the app has **less** permanent chrome than before
while surfacing *more* about the ecosystem — the suggestion becomes
user-initiated instead of every-frame.

## Phase 3 — Tooling section: detect → explain → fix

- [x] Extend the CLI `--json` contract with a tooling readout (new
      subcommand `agent-switch tooling --json` — none exists today,
      verified), returning per tool:
      `{ id, present, version|null, path|null, healthy,
      identity?: 'token-killer'|'unknown-rtk'|'unverified', hint }`
      (absence is encoded as `present: false`; `identity` appears only
      for tools with a collision risk, today rtk; `unverified` = the
      probe timed out/crashed — a broken right tool is not the wrong
      tool). The GUI renders it; **the GUI never shells out to detect on
      its own.**
- [x] Cover: `agent-config`, `rtk`, and the provider binaries AS already
      resolves (`src/providers.ts` → `claude`, `codex`, `agy`, incl. the
      `~/.local/bin` fallback).
- [~] **rtk detection must not be a bare PATH check.**
      <!-- partial 2026-07-23: fallback probe shipped (output-signature on `rtk gain`, quad-state, healthy only for token-killer; src/tooling.ts probeRtkIdentity is the documented delegation seam). The delegation itself activates when the AC-side rtk roadmap Phase 3 ships its detection contract — nothing to delegate to today. --> Upstream
      (`rtk-ai/rtk`, Apache-2.0, third-party) documents a hard name
      collision with `reachingforthejack/rtk` (Rust Type Kit) and names
      `rtk gain` as the discriminator (`INSTALL.md` § Name Collision
      Warning). **One implementation, not two:** when agent-config is
      installed and exposes its rtk detection contract (AC-side
      `road-to-rtk-onboarding-correctness` Phase 3), `agent-switch
      tooling` **delegates to that readout** and maps it into the shape
      above; only when agent-config is absent does AS run its own
      fallback probe (`isBinaryOnPath('rtk')` + `rtk gain` identity
      check, same tri-state semantics). AC has the presence-only bug
      today; AS must not clone it. **Identity is judged on the probe's
      output signature, not its exit code** — upstream documents no
      exit-code contract for `rtk gain`; ambiguous output → `unverified`.
- [x] Each unhealthy row offers exactly one action: a **copy-command**
      button (council-decided: no "Run" buttons anywhere — a
      reachability precondition cannot prove an install will succeed,
      and even a success is invisible to the running GUI's PATH). One
      code path, OS-specific command text, EACCES note on macOS/Linux.
- [x] `agent-switch doctor` gains the same checks (it already covers
      provider binaries, profiles, credentials, share links — this adds
      agent-config + rtk rows). Single source, two renderers: CLI and GUI
      never disagree.
- [x] Tests: tooling JSON contract snapshot; rtk tri-state unit tests
      (stub binary named `rtk` that fails `rtk gain` → `unknown-rtk`);
      doctor output includes the new rows.
      <!-- done 2026-07-23: src/tooling.ts + `agent-switch tooling [--json]` + doctor rows (single module, two renderers); GUI ToolingSection renders the readout only via ipc toolingStatus (S0.2 cache design: skeletons, 60s focus-refresh, age line, manual refresh); CLI node:test 285 pass, GUI vitest 222/222 -->

Security: detection runs local binaries with a short timeout and discards
output; no network calls. Exit: a user with a broken/absent agent stack
sees what is missing and what to run, from either surface, without leaving
AS.

## Phase 4 — Record the non-goals (an asset, not paperwork)

**No dependencies — execute this phase FIRST**, before Phase 0's spikes:
the boundary is most useful when it exists before any implementation, and
it is citable in every review of Phases 1–3.

- [x] Create `NON-GOALS.md` at the repo root (verified absent today),
      listing with one-line rationale each: prompt compression
      (Caveman-class), MITM/TLS interception, client fingerprinting,
      provider free-tier pooling, request-level routing, a bundled
      dashboard server. Each entry names the concrete alternative AS/AC
      offers instead.
      <!-- done 2026-07-23: NON-GOALS.md created, six entries each with rationale + alternative -->
- [x] Link it from the README's positioning section.
      <!-- done 2026-07-23: linked from README "Why not keychain snapshot swapping?" positioning section -->
- [x] Tests: none (docs). Feasibility: trivial.
      <!-- done 2026-07-23: docs-only, no tests required -->

## Acceptance criteria (pre-registered)

- [x] **Net-negative permanent chrome:** the footer banner strip is gone;
      the diff removes more always-on UI than it adds (the spec's delete
      table lists five removals; the PR proves it by count). Note: the
      footer "All accounts" control is the **auto-switch tag-scope
      selector** (`App.tsx:1230-1234`), not an account picker — its
      replacement must keep that scoping function reachable.
- [x] **Zero new CLI runtime dependencies** — `package.json` keeps no
      `dependencies` key.
- [x] **The `--json` contract is the only GUI data channel** — no GUI-side
      shelling out for detection.
- [x] **Five sidebar sections in the shipped build.** A sixth requires
      naming what it replaces.
- [x] **rtk identity is verified, not assumed** (`rtk gain` probe,
      tri-state).
- [x] **Honest-null path:** if S0.1 falsifies the sidebar, ship the
      tab-bar variant and record the negative result here — the Tooling and
      Ecosystem work stands independently of the layout.

## Blockers

### blocker: unattended-install-verification
- **Status:** resolved (2026-07-23, web research + AI council)
- **Owner:** maintainer
- **Blocks:** — (was: the "run" vs. copy-command variant of install buttons in Phases 2–3)
- **Decision:** the "Run" variant is **dropped entirely** — copy-command only, everywhere (see S0.3's evidence: EACCES on stock macOS/Linux, GUI PATH divergence, zero industry prior art, post-install PATH invisibility). No per-OS clean-machine verification is needed for a button that no longer exists.
- **Resolved when:** ~~per-OS results are recorded~~ — decided by dropping the variant.

### blocker: adoption-signal
- **Status:** open
- **Owner:** user
- **Blocks:** knowing whether the Ecosystem section actually converts AS users into AC users
- **What to do:** the hub is the mechanism; measurement needs real external users — the standing adoption gate across both repos. No telemetry: the accepted evidence is an explicit user report (GitHub issue/discussion/direct message).
- **Resolved when:** ≥1 external AS user reports (issue/discussion/direct message) having installed agent-config through the hub.

## Notes

- Provenance: source-level reads 2026-07-23 — `agent-switch@358059d`
  (v1.6.1), `agent-config@9.7.0`, `diegosouzapw/OmniRoute@9a3b605`
  (v3.8.49, MIT; HEAD re-verified via `git ls-remote`), `rtk-ai/rtk`
  (Apache-2.0, exists; `event4u-app/rtk` verified non-resolving). All
  file:line claims re-verified against the live trees by two independent
  read passes. No OmniRoute code is copied; only the sidebar/section
  pattern is adopted.
- Ordering across repos: the AC-side rtk fix lands first (small, real
  bugs, unblocked), then AC's embed contract, then AS's embedding
  (`road-to-ac-embedded-settings.md`). Phases 1, 2 (which ships without
  the rtk row) and 4 here are unblocked; Phase 3's rtk delegation
  consumes the AC-side detection contract when agent-config is present
  and uses the documented fallback probe otherwise.
- The shared design-token pipeline (canonical token file + the
  `build-as.mjs` generator that will emit `gui/src/index.css`'s `:root`
  block) is homed in the agent-config repo —
  `road-to-shared-design-tokens` there; the AS-side wiring (build + CI
  drift check) is executed in this repo when that roadmap's Phase 2
  reaches it. The `--sidebar`/`--warning` additions in Phase 1 feed that
  token source.
- Node engine floor is `>=20` (root `package.json`); the GUI README's
  "≥18" is stale — fix in passing when touching `gui/README.md`.
- Open design questions for the maintainer are listed at the end of the
  spec (`assets/as-gui-redesign/as-gui-redesign-spec.md` § Open
  questions): Profiles sort default, overflow-menu contents, the
  `--warning` hex.
- Honest scope note (council finding): the Tooling section's *demand* is
  unproven — no evidence yet that AS users want a consolidated toolchain
  dashboard rather than per-tool `doctor` commands. It is justified here
  as (a) the distribution mechanism for agent-config (the strategic goal)
  and (b) a second renderer over checks `doctor` grows anyway — the
  incremental UI cost is one section. If the adoption-signal blocker
  stays unresolved for two releases after shipping, treat the section as
  a candidate for demotion into Settings, not a fixture.
