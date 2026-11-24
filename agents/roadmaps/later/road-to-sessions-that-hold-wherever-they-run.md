---
complexity: structural
status: proposal
tree_pin: cdb93c7
pins:
  agent-switch/main: c3ca61d            # 2.14.3, 2026-11-13
  agent-switch/v3-tip: cdb93c7          # feat/road-to-a-tree-that-reads-at-a-glance, 2026-11-23; contains dev/v3 56e5f4d
  herdrdev/herdr: e8d7d97               # TUI multiplexer, 2026-11-20
  herdrdev/herdr-core: 300a455          # hc 0.1.22, 2026-11-22
  herdrdev/herdr-app: 317e673           # 2026-11-18
  herdrdev/herdr-layout-examples: 0ec9676
  herdrdev/herdr-nix: 602c885
---

> **Intake:** owner inbox round `inbox-2026-11-d` (the analysis, chat and this draft are in `agents/tmp.old/inbox-2026-11-d/b/`, gitignored), triaged 2026-11-23 into `later/` by `road-to-a-workbench-that-tells-the-truth` 8.7.
> **Resume condition:** the owner answers its "Decisions (proposals)" and "Open points this analysis could not settle"; until then nothing here is built.

# Roadmap (proposal): sessions that hold wherever they run

> **Status: proposal.** Nothing in this file is adopted. Every step id (`P0.1` …)
> and every decision id (`PD1` …) is a proposal id of this document and must not
> be cited elsewhere as an accepted basis before the owner adopts it.
>
> **Source:** owner request 2026-11-23 — analyse the current state of
> agent-switch and the `herdrdev` organisation in depth, plan a roadmap, then
> re-run analysis and roadmap three times. Web research (blogs, issue trackers,
> the OSC 7501 proposal) is listed under "Sources".
>
> **Form:** every phase starts from a defect or gap read in the agent-switch
> tree at the pins above, and only then names what herdr contributes to it.
> Nothing is here because herdr has it.
>
> **Not read:** no code was run against a live provider login, a real herdr
> server or a Windows machine. Everything that needs one is a spike in Phase 0
> or carries `needs: machine`.

## Goal

1. A session that is resumed — by hand, by a multiplexer or after a reboot —
   lands on the account that holds it.
2. Agent Switch never types into a session that is waiting for a person's
   decision, and never loses track of a session that is still running.
3. A hosted program's state comes from the program's own word wherever it
   offers one, for every hosted program and not only Codex.
4. The host is replaceable, so Windows can get sessions that outlive the app.
5. The app is told when state changes instead of asking every ten seconds.

## Where agent-switch stands (read at the pins)

| Fact | Evidence |
|---|---|
| Two lines since 2026-11-04: `main` ships 2.14.3; the v3 line still says 2.12.0. 59 non-merge commits exist only on `main`, 251 only on the v3 tip, 25 subjects on both (ported twice) | merge-base `293538b`; `git rev-list --no-merges`; `package.json` on both pins |
| v3 hosts sessions in a private tmux server; the host is one concrete class imported by 10 command/daemon files, not an interface | `src/host/tmux-host.ts:90`; importers `src/commands/{bridge,continue,engine,host,needs,open-in,sessions,takeover,view}.ts`, `src/daemon.ts` |
| ADR-006 promises the host "behind an interface, so a native host can replace tmux later", and calls Windows "ephemeral until a native host exists" | `docs/adr/ADR-006-v3-module-split.md:26,68` |
| On Windows a hosted session ends with the app | `src/host/tmux-host.ts:87`; `src/commands/host.ts:38` |
| ADR-006 says the GUI stops polling for state the engine can push; the protocol has no subscribe op and the v3 window runs four CLI reads every 10 s | `docs/adr/ADR-006-v3-module-split.md:63`; `src/protocol/messages.ts:10`; `gui/src/v3/adapter/useFeeds.ts:13,59` |
| Open roadmaps on the v3 tip: `road-to-the-ready-remainders`, `road-to-a-chat-that-reads-well`; 11 parked | `agents/roadmaps/`, `agents/roadmaps/later/` |

## What herdr is (read at the pins)

| Repo | What it is | Evidence |
|---|---|---|
| `herdr` | The terminal multiplexer ("tmux for agents"): server + TUI, per-pane agent state from screen rules and hook integrations, session restore, plugins. Apache-2.0 | `README.md`; `distribution/agent-detection/*.toml`; `src/integration/` |
| `herdr-core` (`hc`) | A headless terminal runtime, new since late October: runs programs in terminals that outlive viewers, relays raw bytes, reads status only from OSC 7501, JSON-RPC API published as OpenRPC (36 methods), Linux/macOS/Windows. Draws nothing | `README.md:1-6,22,147`; `AGENTS.md:24,34`; `schema/hc.openrpc.json` (`info.version` 0.1.22) |
| `herdr-app` | Desktop app on top of `hc`; layouts and "mods" are JavaScript files an agent may edit; telemetry on by default | `README.md`; `docs/security.md:47` |
| `herdr-layout-examples`, `herdr-nix` | Example layouts/mods; Nix packaging | their `README.md` |

`hc` is young: its changelog runs from 0.1.10 (2026-10-23) to 0.1.22
(2026-11-22), 13 releases in 30 days (`herdr-core/CHANGELOG.md:3,166`), and its
API is marked "preview" (`schema/README.md:12`).

## Defects and gaps this roadmap closes

Each row is a defect in agent-switch first; the right column is what the herdr
repos or the web research add to it.

| # | Defect in agent-switch | Evidence | What the sources add |
|---|---|---|---|
| G1 | A plain `claude --resume <id>` (or `-c`, `codex resume <id>`) through the shell wrapper is routed like a new start: the wrapper asks `dir` without the arguments, and `dir` picks by folder rule or balance. If the session lives on another account the resume fails or starts on the wrong one. The wrapper also overwrites a config dir the caller had set | `src/shellenv.ts:121,125,139`; `src/commands/routing.ts:100` | The same failure is the best-documented multi-account complaint around herdr: restore types `claude --resume <id>` into a fresh shell that has no account (`herdr/src/agent_resume.rs:56`; herdr issue #1269; two blog posts; herdr-agent-board #146/#148). herdr does not save a pane's environment (`src/persist/snapshot.rs` has no env field) |
| G2 | `typeIntoHosted` types text and Enter into a hosted window without looking at the session's state. At a permission prompt, Enter confirms the selected option. Callers: the daemon's continue after a move, `continue`, `needs` | `src/commands/continue.ts:18-31`; `src/host/lease.ts:144-151`; `src/daemon.ts:500` | `hc send` refuses while the program is blocked unless forced, and holds automated sends while a person has an unfinished draft (`herdr-core/crates/herdr-core/src/SKILL.md:103,243`; `terminal.send` params `force`, `if`) |
| G3 | The lease guards against two programs typing; it does not guard against a person typing in an attached view, which attaches read-write. Concretely (arena r3 code review, item 4): `type` reads the input line as empty (`capture-pane`), then sends text and Enter in later tmux calls; a key typed in an attached view between the capture and the send is submitted with the automated text | `src/host/tmux-host.ts:307`; `src/host/lease.ts:1-9`; `src/host/lease.ts:153-171` | Same source: the draft wait (`README.md` § Draft wait) |
| G4 | An unreadable `host/sessions.json` reads as empty, and the next start writes a registry holding only the new session: every other running window is forgotten while it keeps running. Read-modify-write has no lock | `src/host/tmux-host.ts:116-123,125-130,209-211` | herdr keeps the unreadable file's bytes before it writes a replacement (`docs/…/session-state.mdx:39`); hc 0.1.22 resumes saving its registry after a failed write and reports the failure to the caller (`herdr-core/CHANGELOG.md:9`). The tree fixed the same class for `settings.json` in `21b5031` |
| G5 | Only Codex windows are read for OSC 7501; the reader accepts only `app=codex`, drops child records, and ignores `kind`, `progress`, `msg`, `title` | `src/host/tmux-host.ts:164,171`; `src/program-status.ts:25-38,142,149` | The proposal (rev. 0.4) defines `kind=permission\|question\|auth`, `progress`, `msg`, record ids. A community tracker lists Claude Code 2.1.295, Antigravity CLI 1.4.0 and others as sending it — **unverified here**, hence spike P0.1. hc stores the full record and a turn counter (`status.rs:3,14-29`) |
| G6 | `done` and `error` from the program are folded into `idle`, although ADR-007's runtime axis has `done` | `src/runtime-state.ts:14,69`; `docs/adr/ADR-007-v3-identity-model.md:61` | herdr-app shows "Done: finished while you were looking elsewhere" apart from idle (`herdr-app/README.md`) |
| G7 | Each hosted Codex window keeps one reader process alive, started as `node <cli> __program-status`; the evidence file calls it "cat-sized" | `src/host/tmux-host.ts:167`; `src/commands/host.ts:113`; `agents/evidence/codex-osc-7501-and-claude-get-usage-2026-11.md:33` | — (own defect; cost unmeasured, hence P0.2) |
| G8 | Programs that report only after the terminal answers the 7501 query stay silent in an AS-hosted window, because AS never answers (answering would type outside the lease) | `src/program-status.ts:1-7`; `src/host/tmux-host.ts:164` | A real terminal answers the query itself. `hc` is built on libghostty-vt, which answers it when its host takes reports (the proposal's implementation note); whether `hc` does at the pin was **not found in its source** and is a row of P0.3 |
| G9 | Windows has no persistent hosting | see table above | `hc` runs on Windows (ConPTY, named pipes: `herdr-core/README.md:22`, `docs/security.md:27`) |
| G10 | A session in the user's own terminal is read-only for AS: it cannot be continued after a move ("type one message in its own terminal") and can be focused only on macOS in Terminal.app or iTerm2. The hook records no terminal identity | `src/commands/continue.ts:19`; `src/focus-terminal.ts:5,88,92`; `src/hook-intake.ts:35-44`; `relay/src/main.rs:25` | Multiplexers put their address into every pane's environment: `TMUX_PANE`, `HC_TERMINAL_ID`, `HERDR_PANE_ID` (`add-herdr-support.mdx:24`) and offer send/read by address |
| G11 | State reaches the window by polling | see table above | `events.subscribe`: snapshot with `seq`, events, `heartbeat`, `missed` (`herdr-core/schema/README.md:117-124`) |
| G12 | A failing command prints `error: <prose>` and exits 1 (332 `die(` call sites); only the guard has its own code (86). A machine caller cannot tell "not found" from "held" from "needs a person" | `src/profiles.ts:162-165`; `src/single-load.ts` `GUARD_REFUSED_EXIT` | hc: `{error: {kind, message, hint}}` and fixed exit codes (`SKILL.md:347`) |

## Constraints (binding)

- `NON-GOALS.md` stands unchanged: no proxy, no port, no telemetry, no login
  handling beyond `import` and `rebind`, no automatic account switch.
- Agent Switch installs nothing and updates nothing it does not own. A second
  host binary is found on PATH or named by the user (the rule `src/agents.ts`
  already states for agents).
- Typing into a terminal Agent Switch does not host is a new power. It is off
  until the user turns it on per terminal kind (PD4).
- No screen reading for state, on any host. A program that says nothing has no
  program state (the rule of ADR-007: no heuristic edge; hc holds the same
  rule, `herdr-core/AGENTS.md:34`).
- The CLI keeps zero runtime dependencies.

## Branch

- Phase 1 and Phase 8: `main` first, ported to the v3 line (PD1 decides whether
  that double port continues).
- Phases 2–7: v3 line only; they touch `src/host/`, `src/engine/`, `gui/src/v3/`.

## Phase 0 — Spikes and one decision (no product code)

- [ ] **P0.1 Who speaks OSC 7501 under our tmux host.** In an AS-hosted window
      with `pipe-pane -O`, capture one turn each of the installed Claude Code,
      Codex and Antigravity CLI: reports seen unasked, fields used (`kind`,
      `progress`, `msg`, `id`), and whether any of them sends the query and
      falls silent when it is not answered.
      verify: `agents/evidence/osc-7501-hosted-programs-<date>.md` with one row
      per program and version; a fixture stream per program under `tests/fixtures/`.
      needs: machine (signed-in Claude, Codex, agy).
- [ ] **P0.2 What a reader costs.** Resident memory and start time of one
      `__program-status` reader per hosted window, at 1, 5 and 20 windows.
      verify: a table in the same evidence file; the "cat-sized" sentence in
      `agents/evidence/codex-osc-7501-and-claude-get-usage-2026-11.md:33` is
      corrected or confirmed.
- [ ] **P0.3 Can `hc` carry our host contract.** In an isolated
      `HC_SESSION=as-spike` with scratch XDG paths: start a stub program by argv
      with env and cwd (`terminal.run`), find it again by label after a core
      restart, read its screen, attach, replace its program (kill + run under
      the same label), end it; then the same on `windows-latest`. Record what
      `hello` returns (`generation`, `features`), what an unknown generation
      does, and whether the core answers the OSC 7501 query (G8).
      verify: `agents/evidence/hc-host-spike-<date>.md`, one row per TmuxHost
      method (`start`, `list`, `capture`, `respawn`, `park`, `view`, `end`,
      type) with GO / NO-GO, on macOS, Linux and Windows.
- [ ] **P0.4 herdr restore with the fixed wrapper (after P1.3).** In a real
      herdr session: two accounts, a Claude session on the non-default one,
      `herdr server stop`, start again. Does the pane resume on the right
      account through the shell wrapper alone, in zsh, bash, fish and PowerShell?
      verify: a result table in `agents/evidence/`. needs: machine (herdr, two accounts).
- [ ] **P0.5 Owner decision PD1** (lines), recorded under "Decisions".

## Phase 1 — A resumed session lands on its own account

> Closes G1. No dependency on any other phase and none on herdr.

- [ ] **P1.1 Red tests.** Two Claude profiles, a session on `b`, cwd with a
      folder rule for `a`: `dir --provider claude --guard -- --resume <id>`
      must return `b`'s config dir with a reason that names the session. Same
      for `-r <id>`, for `--continue`/`-c` (the profile holding the newest
      transcript for this folder), for `codex resume <id>`, and for an id no
      profile holds (routing as today, unchanged exit code).
      verify: the new tests fail on `cdb93c7` and on `c3ca61d`.
- [ ] **P1.2 `dir` reads the start's arguments.** Everything after `--` is the
      wrapped command line. A named session wins over a folder rule and over
      balance, because any other account cannot open it; the pick, its reason
      and a rule it overrode go to `picks.jsonl` and to stderr in one line.
      Lookup is a file check per profile (`locateSession`,
      `src/sessions.ts:358`; `locateCodexSession`, `:783`), no network.
      verify: P1.1 green; `dir` without `--` behaves byte-identically
      (`tests/cli-snapshot.test.ts`).
- [ ] **P1.3 Wrappers pass the arguments** in zsh/bash, fish and PowerShell
      (`src/shellenv.ts:116-129` and its siblings). A config dir the caller set
      explicitly to a registered profile is kept, not overwritten (`:125`).
      verify: wrapper tests per shell; an installed older snippet still works
      against the new CLI.
- [ ] **P1.4 `agent-switch resume <session-id> [-- <args>]`.** One plain
      command that finds the session's account and starts the provider's own
      resume there, non-interactive, for use as any tool's resume command. It
      meets herdr's rules for a reported resume command: bare command name, no
      apostrophes, at most 64 arguments (`add-herdr-support.mdx:71-73`).
      `sessions resume` keeps its preflight (`src/commands/library.ts:311`).
      verify: CLI tests for Claude and Codex, unknown id, and a session whose
      account is signed out (refuses with the sign-in sentence, starts nothing).
- [ ] **P1.5 Docs.** One troubleshooting entry: "A resumed session says
      'No conversation found'" — cause, the wrapper, `agent-switch resume`, and
      what to set as the resume command in tmux-resurrect and herdr.
      verify: `task docs:check`; every command on the page runs.
- [ ] **P1.6 Only if P0.4 fails somewhere:** report the resume command to herdr
      from the SessionStart hook when `HERDR_ENV=1` (`pane report-agent-session
      … -- agent-switch resume <id>`), behind `agent-switch integrations herdr
      on` (default off, PD5).
      verify: hook test with a stub `herdr` binary; nothing is called outside herdr.

## Phase 2 — Writes that look before they type

> Closes G2 and G3.

- [ ] **P2.1 Red tests.** A hosted session whose runtime state is `needs-you`:
      `typeIntoHosted` from the daemon's continue must refuse and leave the
      window untouched. A session at `idle` or `working`: unchanged.
      verify: tests fail on `cdb93c7`.
- [ ] **P2.2 A state gate in `typeIntoHosted`.** Read the session's
      `runtimeState` first; at `needs-you` refuse with a sentence that names
      what waits. Only the two callers that deliver the user's own answer to
      that prompt (`needs`, the session input field) may pass `answer: true`;
      the daemon and `continue` never can.
      verify: P2.1 green; a test that the daemon's `continueHosted` has no way
      to set the override.
- [x] **P2.3 Wait for a person's draft.** *Done in `road-to-terminal-sessions-in-sync` 5.2 (2026-11-24): the wait and the check before Enter read the attached clients' activity; the input line is not re-read before Enter, because a long or pasted text does not come back as typed.* Before an automated send, read the
      attached view clients' last activity (`tmux list-clients -F
      '#{client_activity}'` on the private server); if a person typed within
      the last 3 s, wait, up to 60 s, then give up with "someone is typing in
      it" and leave the request for the user.
      verify: a test with an injected clock and client list: recent key → no
      send; quiet → send; never quiet → gives up, nothing typed.
      The wait narrows the capture-to-send gap in `LeaseStore.type` but cannot
      close it alone: also re-read the input line and the clients' activity
      after typing the text and before Enter, and refuse (clearing only what
      was typed) when either changed.
      verify: a fake host whose client activity changes between capture and
      send: no Enter is sent.

## Phase 3 — The program's own word, for every hosted program

> Closes G5, G6, G7. Scope follows P0.1: a program that P0.1 did not see
> reporting unasked gets no reader.

- [ ] **P3.1 Parse the whole root record.** `state`, `kind`, `progress`,
      `app`, `title`, `msg` (base64; a value that decodes to a control
      character discards the report, as the proposal requires). Child records
      are counted, not dropped. Limits as in the proposal (4096 bytes per
      sequence, already `MAX_BODY`).
      verify: `tests/program-status.test.ts` extended with the P0.1 fixtures
      and the proposal's own examples; a spoofed `app` still changes nothing.
- [ ] **P3.2 One reader per hosted program that speaks, keyed by the agent
      registry.** The accepted `app` name comes from the agent's row
      (`src/agents.ts`), not from a default of `codex`
      (`src/program-status.ts:142`).
      verify: host tests: a Claude window and an agy window get a reader iff
      P0.1 listed them; a foreign `app` in their stream is ignored.
- [ ] **P3.3 `done` and `error` stay what they are.** Runtime gains `done`
      (finished, not yet looked at) and maps `error` to `needs-you` with the
      program's message; `blocked` carries its `kind`: `permission` → approval,
      `question` → question, `auth` → sign-in. Source order is unchanged: hook,
      host word, program, transcript (`src/runtime-state.ts:5-9`).
      verify: `runtime-state` tests per state and kind; the window's trailing
      slot shows `done` until the session is opened (`gui/src/transforms.ts:121`).
- [ ] **P3.4 A cheaper reader — only if P0.2 shows more than 25 MB per
      window.** Move the scanner into the relay binary (`relay/`, already
      shipped per platform) as `as-hook program-status <file>`; the Node reader
      stays as the fallback where the relay is not installed.
      verify: relay unit tests on the same fixtures; P0.2 re-measured.

## Phase 4 — A registry that cannot forget a running session

> Closes G4.

- [ ] **P4.1 Red tests.** (a) `sessions.json` holds invalid JSON and two
      windows run: after `start`, both old sessions must still be listed.
      (b) Two `start` calls race: both sessions are in the registry.
      verify: both fail on `cdb93c7`.
- [ ] **P4.2 Never write over an unreadable registry.** Keep its bytes as
      `sessions.json.unreadable-<time>` (0600, three newest kept), then rebuild
      from the tmux server itself (`list-windows -F` with window id, name and
      start command; a Claude window's argv carries the session id AS wrote,
      a Codex window's does not) and say so once.
      verify: P4.1(a) green; a window whose argv carries no session id is
      listed as "unregistered", never dropped.
- [ ] **P4.3 Lock the read-modify-write** with `withFileLockSync`
      (`src/locks.ts`) in `start`, `respawn`, `park`, `unparked`, `end`.
      verify: P4.1(b) green, 50 parallel starts in a test without a lost entry.
- [ ] **P4.4 `host list` shows windows the registry does not know** as
      "unregistered", with the command to end them.
      verify: host test with a window created behind the registry's back.

## Phase 5 — The host behind an interface

> Delivers what ADR-006 line 26 already says. No behaviour change. Worth doing
> whether or not Phase 6 ever happens: Phases 2–4 then land in one place.

- [ ] **P5.1 `SessionHost` interface** taken from TmuxHost's public surface:
      `start`, `list`, `capture`, `respawn`, `park`, `unparked`, `view`, `end`,
      `type`, `mode`. The 10 importers get the host from one factory.
      verify: no file outside `src/host/` imports `tmux-host.js`
      (a lint test); the suite passes unchanged.
- [ ] **P5.2 Typing goes through the host**, not through raw tmux arguments
      in the lease (`src/host/lease.ts:150-151`).
      verify: lease tests against a fake host.
- [ ] **P5.3 One host contract suite** (today's `tests/tmux-host.test.ts`
      cases, written against the interface) that any host must pass.
      verify: the suite runs against TmuxHost on macOS and Linux CI.

## Phase 6 — `hc` as a second host (experiment, gated on P0.3)

> Closes G8 and G9. Starts only on a GO for every row of P0.3 and on PD2.

- [ ] **P6.1 `HcHost`** behind the interface: its own core
      (`HC_SESSION=agent-switch`, so the user's herdr work and ours never share
      a terminal list), sessions found by label `as.key`, `respawn` and `park`
      as kill + run under the same label, `view` as `hc attach`, typing as
      `terminal.send` without `force`, state from `events.subscribe`.
      verify: the P5.3 contract suite passes against HcHost on macOS, Linux and Windows CI.
- [ ] **P6.2 Selection.** `host.backend`: `auto` (default) keeps tmux wherever
      tmux exists and uses `hc` only where there is no tmux; `tmux` and `hc`
      force one. `doctor` and Settings name the backend in use and why.
      verify: `hostingMode` tests for every platform × presence combination;
      an install with tmux sees no change.
- [ ] **P6.3 Version floor.** HcHost checks `hello.generation` and a minimum
      version; anything else is "ephemeral" with the reason, never a guess.
      Agent Switch does not install or update `hc`; it shows the command.
      verify: tests with a stub core answering an unknown generation.
- [ ] **P6.4 ADR (proposal: "ADR-012 — a second session host")** recording
      PD2, the trust statement (same-user socket, no port — as tmux), what `hc`
      sends over the network on its own (to be read from its source at the
      adopted version; AS never calls `hc update`)
      and the exit criteria below.
- [ ] **P6.5 Exit criteria, checked at every `hc` minor release for 90 days.**
      Drop HcHost if: a release breaks the contract suite without a new
      protocol generation; the core gains telemetry; or Windows CI is red for
      two releases in a row.
      verify: a CI job that runs the suite against the newest `hc` weekly.

## Phase 7 — Reaching a session through the terminal it already runs in

> Closes G10. Reading first; typing only behind PD4.

- [ ] **P7.1 Record where a session runs.** The hook env gains `TMUX_PANE`
      (+ `TMUX`), `HC_TERMINAL_ID` (+ `HC_SESSION`), `HERDR_PANE_ID`
      (+ `HERDR_SOCKET_PATH`), in the CLI list and in the relay's
      (`src/hook-intake.ts:35`, `relay/src/main.rs:25`); ADR-007's terminal
      identity gets the kinds `hc:` and `herdr:` next to `tmux:` and `tty:`.
      verify: intake tests; `sessions --json` shows `terminal` with `source: "hook"`.
- [ ] **P7.2 Focus beyond macOS.** For a tmux pane: select its window and
      switch the client. For `hc` and herdr: only if their CLI documents a
      focus command at the pinned versions; otherwise the row says where it
      runs and offers no button.
      verify: plan tests per kind (argv only, as `src/terminals.ts`).
- [ ] **P7.3 Continue after a move, in the user's own multiplexer** (PD4, off
      by default, per kind): the daemon's continue may type into a recorded
      tmux pane or `hc` terminal, through the same gates as Phase 2, with `hc
      send --if idle` where the terminal offers it.
      verify: tests with stub `tmux`/`hc`: off → never called; on and idle →
      one send; on and `needs-you` → refused.

## Phase 8 — Errors a machine can act on

> Closes G12, for the commands other programs call. Not a sweep of 332 sites.

- [ ] **P8.1 Error kinds for the contract commands:** `dir`, `exec`, `limits`,
      `switch *`, `host *`, `continue`, `resume`, `sessions --json`, `mcp
      serve` tool errors, `remote rpc`. Kinds: `usage`, `not_found`,
      `needs_user`, `held`, `refused`, `unavailable`, `internal`. With `--json`
      a failure prints `{"ok":false,"error":{"kind","message","hint"}}`; exit
      codes are fixed per kind and listed in the CLI reference; 86 stays.
      verify: snapshot tests per command and kind; the prose on stderr is unchanged.
- [ ] **P8.2 The contract only grows.** A released copy of the MCP tool
      schemas, the protocol ops and the `--json` error shape; a test fails on a
      removed field or a new required input (the `released.openrpc.json` rule,
      `herdr-core/schema/README.md:14-19`).
      verify: the test fails when a field is removed in a scratch branch.

## Phase 9 — Told, not asked

> Closes G11. Last, because Phases 3 and 6 add the events worth pushing.

- [ ] **P9.1 `subscribe` on the engine socket:** a snapshot with `seq`, then
      one line per change (hook stored, program state changed, hosted session
      started or ended), a heartbeat, and `missed` when a slow reader fell
      behind — the reader then re-reads once.
      verify: `tests/engine-protocol.test.ts`: order per producer, a stalled
      subscriber never blocks `hook` acknowledgements (ADR-006 Amendment 1).
- [ ] **P9.2 The window refreshes on a change.** `needs`, `host` and
      `codexRows` re-read when an event arrives; the timer stays as a fallback
      at 60 s and at 10 s while no engine answers.
      verify: a test counting feed reads over five idle minutes with an engine
      (from 120 today to at most 20), and that a hook reaches the window in
      under one second.

## Ordering

P0.1–P0.3 and P0.5 can start at once. Phase 1 → P0.4. Phase 2, 3 and 4 are
independent of each other; Phase 5 after them or before them, not during.
Phase 6 after Phase 5 and P0.3. Phase 7 after Phase 2. Phase 8 any time.
Phase 9 last.

## Acceptance

- A Claude or Codex session resumed by id from any folder, any shell and a
  restored multiplexer pane opens on the account that holds it, or says which
  account that is and why it cannot.
- No test and no code path lets the daemon type into a session that waits for
  a person.
- With a corrupted registry and two racing starts, every running hosted
  session is still listed.
- On a Windows runner with `hc` present, a hosted session survives closing the
  app (only if Phase 6 ran).

## Decisions (proposals)

| # | Decision | Alternatives | Reason | Revisit if |
|---|---|---|---|---|
| PD1 | **Owner.** Name the day `main` stops taking features and the v3 line becomes `main`, or state that both lines continue | Keep porting each fix twice | 25 commits already exist twice; herdr runs the same split on purpose as two products with two repos, and says so (`herdr-core/AGENTS.md`, "Fresh code. Do not copy from Herdr 1") — agent-switch has one product on two lines | — |
| PD2 | `hc` is an optional second host, never a replacement for tmux and never bundled | (a) replace tmux; (b) write a native Windows host; (c) stay ephemeral on Windows | (a) trades a long-established dependency for one whose first changelog entry is a month old; (b) is a PTY runtime of our own — `hc`'s source is 25,487 lines of Rust doing only that (`crates/herdr-core/src`); (c) leaves ADR-006's promise open | `hc` leaves preview, or P6.5 trips |
| PD3 | Own core for AS (`HC_SESSION=agent-switch`), not the user's default core | Share the user's core so Herdr shows AS sessions | In a shared core, closing a herdr-app pane ends the terminal (`herdr-app/README.md`), and AS could no longer promise that only `host end` ends a session | Users ask to see AS sessions in Herdr; then labels on a shared core, read-only first |
| PD4 | Typing into a terminal AS does not host is opt-in per terminal kind | On by default once the terminal is known | It is input into a program the user started elsewhere; the link roadmap's rule is that the user approves every move (`agents/roadmaps/road-to-the-agent-config-link.md` at `c3ca61d`, § Why the earlier "automatic move" was dropped) | — |
| PD5 | No herdr-specific code unless P0.4 shows the wrapper is not enough | Ship a herdr integration now | herdr types the resume command into the pane's shell (`agent_resume.rs:56`), where the wrapper already runs | P0.4 fails in a shell we support |
| PD6 | State from the program's word only; no screen rules | Port herdr's detection manifests for programs that stay silent | herdr's own new runtime dropped them ("the one most likely to be helpfully added; don't", `herdr-core/AGENTS.md:34-36`); the manifests are fetched from a URL at run time (`herdr/src/detect/manifest_update.rs:16`), which is remote behaviour change without a signature | A program users host daily never reports and has no hooks |

## Read and deliberately not taken

| From | What | Why not |
|---|---|---|
| herdr | Screen-rule agent detection, remotely updated catalogue | PD6 |
| herdr | Pane screen history replay after restart | Stores terminal output on disk; herdr itself ships it off by default because of secrets (`session-state.mdx`, § Pane screen history replay) |
| herdr | Hook-reported `working`/`idle` for Claude | herdr removed these hooks again and keeps only SessionStart (`src/integration/claude_settings.rs:26-63,78`); the tree already reads Claude's registry word instead (`src/runtime-state.ts:46-51`) |
| herdr-core | Agents starting and steering agents (`run`, `send`, `wait --children`, templates) | Orchestration is not an account question; it belongs to the agent host or to agent-config. Agent Switch only has to keep the account right for whatever is started |
| herdr-core | `hc update` self-update, checksum over HTTPS without a signed manifest (`docs/security.md:97`) | The tree chose notify-only updates (`road-to-the-ready-remainders` D5) |
| herdr-core | Machines over SSH (`hc connect` on stdio) | `remote rpc` already uses the same shape (SSH as the login, a line protocol on stdio) with three methods (`src/remote.ts:84-88`); the wider remote app is parked with its trigger unmet (`later/road-to-agent-switch-v3-reach-carried.md` Phase 3) |
| herdr-app | Mods and layouts as editable JavaScript, marketplace | Unsandboxed trusted code (`herdr-app/README.md:98`); the v3 window is bound to its reference boards (ADR-008) |
| herdr-app | Usage telemetry on by default | `NON-GOALS.md`: no telemetry |

## How this roadmap changed over three passes

**Pass 1 → 2.** The first draft led with "adopt `hc` as the host" and "full
OSC 7501". Re-reading the tree against it: (a) the host has no interface yet,
so the adapter was the second step, not the first — Phase 5 was added and made
independent of herdr; (b) for Claude the registry word already outranks any
program report, so 7501 moved down and behind a spike; (c) the larger gain was
in the other direction — sessions that already run inside a multiplexer — which
became Phase 7; (d) the wrapper defect G1 was found while checking how herdr
restores a pane, and went to the front because it needs nothing from anyone.

**Pass 2 → 3.** (a) The planned herdr integration (report our own resume
command) was cut to a fallback: herdr types the command into the pane's shell,
where the fixed wrapper already decides — PD5, P0.4. (b) The push protocol was
cut from "the engine pushes feeds" to "the engine says something changed and
the window re-reads", which needs no second copy of the feed logic. (c) The
error contract was cut from all 332 `die` sites to the commands other programs
call. (d) Sharing the user's herdr core was rejected for the default (PD3)
after reading that closing a pane ends its terminals. (e) Each phase got a red
test first and every machine-dependent step was moved into Phase 0 or tagged.

## Open points this analysis could not settle

- Whether Claude Code reports OSC 7501 unasked inside tmux: the tree's comment
  says only Codex does (`src/host/tmux-host.ts:164`, tested on 2.1.316 for a
  different question); a community tracker says Claude Code has sent it since
  2.1.295. P0.1 decides.
- The reader's real memory cost (P0.2).
- Whether `hc`'s `terminal.attach` stream can feed the app's terminal directly
  instead of `hc attach` in a PTY. Not needed for Phase 6; not examined.
- herdr's star count and adoption were not used as an argument anywhere.

## Sources

Repositories at the pins in the frontmatter. Web, read 2026-11-23:

- Program Status Protocol (OSC 7501), revision 0.4 — https://control-codes.page/proposals/osc-7501/
- Tracker of programs and terminals — https://areweosc7501yet.com/
- "OSC 7501: your coding agent can now tell your terminal it needs you" — https://dev.to/roidayan/osc-7501-your-coding-agent-can-now-tell-your-terminal-it-needs-you-29a
- tmux request, closed without support — https://github.com/tmux/tmux/issues/5713
- herdr issue #1269, env lost on restore — https://github.com/herdrdev/herdr/issues/1269
- "Herdr, seven months in" — https://sijinjoseph.com/post/2026-10-30-herdr-seven-months-in/
- "Running Multiple Claude Code Accounts with herdr" — https://www.giorgi.dev/ai/running-multiple-claude-code-accounts-with-herdr/
- herdr-agent-board #146 / #148 — https://github.com/MokuTeam/herdr-agent-board/issues/146 , https://github.com/MokuTeam/herdr-agent-board/pull/148
- "One Brain, Two Wallets" (`--resume` does not know about accounts) — https://dev.to/daksh-gargas/one-brain-two-wallets-two-claude-code-accounts-on-one-machine-5ejb
- heise on the desktop app and herdr-core — https://www.heise.de/en/news/Herdr-desktop-app-A-hub-for-AI-coding-agents-11508175.html
- Thoughtworks Radar, Herdr: Assess — https://www.thoughtworks.com/radar/tools/herdr
- "Herdr TUI vs App vs herdr-core" — https://getmoshi.app/articles/herdr-core-vs-tui
- Six ways to use several Claude Code accounts — https://enjoy.dev/blog/multiple-claude-code-accounts/
