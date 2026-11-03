# v3 design gap — fidelity rows (2026-11)

drafted-at: 2026-11-03

The design acceptance for [`road-to-v3-design-gap`](../roadmaps/archive/road-to-v3-design-gap.md):
one row per finding of the external gap report (dev/v3 at c532c2c against board
v15), with the evidence taken at the branch head.

## How the evidence was taken

- **Boards.** The four exported boards ("Work · calm default", "Hover a row",
  "Limits strip", "Summary open") rendered at 1440×900 in headless Chromium from
  their own export. The kit's `reference/*.png` and `compare/side-by-side/` that
  its README names are not in the zip.
- **Same data.** `cd gui && node scripts/screenshots/design-scenes.mjs`: the real
  `V3Window` on the boards' demo data (`gui/design.html`, never a build input), in
  25 scenes. Each scene was laid next to its board.
- **Real data.** `npm --prefix gui run v3-render`: seeded, 40 sessions and empty
  home × darcula, github-light, github-dark-hc, all clean.
- **Behaviour.** `gui/src/v3/design-gap.test.tsx`, `details.test.tsx`,
  `layout.test.ts`, `model-label.test.ts`, `terminal-look.test.tsx`. Each test was
  run against the code without its change and seen red.

| # | Finding (report §) | Evidence | Result |
|---|---|---|---|
| 1 | Open-in menu clipped by the session bar (2a, P0) | scene `openin`; `design-gap` "the caret opens the menu outside the clipping session bar" | menu fully visible, rendered as a window overlay; the bar keeps `overflow-hidden` |
| 2 | Terminal without inner padding (1a) | `terminal-look` "pads a wrapper…"; scene `main` | 16/20 px on the terminal background; FitAddon measures the unpadded host |
| 3 | `╭─╮` boxes broken (1b) | `terminal-look` "loads the WebGL renderer…" / "keeps the DOM renderer…" | `@xterm/addon-webgl` 0.19 (xterm 6) loaded lazily for the v3 terminal. Headless Chromium has no GPU, so the scene shows the DOM fallback; **the real macOS window is not checked yet (carried)** |
| 4 | Sessions window header missing (3a) | scene `main` vs board "Work"; `design-gap` "Sessions window header" | header with `+` and `⋯`; ⋯ = Select, Group by project, Density, Show pinned only, kept with the layout |
| 5 | Second glyph on rows with children (3b) | board "Work" and "Hover a row"; `design-gap` "one trailing glyph per row" | the children count is the slot and unfolds them; a chevron only while open, or on hover in an empty slot. **Deviation from the report's fix** (chevron on hover/active): the boards show no chevron on the active or hovered row |
| 6 | Zone spacing (3c) | scenes `main`, `limits` vs boards | zone heads `px-3.5`, divider `mx-3.5 my-1.5`, Limits strip `pt-1 pb-1.5` + `h-7` head; equal to the boards at 1× |
| 7 | Workbench starts empty (4a) | `layout.test`; `design-gap` "start on a session"; v3-render seeded | restores saved tabs, else the first live session; empty home shows the empty state |
| 8 | Limits row opens the decision sheet (4b) | scene `limits` vs board "Limits strip" | popover with every window, pace line, Move / Open Accounts; equal to the board |
| 9 | Keyboard not wired (4c) | `design-gap` "the v3 keyboard" | ⌘K, ⌘N, ⌘J (focus + ↵ / L), ⌘B, ⌘I, ⌘O, ⌘1–9, ⌃Tab switcher, ⌘⇧M, ⌘, and Esc. ⇧↵ / ⌫ / Y on an approval are **not wired (carried)** |
| 10 | Hover peek not wired (4d) | scene `peek` vs board "Hover a row"; `design-gap` "hover peek" | 400 ms, one card, reference markup; not for the active row |
| 11 | Engine banner above the bar, no action (4e) | v3-render empty / seeded | under the session bar, one action "Restart engine" |
| 12 | Model ids raw (5a) | `model-label.test`; v3-render seeded ("Opus 4.7") | `modelLabel` in the bar, table, decision sheet, peek, chat header and facts; raw id in the tooltip |
| 13 | `—` placeholders (5b) | `design-gap` "real data without placeholders"; v3-render | empty table cells; chips show "Model" / "Thinking" muted |
| 14 | Empty grey limit bars (5c) | v3-render empty ("no data yet"); `design-gap` "an account not read yet…" | "no data yet" or "sign in ›", never an empty track |
| 15 | No empty states (5d) | v3-render empty | workbench empty state; the Sessions zone's "No sessions running. Start one ⌘N" |
| 16 | "internal lines not shown" footer (5e) | `chat.test` "hiddenText" | count and kinds in the "read-only here" tooltip (the report's alternative). A row at each drop place gave ten rows on a recorded transcript |
| 17 | Model / thinking as a centred sheet (2c) | scene `model` vs reference `ModelPopover`; `design-gap` "Model popover" | popover under the chip; the pick sheet is gone |
| 18 | Open not a split button; agent apps dropped (2b) | scene `openin`; `design-gap` "Open in" | split button with monogram; default 1, last used 2, submenus, Configure targets…; only the agent app of the session's tool. The report's "agent-app filter" claim was half right: the global target list never carries that kind |
| 19 | Thinking chip shows `—` (2d) | as 13 | "Thinking" muted |
| 20 | Decision sheet details (§6) | scene `decide`; `details.test` | Room left per account with all windows, state dot, account picker, a detail on each How card |
| 21 | Library "Last" (§6) | `details.test` "Library Last" | now / N min / N h / short date |
| 22 | Summary PR and Git lines (§6) | scene `summary` vs board "Summary open"; `details.test` | "open · conflict · changes requested", "e2e (chromium) failed", branch icon, "12 changed · ↑5 ↓9" right-aligned, More as a section |
| 23 | Palette input ring (§6) | `details.test` "palette input" | `input[data-palette]` has no ring of its own |
| — | Tools page (§6) | — | unchanged: the report calls the 2.11 list acceptable per spec §11 |

## Found on the way

- **A submenu opened by hover closed again on click** (new code in this run). Fixed;
  the test is seen red without the fix.
- **A long active title lost its ellipsis after the first hover or click**: before
  the click the title read "stale li…", after it ran past the edge. Starting on a
  session exposed it. Fixed by laying the title out anew after pointer and focus
  events, a font load or a width change.

## Not covered here

- The real macOS window (WKWebView, WebGL arcs, the owner's data and theme).
- The owner decisions G1–G3 in the roadmap: Library "All", the terminal look of
  own-terminal sessions, the terminal font.
