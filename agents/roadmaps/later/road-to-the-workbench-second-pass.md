---
complexity: standard
status: open
tree_pin: 2e027fe
---

# Roadmap: the workbench, second pass

> **Source:** the three audits of 2026-11-23 (requirements vs. code, usability of
> 40 views, Orca comparison) and the council's cut (decision D3 in
> `road-to-a-workbench-that-tells-the-truth`): new capabilities and broad visual
> consistency follow once every existing action tells the truth.

## Resume condition

Start when `road-to-a-workbench-that-tells-the-truth` is archived.

## Phase 2 — Resume with a preflight

- [ ] 2.1 A Resume dialog: what will happen, in which folder/branch, on which account; options new worktree, fork, other account (spec §8.4).

## Phase 3 — Review that batches

- [ ] 3.1 Line comments collect into one prompt sent with "Send to agent", also from the terminal view.
- [ ] 3.2 j/k between files; compare base selectable.

- [ ] 3.3 An idle review re-reads on window focus (today a stale page refuses an action by its file hash, but still shows the old state until the next action).
- [ ] 3.4 Clean up offers to delete the merged worktree's `agent-switch/<name>` branch too — as its own confirmed choice, never by default.

## Phase 4 — Palette that acts

- [ ] 4.1 Commands: move, resume, end, start, and ⌘↵ for the secondary action.

## Phase 5 — The canvas proposals B–E, as directions

- [x] 5.1 Status groups with counts in the session list (B): Needs you · Running · Idle by default, count pills, "N more" after five rows; a session a Needs-you row shows is not listed twice.
- [x] 5.2 Slimmer session header: where-it-runs as a chip, secondary actions in ⋯ (C): Focus terminal, Take over (with what it changes) and Copy conversation lead ⋯; the strip over a your-terminal session is gone.
- [x] 5.3 One shared limit row for sidebar, tray, decide sheet and accounts (D): one set of cells (bar · used · reset); the strip's rows have the same columns, 5h unless another window is near its limit.
- [x] 5.4 All sessions: two-line rows, status tabs, hidden empty filters (E); a shared account/model is said once; List/Projects follows the Sessions window's Group menu.

## Phase 6 — Fit and read

- [ ] 6.1 A narrow window keeps the terminal usable (sidebar collapses, chips move into ⋯).
- [ ] 6.2 Readability floor: no text under 11px, no 60%-opacity text, labelled icon-only buttons.
- [ ] 6.3 Unread state and a last-message preview in the session list (Orca pattern; row age moved to road-to-a-workbench-that-tells-the-truth 7.7).
