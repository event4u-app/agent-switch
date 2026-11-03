---
complexity: large
status: planned
tree_pin: e5204cd
execution:
  mode: autonomous
---

# Roadmap: v3 window live — a data adapter from the 2.11 store and the v3 CLI

> **Source:** owner turn 2026-11-03 ("merge, then plan the data adapter for
> V3Window") and the gap named in PR #137: `V3Window` (`gui/src/v3/window.tsx`)
> is built and tested against fixtures but not mounted. `gui/src/main.tsx` still
> renders `RedesignApp`, so `npm run tauri dev` shows the 2.11 window. Owner
> observation the same turn: "es startet nur das alte GUI und nicht das neue".
>
> Parent: [`road-to-agent-switch-v3-central.md`](../road-to-agent-switch-v3-central.md)
> (Phases 6–9 built the components this roadmap feeds).

## Branch

`feat/v3-window` from `dev/v3`; the PR targets `dev/v3`.

## Goal

The main window and the tray show the v3 UI with real data. Every `V3Action`
does what its label says, or the control is hidden. The 2.11 window stays
reachable behind a setting for one release, then goes.

## Shape (decided here)

- **One store, not two.** The adapter runs inside the existing `ASProvider`
  (`gui/src/vm/store.ts`). It reuses `loadViewModel`, the engines
  (`redesign/engines/*`: sessions poll, usage refresh, notifications, updates,
  pet/tray) and `Actions` (`vm/actions*.ts`). The v3-only reads become one more
  poll next to them, not a second store.
- **Pure mapping, tested without Tauri.** `toV3Data(vm, feeds, now)` and
  `dispatchV3(action, act, …)` are plain functions in `gui/src/v3/adapter/`.
  React glue stays thin (`V3App.tsx`).
- **Slots reuse 2.11 screens** where the spec keeps them: usage history
  (`screens/usage-history.tsx`), pools (`screens/pools-panel.tsx`), the settings
  sections v3 keeps, the hosted terminal (`terminal-sheet.tsx` `XtermBox`).
- **Fail closed per field.** A feed that errors shows its own empty or stale
  state (`engineDownText`, "last checked …"). One failing CLI call never blanks
  the window.

## Field map (verified against `e5204cd`)

| `V3Data` field | Source today | Gap |
|---|---|---|
| `health` | `engine status --json` | IPC wrapper |
| `needs`, `away` | `listNeeds()` (`needs --json`) | none |
| `history` (Done today) | — | needs a "done" feed: `needs --json` with resolved items of today, or the store's resolved events |
| `sessions` (tree) | `sessions --json --tree` + `host list --json` + `pr status --json` | IPC wrapper; join by session key |
| `limits`, `accounts` | view model (`accounts`, usage, protection, auto-switch) | mapping only |
| `table` | view model sessions + `pr status --json` | mapping only |
| `library`, `vaultBytes`, `autoKeep` | `sessions search --json` (library entries), `library.json` | a `library list --json` (all entries, vault state, cleanup deadline, auto-keep) |
| `tools` | view model `tools` | none |
| `palette` | derived (`PAGE_COMMANDS` + sessions + accounts) | none |
| `appearance`, `prefersDark` | `theme.ts`, `matchMedia` | map the 2.11 theme key onto `Appearance` |
| `openIn` | `open-targets <s> --json`, `open-default` | IPC wrapper; a global `open-targets --json` without a session for the settings page |
| `newSession` | `dir --json` (account + why), `host list --json` (hosting) | mapping; thinking levels per tool as a constant next to the CLI's own |
| `decision(subject)` | view model usage + protection + sessions on that account | mapping only |
| `bar(key)`, `summary(key)`, `next(key)` | sessions + `pr status --json` + `worktrees --json` | mapping only; `next` is a rule over PR/CI state |
| `changes(key)` | — | a `changes <session> --json` (`git diff --numstat` + `status --porcelain=v2` in the session's worktree, path-confined) |

## Phase 1 — Reads

- [x] IPC wrappers with tests: `engineStatus`, `hostList`, `sessionsTree`,
      `prStatus`, `worktrees`, `openTargets`, `setOpenDefault`. Each parses
      defensively (unknown fields ignored, missing → empty).
      → `gui/src/ipc.ts` (+ the write calls the actions need: open, focus, pin,
      archive, auto-keep, host start/end/respawn, cleanup, engine restart),
      parsers in `gui/src/v3/adapter/feeds.ts`. `sessions --json` already carries
      git, PRs, children, parent and library per row, so no `sessionsTree` call:
      the view model now keeps those raw rows (`ViewModel.sessionRows`).
      `worktrees` is not needed by any field. `open-targets` without a session
      is new (the settings page's view).
- [x] CLI `library list --json`: every library entry with pin, archive, tags,
      vault state and bytes, cleanup deadline; plus `autoKeep`. Docs row in
      `reference/cli.mdx`.
      → named `sessions library [--json]` to sit with `sessions pin|archive|…`
      (`libraryList` in `src/commands/library.ts`); e2e in `tests/library.test.ts`.
- [x] CLI `changes <session> --json`: changed files in the session's worktree
      vs HEAD (status, path, added, removed). Refuses a path outside the
      session's folder. Docs row.
      → `src/commands/changes.ts`, `tests/changes.test.ts` (parsers + a real repo).
- [x] "Done today": `needs --json` gains `done` (items resolved since local
      midnight, newest first, at most 20), or the GUI derives it from session
      state transitions — pick the one the store already records; test both
      the empty and the full case.
      → `needs --json` already returns `history` (resolved items, newest first);
      the adapter keeps today's (`doneToday` in `adapter/data.ts`), tested empty,
      full, across midnight and with a bad date.
- [x] `useV3Feeds()`: one poll for the v3-only reads, same cadence and
      hidden-window back-off as `useSessionsPoll`; feeds keep their last good
      value with a timestamp.
      → `gui/src/v3/adapter/useFeeds.ts`; library and Open-in every 6th tick;
      `pr status` is not polled (it calls `gh`; rows read its cache).

## Phase 2 — Mapping

- [x] `toV3Data(vm, feeds, now)` in `gui/src/v3/adapter/data.ts`, field by
      field per the table above. Property tests: every session key in
      `sessions` resolves in `bar`/`summary`; no account appears twice in
      `limits`; a missing feed yields the documented empty state.
      → `gui/src/v3/adapter/data.ts` + `data.test.ts` (seeded property test over
      60 rows; the duplicate-account check was seen red before the dedupe).
- [x] Session key: one join key across `sessions --json`, `host list`,
      `needs`, `pr status`, library (provider + session id). A row that only
      one source knows still renders (state "unknown", no PR).
      → `sessionKey()`; a hosted session with no transcript yet gets a row from
      `host list` alone (no PR, title from its folder).
- [x] `dispatchV3(action)` in `gui/src/v3/adapter/actions.ts`: every
      `V3Action` variant mapped onto an existing `Actions` call or CLI command
      (`takeover`, `rebind`, `host start|end|respawn`, `compact`,
      `sessions pin|archive|keep auto`, `open`, `open-default`, `focus`,
      `engine restart`, `pr`). An exhaustive `switch` with `never` so a new
      variant cannot go unmapped.
      → `gui/src/v3/adapter/actions.ts` + `actions.test.ts`. A CLI failure is an
      alert toast, never a throw. Flows the window has no dialog for reuse the
      2.11 overlays (session sheet for take over / hand off / brief, start,
      re-auth, add account, terminal runs). PR pages open through a narrowed
      shell-open scope (`tauri.conf.json`: `github.com/<o>/<r>/pull/<n>[/checks]`
      and `compare/<branch>?expand=1` only), locked by a test.
- [x] Controls without a backing command are hidden, not dead: list them in
      the PR body with the reason (e.g. "Review" when no reviewer is
      configured).
      → Session menu per session (`menuFor`): Detach never (closing the tab
      detaches), End and Compact only for hosted sessions, moves not for
      Antigravity. "Commit…" disabled with its reason like "Review" — no commit
      flow until v3.1. Model and thinking chips stay locked outside hosted
      sessions, as the design already draws them.

## Phase 3 — Slots and mounting

- [x] `V3App.tsx`: `ASProvider` + engines + `V3Window` with the adapter;
      slots wired to the 2.11 screens named above and to `HostedTerminal`.
      → `gui/src/v3/adapter/{V3App,slots,appearance}.tsx|ts`. The 2.11 overlay
      host and toaster sit over the window; theme tokens go on <html> before
      first paint. The user's-own-terminal body shows folder, branch, model and
      account; its last transcript line is not read yet (no CLI for it), so the
      line is left out rather than filled with the summary.
- [x] Setting `ui.window: "v3" | "2.11"` (GUI settings store), default `v3`
      on `dev/v3`. `main.tsx` picks the app by it; Settings › Appearance
      offers "Use the previous window" for one release.
      → `getUiWindow`/`setUiWindow` (settings-store); the switch sits in
      Settings › Advanced (a 2.11 screen, shown in both windows, en + de), not in
      the designed Appearance page, so the v3 design gains no element.
- [x] Tray: `tray-main.tsx` mounts `V3Tray` with the same adapter. Every read
      the tray makes gets its own scope in `capabilities/tray.json` and
      `TRAY_READ_SCOPES` (`needs --json`, `engine status --json`,
      `host list --json`); `ipc-tray-scope.test.ts` checks the two stay in
      step. No write enters the tray capability.
      → `V3TrayApp.tsx`; scopes `as-read-needs`, `as-read-host`. Every tray
      action opens the main window (start forwards the start overlay).
- [x] The tray and pet windows make no call outside their capability: a test
      walks every IPC function a tray/pet entry imports and asserts its args
      match a scope (the `app-visibility` miss, fixed 2026-11-03 in
      `reportVisibility`, is the case this guards).
      → `tray-calls.test.ts` runs the tray's whole load with the label "tray"
      and checks every shell call against `tray.json`. Seen red first: the 2.11
      loader's `desktop --json` and `launcher list --json` were outside the
      scope (logged as "Scoped command agent-switch not found" on every tray
      load since they were added); both are reads and now have their own scope.
      The pet window makes no shell call at all.

## Phase 4 — Proof

- [x] Smoke: `npm run tauri dev` opens the v3 window with real accounts and
      sessions; record which spec §11 rows were exercised live.
      → 2026-11-03, the owner's machine, CLI from this branch on PATH: the
      window opened on 10 live sessions, "Done today 8", six accounts in the
      strip and the engine-down banner; a session tab showed its bar (account,
      model, thinking, context), the own-terminal body and Open ▾. Six minutes
      with window hide/show and the tray loaded: no "Scoped command … not
      found" line. Rows exercised: overview, session tab, open-in, health.
      Note for the owner: the installed CLI on PATH is still 2.11, which has
      none of the v3 commands; `tauri dev` needs this branch's CLI first on
      PATH until v3 ships.
- [x] Render check at 1440×900 in darcula, github-light and one high-contrast
      theme with real data (long names, 0 and 40 sessions, engine down) —
      nothing clipped, per the parent's design acceptance.
      → `npm --prefix gui run v3-render` (`gui/scripts/screenshots/v3-render.mjs`):
      3 themes × seeded / 40 sessions / none, real CLI on a seeded home, checks
      page scroll, clipping without ellipsis, text past a clipping edge,
      wrapped controls and that the theme reaches the window. Found and fixed,
      each seen red first: (1) the v3 theme never reached the window — the
      `.as-ac` root's defaults won over tokens on <html>, so every theme drew
      the 2.11 palette; the tokens now go on the root; (2) absolutely placed
      screen-reader text in tables escaped the unpositioned scroll containers
      and made the whole document scroll (1921 px at 40 rows); every v3
      scroll container is positioned now; (3) Chromium kept the ellipsis
      decision when only the weight changed, so a selected title ran past its
      edge; the title node is re-created on selection (session row, theme
      name; component test red without it). All nine frames clean.
- [x] GUI coverage floor holds; `reach.test.tsx` runs against `V3App` with
      the adapter on fixture CLI output, not only against raw props.
      `gui/src/v3/adapter/reach-app.test.tsx` mounts `V3App` behind a mocked
      shell that answers from fixture CLI lines (9 rows: overview, library,
      session actions, near-limit decision, open-in, activity, engine
      down/up, start + why). Seen red first: the decision row failed until the
      fixture carried `status --provider` usage — a limit need without a
      known window opens no sheet. Full suite 76 files / 818 tests green;
      coverage 91.3 / 85.7 / 73.4 / 91.3 (floor 78 / 82 / 69 / 78); `tsc
      --noEmit` clean.

## Acceptance

- `npm run tauri dev` on `dev/v3` shows the v3 window; the 2.11 window only
  through the setting.
- No "Scoped command … not found" line in the dev log during a 5-minute run
  with tray open/close and window hide/show.
- Every `V3Action` variant is mapped or its control hidden; the `never`
  check compiles.

## Not here

- Chat/timeline view, diffs inline, terminal ⇄ chat — v3.1
  (`later/road-to-agent-switch-v3-client.md`).
- Removing the 2.11 window — one release after this ships.

## Risks

| Risk | Mitigation |
|---|---|
| Poll cost grows with the v3 reads (`pr status` hits `gh`) | `pr status` keeps its own cache and the hidden-window pause; the v3 poll reads the cached result |
| Two sources disagree on a session's state | one join key; the engine store wins over the transcript scan, documented in `adapter/data.ts` |
| Windows has no tmux | `hosting: "ephemeral"` from `host list`; hosted-only controls hidden there |
