---
complexity: program
status: planned
tree_pin: ff38137
---

# Roadmap: agent-switch v3.0 "Central" — sessions that survive, a tree, git/PR, a library

> **Source:** `agents/tmp.old/inbox-2026-11-b/` — owner transcript (three turns,
> 2026-11-02), the consolidated proposal `road-to-agent-switch-v3` and its two
> parents, three parallel proposals from a second assistant, one UI sketch.
> Proposal ids are kept where they help a reader map back (V*, M*, S*, E*, K*).
>
> Follow-ups (parked, pull trigger named in each):
> [`later/road-to-agent-switch-v3-client.md`](later/road-to-agent-switch-v3-client.md) (v3.1),
> [`later/road-to-agent-switch-v3-reach.md`](later/road-to-agent-switch-v3-reach.md) (v3.2).
> Prerequisite: [`road-to-hooks-that-keep-up.md`](road-to-hooks-that-keep-up.md).

## Branch model (owner, 2026-11-02)

- **All v3 work lands on `dev/v3`**, cut from `main@ff38137`. Every PR of the four
  v3 roadmaps targets `dev/v3`, never `main`.
- `dev/v3` merges into `main` **once, when v3 is complete** — a production-trunk
  merge, so it waits for the owner's explicit go on that turn.
- `main` keeps shipping 2.x; `main` is merged into `dev/v3` after every 2.x
  release, so the final merge does not carry months of drift.
- CI runs on PRs into `dev/v3` and on pushes to it (`.github/workflows/ci.yml`).

## Goal

agent-switch becomes the switch-and-session center the owner asked for: every
session shows **who it belongs to** (subagent, council seat, other helper),
**where it works** (branch, worktree, dirty, ahead/behind), **what its PR does**
(open/merged/closed, CI, mergeable, review), opens in the editor with one click,
**keeps running when the window closes**, and can be typed into from AS. Old
sessions can be pinned, kept beyond Claude's cleanup and resumed.

## Owner demands this roadmap answers (transcript, 2026-11-02)

| # | Demand (owner's words, paraphrased) | Where |
|---|---|---|
| D1 | show which session is a sub-session (subagent, council, arena, court …) | Phase 2 |
| D2 | branch, worktree, PR incl. CI status, mergeable / merged | Phase 3 |
| D3 | open in VS Code / PhpStorm per click | Phase 5 |
| D4 | AS as switch & session center | whole roadmap |
| D5 | run the CLIs/terminals in AS, type into them at any time | Phase 1, Phase 6 |
| D6 | pin/save old sessions, resume as management | Phase 4 |
| D15 | full redesign and re-split are allowed | Phase 6, Decisions |

D7–D11 (Claude-Desktop-class client, view switch, drag & drop, diffs) are in
`later/road-to-agent-switch-v3-client.md`; D12–D14 (other agents, local models,
access from anywhere) in `later/road-to-agent-switch-v3-reach.md`.

## Constraints (binding)

- **The user's own start stays untouched.** Sessions started outside AS are shown
  and can be focused; typing into them is only possible for sessions AS hosts.
- **No port, no server** in v3.0 (`NON-GOALS.md` § No bundled dashboard server).
  App ↔ engine over Tauri IPC / a 0600 socket.
- **No automatic account rotation** (existing principle, `NON-GOALS.md`).
- **Every edge and status says where it came from.** A relation AS cannot prove is
  shown as "relation unknown", never guessed silently (source: host hook, AC
  lineage contract, git observation, heuristic).
- **Identity is namespaced.** `session_id` is never a global key; session,
  process, terminal and worktree are separate identities.
- **No code from `neelsatyavolu/agmux`** (MIT + Commons Clause): ideas only.
- Every existing GUI function stays reachable (redesign principle of 2026-10-28);
  the modal terminal sheet stays for installs and logins.
- **Privacy floor on stored events:** no prompt or answer content in the event
  store; `last_assistant_message` and similar fields are discarded at ingest;
  free text that must be kept passes `redactSecrets`.
- **Dependency direction:** AS reads no agent-config files or AC-specific env names;
  AC writes the published lineage contract, AS only reads that contract.
- **Hosting is opt-in per start.** The default start stays unchanged; "host in AS"
  is an option in the start dialog. Pin and name never write host index files.
- No URL schemes (`phpstorm://`, `vscode://`) as the open path; no tmux `-CC`.
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

## Phase 0 — Contracts and spikes (gate for everything below)

- [ ] ADR draft: v3 module split — engine (CLI + daemon), host, app, `as-hook`;
      protocol types shared between app and engine.
- [ ] ADR draft: identity model (namespaced ids, edge provenance + confidence,
      state axes kept separate: library / runtime / PR / capability — no single
      `status` column).
- [ ] Spike S3: `--settings` hook injection together with `CLAUDE_CONFIG_DIR` and
      the user's own settings (does it merge or replace?).
- [ ] Spike S4: event-store runtime — Node `node:sqlite` vs Bun `bun:sqlite`
      (WAL, concurrent writer, packaging). Feeds Decision E1.
- [ ] Spike T-S1: live `SubagentStart/Stop` payloads incl. `agent_transcript_path`;
      T-S2: hook `cwd` of a subagent under `isolation: worktree`; T-S3: does a
      council child (`claude --print`) inherit AS hooks/env — especially when the
      parent got its hooks via `--settings` (argv-only, probably not inherited);
      T-S4: `claude agents --json` per `CLAUDE_CONFIG_DIR`. Fixtures under
      `scripts/spikes/`.
- [ ] Spike S5: tmux backend per rjprins/agmux rules (own server
      `-L as-<uid> -f /dev/null`, one window per session, linked view session per
      viewer, `refresh-client` on attach) on macOS and Linux.

## Phase 1 — Engine, event store, host

- [ ] M1 event store (SQLite, WAL): `sessions`, `lineage`, `events`, `library`,
      `vault`, `git_facts`, `pr_cache`. Existing JSON files migrated; read
      compatibility for one release. Ingest is append-only, schema-checked,
      deduped, ordered per producer; projections are rebuildable.
- [ ] Engine protocol v1 over a 0600 Unix socket (Windows: named pipe); commands
      carry an idempotency key. CLI `--json` stays stable
      (`tests/cli-snapshot.test.ts`).
- [ ] M2 `as-hook`: tiny native relay stdin → engine socket, file-line fallback.
      Gate: p95 < 20 ms against the node baseline measured in
      `road-to-hooks-that-keep-up` Phase 0.
- [ ] M3 host (tmux): N sessions per account, started via argv (never typed),
      Claude with a pre-generated `--session-id`, hooks via `--settings`; survives
      an app restart. Old per-profile names stay readable for one release.
- [ ] Single writer per hosted session: one input lease, read-only mirrors for
      other viewers, explicit handover, stale-lease recovery.
- [ ] Hosted session controls: detach (close tab) vs **end** (own, confirmed
      action); `AGENT_SWITCH_HOST_PANE` exported for non-Claude providers; starts go
      through the existing guard/pool path; `takeover --in-place` and `compact`
      move to the new host names.
- [ ] Windows: in-app PTY sessions are labelled **ephemeral** until a native host
      exists (see `later/road-to-agent-switch-v3-reach.md`).

## Phase 2 — Tree and lineage

- [ ] M4 subagents from hook events (`road-to-hooks-that-keep-up` Phase 2);
      without hooks: counted from the session directory, content not read.
- [ ] Lineage contract `AGENT_SWITCH_PARENT_SESSION|KIND|LABEL` env vars,
      published as a versioned doc; AC adopts it in its own PR, no reverse
      dependency.
- [ ] Council seats running as `claude --print` in a temp dir are grouped as
      "helper sessions" under their parent; collapsed by default (C2).
- [ ] Continuation edges from takeover, handoff and fork.
- [ ] Never guess a parent; an unproven edge is shown as "relation unknown".
      Temp-orphan criteria: temp `cwd` and never on a TTY. "continued from" is drawn
      apart from "started by"; `clear`/`compact` are edges too.
- [ ] `sessions --json`: `children`, `childCount`, `childSource`; GUI: expander,
      filter on roots, running-child marker, child mini-sheet, `+n` badge in tray
      and pet; counters count roots only.
- [ ] Lineage doc `docs/lineage-contract.md` (`AGENT_SWITCH_PARENT_SESSION`,
      `_AGENT`, `_KIND`, `_LABEL`).
- [ ] `agent-switch sessions --tree --json`.

## Phase 3 — Git and PR facts

- [ ] M5 branch, worktree, dirty, ahead/behind from the last hook `cwd`; fills the
      existing `branch` field (`gui/src/vm/build.ts:257`). For sessions without
      hooks: cwd fallback chain hook → `/proc`/`lsof` → transcript header, with
      `branchSource`. `headSha`, `remote`; 1 s git timeout; cache key
      `(toplevel, .git/HEAD mtime)`.
- [ ] PR matched by head repo + head SHA (several candidates allowed); lifecycle,
      mergeability, review and CI kept as separate axes; one batched `gh` GraphQL
      query per repo, ETag/backoff, rate-limit aware. `MERGED`/`CLOSED` stay stored.
- [ ] Polling cadence: 60 s while a session runs, 5 min idle, paused when the app
      is hidden, halved on rate-limit pressure; chip states for every axis incl.
      `UNKNOWN`. GitLab (`glab`) after GitHub works.
- [ ] No `gh` or no login → one honest line with a fix button; AS never stores a
      GitHub token itself.
- [ ] `agent-switch pr status`, `agent-switch worktrees`.

## Phase 4 — Library and vault

- [ ] M6 pin, name, tags, archive (separate from trash) and search in the store,
      not in localStorage.
- [ ] Show "deleted by Claude in N days" from `cleanupPeriodDays`.
- [ ] Vault copy of pinned sessions (jsonl + `<id>/` + `file-history/<id>`),
      verified by hash; a pin whose transcript is gone shows "saved / unavailable"
      and no Resume button.
- [ ] Vault write on `SessionEnd` of a pinned session: copy → checksum → never
      move; Codex rollouts too; size shown. A session Claude deleted can be
      restored from the vault.
- [ ] CLI: `agent-switch sessions pin|name|tag|archive …`; search over name,
      summary, folder, branch, PR.
- [ ] Resume preflight (cwd exists, branch/SHA, dirty tree, account) and restore
      targets `same_cwd | worktree | new_worktree`; continue, fork, continue on
      another account (existing handoff path), or "as a new session with brief";
      the exact command is previewed.

## Phase 5 — Open in…

- [ ] M7 `agent-switch open <session> --with vscode|cursor|phpstorm|idea|finder|terminal [--line N]`
      via the editors' official launchers; target = worktree root; installed
      editors detected via `apps --json`, missing ones hidden.
- [ ] "Focus terminal" for sessions running in the user's own terminal (tty
      lookup; macOS automation error -1743 explained, not swallowed).
- [ ] Security: allowlisted executables only, canonical path inside a known
      worktree, argv only, never a URL taken from PR text.
- [ ] Default editor setting (scope per Decision E-editor).

## Phase 6 — App: the center

- [ ] M8 three-column layout: sidebar (pinned · projects · recent · archive ·
      accounts), centre terminal dock (tabs; closing a tab detaches, never kills),
      right inspector (changes · git/PR · children · info) — the UI sketch's
      session card (branch, PR, CI, worktree, child tree, "terminal connected",
      editor buttons) is the reference for the card.
- [ ] Quick input on a hosted session row: `send-keys -l` through the input
      lease, plus a `capture-pane` live preview. Never on a non-hosted pane.
- [ ] Same building blocks in list, tray and pet; every current function reachable
      (accounts, pools, protection, apps, tools, activity, health).
- [ ] Before each merge: render and check — no wraps, nothing clipped, same element
      looks the same everywhere.

## Phase 7 — Codex and Antigravity parity

- [ ] Codex hooks per `CODEX_HOME` (user level only); Codex `cwd` from
      `session_meta`; Codex subagent rollouts grouped, not listed as roots.
- [ ] Antigravity: "not readable" label until a structured source exists
      (ACP in `later/road-to-agent-switch-v3-reach.md`).

## Ordering

Phase 0 → Phase 1 store (M1) first. Library (Phase 4), git facts (Phase 3) and
open-in (Phase 5) need only the store and may start before the host (M3) lands —
they are the fastest visible value. The tree (Phase 2) needs the hook roadmap.

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
- Typing arrives in the dock; a foreign tmux server stays untouched.
- Pins survive takeover; host files unchanged (checksums); unpinned sessions are
  never copied.
- Graph code covered by property-based tests (no cycles, every child has one
  parent or "unknown").

## Decisions

| ID | Question | Status |
|---|---|---|
| E1 | Engine runtime: Node (`node:sqlite`) or Bun | **owner** — recommendation Bun if S4 is green (owner wish 2026-10-28) |
| E2 | Positioning as "center and client for all your agents and accounts" | **owner** — recommendation yes, with v3.0 |
| E3 | Monorepo vs split | decided: one repo (one maintainer, one CI); layout per Phase 0 ADR |
| E7 | Hooks for self-started sessions: keep opt-in or offer once at first start | **owner** — recommendation offer once with preview |
| E-editor | Default editor global or per repo | decided: global default, per-repo override (cheap, no lock-in) |
| E-token | Remove all OAuth-token reads (proposal V0.2)? Collides with ADR-003 (rebind reads `fetchProfile`, `src/rebind.ts:147`) and ADR-004 (`src/token-freshen.ts:161`) — the proposal missed both callers | **owner** — see `later/road-to-agent-switch-statusline-usage.md` |
| C2 | Helper sessions collapsed by default | decided: yes (noise; expandable) |
| C3 | Dedicated arena/court views | decided: no — generic kind + label until AC ships those entities |
| E-lineage | Publish the lineage env contract as a stable, versioned doc | decided: yes (Phase 2); AC adopts it in its own PR |
| E-idle | Auto-end idle hosted sessions | decided: no |
| E-cleanup | Change `cleanupPeriodDays` per account from AS | decided: not in v3.0 — show the deadline only (writing host settings is a separate opt-in) |
| C4 | Fix the hook race before or after reproducing it | decided: after (`road-to-hooks-that-keep-up` Phase 0 → 1) |

## Not in v3.0 (kills, with reason)

- Claude Agent SDK (proprietary licence, login grey zone, runtime dependency) —
  the second assistant's "SDK first" proposal is declined for this reason.
- Own MLX/llama server, own agent loop.
- Team login pooling, automatic account rotation, telemetry on by default.
- Pins in localStorage; commands typed into shells; tokens in URLs or terminals.

## Risk Register

| Risk | Mitigation |
|---|---|
| `dev/v3` drifts from `main` while 2.x keeps shipping | merge `main` into `dev/v3` after every 2.x release; conflicts resolved there, never on the final merge |
| Scope: v3.0 alone is large for one maintainer | Phase 0 → 1 first; Phases 2–5 parallel only after Phase 1 |
| Undocumented host internals (transcript layout, cleanup) | fixtures per CC version, honest degrade |
| tmux missing (Windows, minimal Linux) | ephemeral label; native host later |
| agmux is broader | win on trust, persistence, platforms, AC integration — not breadth |
