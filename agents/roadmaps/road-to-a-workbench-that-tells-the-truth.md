---
complexity: standard
status: open
tree_pin: 2e027fe
---

# Roadmap: a workbench that tells the truth

> **Source:** owner's chat, 2026-11-23: "Lokal soll es aussehen wie im online
> design und umgekehrt … alle Ansichten auf Usability prüfen, auch gegen Orca …
> Terminal? Sessions? Chat? Auslistung der Subagents? CLI? Können wir im Terminal
> weiter arbeiten der offen ist und zeitgleich bei uns in AS? … Git? Changes und
> Vergleiche? Ist alles da was ich anfangs definiert habe?" Three delegated
> audits (requirements vs. code, usability of 40 views, Orca comparison) and one
> council round, all in the session scratchpad and
> `agents/runtime/council/responses/workbench-truth-2026-11-23.json` (gitignored).

## Goal

Every control in the v3 window does what its label says, a session starts the
way the New-session dialog shows it, the user can see where a session runs and
how to work in their own terminal and in Agent Switch at the same time, a
session leads to its diff, and the session list reads at a glance. The design
canvas shows the result, because it renders the real app.

## Decisions

- **D1 — Default start mode is "Your terminal"** (council, both seats, 2026-11-23).
  Spec Principle 5: the app does not take a session from the user's own terminal
  by default. Hosted stays one click away. Revisit if usage shows users expect the
  app to own sessions.
- **D2 — i18n of the v3 window is not dropped and not done here** (council).
  It moves to `road-to-a-v3-window-in-two-languages` (later/), created in this
  change with the owner as the named owner.
- **D3 — Order: misleading actions first** (council): offline actions and
  mislabeled buttons, then the start dialog, then terminal + app at once, then
  session → diff, then the at-a-glance pass the owner asked for by name.
- **D4 — Proposals A–E on the canvas are directions, not specs** (owner,
  2026-11-23): built with the app's own components and radii.

## Phase 1 — Actions that do what they say

- [x] 1.1 Engine stopped: the session pane is marked stale (no spinner, no live cursor) and every action that needs the engine is disabled with the reason.
- [x] 1.2 Needs-you CI item: the verb says what happens. With a hosted or chat session it sends the fix prompt (failing checks named) to the agent; otherwise it is labelled "Open checks".
- [x] 1.3 Blocker strip "Send to agent" sends its prompt to the session (hosted / chat); where Agent Switch cannot type, the button says "Copy prompt" and copies it.
- [x] 1.4 "End…" opens the built `EndDialog` instead of the generic confirm.

## Phase 2 — A session starts the way the dialog shows it

- [x] 2.1 Model, thinking and "In a new worktree" from the New-session dialog reach the started session (hosted and your terminal), with CLI flags where `host start` lacks them.
- [x] 2.2 The dialog's prefill is really remembered per project (last tool, model, thinking, where), and says so only when it is.
- [x] 2.3 First start in a project defaults to "Your terminal" (D1).

## Phase 3 — Your terminal and Agent Switch at the same time

- [x] 3.1 The session bar always shows where the session runs: "Hosted · type here or attach" / "Terminal.app · watching".
- [x] 3.2 A hosted session's Open-in menu has "Attach in Terminal" (runs `agent-switch host attach <key>` in the user's terminal); its effect — one shared tmux, input from both sides goes to the same agent — is said in the menu hint.
- [x] 3.3 A your-terminal session says how to type from the app (Take over) and what that changes, in place, not only in a tooltip.

## Phase 4 — From a session to its diff

- [x] 4.1 Summary's changed-files count and the Changes panel count from one source and agree.
- [x] 4.2 The count and every file row open the review page at that file.

## Phase 5 — The list at a glance

- [x] 5.1 One status vocabulary: orange only for "needs you"; selection and checkboxes use the neutral accent; one status mark per row.
- [x] 5.2 Two-line rows are the default density (proposal A); compact stays a choice.
- [x] 5.3 The window and the tray count Needs-you the same way.

## Phase 6 — The canvas shows it

- [x] 6.1 Fixture panels (terminal, Summary, Changes) follow the selected session; the end and review boards show their real state.
- [ ] 6.2 Rebuild the embed, publish it to the design canvas, and mark the proposals that are now built.

## Phase 7 — Arena round 1 (10 reviewers, all NOT DONE; reports in the session scratchpad `arena/r1/`)

- D5 — Pulled forward from the second pass because the owner named them and two reviewers rated them blockers: subagent drill-in, row age / tool / account mark, status-first order.
- [x] 7.1 Start: the dialog's account and command preview follow every change; folder and model are pickable; "Start in <terminal>" starts in the user's terminal without a second dialog; "Choose another…" keeps the plan; Hosted is not offered without tmux; prefill keyed by repo; no nested worktree; the worktree is created after the start guard and never collides; a Codex route does not leak into a Claude chat; `--help` lists every command the GUI uses.
- [x] 7.2 Take over: from your terminal into Agent Switch on the same account, Claude and Codex, with an honest step when the source still runs; the real terminal app is named; not offered on hosted sessions.
- [x] 7.3 Git: the review a count opens shows the same files (an "Uncommitted" scope, the base shown); large diffs stay usable; a failed diff is said; Create PR pushes and creates the PR; Clean worktrees acts on the selection after asking.
- [x] 7.4 Chat: one card per question and its answer arrives; Other / skip / multi-select; the read-only chat follows the selected session; "Always allow" names the rule it applies; printed keys work; Codex chats say Codex.
- [x] 7.5 Overlays: dialogs take focus and trap it, Esc closes them over a focused terminal; menus work with the keyboard; menus anchored to their trigger stay reachable with a side panel open.
- [x] 7.6 Needs and actions: a conflict is not called a CI failure; a fix goes to the session the item names; check names are delimited as data in prompts; every move, send and blocker action respects a stopped engine; Compact, Thinking and Focus terminal are offered only where they work; tray verbs act or go to their item.
- [x] 7.7 List and subagents: rows show age, tool and account mark; status-first order by default; CI in the table as words; subagent rows carry their task description; Children rows open; a subagent opens read-only with its current tool and elapsed time.

## Follow-ups (not in this roadmap)

`road-to-a-v3-window-in-two-languages` (D2) and `road-to-the-workbench-second-pass`
(resume dialog with preflight, palette actions, batched review
comments, status groups / slimmer header / shared limit row / table — proposals
B–E —, narrow-window layout, readability floor), both under `later/`.
