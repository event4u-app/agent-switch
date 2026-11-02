---
complexity: program
status: planned
tree_pin: ff38137
---

# Roadmap: agent-switch v3.0 "Central" — sessions that survive, a tree, git/PR, a library

> **Source:** `agents/tmp.old/inbox-2026-11-b/` — owner transcript (three turns,
> 2026-11-02), the consolidated proposal `road-to-agent-switch-v3` and its two
> parents, three parallel proposals from a second assistant, one UI sketch, and
> (second arrival, same day) the v3 UI design `design/`: a written spec, reference
> boards as a patch, 42 board renders. Proposal ids are kept where they help a
> reader map back (V*, M*, S*, E*, K*).
>
> Follow-ups (parked, pull trigger named in each):
> [`later/road-to-agent-switch-v3-client.md`](later/road-to-agent-switch-v3-client.md) (v3.1),
> [`later/road-to-agent-switch-v3-reach.md`](later/road-to-agent-switch-v3-reach.md) (v3.2).
> Prerequisite (done, archived): [`road-to-hooks-that-keep-up.md`](archive/road-to-hooks-that-keep-up.md).

## Branch model (owner, 2026-11-02)

- **All v3 work lands on `dev/v3`**, cut from `main@ff38137`. Every PR of the four
  v3 roadmaps targets `dev/v3`, never `main`.
- `dev/v3` merges into `main` **once, when v3 is complete** — a production-trunk
  merge, so it waits for the owner's explicit go on that turn.
- `main` keeps shipping 2.x; `main` is merged into `dev/v3` after every 2.x
  release, so the final merge does not carry months of drift.
- CI runs on PRs into `dev/v3` and on pushes to it (`.github/workflows/ci.yml`).

## Design basis (binding)

- **The UI spec is the spec.** [`docs/design/agent-switch-v3-ui-spec.md`](../../docs/design/agent-switch-v3-ui-spec.md)
  says what every v3 element is for, how it looks and how it behaves. It is built
  1:1 (`design.fidelity_mode` default `strict`): every visible deviation — font,
  control, component, layout, spacing, colour, an added or omitted element —
  needs the owner's confirmation first. Section numbers below (`§n`) point into it.
- **Reference boards:** [`docs/design/agent-switch-v3-reference.patch`](../../docs/design/agent-switch-v3-reference.patch)
  adds `gui/src/v3/` (boards on demo data, theme registry + resolver + tests) and
  five shared `gui/src/ui/` changes. It applies cleanly on `ff38137`. Its code is
  adapted, not re-derived (Phase 6), but it is **not** merged as it is: applied
  whole it drops GUI line coverage to 63.6 % against the 78 % floor
  (`gui/vite.config.ts`, measured 2026-11-02). Where boards and spec disagree, the
  spec wins and the conflict is reported (spec §0).
- **Board renders** (42 PNG, ~7.8 MB) stay in the inbox
  (`agents/tmp.old/inbox-2026-11-b/design/views/`). They check the result; the
  spec and the boards are the input.
- **Superseded by the design:** the earlier UI sketch's three-column layout
  (sidebar pinned · projects · recent · archive · accounts, right inspector) →
  spec §4 frame; the quick-input field on a session row and the child mini-sheet
  are not in the design and are dropped (typing goes into a hosted session's
  terminal tab, children show under the row and in the Children window).
- **Conflicts reported, spec wins (no owner decision needed):** the `map` board
  (`rest.tsx`) says Health = "Ready" in the title bar and names an "Accounts
  zone"; spec §4.1/§11 say "Engine stopped" only while the engine is down, and
  §5.3 a Limits strip.
- **Conflicts decided by the owner (2026-11-02):** D-mirror, D-vault, D-approve
  (Decisions) — confirmed deviations from the spec, listed in the fidelity matrix.

## Goal

agent-switch becomes the switch-and-session center the owner asked for: every
session shows **who it belongs to** (subagent, council seat, other helper),
**where it works** (branch, worktree, dirty, ahead/behind), **what its PR does**
(open/merged/closed, CI, mergeable, review), opens in the editor with one click,
**keeps running when the window closes**, and can be typed into from AS. Old
sessions can be pinned, kept beyond Claude's cleanup and resumed. Everything the
user sees follows the v3 UI spec.

## Owner demands this roadmap answers (transcript, 2026-11-02)

| # | Demand (owner's words, paraphrased) | Where |
|---|---|---|
| D1 | show which session is a sub-session (subagent, council, arena, court …) | Phase 2, Phase 7 |
| D2 | branch, worktree, PR incl. CI status, mergeable / merged | Phase 3, Phase 8 |
| D3 | open in VS Code / PhpStorm per click | Phase 5, Phase 8 |
| D4 | AS as switch & session center | whole roadmap |
| D5 | run the CLIs/terminals in AS, type into them at any time | Phase 1, Phase 8 |
| D6 | pin/save old sessions, resume as management | Phase 4, Phase 9 |
| D15 | full redesign and re-split are allowed | Phases 6–9, Decisions |
| D16 | take the design as the basis (second arrival, 2026-11-02) | Design basis, Phases 6–9 |

D7–D11 (Claude-Desktop-class client, view switch, drag & drop, diffs) are in
`later/road-to-agent-switch-v3-client.md`; D12–D14 (other agents, local models,
access from anywhere) in `later/road-to-agent-switch-v3-reach.md`.

## Constraints (binding)

- **The user's own start stays untouched.** Sessions started outside AS are shown
  and can be focused; typing into them is only possible for sessions AS hosts.
- **No port, no server** in v3.0 (`NON-GOALS.md` § No bundled dashboard server).
  App ↔ engine over Tauri IPC / a 0600 socket.
- **No automatic account rotation** (existing principle, `NON-GOALS.md`; spec
  §1.2, §13.1).
- **Every edge and status says where it came from.** A relation AS cannot prove is
  shown as "relation unknown", never guessed silently (source: host hook, AC
  lineage contract, git observation, GitHub, host, counted; spec §1.4, §13.6).
- **Identity is namespaced.** `session_id` is never a global key; session,
  process, terminal and worktree are separate identities.
- **No code from `neelsatyavolu/agmux`** (MIT + Commons Clause): ideas only.
- Every existing GUI function stays reachable (redesign principle of 2026-10-28;
  spec §1.6 and the map in §11); the modal terminal sheet stays for installs and
  logins.
- **Privacy floor on stored events:** no prompt or answer content in the event
  store; `last_assistant_message` and similar fields are discarded at ingest;
  free text that must be kept passes `redactSecrets`.
- **Dependency direction:** AS reads no agent-config files or AC-specific env names;
  AC writes the published lineage contract, AS only reads that contract.
- **Hosting is opt-in per start.** The default start stays unchanged; "Host in
  Agent Switch" is a radio card in the start dialog (spec §1.5, §8.1). Pin and
  name never write host index files.
- No URL schemes (`phpstorm://`, `vscode://`) as the open path; no tmux `-CC`.
- **UI behaviour rules of spec §13 (1–10) and principles of spec §1 (1–10) are
  binding**, in particular: approvals stay real and are one decision wherever
  they are answered; model and thinking changes apply from the next turn and are
  locked for sessions in the user's own terminal; closing a tab never ends a
  session; stale usage is drawn greyed with its age.
- Scope line: `later/road-to-session-orchestration.md` (pause/resume, scheduling)
  stays disjoint; this roadmap does not schedule sessions.

## Verified against the tree (`ff38137`)

- Embedded terminal exists (Rust PTY + xterm), but as a modal sheet; closing kills
  the child (`gui/src/redesign/screens/terminal-sheet.tsx:93-140`,
  `gui/src-tauri/src/pty.rs:118-120`). Only `agent-switch` may run in it
  (`pty.rs:20`).
- AS-managed tmux exists, one session **per profile** (`src/tmux.ts:32-34`) —
  does not fit 2–3 sessions per account.
- The view model has a `branch` field that is always `null`
  (`gui/src/vm/build.ts:257`).
- No `--settings` hook injection anywhere in `src`.
- AC ships no first-class "arena"/"court" entity (only prose mentions in judge
  skills of the installed agent-config); the UI sketch shows a Court row anyway →
  a **generic kind + label** per child, no dedicated views (Decision C3).
- The design patch applies on `ff38137` without conflicts; with it, `gui` passes
  `tsc --noEmit` and 627/627 tests, and fails the coverage floor (lines and
  statements 63.6 % vs 78 %). Measured 2026-11-02.

## Phase 0 — Contracts and spikes (gate for everything below)

- [x] ADR draft: v3 module split — engine (CLI + daemon), host, app, `as-hook`;
      protocol types shared between app and engine.
      → `docs/adr/ADR-006-v3-module-split.md` (Proposed).
- [x] ADR draft: identity model (namespaced ids, edge provenance + confidence,
      state axes kept separate: library / runtime / PR / capability — no single
      `status` column).
      → `docs/adr/ADR-007-v3-identity-model.md` (Proposed).
- [x] ADR draft: v3 GUI code — how `gui/src/v3/` grows from the reference boards
      (port board by board, wired to the engine, each with tests; demo data never
      in the product bundle; the coverage floor is kept, never lowered or
      side-stepped by excludes).
      → `docs/adr/ADR-008-v3-gui-code-from-the-reference-boards.md` (Proposed).
- [x] Spike S3: `--settings` hook injection together with `CLAUDE_CONFIG_DIR` and
      the user's own settings (does it merge or replace?).
      → `agents/evidence/v3-phase0-spikes-2026-11.md` § S3: `--settings` adds to project and local hooks, even under a narrowed `--setting-sources`.
- [x] Spike S4: event-store runtime — Node `node:sqlite` vs Bun `bun:sqlite`
      (WAL, concurrent writer, packaging). Feeds Decision E1.
      → `agents/evidence/v3-phase0-spikes-2026-11.md` § S4: both correct and fast; `node:sqlite` needs Node ≥ 22.13 (engine floor is 20), a Bun-compiled CLI is 61 MB and already hits hook p95 20.4 ms. E1 stays with the owner.
- [x] Spike T-S1: live `SubagentStart/Stop` payloads incl. `agent_transcript_path`;
      T-S2: hook `cwd` of a subagent under `isolation: worktree`; T-S3: does a
      council child (`claude --print`) inherit AS hooks/env — especially when the
      parent got its hooks via `--settings` (argv-only, probably not inherited);
      T-S4: `claude agents --json` per `CLAUDE_CONFIG_DIR`. Fixtures under
      `scripts/spikes/`.
      → `agents/evidence/v3-phase0-spikes-2026-11.md` § T-S1…T-S4: worktree subagents report `<repo>/.claude/worktrees/agent-<id>`; a child `claude -p` inherits env vars but not `--settings` hooks; `claude agents --json` lists live sessions per account.
- [x] Spike S5: tmux backend per rjprins/agmux rules (own server
      `-L as-<uid> -f /dev/null`, one window per session, linked view session per
      viewer, `refresh-client` on attach) on macOS and Linux.
      → `agents/evidence/v3-phase0-spikes-2026-11.md` § S5: all seven checks green on macOS (tmux 3.7b) and Linux (tmux 3.5a).
- [x] Spike S2 (moved here from v3.1, because the Needs-you zone shows "Allow" and
      "Reply" in v3.0, spec §5.1): `PermissionRequest` hook as approval channel vs
      `--permission-prompt-tool` — latency, abort, always-allow, answering a
      question. The approval hook is the one hook that waits by nature; measure
      that its timeout falls back to the terminal prompt and never holds a turn
      longer than the prompt would. Feeds D-approve.
      → `agents/evidence/v3-phase0-spikes-2026-11.md` § S2: the hook answers approvals next to the terminal prompt; first answer wins; timeout leaves the normal prompt.
- [x] Spike S8: next-turn model and thinking change for a hosted session (spec
      §6.2, §7.6, §13.2) — which of the tool's own commands sets each (Claude:
      model and effort; Codex: reasoning levels), sent through the input lease
      between turns; and the source of `ctx %` per session (hook, transcript or
      status line), with its provenance.
      → `agents/evidence/v3-phase0-spikes-2026-11.md` § S8: `/model` and `/effort` persist as the account's defaults, so AS never types them; next-turn changes go through the in-place respawn with `--model`/`--effort`. Model and effort per answer come from the transcript; `ctx %` from the existing transcript reader.
- [x] Spike S9 (spec §15.3): can Claude Desktop / Codex Desktop resume the same
      conversation when opened on the worktree root, per app version? Until it is
      verified the Open menu says "opens this project" (spec §13.10).
      → `agents/evidence/v3-phase0-spikes-2026-11.md` § S9: Claude Desktop 4.29.0 takes no folder and cannot resume a CLI session through its launcher; Codex Desktop not installed. See S-desktop.

## Phase 1 — Engine, event store, host

- [x] M1 event store (SQLite, WAL): `sessions`, `lineage`, `events`, `library`,
      `vault`, `git_facts`, `pr_cache`, `attention`. Existing JSON files migrated;
      read compatibility for one release. Ingest is append-only, schema-checked,
      deduped, ordered per producer; projections are rebuildable.
      → `src/store/` (`node:sqlite` or `bun:sqlite`, so E1 stays open);
      `agent-switch store status|import|rebuild`. The hook rings are the only
      event-shaped JSON and are imported; they stay in place for the 2.x readers.
      Other JSON state (arms, mappings, settings) is not event data and stays.
      Node 20 has no SQLite: there the store reports itself unavailable.
- [x] Engine protocol v1 over a 0600 Unix socket (Windows: named pipe); commands
      carry an idempotency key. CLI `--json` stays stable
      (`tests/cli-snapshot.test.ts`).
      → `src/protocol/messages.ts`, `src/engine/{server,client,run}.ts`: line JSON,
      ops `hello · ingest · sessions · children`, idem cache, 64 KiB line cap; a
      second engine refuses, a stale socket is taken over. The daemon starts it
      (`<root>/engine.sock`) and keeps polling when it cannot.
- [ ] M2 `as-hook`: tiny native relay stdin → engine socket, file-line fallback.
      Gate: p95 < 20 ms against the node baseline measured in
      `road-to-hooks-that-keep-up` Phase 0.
- [x] M3 host (tmux): N sessions per account, started via argv (never typed),
      Claude with a pre-generated `--session-id`, hooks via `--settings`; survives
      an app restart. Old per-profile names stay readable for one release.
      → `src/host/tmux-host.ts`, `agent-switch host start|list|end`. Verified live:
      `claude agents --json` reports the session id AS chose. Hooks reach the
      session through `<root>/host/hooks-settings.json`.
- [x] Single writer per hosted session: one input lease, read-only mirrors for
      other viewers, explicit handover, stale-lease recovery.
      → `src/host/lease.ts`: O_EXCL lease file per session, renewal within 15 s,
      recovery from a dead or silent holder, handover only by the holder; typing
      is `send-keys -l` and only for the holder. Mirrors read `capture-pane`.
      The 12-process race test fails when the exclusive create is removed.
- [x] Hosted session controls: detach (close tab) vs **end** (own, confirmed
      action); `AGENT_SWITCH_HOST_PANE` exported for non-Claude providers; starts go
      through the existing guard/pool path; `takeover --in-place` and `compact`
      move to the new host names.
      → `host attach` opens a per-viewer view that tmux drops on detach; `host end`
      asks (or needs `--yes`); `AGENT_SWITCH_HOST_PANE` carries the session key for
      every provider; `host start` without a profile uses `resolveDir` (folder
      rules, pools, guard) and records the pick; `takeover --in-place` respawns the
      hosted window, `compact <key>` types through the input lease.
- [x] Attention queue (spec §5.1, §7.4): one queue ordered approvals → questions →
      limit decisions → failing CI → sign-ins → updates; "Later" snoozes an item
      until it changes; finished items stay as history (the 2.11 activity list);
      a "while you were away" digest after a long absence (merged PRs, CI breaks,
      finished turns, limit resets). An answer given in one place clears the item
      everywhere (spec §13.5). `agent-switch needs --json`.
      → `src/attention.ts` + `agent-switch needs [--json] | needs later <id>`. The
      queue is derived on every read, so an answer anywhere clears it; only
      snoozes, history and the last read are stored (`<root>/attention.json`).
      Sources today: hook events + transcripts (approvals, questions, limit
      stops, sign-outs), cached usage vs protect (limits), account sign-in.
      Failing CI joins in Phase 3 (and the digest gains merged PRs and CI breaks
      there), tool updates with the Tools page (Phase 9). Approvals say "Focus
      terminal" until AS installs the approval hook (D-approve).
- [x] Per-session facts for the session bar from S8: model and thinking level
      from the transcript (`message.model`, `effort`), context used from the
      transcript reader — each with its source; unknown stays unknown.
      → `sessions --json` `context` now carries `model`, `effort` (per-turn first)
      and `pct` with `source: "transcript"`; a transcript without effort gives
      `null`.
- [x] Engine health for the title bar and the system banner (spec §4.1, §6.6):
      "Engine stopped" with restart; hosted sessions keep running in tmux and AS
      reconnects.
      → `agent-switch engine status|restart [--json]`: `running`, `reason`, and
      `hostedRunning` (hosted sessions alive in tmux either way); restart restarts
      the background service the engine lives in. The title-bar label and banner
      read this in Phase 6/8; reconnecting is the app polling it.
- [x] Windows: in-app PTY sessions are labelled **ephemeral** until a native host
      exists (see `later/road-to-agent-switch-v3-reach.md`).
      → `hostingMode()` in `src/host/tmux-host.ts` (also without tmux on Linux and
      macOS); `host list --json` reports `mode`, `host start` refuses with the
      reason. The start dialog's "Host in Agent Switch" card shows it (Phase 8).

## Phase 2 — Tree and lineage

- [x] M4 subagents from hook events (`road-to-hooks-that-keep-up` Phase 2);
      without hooks: counted from the session directory, content not read.
      → hook children since `road-to-hooks-that-keep-up`; without subagent hooks `countSubagentFiles` counts `<session>/subagents/agent-*.jsonl` by name (`childSource: "counted"`).
- [x] Lineage contract `AGENT_SWITCH_PARENT_SESSION|KIND|LABEL` env vars,
      published as a versioned doc; AC adopts it in its own PR, no reverse
      dependency.
      → `lineageFromEnv` in `src/hooks.ts`, read at `SessionStart` by `__hook-event`, stored as a `lineage` edge (`source: lineage`, confidence `reported`). AC's own PR is theirs to open.
- [x] Council seats running as `claude --print` in a temp dir are grouped as
      "helper sessions" under their parent; collapsed by default (C2).
      → a seat that sets `KIND=council` shows under its parent with its label (`src/lineage.ts`); collapsing is the Sessions window's job (Phase 7, ChildLine).
- [x] Continuation edges from takeover, handoff and fork.
      → `takeover` (also `--fork`, also in place) starts the resumed session with `AGENT_SWITCH_PARENT_KIND=continued_from`, shown "via host". `handoff` only prints a command for the user to run, so it has no edge yet.
- [x] Never guess a parent; an unproven edge is shown as "relation unknown".
      Temp-orphan criteria: temp `cwd` and never on a TTY. "continued from" is drawn
      apart from "started by"; `clear`/`compact` are edges too.
      → no edge without a report; an unclaimed session in a temp folder carries `relation: "unknown"` (TTY history is not recorded, so the temp folder alone marks it). `continued_from` ≠ `started_by`. Compaction keeps the id (an event, not an edge); `/clear` is not provable from the hook payload — carried as its own step below.
- [x] `sessions --json`: `children`, `childCount`, `childSource`.
      → `children` with `kind` / `state` / `source`, `childCount`, `childSource`,
      and `parent` on a child. The GUI half moved to Phase 7 (Sessions zone).
- [x] Lineage doc `docs/lineage-contract.md` (`AGENT_SWITCH_PARENT_SESSION`,
      `_AGENT`, `_KIND`, `_LABEL`).
      → `docs/lineage-contract.md`, version 1.
- [x] `agent-switch sessions --tree --json`.
      → `buildTree` nests reported children; property-tested: each row once, no cycles.
- [x] `/clear` edge: link the new session to the one it cleared through process
      continuity (the same Claude process before and after), not through timing.
      → Measured live: hooks get `CLAUDE_PID`, equal before and after `/clear`.
      `clearedFrom` in `src/hooks.ts` links a `source: clear` start to the last
      start of the same pid (`kind: cleared`, "via hook"); no pid, no edge.

## Phase 3 — Git and PR facts

- [x] M5 branch, worktree, dirty, ahead/behind from the last hook `cwd`; fills the
      existing `branch` field (`gui/src/vm/build.ts:257`). For sessions without
      hooks: cwd fallback chain hook → `/proc`/`lsof` → transcript header, with
      `branchSource`. `headSha`, `remote`; 1 s git timeout; cache key
      `(toplevel, .git/HEAD mtime)`.
      → `src/git-facts.ts`; `sessions --json` `git` with `cwdSource: hook ·
      process · transcript`; the GUI's `branch` reads it. Deviation from the
      plan, on evidence: status is read fresh each time — a new untracked file
      changes neither HEAD nor index mtime, so that cache key showed a stale
      "clean" (test). Only the remote URL is cached; within one run, one git call
      per folder. SessionStart and Stop now carry the folder, so a worktree
      switch shows after the next turn (e2e).
- [x] PR matched by head repo + head SHA (several candidates allowed); lifecycle,
      mergeability, review and CI kept as separate axes; one batched `gh` GraphQL
      query per repo, ETag/backoff, rate-limit aware. `MERGED`/`CLOSED` stay stored.
      → `src/pr-facts.ts`: one GraphQL call per repo (verified live against this repo: 50 PRs, 50 points of 5000), matched by head commit, four axes each with UNKNOWN, cache `<root>/pr-cache.json`. GraphQL has no ETag; the back-off reads GitHub's own `rateLimit` instead. `sessions --json` lists `prs` from the cache only.
- [x] Polling cadence: 60 s while a session runs, 5 min idle, halved on
      rate-limit pressure; chip states for every axis incl. `UNKNOWN`.
      → `refreshIntervalMs` / `due`; the daemon refreshes due repos each cycle and
      logs a missing gh once per change.
- [x] Pause the PR refresh while the app is hidden (the daemon needs a signal
      from the app; none exists yet).
      → The app reports `agent-switch app-visibility visible|hidden` on every
      visibility change; the daemon skips the refresh while a "hidden" younger
      than 30 min stands. No app, or a stale report, refreshes as before.
- [ ] GitLab merge requests through `glab`, after GitHub works. Open: `glab` is
      not installed here and no session works in a GitLab repository, so there
      is nothing to verify the API shape against.
- [x] No `gh` or no login → one honest line with a fix button; AS never stores a
      GitHub token itself.
      → `GhUnavailable` with `fix` (`gh auth login` / install link); `pr status` prints one line, `--json` gives `problem: {message, fix}` for the app's button. No token is read or stored.
- [x] Failing CI and merge conflicts become attention items (kind `ci` in `src/attention.ts`; the digest counts merged PRs and CI breaks) and the session's
      blocker (spec §5.1, §6.3, §9.1); "Fix" / "Send to agent" sends the failing
      check's name and log link to a hosted session through the input lease —
      never into a session AS does not host.
      → `ciCandidates` in `src/commands/needs.ts` (open PRs only, each once);
      `needs fix <id>` types the PR, its failing checks and the checks URL into a
      hosted session through the input lease, and refuses for any other
      session. The digest counts merged PRs and CI breaks. The blocker strip and
      Summary's next step read the same facts in Phase 8.
- [x] `agent-switch pr status`, `agent-switch worktrees`.
      → both, with `--json`; `worktrees` groups linked worktrees by their main checkout and names the sessions in each.

## Phase 4 — Library and vault

- [x] M6 pin, name, tags, archive (separate from trash) and search in the store,
      not in localStorage.
      → `src/library.ts` + `sessions pin|unpin|name|tag|untag|archive|unarchive|search`; library table in the store (the app kept no pins in localStorage, so there was nothing to move).
- [x] Show "deleted by Claude in N days" from `cleanupPeriodDays`; the Library's
      deadline banner and "Kept?" states kept / at risk (≤ 7 days in amber) / lost
      (spec §10.3).
      → `keptState` from `cleanupPeriodDays` (default 30); `sessions --json` carries `library`, `kept` (`kept · at-risk · lost`), `vault`, `canResume`. The banner itself is the Library page (Phase 9).
- [x] Vault copy of pinned sessions (jsonl + `<id>/` + `file-history/<id>`),
      verified by hash; a pin whose transcript is gone shows "transcript gone" and
      "can't resume".
      → `vaultCopy`: copy into a temp folder, hash-check, swap in; symlinks are not followed; a pin is copied at once. A lost transcript gives `kept: lost`, `canResume: false`.
- [x] "Auto-keep sessions with an open PR", on by default (spec §10.3): such a
      session is kept like a pin until its PR is merged or closed.
      → `libraryRound` sets and releases `autoKept` from the PR cache; `sessions keep auto on|off` (default on).
- [x] Vault write on `SessionEnd` of a kept session: copy → checksum → never
      move; size shown ("vault 11.6 MB"). A session Claude deleted can be
      restored from the vault.
      → The daemon's library round copies every kept session whose transcript
      changed since its copy (which covers the end of a session without making
      a hook wait for a copy); `store status` shows the vault size;
      `sessions vault <key> restore` puts it back to the paths in its manifest.
- [x] Codex rollouts in the vault too (the library resolves Claude sessions only).
      → `resolveSession` finds Codex rollouts as well; pin, vault and restore work
      the same (e2e). `sessions resume` stays Claude-only and says how to resume
      a Codex session instead.
- [x] Merged sessions archive themselves after 24 h into the Library; "Clean up"
      under "Done today" removes merged worktrees and skips dirty ones (spec §5.2,
      §13.8).
      → `libraryRound` archives once per session (`library_auto_archived`), so an unarchive sticks; `sessions cleanup [--yes]` removes merged linked worktrees from the main checkout, without `--force`, skipping dirty ones.
- [x] CLI: `agent-switch sessions pin|name|tag|archive …`; search over name,
      summary, folder, branch, PR.
      → as above, plus `sessions vault` and `sessions keep`; search matches every word.
- [x] Resume (spec §8.4): preflight (folder, branch/SHA, dirty main checkout,
      account with numbers), restore targets `same_cwd | worktree | new_worktree`
      with the suggestion in words; Continue, Fork, Other account (existing handoff
      path), New with brief; the exact command is previewed and copyable.
      → `src/resume.ts` + `sessions resume <session> [--how …] [--to …] [--yes]`: checks in words, `new_worktree` at the last commit when the branch is gone or the checkout dirty, exact commands (`--json` adds copyable lines); nothing runs without `--yes`.

## Phase 5 — Open in…

- [x] M7 `agent-switch open <session> --with vscode|cursor|phpstorm|idea|finder|terminal [--line N]`
      via the editors' official launchers; target = worktree root; installed
      editors detected via `apps --json`, missing ones hidden.
      → `src/open-in.ts` + `open <session> [--with …] [--file] [--line]`: worktree root, the tool's own launcher (CLI on PATH, else the macOS app via `open -na`). Installed editors are found on PATH and in the app folders — `apps --json` lists the agents' desktop apps, not editors, so it could not serve here. `open <app> [profile]` keeps working.
- [x] Open targets per spec §7.7: default target (⌘O) and last used target;
      Editor, Agent app (only the app of the session's tool, "opens this project"
      until S9 says more), Terminal (focus / new here / attach tmux), Files (reveal
      / copy path), Web (PR / CI run).
      → `open-targets <session> --json`: installed targets, default, last used, the agent app of the session's tool ("opens the app", S9), Terminal (focus for a Claude session, attach when hosted), Web (PR, checks). Copying a path is the app's clipboard, not a CLI target.
- [x] "Focus terminal" for sessions running in the user's own terminal (tty
      lookup; macOS automation error -1743 explained, not swallowed).
      → `focus <session>` (`src/focus-terminal.ts`): pid from the host's registry → tty → the Terminal.app or iTerm2 tab owning it; -1743 is reported with where to allow it. macOS only.
- [x] Security: allowlisted executables only, canonical path inside a known
      worktree, argv only, never a URL taken from PR text.
      → only the launchers in `LAUNCHERS`, argv only, `confine()` resolves symlinks and refuses anything outside the session's folder; no URL is passed, PR URLs are only listed for the app to show.
- [x] Default target global with per-repo override (Decision E-editor; Settings ›
      Open in, spec §10.5).
      → `open-default <target> [--repo DIR]`, keyed on the main checkout so all its worktrees share it; a default that is not installed falls back to the first installed editor.

## Phase 6 — Design system and window frame (spec §0–§4, §12)

- [x] Themes (spec §2): the 18 themes in spec order, Darcula for new installs;
      `--ac-*` tokens from `resolveTheme` only (no raw colours except account
      identity colours); the resolver enforces the contrast floors, including
      terminal ANSI ≥ 4.5:1; accent = theme or Agent Switch orange; "Terminal uses
      the theme's colours" on by default. Ported from `themes/*` with their tests;
      every new token gets a floor.
      → `gui/src/v3/themes/` adapted from the reference patch with its tests,
      plus two: every terminal colour ≥ 4.5:1 on the terminal background, and
      the spec's theme order. GUI coverage stays above the floor (84.5 % lines).
      Wiring into the window is the `AcRoot` step below.
- [x] 2.11 migration: the old `agent-switch-theme` keeps its mode and gets the
      Agent Switch palette, so the update changes nothing visible. Test.
      → `gui/src/v3/appearance.ts`: a stored v3 choice, else the 2.11 mode with
      the Agent Switch palette, else — accounts exist but 2.11 stored nothing
      (it followed the system) — the Agent Switch palette following the system;
      only a new install gets Darcula (the reference would have switched those
      silent 2.11 users to Darcula). A test parses `gui/src/index.css` and found
      the reference's Agent Switch palettes off in overlay, shadow and three
      account colours; they are now exact (reported conflict, spec wins).
- [x] Shared component changes (spec §0): `ui/Segmented` selected = raise fill,
      `RowMenu`/`Select`/`Toaster` at 12 px, `AcRoot` takes `style`. They reach the
      2.11 screens too — render-check those screens in the same change.
      → Applied from the reference patch. Render check with the existing
      screenshot pipeline (`gui/scripts/screenshots`, German run into a temp
      folder, before vs after): 7 of 15 2.11 captures change, each only where a
      segmented control shows its selection (raise fill instead of the orange
      outline, checked by eye on `sessions`); nothing clipped or moved. 637 GUI
      tests pass.
- [x] Visual grammar kit (spec §3): the one radius scale, `Marker` and the tab
      frame for "where you are", state dots vs the `AccountMark` tick, three chip
      kinds, button kinds with one filled button per surface, one number and
      duration format.
      → `gui/src/v3/kit.tsx` adapted with handlers on every control and the
      §3.6 formats (`pct`, `duration`, `resetIn`, `age`, `checkedAgo`);
      `design-guard.test.ts` enforces no inset-shadow bars anywhere and only the
      §3.1 radii in v3 code (shown to fail on a planted `rounded-lg`).
- [ ] Window frame (spec §4): title bar (search field → palette, "Engine
      stopped", inbox pill only in focus mode, "Start session" as the only filled
      chrome button, settings gear), left and right stripes with corner dots, one
      right tool window at a time and closed by default, tone order rail → panel →
      bg.
- [ ] Keyboard (spec §12): every listed key; no app key steals a key the CLI needs
      while the terminal has focus; Ctrl+Shift on Linux/Windows; all keys
      rebindable.

## Phase 7 — Sessions window and attention (spec §5, §7.1–§7.5, §10.7)

- [ ] Needs-you zone on the attention queue: `NeedRow` with the verb and keys per
      kind, the top item open, ⌘J focus with the warn Marker and key line, at most
      3 rows plus "N more ›", one digest row, hidden when empty. "Allow" and
      "Reply" only where an approval channel exists (S2); otherwise the verb is
      "Focus terminal" (D-approve).
- [ ] Children in the GUI (spec §5.2, §7.3, §9.3; moved here from Phase 2):
      children unfold under the row (`ChildLine`, provenance in the tooltip,
      "relation unknown ⓘ" / "counted" inline), helper sessions collapsed by
      default (C2), the `Bot` + count trailing slot, the Children tool window,
      `N children` in the peek card; counters count roots only. The pet stays
      unchanged (spec §11).
- [ ] Sessions zone: the shared order (needs you → CI failing → working → rest),
      one trailing slot by priority, second line on the active row (and on every
      row in comfortable density), "Done today N ›" with "Clean up",
      multi-select with the batch bar.
- [ ] Peek card on hover (~400 ms): account, model, thinking; branch, `#PR`,
      children; last output line (hosted: `capture-pane`; otherwise only where a
      source exists, else left out).
- [ ] Limits strip and limits popover: tightest window per account, colours from
      the account's protect value, stale data greyed with its age, "sign in ›";
      the popover with all windows, the pace tick and the pace line in words plus
      its one-line legend; "Move its session…" opens the decision sheet.
- [ ] Inbox popover (focus mode), ⌃Tab switcher, ⌘K palette (sessions incl.
      Library, branches & PRs, commands; `>` for commands).
- [ ] Tray (spec §10.7): the same components in the same order; "Start session"
      and "Open Agent Switch".

## Phase 8 — Workbench, dialogs and tool windows (spec §6, §7.6–§7.7, §8, §9)

- [ ] Tab strip: page tabs first, session tabs with state dot and `⌘1…⌘9`;
      closing a session tab detaches, never ends.
- [ ] Session bar: `[Terminal | Chat]` (Chat disabled until v3.1 and for
      non-hosted sessions, with the reason), account chip (opens the decision
      sheet, never switches), model and thinking chips → model popover for the next
      turn (S8), locked with the reason for sessions in the user's own terminal,
      `ctx %`, Open ▾ split button, ⋯ menu. A model or thinking change is
      applied by respawning the hosted session in place between turns with
      `--resume … --model … --effort …` — never by typing `/model` or `/effort`,
      which change the account's defaults (S8).
- [ ] Terminal body: the hosted session's real PTY in xterm with the theme's
      terminal tokens, 12.5 px mono, line height 1.5, xterm's custom glyphs for the
      CLI's rounded boxes; never re-rendered or summarised (spec §6.4); typing goes
      through the input lease (D5). Blocker strip
      only while Summary is closed, never twice.
- [ ] Session in the user's own terminal (spec §6.5): "Runs in … · read-only
      here", "Focus terminal ⌘↵", "Take over here…" that explains the move first;
      the body shows the session's facts and its last transcript line, no PTY
      mirror (D-mirror).
- [ ] Dialogs (spec §8): New session (prefill remembered per project, tool /
      model / thinking, account box with all windows, pace estimate in words,
      "Host in Agent Switch" saying "ends when the app closes" where `hostingMode`
      is `ephemeral`,
      "Why? ›" with the 2.11 routing lines, "Where it runs" radio cards with "Your
      terminal" default, command preview, primary names the outcome); near-limit
      decision sheet on the existing arm and rebind paths; End session listing
      what stops with it and saying whether this session is kept in the vault
      (D-vault).
- [ ] Right tool windows (spec §9): Summary (next step, PR with provenance, git
      line, limit block only near the limit, More ›), Changes (worktree vs HEAD,
      "Commit…"; "Review changes" arrives with v3.1), Children.

## Phase 9 — Pages (spec §10.1–§10.6, §11)

- [ ] Pages share `PageBody` and `PageHeader` (spec §6.7): centred, max 960,
      tables as 10 px cards with muted column heads.
- [ ] Accounts page: the 2.11 table kept, with "Usage history" and "Projects &
      pools" as views, every window as a full `LimitBar`.
- [ ] All sessions page: filter, State and Tool segmented controls, the labelled
      batch bar, the columns of spec §10.2.
- [ ] Library page on Phase 4 data (search, All / Pinned / Archived, vault size,
      deadline banner, Resume… / can't resume, Archive/Restore).
- [ ] Tools page; updates also arrive as Needs-you items and never touch running
      sessions.
- [ ] Settings page with its left nav; Appearance (mode, theme cards with live
      mini previews grouped as in §10.5, accent, terminal colours, contrast note,
      "About <theme>"); Open in. The Agents and Remote entries arrive with v3.2.
- [ ] First run (spec §10.6): one path, no tour; shell integration shown before
      it changes anything.
- [ ] Every row of the 2.11 map (spec §11) is reachable in ≤ 2 clicks from the
      main window.

## Phase 10 — Codex and Antigravity parity

- [x] Codex `cwd` from `session_meta`; Codex subagent rollouts grouped, not
      listed as roots.
      → `codexSessionMeta` reads the first line (≤ 256 KiB; fields measured on
      codex-cli 0.166.0) for `cwd` and `thread_source`; a thread not started by
      the user is `root: false, relation: "unknown"` and `--tree` groups it apart.
      Codex sessions now get git facts too.
- [ ] Codex hooks per `CODEX_HOME` (user level only). Measured: codex-cli
      0.166.0 has hooks (`[hooks]` in config.toml — SessionStart/End, Stop,
      SubagentStart/Stop, PermissionRequest, Pre/PostCompact, …) behind a
      persisted hook trust. Open: both Codex accounts here are signed out
      ("access token could not be refreshed"), so the payloads could not be
      captured; signing in is the user's step.
- [x] Antigravity: "not readable" label until a structured source exists
      (ACP in `later/road-to-agent-switch-v3-reach.md`); it can be started from
      New session like any terminal-only tool.
      → `sessions --provider antigravity` says "not readable yet" (`--json`: `[]`);
      `host start <profile> --provider antigravity` runs `agy` with the account's
      HOME. The New-session dialog offers it in Phase 8.

## Ordering

Phase 0 → Phase 1 store (M1) first. Library (Phase 4), git facts (Phase 3) and
open-in (Phase 5) need only the store and may start before the host (M3) lands —
they are the fastest visible value. The tree (Phase 2) needs the hook roadmap.
Phase 6 needs no engine and may run beside Phase 1; Phases 7–9 port one board at a
time and wire it to the engine as its data exists.

## Acceptance (v3.0)

- 5 hosted sessions with 4 subagents each survive an app restart.
- Each shows tree, branch, worktree, PR/CI and vault status.
- 20 parents with 100+ child events render the tree in < 2 s.
- Hook p95 < 20 ms; CPU-seconds per 100 hooks reported before/after in the
  release note.
- 0 lost events at 50 parallel hooks; "needs you" unchanged after 1,000 subagent
  events.
- 4 subagents (2 in worktrees) show with branch; without hooks "(counted)".
- A 3-seat council shows as 3 labelled children under its parent.
- Branch matches `git worktree list` across 10 sessions / 3 repos / 4 worktrees; a
  mid-session worktree switch shows after the next turn.
- GraphQL calls per tick ≤ number of repos; `UNKNOWN` resolved within 2 ticks.
- IDE opens the worktree root on macOS and Linux.
- Typing arrives in the hosted terminal; a foreign tmux server stays untouched.
- Pins survive takeover; host files unchanged (checksums); sessions neither pinned
  nor auto-kept are never copied.
- Graph code covered by property-based tests (no cycles, every child has one
  parent or "unknown").
- Design (spec §14): every v3.0 screen rendered at 1440×900 in darcula,
  github-light and one high-contrast theme with nothing clipped, no unplanned
  wrap, no misaligned row baseline; no inset-shadow selection bars; every "where
  you are" item uses `Marker` or the tab frame, every chosen list option a check,
  every segmented control `ui/Segmented`; only the §3.1 radii; contrast tests
  green; the GUI coverage floor holds.
- A fidelity matrix is committed that names, per spec chapter §1–§14, the
  evidence taken (render, test, grep) and every confirmed deviation.

## Decisions

| ID | Question | Status |
|---|---|---|
| E1 | Engine runtime: Node (`node:sqlite`) or Bun | **owner** — recommendation Bun if S4 is green (owner wish 2026-10-28) |
| E2 | Positioning as "center and client for all your agents and accounts" | **owner** — recommendation yes, with v3.0 |
| E3 | Monorepo vs split | decided: one repo (one maintainer, one CI); layout per Phase 0 ADR |
| E7 | Hooks for self-started sessions: keep opt-in or offer once at first start | **owner** — recommendation offer once with preview |
| E-editor | Default editor global or per repo | decided: global default, per-repo override (cheap, no lock-in; spec §10.5 agrees) |
| E-token | Remove all OAuth-token reads (proposal V0.2)? Collides with ADR-003 (rebind reads `fetchProfile`, `src/rebind.ts:147`) and ADR-004 (`src/token-freshen.ts:161`) — the proposal missed both callers | decided (owner, 2026-11-02): only the usage query moves off the token — statusline first, then a control query over the unmodified binary; rebind and token-freshen keep their narrow reads (`later/road-to-agent-switch-statusline-usage.md` Phase 6) |
| C2 | Helper sessions collapsed by default | decided: yes (noise; expandable) |
| C3 | Dedicated arena/court views | decided: no — generic kind + label until AC ships those entities |
| E-lineage | Publish the lineage env contract as a stable, versioned doc | decided: yes (Phase 2); AC adopts it in its own PR |
| E-idle | Auto-end idle hosted sessions | decided: no |
| E-cleanup | Change `cleanupPeriodDays` per account from AS | decided: not in v3.0 — show the deadline only (writing host settings is a separate opt-in) |
| C4 | Fix the hook race before or after reproducing it | decided: after (`road-to-hooks-that-keep-up` Phase 0 → 1) |
| D-design | Is the v3 UI spec binding? | decided: yes, strict fidelity (owner, 2026-11-02: "das Design als Grundlage") |
| D-sketch | Earlier UI sketch layout and quick input on rows | decided: superseded by the design (Design basis) |
| D-mirror | Spec §6.5 shows a read-only mirror of a session in the user's own terminal; AS cannot read a foreign PTY | decided (owner, 2026-11-02): v3.0 shows the session's facts and last transcript line there; a full read-only view comes with the v3.1 timeline reader |
| D-vault | Spec §8.3 says "the transcript is kept in the vault either way"; Phase 4 vaults only pinned and auto-kept sessions | decided (owner, 2026-11-02): the vault scope stays (pinned and auto-kept); the End dialog says whether this session is kept |
| D-approve | Spec §5.1 offers "Allow"/"Reply" for every approval; for a session without an approval channel (own terminal without hooks, or S2 red) AS cannot answer | decided (owner, 2026-11-02): there the row's verb is "Focus terminal". S2 is green: the channel exists wherever AS hooks are installed, hosted or not, so "Focus terminal" applies to sessions without AS hooks |
| S-density | Spec §15.1: comfortable density as default? | **owner** (from the design) — spec today: compact |
| S-limits | Spec §15.2: Limits strip at the bottom or under the session list? | **owner** (from the design) — spec today: bottom |
| S-desktop | Spec §15.3: Desktop apps resume or only open the project? | S9: Claude Desktop 4.29.0 can do neither through its launcher (no folder type; only `claude://`, which the roadmap excludes). The spec's "opens this project" would overclaim | **owner** — recommendation: the Agent-app entry says "opens the app"; re-check per app version |
| S-proposals | Spec proposals: ⇧/⌘-click multi-select (§5.2), "Start here" when hosted (§8.1) | **owner** — both marked "proposal" in the spec, not built until confirmed |

## Not in v3.0 (kills, with reason)

- Claude Agent SDK (proprietary licence, login grey zone, runtime dependency) —
  the second assistant's "SDK first" proposal is declined for this reason.
- Own MLX/llama server, own agent loop.
- Team login pooling, automatic account rotation, telemetry on by default.
- Pins in localStorage; commands typed into shells; tokens in URLs or terminals.
- Quick input on session rows and the child mini-sheet — not in the design.
- Merging the reference patch as it is — it drops the GUI coverage floor.

## Risk Register

| Risk | Mitigation |
|---|---|
| `dev/v3` drifts from `main` while 2.x keeps shipping | merge `main` into `dev/v3` after every 2.x release; conflicts resolved there, never on the final merge |
| Scope: v3.0 alone is large for one maintainer | Phase 0 → 1 first; Phases 2–5 parallel only after Phase 1; boards ported one at a time |
| Undocumented host internals (transcript layout, cleanup) | fixtures per CC version, honest degrade |
| tmux missing (Windows, minimal Linux) | ephemeral label; native host later |
| agmux is broader | win on trust, persistence, platforms, AC integration — not breadth |
| Shared component changes alter the 2.11 screens | render-check the 2.11 screens in the same change (Phase 6) |
| The approval hook holds a turn | S2 measures it; timeout falls back to the terminal prompt |
