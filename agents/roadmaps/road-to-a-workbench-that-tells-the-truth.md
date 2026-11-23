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

## Phase 8 — Arena round 2 (4 DONE, 6 NOT DONE; reports in the session scratchpad `arena/r2/`)

- [x] 8.1 Create PR: what was confirmed is what runs (branch, head, remote, refspec, base, title bound; refused when changed); preflight before any push (no commits ahead, PR exists, not GitHub); base selectable, defaulting to the branch's real target; Create PR hidden when a PR exists.
- [x] 8.2 Review: a tab never acts on another session's data; file names with spaces and non-ASCII work; one file inventory for Changes and Review with omissions said; the shared-worktree warning stays current while polling.
- [x] 8.3 Chat: the whole conversation is reachable (earlier turns load on demand, the budget counts visible rows); Copy says what it copies; a chat-started session's Terminal toggle and stale question cards are honest.
- [x] 8.4 Subagents: `timeline --subagent` works end to end; subagents are listed and open from Claude Code's own meta files without our hook; reads stay confined to the session folder; truncation is said.
- [x] 8.5 Actions: Open in and Resume work for Codex or say why; the engine-stopped lock covers only what needs the engine; a hosted send never submits the user's draft and reports a failed send; CI items send no check names; label and target of a CI item agree; `host adopt --force` never starts a second writer; Move from any entry opens the v3 decision sheet; the tray starts the v3 New-session dialog; the real dialog shows the folder's git state.
- [x] 8.6 Flyouts and list: ⌘J moves focus to the item so its keys never reach the terminal; session-bar chips move into ⋯ instead of being cut when a panel is open; Limits rows work by keyboard; ⌘K/Esc returns focus; an existing install gets the new sort and density defaults once; the sort menu labels its default.
- [x] 8.7 Owner inbox of 2026-11-23 triaged: three proposal roadmaps under `later/` (`road-to-a-reading-every-pick-can-trust`, `road-to-sessions-that-hold-wherever-they-run`, `road-to-skins-that-change-the-look-not-the-meaning`), each with its resume condition (the owner's answers); the inbox round archived as `agents/tmp.old/inbox-2026-11-d`.
- [x] 8.8 The near-limit sheet (owner screenshot in that round): the suggested account is a real account and is the one preselected; the footer names what happens when sessions go to different accounts; the sheet does not call 60 % "near limit" below the account's protect threshold.

## Phase 9 — Arena round 3 (6 DONE, 4 NOT DONE; reports in the session scratchpad `arena/r3/`) — the last round the owner asked for

- [x] 9.0 `--since` and `--dir` take their values; a test fails when any command reads a flag as a string the parser does not give a value (r3 git blocker 1, code blocker 3; `sign-in-browser --dir` was broken since #153).
- [ ] 9.1 Git integrity: whole-file stage / unstage / discard use whole-file git commands (deleted and new files keep their meaning); binary, large and symlinked files can be acted on; a file action applies to what the page showed (hash bound, refused when changed); a base that exists only locally is refused before any push; the confirmed PR binds the push URL and the PR repository; the review poll waits for the previous read; Clean up says what it did and checks for live sessions.
- [x] 9.2 Concurrency: adoption holds an OS-level lock through registration; timeline polls never roll back or drop events between pages; subagent reads stay confined even when a directory is swapped after validation; a CI item never falls back to another PR.
- [ ] 9.3 Chat and engine: lines Claude Code adds itself (task notifications, compaction summaries) are not drawn as the user's prompts; the chat sends while the engine is stopped; load more shows what it loaded; the draft check reads multi-line drafts and an open permission menu right; the attached tmux view shows no other sessions' status and keeps the agent's own Ctrl-B; the design fixture shows the real hosted menu and the decision sheet of the subject it was opened for.

## Follow-ups (not in this roadmap)

`road-to-a-v3-window-in-two-languages` (D2) and `road-to-the-workbench-second-pass`
(resume dialog with preflight, palette actions, batched review
comments, status groups / slimmer header / shared limit row / table — proposals
B–E —, narrow-window layout, readability floor), both under `later/`.
