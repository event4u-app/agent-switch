---
complexity: standard
status: complete
execution:
  mode: autonomous
---

# Roadmap: read what changed in an agent-config update, inside agent-switch

> **Ask (owner + colleague, 2026-08-19):** "when an agent-config update comes,
> the version info should be readable right there."
>
> Today agent-switch announces an agent-config update on four surfaces and
> shows a **version number on every one of them and nothing else**. The
> release body — which GitHub already returns in the same response — is
> fetched and thrown away. This roadmap keeps it and renders it where the
> update is announced, on the GUI **and** the CLI.

## Verified current state (read 2026-08-19, do not relitigate)

| Fact | Evidence |
|---|---|
| `fetchLatestRelease()` already returns `{ tag, name, url, notes, publishedAt }` | `gui/src/updates.ts:73` · `src/updates.ts:73` |
| `detectAgentConfig()` keeps **only** `.tag` and discards `notes`/`name`/`publishedAt` | `gui/src/App.tsx:926` — `?.tag ?? null` |
| `AgentConfigStatus` can only carry version numbers | `gui/src/agent-config.ts` (`installed`/`current`/`latest`) |
| Surface 1 — notification: text only, "use the banner below to update" | `gui/src/App.tsx:933-940` |
| Surface 2 — Profiles first-run card: `Installed vX · vY available.` | `gui/src/AgentConfigCard.tsx` (`body`) |
| Surface 3 — Ecosystem card: badge `vX → vY available` | `gui/src/App.tsx` `AcPrimaryCard` |
| Surface 4 — Tooling row: `Update to vY` button | `gui/src/ToolingSection.tsx` `ToolingRow` |
| Surface 5 — CLI: **no agent-config update surface at all** (`tooling` is deliberately offline/local-only) | `src/tooling.ts` header · `src/index.ts` `cmdTooling` |
| A working precedent for rendering notes exists — agent-switch's **own** update card | `gui/src/App.tsx:3336-3348` (`notes.slice(0, 500)`, scroll box, "Release notes" link) |
| agent-config releases are public and reachable unauthenticated | `GET /repos/event4u-app/agent-config/releases/latest` → 200, tag `14.2.0` (no `v` prefix) |
| Real release bodies are ~3.7 KB markdown with a **curated highlights head**, generated commit sections, `([sha](url))` suffixes **and an HTML comment** | release `14.2.0` body, measured |
| GUI and CLI **mirror** pure helpers instead of importing across the boundary | `gui/tsconfig.json` `include: ["src"]`, no `../src` alias; `src/updates.ts` header says "Mirrors the GUI's update logic" |

The measured release body is the reason a naive `notes.slice(0, 500)` is not
good enough here: the first 500 characters of agent-config `14.2.0` are the
`### Release highlights` heading followed by an **HTML comment addressed to the
release author** and five `_none_` placeholders. Dumped raw into a card that is
the whole point of the feature, that reads as broken.

## Goal

An agent-config update is **readable, not just countable**: what changed, when
it was published, and — when several versions were skipped — what changed in
each of them, without leaving agent-switch and without a browser round-trip.

## Out of scope (hard boundary)

- **No change to how updates are installed.** The one-click background
  install/upgrade and the embedded-terminal run stay exactly as they are.
- **`agent-switch tooling` stays offline.** Its documented contract is a local,
  network-free readout that the GUI consumes over `--json`; the notes command
  is a separate, explicitly-network subcommand.
- **No markdown engine dependency.** A ~40-line pure normaliser covers the
  shapes agent-config's release template actually emits; a markdown renderer in
  a tray app is a supply-chain cost with no payoff here.
- **No GitHub token, no authenticated calls.** Same unauthenticated posture as
  every other check in the app; rate-limited → notes unknown → panel hidden.
- **Never a speculative panel.** Unknown/unfetchable notes render *nothing* —
  the same honesty rule the Update buttons already follow.
- **No new always-on polling.** The existing hourly `detectAgentConfig()` sweep
  carries the extra data in the same round; no second timer.

## Phase 1 — keep the release, and make its body readable

- [x] **`releases` fetch + `releasesNewerThan()`** — add `fetchReleases(repo)`
      (`GET /releases?per_page=20`, reusing `parseRelease` so drafts and
      prereleases are dropped by the existing rule) and the pure
      `releasesNewerThan(releases, current)` (strictly newer, newest first) to
      `gui/src/updates.ts` **and** its `src/updates.ts` mirror. On any failure
      fall back to today's `fetchLatestRelease` path so a rate-limited or
      offline run behaves exactly as it does now.
- [x] **`release-notes.ts` — the pure normaliser** (new file, mirrored in
      `src/` and `gui/src/`). `releaseNoteBlocks(markdown)` →
      `{ kind: "heading" | "item" | "text"; text: string }[]`:
      strips HTML comments, strips `([sha](commit-url))` suffixes, unwraps
      `**bold**` / `_italic_` (`_none_` → `none`), maps `###`/`##` to `heading`
      and `-`/`*` to `item`, collapses blank runs, and drops the template's
      author-facing instruction line. Plus `releaseNotesText(blocks, opts)` for
      the terminal renderer. Pure, no I/O, unit-tested on the **real** `14.2.0`
      body captured as a fixture.
- [x] **`AgentConfigStatus` carries the releases** — extend it with
      `newer: ReleaseInfo[]` (everything strictly newer than the installed
      version, newest first); `latest` stays as-is so every existing consumer
      keeps working. `deriveAgentConfigView`'s `update` variant gains
      `releases`, and `agentConfigNotes(status)` is the single derivation every
      surface reads. A separate "newest release" field was dropped as
      redundant — `newer[0]` is it, and `latest` already carries its tag.

## Phase 2 — GUI: one release-notes surface, reused on every announcement

- [x] **`ReleaseNotes.tsx` — the single rendering component.** One collapsible
      per release: title (`name`, else tag), publish date, normalised blocks in
      a bounded scroll box, and an "Open on GitHub" link for the full text.
      A `ReleaseNotesStack` renders several skipped versions with the newest
      expanded. Built on the shapes Phase 1 emits — no per-card markup.
- [x] **Ecosystem card (primary home).** `AcPrimaryCard` renders the stack
      directly under the `vX → vY available` badge, **expanded by default** in
      `update` mode — a user on that card is there because of the update.
- [x] **Profiles first-run card.** `AgentConfigCard` gets a compact
      "What's new" disclosure, **collapsed by default**, so the first-run card
      keeps its current height until asked.
- [x] **Tooling row.** The agent-config row gets the same disclosure next to
      its `Update to vY` button (new `agentConfigReleases` prop, fed from the
      same App state) — the fourth surface stops being a dead end.
- [x] **Notification body points at the notes.** Keep it one line, add the
      first curated highlight when there is one, and name where to read the
      rest ("Ecosystem → agent-config"). Still once per version, still only
      when installed.

## Phase 3 — CLI: `agent-switch tooling notes`

- [x] **`agent-switch tooling notes [<tool>] [--latest] [--json]`** — default
      tool `agent-config`; `rtk` supported (it has a GitHub release source);
      every other id gets an honest refusal naming why, never an invented
      source. Prints installed → latest, then the readable notes for **every
      release newer than the installed version** (`--latest` limits it to one,
      `--json` emits the structured blocks). Reuses the Phase 1 mirror, so the
      CLI and the GUI can never describe the same release differently.
- [x] **Discoverability** — the command in `agent-switch --help`, and the
      `tooling` readout's footer hint mentions it. `tooling` itself performs no
      new network call.

## Phase 4 — docs + verification

- [x] **Docs follow the surface.** `guides/tray-gui.md` § agent-config
      companion banner gained "Reading what an update contains" (where the panel
      lives per surface, the several-versions-behind case, and the explicit
      hidden-when-unfetchable rule); `reference/cli.md` gained an **Ecosystem
      tooling** section — it previously documented no `tooling` command at all,
      so `notes` is listed there together with the two rows it needs as context,
      with the offline-vs-fetching distinction stated. The README carries no
      `tooling` command list, so it has nothing this change contradicts.
- [x] **Targeted verification** (`quality.local_auto_run` is `false`, so no
      full-pipeline step is scheduled here per `roadmap-ci-steps-policy`):
      CLI `tsc -p tsconfig.test.json` clean + `node --test` 411 pass / 0 fail /
      13 skipped (opt-in contract tests); GUI `tsc && vite build` clean +
      `vitest run` 375 pass / 0 fail across 20 files; `agent-switch tooling
      notes` exercised live against the real GitHub endpoint, including its
      rate-limited path. Remote CI on the PR stays the authoritative gate.

## Acceptance criteria

1. With an agent-config update pending, the Ecosystem card shows the release
   title, its date, and readable highlights **without a click**.
2. Installed 3 versions behind → all three release bodies are readable, newest
   first, each collapsible.
3. Offline / rate-limited / notes empty → no panel, no placeholder, no error
   text; the Update button behaves exactly as today.
4. The captured real `14.2.0` body renders with no HTML comment, no
   `([sha](url))` noise, and no `**` markers.
5. `agent-switch tooling notes` prints the same content the GUI shows, and
   `tooling` (no subcommand) makes no network call.
6. Every existing agent-config test still passes unchanged.

## Notes

- The four GUI surfaces are deliberately fed from **one** App-level state and
  **one** component. A second fetch path is exactly how the banner and the
  Tooling row would start disagreeing — the reason `gui/src/tool-updates.ts`
  already excludes agent-config from its own lookup round.
- Mirroring `release-notes.ts` into `src/` and `gui/src/` follows the
  established `updates.ts` / `transforms.ts` precedent, not a new pattern. It
  is duplication by design of the build boundary, and the tests are mirrored
  with it. The drift guard is a **byte comparison of the two sources** below
  their header comment (`tests/release-notes.test.ts`), which is stronger than
  the shared fixture this roadmap originally specified: a fix applied to one
  mirror and not the other fails regardless of what any input happens to cover.
- **Corrected after the first CI run — a local pass that was not a real pass.**
  The GUI mirror's tests initially read the captured fixture with `node:fs`.
  That typechecks in a full checkout because TypeScript walks up to the ROOT
  `node_modules/@types/node`, and fails in CI, whose gui job runs `npm ci` with
  `working-directory: gui` — the GUI project carries no `@types/node` on purpose
  (`types: ["vitest/globals"]`, `lib: [ES2022, DOM]`; it is a browser bundle).
  Six TS2307 errors on macOS and Windows. Fixed by removing filesystem access
  from that project entirely; the real captured body is asserted on the CLI side,
  where Node types are legitimate. Two guards now make the asymmetry
  self-reporting instead of remembered: the mirror byte-comparison above, and a
  test that fails if any file under `gui/src` imports a `node:` builtin.
- **Request budget: unchanged in the normal case.** The hourly sweep now calls
  `/releases` instead of `/releases/latest` — one request either way. Only the
  fallback path (list unavailable or drafts-only) makes a second call, which is
  exactly the case where the first one failed. The unauthenticated limit is 60/h
  per IP, shared with the app's own update check and the rtk lookup.
- **One deliberate GUI/CLI difference, against acceptance criterion 5's
  wording.** A release published with an EMPTY body renders nothing in the GUI
  (a panel with no content is noise) but prints `(no notes in this release)` in
  the CLI — a command the user typed has to answer. Same source, same
  normaliser, different silence rule; recorded here rather than left as an
  apparent inconsistency.
- **Found while working, then fixed on the owner's say-so** (it was surfaced as
  out of scope first): `scripts/release.mjs` bumped `gui/package.json` but
  resynced and staged only the root `package-lock.json`, so
  `gui/package-lock.json` kept the previous release's version field (`1.7.0`
  against a 2.0.0 tree) and any `npm install` under `gui/` produced a two-line
  diff nobody asked for. The script now resyncs both lockfiles and stages both;
  the drifted file is synced in this change; and
  `tests/release-workflow.test.ts` gained a version-parity assertion across
  every version-carrying manifest — verified to fail against the drifted state
  before the fix, so it is a real guard and not a decoration.
