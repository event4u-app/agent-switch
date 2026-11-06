---
complexity: structural
status: ready
---

# Roadmap: service-executed moves — an opt-in for answers given in the app

> Owner request (2026-11-05), follow-up to
> `archive/road-to-the-agent-config-link.md` (D6, D7): an answer given in the app's
> near-limit sheet may also be carried out by the background service instead of
> the app. A setting, **default off**, with the risk stated next to the switch.
> Off keeps today's behaviour: the app moves what it hosts and records the
> answer `--executed`.

## Why it is opt-in

Only the app can move a session that runs in its own terminal or chat. The
service runs plain agent-switch commands from the background and has no hold on
that session. With the setting on, the user trades that for one executor for
every answer, wherever it was given. The setting has to say what can go wrong.

## Ground truth (verified, not assumed)

Read at `feat/agent-config-link-v3` (merge of `main` 2.12.0 into `dev/v3`).

| Fact | Source |
|---|---|
| The service runs approved requests every 2 s, once each, never retried | `src/daemon.ts:537-562`, `src/link/execute.ts:1-13,72` |
| Claude moves are `rebind` (`--when-idle` after the turn); no `continue` is typed into a hosted session | `src/link/execute.ts:47-51` |
| A Codex `now` move is `takeover … --json`; its resume cannot run in the background and comes back as `outcome.resume` | `src/link/execute.ts:9-12,52-55` |
| A handoff only writes the brief; the seed comes back as `outcome.resume` | `src/link/execute.ts:42-45,88-89` |
| The app moves a Claude session by takeover when the target account runs a session of its own — `rebind` there signs that account out | `gui/src/v3/adapter/actions.ts` (`moveOne` doc comment, `via: "takeover"`) |
| The app types `continue` into a hosted or chat session after a rebind | `gui/src/v3/adapter/actions.ts` (`moveOne`) |
| The arm watcher can type into a hosted session from the service | `src/daemon.ts:506-514` (`continueSession` via `typeIntoHosted`) |
| The app records its own moves `--executed`; the service skips those | `gui/src/ipc.ts:1186-1197`, `gui/src/v3/adapter/actions.ts` (`recordMoves`) |

## Risks the setting text must name

1. **A session in the app's terminal or chat can stop.** A Codex takeover ends
   the old process; the service cannot resume it in the app's window. The resume
   command is offered afterwards.
2. **The target account can be signed out.** Until Phase 2 lands, `rebind` onto
   an account that runs a session of its own takes that login away.
3. **No `continue` after the switch** until Phase 2: the session waits for one
   typed message.

## Phase 1 — The setting

- [x] **1.1 CLI.** `agent-switch link executor app|service` and
      `link status --json` reports `executor` (default `app`). Stored next to the
      link's auto-connect flag.
      verify: CLI tests: default `app`, round trip, `status --json`.
- [x] **1.2 GUI switch** in Settings › Protection under "agent-config":
      "Let the background service carry out moves", off by default, with the
      three risks above as its detail text (en + de). Tray scope not needed
      (main window only).
      verify: settings test in redesign and v3 (`settings-link.test.tsx`).

## Phase 2 — Executor parity with the app

- [x] **2.1 No sign-out by rebind.** When the target account runs a session of
      its own, `planMove` uses a takeover, as the app does.
      verify: `execute` unit test with a busy target.
- [x] **2.2 Carry on after the switch.** After a Claude rebind of a hosted
      session, the service types `continue` through the same path as the arm
      watcher.
      verify: daemon test with a fake host.
- [x] **2.3 Hosted Codex takeover.** A session hosted by the app moves with the
      hosted takeover, so its window keeps running.
      verify: execute test against a fake host (`tests/link-execute.test.ts`
      "2.3"); daemon wiring in `tests/daemon-requests.test.ts`. Manual check in
      the running app still owed.

## Phase 3 — The app hands the answer over

- [x] **3.1 Decide without executing.** With the setting on, the sheet (v3 and
      2.x) calls `switch decide` without `--executed` and makes no move itself.
      Brief/handoff stays in the app.
      verify: adapter tests for both settings: on → no rebind/takeover call,
      one decision per session; off → today's behaviour.
- [x] **3.2 Show the outcome.** The request's `outcome` (done, failed,
      `resume`) reaches the user as a notice; a `resume` opens in the app's
      terminal on one click.
      verify: window test with a finished and a failed request.

## Phase 4 — Docs

- [x] **4.1 Guide** "Working with agent-config": the setting, its default and
      the risks.
      verify: starlight build.

## Decisions

| # | Decision | Why |
|---|---|---|
| E1 | Default off | Owner, 2026-11-05: the app is the only one that can move what it hosts |
| E2 | Phase 2 before the switch is advertised in the guide | The risks list shrinks with parity; the guide should describe the shrunk list |

## Out of scope

Automatic moves (D1 of the link roadmap stays) · moves across tools other than
a handoff · the service starting interactive sessions.
