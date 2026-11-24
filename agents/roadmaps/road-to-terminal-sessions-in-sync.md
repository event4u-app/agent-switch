---
complexity: standard
status: open
tree_pin: 394362a
---

# Roadmap: terminal sessions in sync

> **Source:** owner's chat, 2026-11-24: "Ist es nicht möglich, dass eine Session
> im Terminal oder z.B. Claude Desktop läuft und wir es gleichzeitig hier
> eingeben können? … schreib die Roadmap dafür und setze sie direkt um. Mach
> gerne eine Einstellung im passenden Bereich, dass man es an und aus schalten
> kann. Aber default sollte es dann an sein … wir wollen ja eigentlich, dass
> alles synchron ist."

## Goal

A `claude` or `codex` typed in the user's own terminal runs in Agent Switch's
host, and that terminal is one view of it. The same session can then be typed
into from the terminal and from Agent Switch at the same time, and both see
everything. One process, many views: the model Remote Control already uses.

## Why it is not synchronous today

A Claude Code session is one local process; its `.jsonl` is that process's log,
not shared state. A second process resuming the same id writes to the same file
and sees none of the first one's turns: a fork, not a sync. A session started in
a plain terminal has no input channel Agent Switch can reach (G10 of
`later/road-to-sessions-that-hold-wherever-they-run.md`), so Agent Switch can
only read it. A session in the host (`src/host/tmux-host.ts`) already takes
input from Agent Switch and from an attached terminal.

## Decisions (owner-delegated, recorded here)

- **D1 Default on, one switch.** Setting "Terminal starts run in Agent Switch"
  under Settings › Open in, and `agent-switch terminal-sync on|off|status`.
  Off restores today's wrapper exactly.
- **D2 Closing the terminal leaves the session running**, as for every hosted
  session; ending the program (`/exit`, Ctrl-D) ends the hosted session and
  returns the terminal to its shell with the program's exit status.
- **D3 The shell's environment travels.** The program sees the variables of the
  shell it was typed in (PATH, project variables), not the host server's. They
  pass through a 0600 file the window sources and deletes before it starts the
  program, never through tmux arguments (`ps` shows those).
- **D4 Only interactive starts are hosted.** stdin and stdout are terminals,
  tmux is installed, not Windows, not already inside an AS-hosted window, and no
  argument asks for a non-interactive run or a subcommand (`-p`, `--print`,
  `--output-format`, `-v`, `--version`, `-h`, `--help`, `claude mcp|config|
  doctor|update|install|setup-token|plugin|migrate-installer`, any `codex`
  subcommand, a bare `--resume`/`-r` that opens the picker). Everything else
  runs exactly as today.
- **D5 A resume lands on the account that holds it.** `--resume <id>` and
  `--session-id <id>` keep that id; the account is the one whose config holds
  the transcript (closes G1 for the hosted path). `-c`/`--continue` resumes the
  newest transcript of the folder on the routed account, or starts new when
  there is none.

## Phase 1 — The plan, decided without side effects

- [x] **1.1 Red tests** for a pure `terminalStartPlan(provider, argv, ctx)`:
      every D4 refusal returns `plain` with its reason; a plain start, a prompt
      argument and model flags return `hosted`; `--resume <id>` and
      `--session-id <id>` return that id; `-c` returns `continue`; the setting
      off returns `plain`.
      verify: tests fail before 1.2.
- [x] **1.2 Implement** `src/terminal-sync.ts`.
      verify: 1.1 green.

## Phase 2 — The switch

- [x] **2.1 State and command.** `terminalSync` in the CLI state (default
      true), `agent-switch terminal-sync [on|off|status] [--json]`, logged like
      `keep-signed-in`.
      verify: a test for default, on, off, and the JSON.
- [x] **2.2 Settings › Open in** gets the switch with a line that says what it
      does and what closing the window means (D2); IPC `getTerminalSync` /
      `setTerminalSync`.
      verify: a component test: shows the read value, a click calls the setter.

## Phase 3 — `agent-switch launch`

- [x] **3.1 Red tests** with a fake host: a hosted plan starts the window with
      the routed account, the shell env file (0600, without the host's own
      variables), and the user's arguments; the view attaches in this terminal;
      when the program ends the hosted session is ended and the program's exit
      status is returned; a `plain` plan exits 87 and touches nothing; a failed
      start removes the env file.
      verify: tests fail before 3.2.
- [x] **3.2 Implement** `agent-switch launch <provider> -- <args>` (hidden from
      the main help, documented in the reference).
      verify: 3.1 green; one test against the real private tmux server with a
      stub program that exits 3: the attach returns, the exit status is 3, the
      registry no longer lists it.

## Phase 4 — The wrappers use it

- [x] **4.1** zsh/bash and fish `claude` and `codex` call `launch` first and
      fall back to today's path on 87. PowerShell is unchanged (no host on
      Windows).
      verify: `tests/shellenv` snapshots updated; a shell test with a stub
      `agent-switch` that exits 87 runs the plain path.

## Phase 5 — Typing from both sides at once (G3)

- [x] **5.1 Red tests** with an injected clock and client list for the
      automated send in `LeaseStore.type`: a client that typed within 3 s →
      wait; quiet → send; never quiet within 60 s → give up with "someone is
      typing in it", nothing typed; a client that types between the text and
      Enter → no Enter, the typed text cleared.
      verify: tests fail before 5.2.
- [x] **5.2 Implement** the draft wait (moves P2.3 of
      `later/road-to-sessions-that-hold-wherever-they-run.md` here).
      verify: 5.1 green.

## Phase 6 — Docs and delivery

- [x] **6.1** `help.ts`, CLI snapshots, `starlight/.../reference/cli.mdx`
      (`terminal-sync`, `launch`), the troubleshooting line "my terminal
      session keeps running after I closed the window".
      verify: snapshot tests green.
- [x] **6.2** Full gates: root build, `tsc`, `npm test`; gui `tsc`, vitest.
- [ ] **6.3 Owner check in a real terminal** (needs a person and a real
      session, which no test may start): `claude` in a new terminal shows the
      session; it appears in Agent Switch as hosted; a message typed in either
      appears in both; `/exit` returns the terminal; closing the window leaves
      it running; `agent-switch terminal-sync off` restores the plain start.

## Acceptance

- With the switch on, `claude` in a terminal shows the session there and the
  same session in Agent Switch accepts input; a message typed in either appears
  in both.
- With the switch off, or for any D4 case, the wrapper behaves as before.
- No real agent session, tmux server of the user, push or PR is started by a
  test.
