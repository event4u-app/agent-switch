---
complexity: large
status: active
tree_pin: faedbeb
execution:
  mode: autonomous
---

# Roadmap: close the v3 design gap — dev/v3 against the boards

> **Source:** `agents/tmp.old/inbox-2026-11-c/` — an external gap report
> measured against dev/v3 at c532c2c (board v15), the four exported boards, the
> design HTML, a gap kit with a render fixture and comparison images, and the
> owner's chat (2026-11-03): "vor allem das Design im Detail".
> **Activated 2026-11-03** by the owner in the invocation itself.

## Branch

Targets `dev/v3`. Spec: [`docs/design/agent-switch-v3-ui-spec.md`](../../docs/design/agent-switch-v3-ui-spec.md),
strict fidelity. Reference code: `gui/src/v3/menus.tsx`, `dialogs.tsx`
(`ModelPopover`) and `frame.tsx` in
[`docs/design/agent-switch-v3-reference.patch`](../../docs/design/agent-switch-v3-reference.patch).

## Verification of the report against faedbeb

33 commits landed after c532c2c. None of them touches the workbench,
the sessions window, the terminal or the adapter's model data, so every
P0/P1 finding below was checked at its file and line and is still true.
One claim is corrected:

- **§2b "drops `agent-app` targets"**: `t.kind !== "agent-app"` exists
  (`adapter/slots.tsx:59`), but the global `open-targets --json` never
  delivers that kind (`src/open-in.ts` `TARGET_IDS`). The agent app is
  launched through `open <app> <account>` (`ipc.openApp`), so the split menu
  takes it from the session's tool, not from the target list.
- The kit's README lists `reference/*.png` and `compare/side-by-side/`, but the
  zip does not contain them. The four exported boards and the reference patch
  are the reference instead.

## Phase 1 — broken or invisible (P0)

- [x] **Open-in menu is visible**: render the menu as a `V3Window` overlay
  outside the 40 px session bar, which keeps `overflow-hidden`. Done when a test
  opens the menu, and the v3 render has no clipping and no horizontal overflow
  at 1024 px.
- [x] **Terminal inner padding**: 16 px top/bottom and 20 px left/right, on the
  terminal background. The wrapper is padded and the xterm host is not, so
  FitAddon still measures right. The 2.11 sheet keeps its layout.
- [x] **Rounded, continuous `╭─╮` boxes**: load `@xterm/addon-webgl` (the
  version whose peer matches `@xterm/xterm` 6) for the v3 terminal. If it does
  not load, fall back silently. Checked once in the real Tauri window on
  macOS; until then it is carried as the acceptance point.

## Phase 2 — frame elements (P1)

- [x] **Sessions window header**: 36 px, "Sessions" with `+` (⌘N) and `⋯`. The
  `⋯` menu has Select, Group by project, Density and Show pinned only. Density
  is stored next to the appearance.
- [x] **Start on a session**: restore the last tabs and the active tab.
  Otherwise open the first live session. With no session at all, show the
  workbench empty state (title, one line, Start session ⌘N, Open Library).
- [x] **Open is a split button**: the main part opens the default target (⌘O)
  with its monogram, and the caret opens the menu. The menu lists default (1),
  last used (2), the Editor / Agent app / Terminal / Files / Web submenus and
  Configure targets…. The agent app is only the one of the session's tool, with
  "opens this project".
- [x] **Keyboard wired**: `useV3Keys` in `window.tsx` over `actionFor`, and
  `data-terminal` focus is respected. ⌘K, ⌘N, ⌘J (next need with focus), ⌘B,
  ⌘I, ⌘O, ⌘1–9, ⌃Tab, ⌘⇧M, ⌘, and Esc work. A focused item answers to
  ↵ (its verb) and L (later). ⇧↵ always, ⌫ deny and Y yes are not wired: a
  `needs --json` item carries no approval id, which `needs allow|deny` needs
  (carried below).
- [x] **Limits popover**: a click on a limits row opens `LimitsPopover`
  anchored to the strip, with "Move its session…" and "Open Accounts". The row
  keeps its raise fill while open.
- [x] **Model popover**: an anchored popover under the chip (w 320) with
  "Model · next turn", one row per model, Thinking as a `Segmented`, and the
  note. It replaces the centred pick sheet for model and thinking.

## Phase 3 — real data (P1)

- [x] **Model labels**: `modelLabel("claude-opus-4-7")` → "Opus 4.7"
  everywhere a model is shown, with the raw id in the tooltip.
- [x] **No `—` placeholders**: table cells stay empty, chips show the muted
  field name ("Thinking", "Model"), and the bar's limit reads empty instead of
  `—`.
- [x] **Limit rows without data**: "no data yet" instead of an empty track,
  and "sign in ›" when not signed in.
- [x] **Empty states**: the Sessions zone shows "No sessions running. Start one
  ⌘N".
- [x] **One trailing glyph per row**: the children toggle shows only on hover,
  on the active row or while open.

## Phase 4 — details (P2)

- [x] **Engine banner** under the session bar, with one action, "Restart
  engine".
- [x] **Hover peek** after 400 ms on a session row, one card at a time.
- [x] **"internal lines not shown"** is no longer a footer: the count and its
  kinds sit in the tooltip of "read-only here" (the report's alternative). A
  row at each drop place was tried and rejected: a recorded transcript drops
  bookkeeping lines between almost every turn, which gave ten scattered rows.
- [x] **Decision sheet**: "Room left" with every account of the tool, a state
  dot on each session row, and a one-line detail on all three "How" cards.
- [x] **Library "Last"** reads `now`, `3 h`, `Oct 28`.
- [x] **Summary**: PR line without "review" ("changes requested"), Git line
  with branch and worktree icons.
- [x] **Palette input** has no focus ring of its own.
- [ ] **Render harness**: the gap kit's fixture page (`gui/design.html`, never
  in the build) and `design-scenes.mjs`, so each scene can be re-rendered and
  compared with the boards.
- [ ] **Fidelity evidence** for this roadmap in
  `agents/evidence/v3-design-gap-fidelity-2026-11.md`, one row per finding with
  the evidence taken.

## Owner decisions (not built here)

| Id | Question | Why not by the agent |
|---|---|---|
| G1 | Library "All": should archived rows show with an "archived" chip, as on the boards, or should "All" be renamed "Active"? | The report names it as the owner's call; both are defensible. |
| G2 | Sessions in the user's own terminal: keep the chat-style read-only timeline (ADR-010 D-mirror), or render it in terminal style (mono 12.5/1.5, `--as-term-bg`)? | It changes a recorded decision (ADR-010). |
| G3 | Terminal font: IBM Plex Mono as on the boards, or SF Mono (`ui-monospace`)? | Optional per the report (§1c); taste. |

## Carried

- **Approval keys on a focused item** (⇧↵ always, ⌫ deny, Y yes): the needs
  feed has to carry the approval id first, and "always" is never offered from
  outside the chat (remote rule of v3.2). Trigger: the needs item gains an
  approval id. Until then the key line keeps the spec text, and those three
  keys do nothing.

## Risk register

| Risk | Mitigation |
|---|---|
| WebGL is missing or the context is lost in WKWebView | Fall back silently to the DOM renderer, and dispose the addon on context loss. |
| A global key listener steals keys from the CLI | `actionFor` with `terminalFocused` from `data-terminal`, so off macOS the app's keys need Shift. |
| Overlay anchors drift from the chip positions | The model popover is anchored to the chip's measured left edge, not to a fixed x. |
| `reach.test.tsx` (≤ 2 clicks) breaks when the menus move | Run it on every step. |

## Acceptance

- `npx vitest run` (gui), `npm test` and the type checks are green.
- `npm --prefix gui run v3-render` is clean in three themes.
- Every step has a row in the fidelity evidence.
