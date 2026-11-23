---
complexity: standard
status: done
tree_pin: e608130
---

# Roadmap: a session tree that reads at a glance

> **Source:** `agents/tmp.old/inbox-2026-11-22/` — the owner's chat of 2026-11-22
> (two turns: "sessions and sub-sessions are well grouped there, use that for AS
> v3, go into detail" and "deep analysis, three loops, final roadmap — and we can
> still analyse the code and use it for our project"), two supplied plans written
> from that chat, and a code read of the reference in this session. The reference
> is called **R1** here: an MIT-licensed open-source agent IDE, read at commit
> `923b19d`, never run. Its identity is in the round's intake note only.
>
> **Pins.** Every agent-switch line below is verified at `dev/v3@e608130`. No commit
> between the supplied plan's pin `56e5f4d` and `e608130` touches `gui/src/v3`,
> `gui/src/vm`, `src/lineage.ts`, `src/sessions.ts`, `src/git-facts.ts`,
> `src/codex-hooks.ts` or `src/commands/sessions.ts`, so the plan's line numbers hold.
>
> **Method.** Each finding starts from a defect in this tree. R1 is cited per
> defect, only where it holds a working answer. Nothing is added because R1 has it.

## Goal

The Sessions window answers three questions without a click: what each session is
doing, which sessions belong together, and where the user is needed. Today the
first is guessed from a file time, the second stops one level down, and the third
is not carried from a child to its parent. The list also moves while the pointer
is on it.

No new hook, no new account behaviour, no inferred relation. Principles 1–10 and
§13 of `docs/design/agent-switch-v3-ui-spec.md` stay binding.

## Findings

| ID | Defect in agent-switch | Evidence (`e608130`) |
|---|---|---|
| F1 | "Working" is a guess: live and transcript written in the last 60 s. A turn inside a long tool call reads idle; a finished turn reads working for up to a minute. The host's own state word is read and then never used for the state. | `gui/src/vm/build.ts:54,271`; `src/api.ts:143-159` reads `status`, `statusUpdatedAt`; `src/sessions.ts:174,287` keeps `hostStatus`; no `hostStatus` under `gui/src` |
| F2 | A helper session (council seat, arena, court) is "running" until its `SessionEnd`, and the window draws running as working. A seat that is idle or waits for an approval looks busy. | `src/lineage.ts:41`; `gui/src/v3/adapter/data.ts:124-126` |
| F3 | A child row shows a dot and a label. The child's key names its tool and account, and both are dropped. | key at `src/lineage.ts:40`; `ChildModel` `gui/src/v3/sessions.tsx:18-27`; `ChildLine` `:119-129` |
| F4 | The window draws one level. A seat's own subagents are not shown, although the engine nests to any depth. | `sessions.tsx:18-27`, render `:263-266`; roots only `data.ts:235`; engine `src/lineage.ts:85-104` |
| F5 | A parent row does not show that a child needs the user; the trailing slot counts working children only. | `data.ts:229,247`; `trailing()` `sessions.tsx:94-108` |
| F6 | A project is named from the folder path: a worktree joins its repository only when its path matches `-wt/<name>` or `/.worktrees/<name>`. Git's common dir is computed and reduced to a boolean. | `data.ts:258-263`; `src/git-facts.ts:86-91,107` |
| F7 | The default order is "most recent first", recomputed on every refresh, also while the pointer is on the list. | `sortLive` `sessions.tsx:76-87`; no hold under `gui/src/v3` |
| F8 | The open, active row is two visual pieces: the raise fill ends at the row, its children hang outside it. | `sessions.tsx:222` (fill), `:263` (children as sibling) |
| F10 | All children of an open parent are listed flat, running and finished alike; a council with nine seats shows nine lines although one is working. | `sessions.tsx:263-266` maps every child |

F9 of the supplied plan (hosted Codex state stays the 60 s guess, `src/codex-hooks.ts:28`)
belongs to `later/road-to-host-signals-followups.md` § Codex and landed there.

## What R1 does at the same places

| For | R1 at `923b19d` | Taken as |
|---|---|---|
| F1 | Explicit states with their own clocks; a state without fresh evidence shows as unverifiable or idle with "No update in 34m". Hooks outrank the terminal-stream report. | pattern: `src/shared/agent-status/presentation/agent-row-decay-state.ts:14-34`; `src/main/agent-hooks/README.md:11-19` |
| F2, F3 | A child is drawn by the same row grammar as its parent: state glyph, agent icon, text, trailing facts. | pattern: `…/sidebar/workspace-card/activity/worktree-card-compact-agent-row.tsx:204-299` |
| F4 | Tree connectors per row: rails for ancestors that continue, a tee for a middle child, a rounded elbow for the last, a stem below the parent; each row paints only its own slice. 18 px per level. | pattern: `…/sidebar/worktree-list/rows/lineage-guides.tsx:17-89`, `rows/indentation.ts:1` |
| F5 | A collapsed parent carries a merged child-state dot plus `+N`, so hidden child work stays visible. | pattern: `…/workspace-card/activity/worktree-card-compact-agent-row.tsx:276-287` |
| F6 | The parent link only nests rows and changes nothing in git; the project is the repository. | pattern: `src/shared/sidebar-list/sections/worktree-grouping.ts:27-144` |
| F7 | While the pointer is on the list, rows keep their place; rows that left are removed, new ones are inserted where the new order puts them. | **code**, a pure merge: `…/sidebar/worktree-list/listing/held-order.ts` (the supplied plan reads it as 15 lines, `:2-15`; re-read at 4.4 before porting) |
| F8 | The workspace card encloses its agent rows and its child toggle in one surface. | pattern: `…/workspace-card/template/default-workspace-card.json:239-243` |
| F10 | Children split into active and idle; idle ones fold behind one "N idle" disclosure row. | pattern: `…/workspace-card/activity/WorktreeCardAgents.tsx:344-396` |

## Decisions

| ID | ownership | Decision | Why | Revisit if |
|---|---|---|---|---|
| D1 | reversible-technical | State source order: host registry word, then the hook events AS already records, then the transcript time. A lower source speaks only where the higher is silent; the dot's tooltip names the source. | F1; same precedence as R1's hook/stream rule | S1 shows the registry word wrong more often than the file time |
| D2 | reversible-technical | The runtime state is computed in the engine and added to `sessions --json` as `runtime: { state, source, observedAt }`. No field is removed. | one value for CLI, tray, MCP and window | — |
| D3 | reversible-technical | A `busy` whose `statusUpdatedAt` and transcript are both older than 10 minutes is shown as unconfirmed, with its age in words. | a long build is real work; ten silent minutes are worth a look | S1 measures real long-tool gaps |
| D4 | reversible-technical | A child that is a session gets its state from the same function as a root. A subagent keeps running / done. | F2 | — |
| D5 | reversible-technical | Child rows show tool and account as identity marks always; state words only when not OK; model and age in the peek card. | spec principle 10, §3.3 | the owner wants numbers on rows in comfortable density |
| D6 | reversible-technical | A parent whose descendant needs the user uses the existing trailing-slot rank 4 (small amber dot). No new mark. | spec §3.2: one meaning per mark | — |
| D7 | reversible-technical | The project is the repository root from `git rev-parse --git-common-dir`. Without git it is the folder, as today. The path patterns go. | F6; spec §13.6 provenance | — |
| D8 | reversible-technical | Under "Group by project", a worktree sub-header appears only when the project has live sessions in more than one worktree. | no extra line for the common case | — |
| D9 | reversible-technical | Order hold applies to the Sessions zone and the tray list while the pointer is inside or a row has keyboard focus. The Needs-you zone is never held. | F7; what needs the user must not wait | — |
| D10 | reversible-technical | Ported R1 code carries an origin header (repository, commit, path, MIT, copyright holder), and `ADOPTED.md` gains one entry per item under "Adopted". This is the attribution the MIT license requires, not a design citation. | the owner allowed using the code (turn 2); MIT requires the notice | — |
| D12 | owner (Q1, 2026-11-22: "1") | The active, open row and its children share one raise surface; the Marker frames the whole block. | F8; the grouping the owner liked in R1 | the block reads heavier than the row in a render |
| D13 | council (Q3, delegated by the owner 2026-11-22; both seats, converged) | No "unseen turn" rank and no unseen mark. A finished turn stays in the idle group, ordered by recency as today. | both seats: a rank right after needs-you would outrank failing CI (priority inversion); a rank that clears on view moves the row the user just clicked; no evidence the findability gap exists here. Record: `agents/runtime/council/responses/2026-11-22-unseen-turns.md` (gitignored). Settled by decision, not by measurement. **Scope:** an unseen-turn rank or mark in the Sessions list only. | the owner reports missing finished sessions in daily use, or a variant ranked below failing CI with a mark approved on the boards is proposed |
| D11 | reversible-technical | Under an open parent, running children and children that need the user stay listed; finished and idle ones fold behind one "N idle" line that opens in place. | F10; a row at rest carries no extra glyph | the owner wants every child listed |

## Owner questions

| ID | Question | Options | Default without answer |
|---|---|---|---|
| Q1 | F8: may the active, open row and its children share one raise surface, with the Marker framing the block? It changes spec §3.2 and §5.2. | (1) yes, one block (2) no, the row stays the framed item | **answered 2026-11-22: (1)** → D12 |
| Q2 | D3: how is "unconfirmed" drawn? | (1) the working dot without its pulse plus "no update in 34m" (2) a new mark in §3.3 (3) not at all | step 1.4 takes option 1 |
| Q3 | A session whose turn ended since you last looked at it: does it get its own sort rank right after needs-you, and a visible "unseen" mark? R1 does both (bold title until seen; `src/shared/sidebar-list/sorting/smart-attention.ts:124-151`). The v3 boards have no such mark. | (1) rank and mark (2) rank only, no mark (3) neither | **decided by the council 2026-11-22: (3)** → D13 |

## Spikes

- **S1 — the registry word across a turn.** Record `sessions/<pid>.json`
  (`status`, `statusUpdatedAt`) once per second through: a prompt, a tool call
  longer than two minutes, a permission prompt, an Esc interrupt, a subagent run,
  `/clear`, a compaction. Claude Code version noted. Output:
  `agents/evidence/registry-status-across-a-turn-2026-11.md` and a fixture.
  *Kill:* if `busy` is not held through the long tool call, or the word does not
  change at the permission prompt and no hook covers it, D1 falls back to
  hooks-then-file and Phase 1 is replanned before any edit.

## Phase 0 — Probe

- [x] **0.1 Run S1.** verify: the evidence file exists, names the Claude Code
      version, and holds one row per situation with the observed words.
      _Done 2026-11-23:_ `agents/evidence/registry-status-across-a-turn-2026-11.md`,
      Claude Code 2.1.316; `busy` holds through a 155 s tool call, so the kill
      condition does not fire.

## Phase 1 — A state the host reported

- [x] **1.1 Keep the clock.** `SessionRow` gains `hostStatusAt` from
      `statusUpdatedAt`; `sessions --json` shows it. verify: a `tests/` case with
      a registry fixture; absent field → absent key.
- [x] **1.2 One function for the runtime state, in the engine.**
      `runtimeState(row, events, now)` → `{ state, source, observedAt }` by D1:
      waiting (hook or open question) → needs-you; registry `busy` → working;
      registry `idle` or `shell` → idle; no registry word → the 60 s file rule with
      `source: "transcript"`. verify: table test over the S1 fixture, seen red
      first for "long tool call reads working" and "finished turn reads idle at
      once".
      _Done 2026-11-23:_ S1 found a fourth word, `waiting` at a permission prompt
      (also a subagent's); it reads needs-you with `source: "host"`, below a hook
      or transcript wait. `src/runtime-state.ts`, `tests/runtime-state.test.ts`
      (7 red with the host source neutralised, then green).
- [x] **1.3 The window reads it.** `sessionFromRow` uses `row.runtime` when
      present and keeps the old rule for an engine that does not send it. verify:
      `gui/src/vm` test with and without the field; `WORKING_FRESH_MS` has one
      remaining caller.
- [x] **1.4 Unconfirmed, in words.** D3 drawn per Q2. The tooltip of every state
      dot names its source ("from Claude Code", "from the last hook", "from the
      transcript time"). verify: view test; render in three themes.
- [x] **1.5 Children that are sessions use the same function (D4).**
      `src/lineage.ts` stops deciding their state; the child carries its session's
      `runtime`. verify: a seat without `SessionEnd` whose registry word is `idle`
      renders idle; one with an open approval renders needs-you.

## Phase 2 — Children that say who they are

- [x] **2.1 `ChildModel` carries identity.** For a session child: tool, account
      name and colour, from its key. For a subagent: type and worktree name
      (`worktreeOf`, `data.ts:147-156`). verify: adapter test from a
      `sessions --json` fixture with a three-seat council on two accounts.
- [x] **2.2 One row grammar.** `ChildLine` shows state dot, tool monogram,
      `AccountMark`, label; the trailing slot follows `trailing()`'s priority.
      Words only when not OK (D5). Parent and child rows share column positions.
      verify: view test; render at 300 px window width in compact and comfortable
      density, no clipped label.
- [x] **2.3 Peek for a child.** Hovering a child shows the peek card (§7.3) with
      model, thinking, age and last output line where the engine has them.
      verify: view test; one card at a time still holds.
- [x] **2.4 Clicking a session child opens it.** A subagent row stays
      non-navigable and says so in its tooltip. verify: view test.

## Phase 3 — A tree, and a parent that reports

- [x] **3.1 Nested children in the model.** `ChildModel.children`, any depth,
      from the engine's tree (`src/lineage.ts:85-104`); no inferred edge;
      "relation unknown" rows stay where they are today. verify: adapter test with
      a root → seat → subagent fixture; a cycle in the input yields roots, never a
      loop (`src/lineage.ts:79-84`).
- [x] **3.2 Connectors.** Rails, tee, elbow and stem per row, from one component,
      replacing the single left border at `sessions.tsx:263`. Geometry after R1's
      `lineage-guides.tsx`, written against AS tokens (`--ac-line`). verify:
      render of depth 1, 2 and 3 with a last and a middle child, in three themes;
      lines meet the dots at every depth.
- [x] **3.3 Roll-up (D6).** A row's `needsYou` is true when a Needs-you item
      points at it or any descendant; the running count sums descendants. The
      tooltip names the child. verify: `trailing()` test, red first, for a
      collapsed council with one seat waiting.
- [x] **3.4 ⌘J reaches a child.** Jumping to a Needs-you item whose subject is a
      child opens its parent's children and focuses the child row. verify: window
      test.
- [x] **3.5 Idle children fold (D11).** Under an open parent, children that are
      neither working nor needs-you collapse into one "N idle" disclosure line;
      it opens in place and remembers its state per parent for the session.
      verify: view test, red first, for a nine-seat council with one working seat
      (two lines, not nine); render in three themes.
      _Done 2026-11-23:_ connectors re-derived (16 px per level), no R1 code ported.
      A parent's needs-you dot or running count also opens its children, so a
      waiting child is reachable inline.

## Phase 4 — Projects from git, a list that holds still

- [x] **4.1 `GitFacts.repoRoot`.** The main checkout's root from the common dir
      already computed at `src/git-facts.ts:91`; added to `sessions --json` under
      `git`. verify: test with a linked worktree outside the repository folder and
      one under `.claude/worktrees/`.
- [x] **4.2 Project = `repoRoot` (D7).** `projectOf` uses it; the path patterns at
      `data.ts:262` are removed. verify: adapter test where three sessions in
      three worktree layouts land in one project group.
- [x] **4.3 Worktree sub-header (D8).** Branch name, a "worktree" chip for a linked
      one, session count. verify: view test for one worktree (no header) and two
      (headers); render in three themes.
- [x] **4.4 Order hold (D9).** Re-read R1's `held-order.ts` at `923b19d`, port the
      merge (D10) and add an engagement hook for pointer-inside and focus-inside.
      verify: unit test of the merge (kept places, removed rows, inserted
      arrivals); window test: with the pointer on row 3, a refresh that would
      reorder leaves row 3 in place and reorders after the pointer leaves.
- [x] **4.5 The same in the tray.** `gui/src/v3/tray.tsx:89` sorts by activity too.
      verify: tray test.
- [-] **4.6 Unseen turns.** Cancelled by D13 (council, Q3 option 3): no rank, no
      mark. Reopens only under D13's revisit condition.

## Phase 5 — One block for the open row (D12)

- [x] **5.1 Spec first.** Edit §3.2 and §5.2: when an active row's children are
      open, the raise fill and the Marker cover the row and its children as one
      block. verify: the owner's answer to Q1 ("1", 2026-11-22) is quoted in the
      commit.
- [x] **5.2 Build it.** verify: `design-guard.test.ts` gains the rule; render of an
      open active row with three children in three themes.

## Close

- [x] **C.1 `ADOPTED.md`:** one entry per R1 item actually ported, with commit,
      path and the MIT notice. verify: every ported file's header names the same
      commit.
      _Done 2026-11-23:_ one port, `gui/src/v3/held-order.ts` (ADOPTED.md § 8); the
      connectors are a pattern only, re-derived.
- [x] **C.2 Spec and docs:** §3.3 (state sources), §5.2 (child grammar, tree,
      roll-up, idle fold, worktree sub-header, order hold), the desktop-app guide
      in `starlight/`. verify: every changed claim has a `file:line` in the tree.
      _Done 2026-11-23:_ spec §3.3 (sources, quiet work), §5.2 (child grammar, tree,
      roll-up, idle fold, worktree sub-header, order hold), §3.2 (one block);
      `starlight/src/content/docs/guides/desktop-app.mdx` "Reading the session tree".

## Not taken

| ID | Proposal | Why not |
|---|---|---|
| K1 | Card layout as a JSON template | AS has one row shape and a fixed slot priority; R1's template serves three card styles and plugins |
| K2 | Full-autonomy launch flags as the default | spec principle 3: approvals stay real |
| K3 | Inferred parents from cwd or the active workspace | spec §13.6: no heuristic parent |
| K4 | One active account per provider, switched by hand | AS places each start by remaining quota |
| K5 | A per-prompt hook to mark a turn open | the registry word is already local; Codex has no prompt hook |
| K7 | Group by PR state | the status order already puts failing CI first |
| K8 | An agent board (needs you / working / done / idle columns) | the Needs-you and Sessions zones cover it; no defect |
| K9 | A new domain model (Session / Execution / AgentNode / Run / Task graph) before the UI | no defect in this tree needs it; run and worker modelling is `later/road-to-session-orchestration.md`'s |
| K10 | A headless remote runtime node, scheduling, pairing | `later/road-to-agent-switch-v3-reach-carried.md` owns reach; NON-GOALS excludes a mandatory server |
| K11 | Multi-pane layouts and presets (Focus / Review / Parallel / Council) | no defect in the session list; the frame already has tabs and one right window |
| K12 | List virtualization | no measured row count where the list is slow; revisit above 200 live rows |
| K13 | A coordinator / worker crew panel | inter-session messaging does not exist in AS; councils are agent-config's |

## Risks

- **The registry word is internal to Claude Code.** D1 keeps two fallbacks and the
  tooltip names the source, so a changed word degrades to today's behaviour, not
  to a wrong one.
- **Roll-up can hide which child asks.** 3.3's tooltip and 3.4's jump are the
  answer; both are in one phase on purpose.
- **Idle fold can hide a child the user is looking for.** The fold line names the
  count and opens in place (3.5); search and ⌘J still reach every child.
- **Order hold can show a stale order for long** if the pointer rests on the list.
  Needs-you is exempt (D9).
