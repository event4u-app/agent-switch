---
complexity: standard
status: open
tree_pin: 2e027fe
---

# Roadmap: a v3 window in two languages

> **Source:** owner requirement D7 (German and English) — marked done for the 2.11
> GUI — and the requirements audit of 2026-11-23, which found zero `t(` calls under
> `gui/src/v3`. Council 2026-11-23 (decision D2 in
> `road-to-a-workbench-that-tells-the-truth`): not dropped, not squeezed into that
> pass, done next with the owner as its named owner.

## Resume condition

Start when `road-to-a-workbench-that-tells-the-truth` is archived. Owner: Matze.

## Goal

Every user-visible string of the v3 window, tray and dialogs goes through the
existing i18n layer (`gui/src/i18n/`), with English and German complete, and a
test fails when a v3 component renders a literal user-visible string.

## Phase 1 — Inventory and guard

- [ ] 1.1 Count the literal strings per v3 file and choose the key layout (one namespace per v3 area).
- [ ] 1.2 A test that fails on a new literal string in `gui/src/v3/**` (allow-list for brand names and key glyphs).

## Phase 2 — Move the strings

- [ ] 2.1 Frame, sessions list, needs, limits, tray.
- [ ] 2.2 Workbench, panels, review, chat, composer.
- [ ] 2.3 Pages, settings, dialogs, overlays, first run.

## Phase 3 — German

- [ ] 3.1 German for every key, reviewed in the running app at the window's own size (no clipped buttons).
- [ ] 3.2 The language follows the app setting already used by the 2.11 GUI.
