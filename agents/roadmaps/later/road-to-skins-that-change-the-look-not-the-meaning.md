---
complexity: complex
status: proposal
tree_pin: 6046bc2
---

> **Intake:** owner inbox round `inbox-2026-11-d` (the analysis, chat and this draft are in `agents/tmp.old/inbox-2026-11-d/c/`, gitignored), triaged 2026-11-23 into `later/` by `road-to-a-workbench-that-tells-the-truth` 8.7.
> **Resume condition:** the owner answers the owner questions Q1–Q6 (step 0.5); until then nothing here is built.

# Roadmap: skins that change the look, not the meaning

> **Source.** The owner's chat of 2026-11-23: "improve agent-switch further; analyse
> the current state and five Herdr layouts in depth; what can we learn, use and adapt;
> plan a roadmap; then start again from the last analysis and roadmap, go deeper,
> question the decisions, three loops; I would like to use these designs as
> alternative themes for AS v3."
>
> **Pins.** Every agent-switch line below was read at `dev/v3@6046bc2`
> (2026-11-23 07:54 +01:00, `package.json` version 2.12.0). `main@c3ca61d` is
> version 2.14.3; `dev/v3` is 286 commits ahead of `main` and 75 behind it. Nothing
> here was run in the Tauri window; the references were read, never run.
>
> **Method.** Each finding starts from a defect in this tree. A reference is cited
> per defect, only where it holds a working answer. Nothing is added because a
> reference has it.
>
> **IDs.** F, D, Q, S and AC numbers in this file are proposals of this roadmap.
> None of them is adopted, and none may be cited elsewhere as a basis until the
> owner has accepted this file.

## Goal

A user can pick a theme that changes more than colours: type, shape, words, an
extra region, and for one theme a small living scene. Under every theme the window
still means the same thing: the same states, the same approvals, the same keys,
the same "never automatic".

The five designs become selectable in the theme picker. Two of them are mostly an
arrangement (cards in state columns), so the arrangement is built once as a view
that every theme can use.

No theme runs code. No new hook. No engine output changes with the theme.

## What was read

| ID | Reference | Pin | Licence | Read |
|---|---|---|---|---|
| R1 | kevinpardo/world-of-codecraft | `6c5b65b` (2026-11-08) | MIT; fonts OFL | README, RECIPE, layout, theme, `kit.js`, `activite.js`, `demo.js`, the Claude Code hook; 3,554 files, 122 MB as cloned, 3,372 PNG |
| R2 | PowershellNinja/herdr-aperture | `580020c` (2026-11-06) | MIT; fonts OFL | README, RECIPE, AGENTS, `events.js`, `lexicon.js`, `recovery.js`, test stubs |
| R3 | herdrdev/herdr-layout-examples, `code/` | `0ec9676` (2026-11-02) | Apache-2.0 | README, RECIPE, layout, manifest |
| R4 | dougcunha/herdr-mods, `kanban-app/` and neighbours | `fd86247` (2026-11-22) | MIT | README, AGENTS, the kanban, agent-cards, agent-resume, tokenhound and repo-launcher recipes, `waiting.js`, `kit.json` |
| R5 | Isitea/herdr-dynamic-board | `61eee2b` (2026-11-16) | Apache-2.0 (a changed copy of R3's `board`); bundled parts MIT | README, RECIPE, `rts-command.json`, the skin reader in `main.js`, `docs/platform-notes.md` |
| P | The Herdr app itself | AGENTS.md on `herdr-app@master`, read 2026-11-23 | Apache-2.0 | the agent guide, the core page, the guide page, three blog posts, one third-party review |

Preview images of R1, R2, R3 and R5 were opened and looked at. R4's `preview.png`
is a title card; its look was taken from its recipe.

## Findings

All evidence is at `dev/v3@6046bc2`.

| ID | Defect in agent-switch | Evidence |
|---|---|---|
| F1 | A theme is colours and nothing else. It has no field for a font, a corner scale, a word, a region or an image. None of the five designs can be expressed. | `gui/src/v3/themes/registry.ts:45-62` (`ThemeDef`: `ui`, `terminal`, `diff`); `resolve.ts:56-161` resolves only `--ac-*` and `--as-*` colours |
| F2 | The set of themes is closed. Themes are one compiled array, the group is a closed union, a stored id that is not in the array is dropped without a word, and a test pins the exact list of 18. | `registry.ts:10` (`ThemeGroup`), `:107` (`THEMES`); `adapter/appearance.ts:8,18-19`; `themes.test.ts:48-54` |
| F3 | The v3 window speaks through English literals in its components. Two of the 60 non-test files under `gui/src/v3` import the string table. A theme cannot rename anything, and the German table does not reach these strings. | `frame.tsx:47,51,57,76`; `sessions.tsx:90-91`; importers: `adapter/V3App.tsx`, `adapter/V3TrayApp.tsx` only |
| F4 | The frame is fixed JSX with fixed sizes. There is no bottom region, so a design with a status bar has no place for it. | `frame.tsx:45` (h-11), `:97` (w-11), `:162-201` (`Shell`: title bar, two stripes, three slots) |
| F5 | Fonts are constants. The UI font sits in the stylesheet, the mono font in the Tailwind config and again in the terminal look. | `gui/src/index.css:215`; `gui/tailwind.config.js:75-78`; `workbench.tsx:432` |
| F6 | The corner scale is enforced by a source scan with one allowlist. That is right for today, and it means a theme with square or bevelled corners can only be built by breaking the guard. | `design-guard.test.ts:18-28` |
| F7 | The state `waiting` is drawn and counted, and nothing produces it. The engine's runtime state has three names. A session whose turn ended with a background shell still running reads `idle`. | `gui/src/vm/types.ts:83`; `ui/SessionStateIcon.tsx:7`; `v3/adapter/data.ts:613`; `src/runtime-state.ts:14`, `:48-50`, `:62`; the only other hit is the design fixture, `v3/design-fixture/main.tsx:54` |
| F8 | Sessions can be listed and tabled, never arranged by state. With many live sessions the question "who waits, who works, who is finished" needs a scroll. | list `v3/sessions.tsx:511`; table `v3/pages.tsx:262`; no board under `gui/src/v3` |
| F9 | What a session is doing inside a turn (reading, editing, testing) exists only inside the chat timeline. The window has no small fact for it. The hooks do not carry it, by design: tool events are not hooked. | `src/timeline/events.ts:18-38` (`tool.started`, `tool.finished`); `src/hooks.ts:35` (`HOOK_EVENTS`, nine lifecycle events); cost per hook event `agents/evidence/hook-event-cost-2026-11.md` (45 ms wall p50) |
| F10 | The window has no Content Security Policy. Every asset a theme brings would load into a webview that restricts nothing. | `gui/src-tauri/tauri.conf.json:29` (`"csp": null`) |
| F11 | Two modules parse the stored appearance. One of them is imported only by its own test. | live: `gui/src/v3/adapter/appearance.ts` (imported by `main.tsx:6`, `tray-main.tsx:13`, `V3App.tsx:30`); dead twin: `gui/src/v3/appearance.ts` (imported by `appearance.test.ts:2` only) |

What already fits, so it is not a finding:

- A light frame around a dark terminal is expressible today: the terminal palette is
  resolved on its own (`resolve.ts:138-153`). Not yet seen in a render.
- A sprite contract exists: eight columns by nine rows, 192×208 px frames, nine
  reactions (`gui/src/pet/model.ts:26-50`; eight pets, 260 KB under `gui/public/pets`).
- A render check exists: three themes times three data shapes with clip, wrap and
  overlap checks (`gui/scripts/screenshots/v3-render.mjs:7-18`).
- Limits carry what a resource bar needs: used share, reset time, pace, age
  (`v3/limits.tsx:15-38`).

## What the references do at the same places

| For | Reference | Taken as |
|---|---|---|
| F1 | A layout names a theme, a terminal font, a UI font, paddings and a pane frame next to its colours; the theme file carries state colours of its own (`working`, `blocked`, `done`, `idle`, `unknown`). | pattern: R1 `layouts/World-of-Codecraft.json` (root keys), `themes/World-of-Codecraft.json` (`colors`); P AGENTS.md § theme colour names |
| F1, F6 | One board, two looks: the second layout passes a small object (`font`, `bevel`, `alerts`, `labels`, `ticker`, `radar`) and the same code reads it. | pattern: R5 `layouts/rts-command.json:8-10`; `mods/dynamic-board/main.js:86-99` |
| F2 | A layout is a folder: definition, parts, a brief and a preview. It is added next to what exists and never overwrites. | pattern: P AGENTS.md § community layouts; R3 `README.md` |
| F3 | Every visible string in one table per language; state words per look. | pattern: R1 `mods/world-of-codecraft/i18n.js` (212 lines, FR and EN); R2 README § Terminology; R5 `labels` |
| F3 | A voice: rotating lines per event kind with four placeholders, pure data, unit-tested. Each line is shown behind a factual tag. | pattern: R2 `aperture/mods/aperture/lexicon.js:6-20` (tags), `:22-111` (lines); `events.js:59-71` |
| F4 | Regions are named blocks with a pixel size or a weight; a region can be hidden and shown; one design is "five regions": bar, rail, explorer, work area, status bar. | pattern: R3 `code/layouts/code.json`; `code/RECIPE.md` § What you see |
| F7 | A "Waiting" column for a Claude Code session that looks finished while background subagents or shell commands still run. It is read from the transcript and the session registry, it expires after an hour, and the user can dismiss it per turn. | pattern: R4 `kanban-app/RECIPE.md:32` ff.; `mods/kanban/waiting.js:1-22`, `:35` |
| F8 | Cards in state columns; columns can be hidden and reordered; an empty column folds to a strip; a subagent is a dashed card linked to its parent and is never "done" by itself; keyboard next/previous follows the order shown. | pattern: R4 `kanban-app/RECIPE.md` § How it behaves; R5 `RECIPE.md:43,52,72` |
| F9 | A small activity word per agent (thinking, reading, editing, command, test, web, compacting, finished) plus counters. A scene changes only after the new one was asked for 8 s and the old one lasted 15 s. | pattern: R1 `integrations/claude-code/wocc-activity.py:47-61`; `mods/world-of-codecraft/activite.js:30-31` |
| F10 | The platform says it plainly: parts are trusted code with the user's rights, and nothing is reviewed. Its own install rule is "read every file first, say what it runs". | counter-example: P AGENTS.md § security; R2 `AGENTS.md:24` ff. ("Tier 2") |
| all | Every design ships a brief with five fixed sections that ends in "Done when", and a demo mode so a preview never shows the owner's projects. | pattern: P AGENTS.md § RECIPE.md; R1 `demo.js:1-3`; R4 `agent-cards.demo` |

Two things the references measured, which bound this roadmap:

- R1 states its own cost: about 27 % of one core on an M2 Pro with animations, about
  10 % with stills (`RECIPE.md:131`).
- The platform cut 89–95 % of CPU in render-bound workloads by removing a spinner,
  skipping hidden panes and ignoring pointer motion, and drew one rule from it:
  motion marks a change of state, not the fact that something is running (blog post
  of 2026-08-03). Their architecture is not ours; the rule is what transfers.

## The five designs, taken apart

A design is up to five layers. Only the first exists in agent-switch today.

| Design | Colours | Look (type, corners, edges) | Words | Region or view | Scene | Verdict |
|---|---|---|---|---|---|---|
| R3 Code | dark editor greys, blue bar | flat tabs, square corners | none | a status bar with "N working · N need you" | none | Cheapest. Its explorer and code view are decoration by its own brief (`code/RECIPE.md:72`) and are not taken. |
| R4 Kanban | follows the host theme | cards, 12–16 px corners | five column names | the board | none | It is an arrangement. Built as a view. |
| R5 Dynamic Board | paper / graphite, violet accent | cards, 7 px corners | four column names | the board above the terminals, filter chips, folded columns | none | The same view with other defaults. |
| R5 RTS variant | green on black | mono font, bevelled edges, scanlines | four order words, an alert tag | a ticker in the status bar; a radar | none | Look and words over the board. The radar is not taken (see "Not in this roadmap"). |
| R2 Aperture | light panels, dark consoles, orange | signage capitals, 6 px frames | a full terminology table | header counts, a footer line, a records list | a breathing mark | Words and voice carry it. Its window that opens by itself and its sounds collide with principle 1. |
| R1 World of Codecraft | oak, parchment, gold | carved frames from image strips, four fonts | every string | resource bar, districts column | a village with one actor per agent | The only one that needs a scene. 122 MB as cloned. Last, behind a gate. |

## Decisions (proposals)

| ID | ownership | Decision | Why | Revisit if |
|---|---|---|---|---|
| D1 | reversible-technical | A theme has up to five layers: colours (today), look, words, regions, scene. All but colours are optional. One picker. A theme with any layer beyond colours is called a skin in code and "theme" in the window. | F1; the owner's word is "themes" | S1 shows the look layer cannot be reached by tokens |
| D2 | reversible-technical | A skin is data: typed tokens, word tables, references to bundled images and fonts. No script, no stylesheet text, no selector. Built-in skins load through the same loader a later on-disk pack would use. | F10; the platform's own caveat; a theme store that ran code once deleted a user's files (KDE, March 2024) | — |
| D3 | owner (Q3) | What never changes with a skin: principles 1–6 and §13 of the UI spec, the meaning of every state mark (one mark per state, every state has one), the contrast floors, the keyboard map, the reachability of every 2.11 function. What a skin may set: fonts, a corner scale, edge style, the shape of a mark, words, optional regions. | F6; spec §1, §3.2, §3.3, §13 | a skin needs a rule from the first list to look right; then the skin loses that trait |
| D4 | reversible-technical | The v3 window's strings move into the string table first. A skin's words are an overlay per language on that table. An overlay key must exist in the base table with the same placeholders. | F3 | — |
| D5 | reversible-technical | The engine never speaks in a skin. CLI output, `--json`, OS notifications and the activity log keep their words. A skin's voice exists only inside the window. | one truth for scripts and other tools; `src/hooks.ts:398-408` stays as it is | — |
| D6 | reversible-technical | Regions are a fixed, named set, not a layout tree: title bar, left stripe, sessions, workbench, right window, right stripe, and two new optional ones, status bar (bottom) and scene (bottom strip). A skin sets shown or hidden and a size inside bounds. | F4; a general layout engine is a second product | two skins need a region this set cannot give |
| D7 | owner (Q1) | The board is a view: a page tab, and optionally a zone above the workbench. It exists under every theme. "Kanban" and "Dynamic Board" are picker entries that bring their colours and switch the board on. | F8; both designs are arrangements | — |
| D8 | reversible-technical | Board columns come from the engine's runtime state and nothing else. A card is the session row's own grammar (state mark, tool, account tick, title, trailing fact). A child is a linked card that names where the relation comes from. | spec principles 4, 7, 10 | — |
| D9 | reversible-technical | `waiting` is decided by S2. If a session takes a turn by itself when its background job ends, `waiting` gets a producer in `runtimeState` with `source: "host"`. If it does not, `waiting` is removed from the state type. Either way the dead state goes. | F7 | — |
| D10 | reversible-technical | The activity fact comes from the timeline reader, not from new hooks. It is computed only while something visible shows it. | F9; nine hook events stay nine | S4 over budget |
| D11 | reversible-technical | One scene renderer for every skin: image layers, named spots, actors drawn from sprite sheets in the pet contract. An actor's spot follows the session's state. A scene change waits 8 s of asking and 15 s of holding. | R1's anti-flicker rule; `gui/src/pet/model.ts:26-50` | — |
| D12 | reversible-technical | Motion marks a change. A steady state is still. With reduced motion, and whenever the window is hidden, nothing animates and no timer runs. | the platform's measured rule; `index.css:342` already handles reduced motion for the pulse | S3 shows the pulse costs nothing measurable; then the pulse stays |
| D13 | owner (Q2) | Bundled skins carry original names and original art. No third-party name, mark, quoted line or sound ships in the package. Each adopted idea gets an entry in `ADOPTED.md`. | R2 calls itself an unofficial fan work of another company's game; R1's name plays on another | the owner decides otherwise in Q2 |
| D14 | reversible-technical | The window gets a Content Security Policy before any skin asset is loaded from outside the bundle. | F10 | — |
| D15 | reversible-technical | Every skin ships a brief (`SKIN.md`: what you see, how it behaves, built from, watch out, done when), a demo fixture, and frames in the render check. "Done when" is a test or a render, never a sentence. | the references' strongest habit; spec §14 | — |
| D16 | reversible-technical | Order: model, words, regions with the editor skin, the board, the facility skin, the console skin, the village. Each phase ends in something a user can pick. | the cheap layers prove the model before the art is paid for | — |
| D17 | reversible-technical | No sound in this roadmap. | no audio exists in the GUI today; quiet hours are open in `road-to-the-ready-remainders.md` 3.5 | quiet hours have shipped |
| D18 | reversible-technical | Nothing opens by itself in any skin. A turn that finished while the user was away is a line in the voice feed and a count in the existing away digest. | spec principle 1; `v3/needs.tsx:26-32` | — |

## Owner questions

| ID | Question | Options | Default without answer |
|---|---|---|---|
| Q1 | Kanban and Dynamic Board are arrangements, not looks. How do they appear? | (1) the board is a view under every theme, and two picker entries switch it on with their colours (2) the view only, no picker entries (3) two separate window arrangements | (1) |
| Q2 | Names and art of the bundled skins. | (1) original names and own art, the references credited in `ADOPTED.md` (2) the references' names, offered as a separate download, not in the package (3) the references' names in the package | (1). This is not legal advice; (3) should not be chosen without it. |
| Q3 | May a skin change the corner scale and the shape of a state mark? It changes spec §3.1 and §3.3. | (1) yes, from a short list per skin, checked by the guard (2) no: colours, fonts and words only | (1); with (2) the facility and village skins cannot be built and Phases 5–7 shrink to colours and words |
| Q4 | A board "Done" column in the references means "finished since you last looked". The council decided on 2026-11-22 against an unseen rank or mark in the Sessions list (D13 of `road-to-a-tree-that-reads-at-a-glance`). | (1) the board's last column holds idle sessions; no unseen notion anywhere (2) an unseen notion on the board only | (1) |
| Q5 | The village needs art. | (1) a small own set: one ground image by day and by night, six buildings, actors from the existing pet sheets (2) ask R1's author for a pack under his name as a separate download (3) no village | (1), behind the S3 gate |
| Q6 | Where does this land? `dev/v3` is 75 commits behind `main`. | (1) on `dev/v3` after it has taken `main` (2) on `dev/v3` as it is | (1) |

## Spikes

- **S1 — how far tokens reach.** Build the editor skin's look in a scratch branch
  with tokens only (fonts, a corner scale, a flat tab, a bar colour). List every
  component that needs a branch on the skin instead of a token. Output:
  `agents/evidence/skin-token-reach-2026-11.md` with frames in three themes plus the
  skin. *Kill:* more than five components need a branch. Then the look layer is
  reduced to fonts and colours and Q3 is answered (2).
- **S2 — a turn that ended with work still running.** Record the registry word and
  the transcript once per second through: a turn that ends with a background shell
  that exits after two minutes; one that never exits; a turn that ends with an async
  subagent running. Claude Code version noted. Output: an addendum to
  `agents/evidence/registry-status-across-a-turn-2026-11.md` and a fixture. *Kill:*
  the session never takes a turn by itself in any of the three. Then `waiting` is
  removed (D9).
- **S3 — what motion costs here.** In the Tauri window on macOS: ten working rows
  with the pulse, the same with stills; then six actors at 8 frames per second on a
  ground image. CPU of the webview process over 60 s each, with a frame counter next
  to it. Output: `agents/evidence/window-motion-cost-2026-11.md`. *Budget (proposal,
  set by this spike):* a visible scene at most 5 % of one core on the reference
  machine, 0 % when the window is hidden. *Kill:* the scene misses the budget at 4
  frames per second too. Then the village ships with stills only.
- **S4 — the activity fact.** Read the last tool event from the transcript tail of
  ten live sessions at most once per second, only on a change of the file's size.
  Output: wall time and CPU per second in the same evidence file. *Kill:* more than
  10 ms per second in total. Then the fact is computed for the active session only.
- **S5 — the window under a policy.** Run the v3 window and the tray under
  `default-src 'self'; img-src 'self' asset: data: blob:; font-src 'self' asset:;
  style-src 'self' 'unsafe-inline'; connect-src ipc: http://ipc.localhost`. List what
  breaks (the terminal's WebGL renderer, the embedded agent-config page, the pet
  window). Output: `agents/evidence/window-csp-2026-11.md`. *Kill:* none; a break
  becomes a step in Phase 1.

## Phase 0 — Probe

- [ ] **0.1 Run S1.** verify: the evidence file lists the components by path and
      holds the frames.
- [ ] **0.2 Run S2.** verify: one row per situation with the observed words; the
      kill condition is answered yes or no in the file.
- [ ] **0.3 Run S3 and S4.** verify: each number has its counter next to it.
- [ ] **0.4 Run S5.** verify: the list of breaks, each with the directive that
      causes it.
- [ ] **0.5 Record Q1–Q6.** verify: each question has the owner's answer or the
      note "default taken" with the date.

## Phase 1 — A theme that can hold more than colours

Nothing a user sees changes in this phase.

- [ ] **1.1 One appearance module.** Delete `gui/src/v3/appearance.ts` and its test;
      move the cases the live module lacks (`initialAppearance` for an existing
      install) into `adapter/appearance.ts` first. verify: red first for "an install
      with accounts and no stored choice keeps the Agent Switch palette"; no importer
      of the deleted file remains.
- [ ] **1.2 Layers on `ThemeDef`.** Optional `look`, `words`, `regions`, `scene`;
      each a plain typed record. `ThemeGroup` gains `skins`. verify: type test; the
      18 existing entries compile unchanged.
- [ ] **1.3 The order test pins the first 18.** verify: the test fails when one of
      the 18 moves and passes when an entry is added after them.
- [ ] **1.4 Look tokens.** `--ac-font-ui`, `--ac-font-mono`, `--ac-font-display`,
      `--ac-radius-mark`, `--ac-radius-control`, `--ac-radius-card`,
      `--ac-radius-layer`, `--ac-edge` (line or bevel). The stylesheet, the Tailwind
      config and `TERMINAL_LOOK` read them. Defaults are today's values. verify: the
      render check's frames for the three themes are pixel-equal before and after.
- [ ] **1.5 State tokens.** `--ac-state-working`, `-needs`, `-waiting`, `-idle`,
      `-done`, defaulting to today's mapping in `SessionStateIcon`. A contrast floor
      of 3:1 against panel and bg for each. verify: `themes.test.ts` covers every
      theme; red first for a palette whose `ok` misses the floor.
- [ ] **1.6 The guard takes the scale from the theme.** The allowlist in
      `design-guard.test.ts` becomes "the radius utilities that map to the four
      tokens". verify: a raw `rounded-[7px]` in `gui/src/v3` still fails.
- [ ] **1.7 A policy for the window (D14).** The policy from S5 in
      `tauri.conf.json`, with the fixes S5 listed. verify: the Tauri build starts,
      a hosted terminal draws, the tray opens; a test page that loads a remote image
      is blocked.
- [ ] **1.8 Spec.** §2 gains the layers and the lists of D3; §14 gains "every skin
      is rendered next to the three themes". verify: the spec names every new token.

## Phase 2 — Words that can change

- [ ] **2.1 The v3 window through the string table.** Every visible literal under
      `gui/src/v3` moves to `gui/src/i18n/en` with a German entry. verify: the
      existing lint test for the tables covers the new keys; a source scan finds no
      JSX text literal of three letters or more under `gui/src/v3` outside tests and
      fixtures; the render check gains a language switch (the 2.11 capture has one,
      `SHOTS_LANG`, `gui/scripts/screenshots/capture.mjs:48`) and finds no clipped or
      wrapped control in German.
- [ ] **2.2 The overlay.** `words: { en: {...}, de: {...} }` on a skin, looked up
      before the base table. verify: unit test; a key that is not in the base table,
      or whose placeholders differ, fails the build.
- [ ] **2.3 State words stay findable.** Under a skin that renames a state, the
      plain word is in the mark's tooltip ("Awaiting orders · needs you"). verify:
      view test for all states under a skin with renamed states.
- [ ] **2.4 The engine does not change.** verify: the CLI snapshot tests under
      `tests/fixtures/cli-snapshots` pass unchanged with a skin selected in the
      window's store.

## Phase 3 — A region more, and the first skin: Editor

- [ ] **3.1 Regions as data (D6).** `Shell` reads which optional regions are shown
      and their sizes from the theme; the six existing regions keep their sizes.
      verify: frame test; pixel-equal frames for the three themes.
- [ ] **3.2 The status bar.** Height 24. Left: working count, needs-you count (the
      inbox pill's data, `frame.tsx:18-22`), engine health. Right: the next account
      for new sessions and its tightest window. Hidden by default. A click on a count
      does what the title-bar pill does. verify: view test; with the bar shown the
      title-bar pill is not drawn twice.
- [ ] **3.3 The Editor skin.** Colours from the editor's own published dark theme,
      read at a pinned commit, with the link in `source` like every other entry.
      Flat tabs, square controls, the status bar shown and filled with the accent.
      No explorer, no code view. verify: contrast tests; frames at 1440×900 with the
      demo data, 40 long-named sessions and no sessions; `SKIN.md` with a "Done
      when" that names these frames.
- [ ] **3.4 The picker shows skins.** A "Skins" group after "Accessible"; a swatch
      that shows the font and the corner scale, not only colours. verify: settings
      view test; the frame of the Appearance page has no wrapped label.

## Phase 4 — The board

- [ ] **4.1 `waiting`, by S2 (D9).** Either a producer in `runtimeState` with its
      source and a table test over the S2 fixture, or the state removed from
      `SessionState`, `SessionStateIcon`, `logic.ts`, `rows.tsx`, `data.ts` and spec
      §3.3. verify: a source scan finds no state that nothing produces.
- [ ] **4.2 The board as a page tab.** Columns: needs you, working, waiting (only
      with 4.1's producer), idle. A card is the row grammar of `SessionRow`. A click
      opens the session tab. verify: adapter test from a `sessions --json` fixture;
      view test; frames with 3, 12 and 40 sessions.
- [ ] **4.3 Children as linked cards.** A session child is a card with a dashed
      edge and "↳ parent"; a subagent stays a count on its parent. A child card says
      where the relation comes from, and "relation unknown" stays in the parent's
      column. A child is never in a column of its own kind before its parent's news.
      verify: view test with a three-seat council on two accounts.
- [ ] **4.4 Columns the user arranges.** Hide, reorder, fold when empty; stored in
      `WindowLayout` (`layout.ts:9`). With all hidden the board says so and offers
      "Show all". verify: `parseLayout` test for the new fields; view test.
- [ ] **4.5 A board that holds still.** The order hold of `held-order.ts` applies
      to each column while the pointer or the focus is inside it; the needs-you
      column is never held. verify: window test as for the Sessions list.
- [ ] **4.6 Keys.** Next and previous session follow the order shown; ⌘J still
      jumps to the next Needs-you item. verify: `keys.test.ts`.
- [ ] **4.7 The board above the workbench.** An optional zone with a height the
      user drags, in whole card rows; the terminal stays below. Off by default.
      verify: frames at 1440×900 and 1100×700; no clipped card.
- [ ] **4.8 Two picker entries (Q1).** "Board" and "Board, compact" with their own
      colours; picking one switches the zone of 4.7 on. Picking another theme leaves
      the zone as the user set it. verify: appearance test; nothing else changes
      when the theme changes.

## Phase 5 — The facility skin

- [ ] **5.1 Colours and type.** A light frame, a dark terminal, one accent; a
      signage font under OFL, bundled. verify: the terminal's ANSI colours meet 4.5:1
      on the terminal background and the frame's text meets the floors on the frame;
      frames in the render check.
- [ ] **5.2 Words.** One table: project, session, agent, start, resume, end, log,
      notices, each with its own term, in English and German. verify: 2.2's checks;
      2.3's tooltip.
- [ ] **5.3 What happened, as pure data.** `detect(previous, next)` over two
      snapshots of the session list: arrived, needs you, finished, left; a session
      that left is classed from the engine's own record (ended by the user, ended
      with an error, gone). verify: table test, red first for "the first snapshot is
      a baseline, not news".
- [ ] **5.4 The voice.** Four to six lines per event kind with the placeholders
      session, project, tool and count. The factual tag stands before every line.
      Lines rotate per kind. One switch turns the voice off and leaves the tags.
      verify: a test that every line keeps its placeholders; a view test that the tag
      is drawn with the voice off.
- [ ] **5.5 The feed.** The latest line in the status bar; the last 80 in a list
      opened from it. Nothing opens by itself (D18). verify: window test: a session
      that finishes while another tab is shown adds a line and opens nothing.
- [ ] **5.6 Ending keeps its question.** The End dialog is the same dialog with the
      skin's words. verify: `dialogs.test.tsx` under the skin.

## Phase 6 — The console skin

- [ ] **6.1 Look.** A mono UI font under OFL, bevelled edges through `--ac-edge`,
      one accent on a near-black frame, in a light and a dark variant. verify:
      contrast tests; frames.
- [ ] **6.2 Words and the ticker.** Four order words for the board's columns, an
      alert tag on a needs-you card, the voice of 5.4 with its own short lines in the
      status bar. verify: 2.2, 2.3 and 5.4's checks.
- [ ] **6.3 No motion at rest (D12).** A needs-you card may pulse once when it
      arrives; a working card is still. verify: a test that no animation is running
      on a board whose data did not change for five seconds.

## Phase 7 — The village (gated)

Starts only when S3 met its budget and Q5 is answered.

- [ ] **7.1 The scene renderer (D11).** Layers, spots, actors; one timer for the
      whole scene that runs only while an actor moves and stops when the scene is
      hidden. verify: unit tests for "state to spot" and for the 8 s / 15 s rule; a
      test that no timer is alive on a hidden scene.
- [ ] **7.2 Who is who.** An actor's sheet comes from the tool; its name comes from
      a stable hash of the session key, so it does not change between starts. A
      project is a district with a colour and a charge from the same hash. verify:
      unit test for stability; no two live sessions share a name inside one project.
- [ ] **7.3 Where an actor stands.** Working: at its tool's building. Needs you: a
      mark above it and the first place in the scene's own list. Idle: at the fire.
      Children: one small light per running subagent. verify: view test from the
      demo fixture with all four states.
- [ ] **7.4 The resource bar.** One plaque per account with its 5-hour share, the
      weekly share as a second value, and the time to the next weekly reset. Stale
      readings are grey with their age (spec §13.9). More accounts than fit become
      "+n". verify: view test with one, three and seven accounts; a stale account.
- [ ] **7.5 The activity fact in the scene (D10).** Reading, editing, command,
      test, compacting, from the data path S4 measured. Without the fact an actor shows its plain
      state. verify: fixture test from `gui/src/v3/fixtures/timeline-claude-2.1.316.json`.
- [ ] **7.6 The chronicle.** The feed of 5.5 with the village's words, the last
      four lines in a corner of the scene. verify: view test.
- [ ] **7.7 A switch for stills.** "Animations" off draws every actor on one frame
      and runs no timer. Reduced motion sets it off. verify: the test of 7.1 with the
      switch off.
- [ ] **7.8 Size.** All skins together add at most 3 MB to the installed app
      (proposal; fonts are 136 KB and pets 260 KB today). verify: a size check in CI
      on `gui/dist`.
- [ ] **7.9 The scene as a page tab.** The scene alone in the workbench, for the
      user who wants to look at it; the bottom strip stays optional. verify: frames.

## Not in this roadmap — where each point goes

| Point | Why not here | Where |
|---|---|---|
| Skins loaded from a folder on disk | A second trust boundary. It needs 1.7, an asset scope limited to one folder, a schema check and size caps first. | a later roadmap; resume when the owner wants a skin without a release |
| Sound | D17 | after quiet hours (`road-to-the-ready-remainders.md` 3.5) |
| A window that opens when a turn finished | spec principle 1 | not planned |
| R3's explorer and code view | decoration by its own brief | not planned |
| R5's radar | a second picture of what the board already shows; it needs a legend (principle 8) | not planned |
| R1's hook on every tool call | nine hook events stay nine; 45 ms per event | not planned; D10 instead |
| Resuming hosted sessions after a reboot (R2 `recovery.js`, R4 agent-resume) | Not checked in this tree beyond a search of `src/host/tmux-host.ts` and `src/resume.ts`, which found the resume preflight and no reboot path. Unverified; needs its own read. | a finding to check in `later/road-to-host-signals-followups.md` |
| agent-switch accounts inside the Herdr app | R4's launcher finds accounts by scanning `~/.claude*` and `~/.codex*` (`repo-launcher-app/RECIPE.md:91`); agent-switch profiles live under `~/.agent-switch` (`src/profiles.ts:14`). `agent-switch --list --json` already exists for such readers. A small read-only part for that app is possible. | the owner's call; nothing is proposed here |
| A general layout tree | D6 | not planned |

## Risk register

| Risk | Sign | Answer |
|---|---|---|
| The look layer turns into per-skin branches in components | S1's list is long; a PR adds `if (skin === …)` | S1's kill; a lint rule against reading the skin id in a component |
| A playful word hides a state | a user cannot tell what "Standing by" means | 2.3; the tag in 5.4 |
| The scene costs CPU while nobody looks | the webview is busy with the window hidden | D12; the timer test in 7.1; S3's counter |
| A name or a look belongs to someone else | Q2 answered (3) | D13; not legal advice |
| Two looks of one control | a skin restyles a control on one page only | D3; the render check runs every page under every skin |
| The German table breaks the layout | wrapped buttons in the German render | 2.1's render |
| `dev/v3` and `main` drift further | Q6 | land after the merge |
| The board contradicts the Sessions list | a session in "working" on the board and idle in the list | D8: one function, `runtimeState`, feeds both; a test that renders both from one fixture |

## Acceptance criteria

- [ ] AC-1 — Under every theme and skin, each session state has exactly one mark,
      and the mark's tooltip holds the plain state word.
- [ ] AC-2 — The frames of darcula, github-light and github-dark-hc are pixel-equal
      before Phase 1 and after Phase 3, with no skin selected.
- [ ] AC-3 — No file under `gui/src/v3` outside tests and fixtures holds a visible
      English literal; the window renders in German without a clipped or wrapped
      control.
- [ ] AC-4 — A skin definition holds no script, no stylesheet text and no path
      outside the bundle; the loader rejects one that does.
- [ ] AC-5 — The CLI's snapshot tests pass unchanged whatever theme is stored.
- [ ] AC-6 — The board and the Sessions list show the same state for every session
      of one fixture.
- [ ] AC-7 — No state exists in the type that nothing produces.
- [ ] AC-8 — With the window hidden, no skin runs a timer or an animation.
- [ ] AC-9 — Every skin has a `SKIN.md` whose "Done when" is covered by a test or a
      frame in the render check.
- [ ] AC-10 — The window runs under a Content Security Policy.
- [ ] AC-11 — Nothing opens, moves or switches by itself under any skin.

## How this plan changed over three loops

**Loop 1 — the first reading.** Five new entries in the theme registry, each with
more fields; then a folder of user themes.
*What was wrong with it:* it treated five different things as one. It put a
village and a column board into a colour list, and it opened a folder of user
content before asking what the window does to keep content from being code.

**Loop 2 — taking the designs apart.** The table "The five designs, taken apart"
came from this loop, and with it: the board as a view (D7), words as an overlay on
a string table the v3 window does not yet use (F3, D4), regions as a short fixed
set instead of a layout tree (D6), and the missing policy (F10, D14). The second
read of the tree also found the state without a producer (F7), the dead twin
(F11), and that a light frame with a dark terminal and a sprite contract already
exist. Disk packs moved out of the plan.
*What was still wrong:* the village was a phase like the others, with no price on
it, and the plan still let a finished turn open a window because the reference
does.

**Loop 3 — questioning the decisions.** Asked of every decision: what in this tree
or in a measurement supports it, and what would end it. That added the spikes with
kill conditions, the CPU and size budgets from R1's own numbers and the platform's
measured rule (D12, S3), the gate on Phase 7, and D18. It moved the activity fact
from hooks to the timeline reader (D10) after re-reading why the hook list has nine
events. It turned three assumptions into owner questions: names and art (Q2),
whether a skin may touch corners and marks at all (Q3), and the collision of a
"Done" column with the council's decision of 2026-11-22 (Q4). It also cut the radar,
the explorer and sound, and reordered delivery so that the cheapest skin proves
the model first (D16).

## Sources

- R1 https://github.com/kevinpardo/world-of-codecraft · https://herdr.dev/layouts/kevinpardo/world-of-codecraft/
- R2 https://github.com/PowershellNinja/herdr-aperture · https://herdr.dev/layouts/PowershellNinja/herdr-aperture--aperture/
- R3 https://github.com/herdrdev/herdr-layout-examples/tree/main/code · https://herdr.dev/layouts/herdrdev/code/
- R4 https://github.com/dougcunha/herdr-mods/tree/main/kanban-app · https://herdr.dev/layouts/dougcunha/herdr-mods--kanban-app/
- R5 https://github.com/Isitea/herdr-dynamic-board · https://herdr.dev/layouts/Isitea/herdr-dynamic-board/
- P https://github.com/herdrdev/herdr-app/blob/master/defaults/AGENTS.md · https://herdr.dev/core/ · https://herdr.dev/guide/
- P https://herdr.dev/blog/ten-agents-three-clients-95-percent-less-cpu/ · https://herdr.dev/blog/coding-agents-are-becoming-runtimes/
- Third-party review of the gallery (counts, "trusted code" caveat): https://www.bitdoze.com/herdr-app-layouts-mods/
- A theme store whose themes ran code: https://planet.kde.org/david-edmundson-2024-03-20-trusting-content-on-the-kde-store
- Policy and asset scope of the window toolkit: https://v2.tauri.app/security/csp/ · https://v2.tauri.app/security/asset-protocol/
- Theme structure of an IDE whose themes carry icons and fonts as data: https://plugins.jetbrains.com/docs/intellij/theme-structure.html
