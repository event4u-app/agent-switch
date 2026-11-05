---
complexity: structural
status: ready
---

# Roadmap: the agent-config link — one switch decision, two tools

> Owner request (2026-11-05): when a session nears its limit, agent-config (AC)
> and agent-switch (AS) **inform the user and request a switch**. The user decides
> in either tool; a decision made in one is valid in both. Neither tool switches
> on its own. AS ships a local MCP server that AC connects to automatically
> (setting in AS, default on). AC reads every account's limits through it to
> spread council / judge-bracket load. Lands on the 2.x line (`main`) and on v3.
>
> Counterpart in AC: `agents/roadmaps/later/road-to-a-link-with-agent-switch.md`
> in `event4u-app/agent-config`.

## Why the earlier "automatic move" was dropped

An AI council (2026-11-05, anthropic + openai, both seats answered) rejected an
unattended move: a move at 10:15 is unattended even if the session was started
at 9:00, and a typed `continue` cannot prove one executor. The owner then
replaced it with this design: **every move is approved by the user**. That keeps
`daemon.ts:9-14` ("no automatic switch") true and puts nothing behind AC's
unattended-relaunch refusal.

## Ground truth (verified, not assumed)

Line numbers are read at the v3 tip `ead689c`; files that exist only on v3
(`gui/src/v3/**`, `src/commands/continue.ts`, `--stop-source`) are marked by
Phase 4, which owns them.

| Fact | Source |
|---|---|
| Usage shape: windows `{key, utilization, resetsAt}` per snapshot | `src/usage.ts:11-29` |
| Daemon polls every enabled account, caches in `daemon-state.json` | `src/daemon.ts:127,628-776` |
| Freshness rule for cached usage | `src/daemon.ts:335-343`, `src/commands/shared.ts:172-199` |
| Limit needs (`kind:"limit"`) with version `key:resetsAt` | `src/commands/needs.ts:37-85` |
| "Ask once" is per webview (localStorage), invisible to CLI/daemon/AC | `gui/src/v3/adapter/limit-auto.ts:11-41`, `gui/src/redesign/engines/limit-open.ts` |
| The move decision + execution live in the GUI only | `gui/src/v3/adapter/actions.ts:128-217`, `gui/src/v3/adapter/data.ts:446-512` |
| Only persisted move state: rebind arms, no id, no queryable result | `src/rebind-arm.ts:24-246` |
| No transfer/idempotency id on `takeover`, `rebind`, `continue` | `src/commands/takeover.ts`, `src/commands/continue.ts` |
| `takeover --print-only` moves and only skips the launch (documented) | `guides/move-a-session.mdx:84`, `tests/cli-e2e.test.ts:333` |
| No MCP server, no MCP SDK; `mcp` only lists account configs | `src/commands/mcp.ts`, `package.json` (zero runtime deps) |
| Only listener: `engine.sock` (0600), closed op allowlist, sync handler | `src/protocol/messages.ts:10,54-58`, `src/engine/server.ts` |
| Default-on boolean pattern | `src/profiles.ts:331-361` (`keepSignedIn`) |
| Session identity inside a session: `CLAUDE_CONFIG_DIR` / `CODEX_HOME`; hosted: `AGENT_SWITCH_HOST_PANE` | `src/hook-intake.ts:66-75`, `src/host/tmux-host.ts:140-146` |
| v2 is `main` (PR #148, 2.12.0); limit flow there is Codex move + Claude rebind, no hosted continue | `347604a`, `gui/src/redesign/screens/near-limit.tsx` |

## Design

**One shared object: the switch request.** Stored under
`~/.agent-switch/switch-requests/<id>.json`, written under the existing file
lock, compare-and-set on `rev`.

```
{ v: 1, id, rev, session: "provider/account/sessionId" | null,
  account: "provider/account", reason: { window, fill, resetsAt, etaFull? },
  raisedBy: "as-daemon" | "as-gui" | "ac", raisedAt, expiresAt,
  candidates: [{ target, provider, fill, resetsAt, how: ["after-turn","now","handoff"] }],
  state: "open" | "approved" | "declined" | "snoozed" | "executing" | "done" | "failed" | "expired",
  decision?: { target, how, by: "as-gui" | "as-cli" | "ac:<host>", at },
  outcome?: { at, detail, newSession? } }
```

- **Dedup:** one open request per `(account, window, resetsAt)` — the same key
  the limit need already uses. AC raising it twice returns the existing id.
- **First decision wins.** `decide` CAS-writes `open → approved|declined|snoozed`;
  a second decision on a decided request returns the existing decision, never
  overwrites it. This is what makes "decided in one tool = valid in both".
- **AS is the only executor.** The daemon (or the CLI when no daemon runs) picks
  up `approved`, moves it to `executing`, runs the existing path
  (`rebind --when-idle` / `takeover --stop-source` / hosted takeover / handoff),
  and writes `done|failed` with the outcome. The request id is the idempotency
  key: an `executing` or `done` request is never executed twice.
- **Cross-provider** (Claude → Codex) is offered only as a candidate the user
  picks, executed as `handoff extract|seed`. Free models are not an AS account
  type; out of scope here.

**Two front doors, one core.** `src/link/` holds the request store, the limits
observation and the decide logic. Exposed as (a) CLI `--json` subcommands and
(b) `agent-switch mcp serve`, a stdio MCP server in pure Node (no SDK, keeping
zero runtime dependencies; JSON-RPC 2.0, protocol `2025-06-18`). Stdio means no
port, no token: the host spawns it as the same user.

**MCP tools (v1)**

| Tool | Effect | Notes |
|---|---|---|
| `limits_get` | read | Observations, never reservations: `{v, observedAt, accounts:[{id, provider, name, usable, stale, windows:[{key, fill, resetsAt}]}]}`. Cached data only; `refresh:true` is opt-in. |
| `session_whoami` | read | The calling session's `provider/account[/sessionId]` from env + Claude's pid registry. |
| `switch_list` | read | Open and recent requests. |
| `switch_request` | write (request only) | Raise or return the request for an account/session. Moves nothing. |
| `switch_decide` | write (decision) | `approve` with `target` + `how`, `decline`, or `snooze`. Must be a tool the host asks the user about — never on an auto-allow list. |
| `switch_status` | read | One request incl. outcome. |
| `link_status` | read | `{enabled, version, contract: 1}`. |

**Setting `link.autoConnect`** (state.json, default **on**, `raw?.x !== false`).
Off ⇒ `link status` reports disabled, `mcp serve` answers `initialize` and then
lists no tools, and AC removes its entry on its next install/doctor pass. The
CLI front door stays (it is the user's own tool).

## Phase 1 — Core on `main` (2.x)

- [x] **1.1 Limits observation.** `src/link/limits.ts` + `agent-switch limits
      --json`: per account the newest cached snapshot, `stale` per the daemon's
      freshness rule, `usable` per `balance.ts weigh()`. No network unless
      `--refresh`.
      verify: unit tests over fixture daemon-state (fresh, stale, past reset,
      Codex rollout, Antigravity without readout).
- [x] **1.2 Switch-request store.** `src/link/requests.ts`: create (dedup key),
      list, get, CAS decide, expire (`expiresAt` = window reset), prune after
      7 days. Red-first tests for: dedup, first-decision-wins under two
      concurrent writers, expiry, corrupt file ignored.
      verify: `npm test` filter `link/requests`.
- [x] **1.3 Candidates.** Reuse `pickSwitchTarget`/`balance.ts` for same-provider
      targets, never lending an account with a live session (rebind-dialog
      `busy`); add one cross-provider handoff candidate when another provider
      has a usable account.
      verify: unit tests incl. "every other account busy → only handoff".
- [x] **1.4 Executor.** Daemon tick: `approved → executing → done|failed`,
      mapping `how` onto the existing paths. Idempotent by id; a failed launch
      after transfer reports `failed` with the new location, never retries
      blind.
      verify: tests with an injected runner: one execution per id across two
      ticks; failure records `outcome.detail`.
- [x] **1.5 Daemon raises requests.** The protection/near-limit branch
      (`daemon.ts:694-775`) raises a request (`raisedBy:"as-daemon"`) for
      accounts with live sessions, instead of only a notice. Still never moves.
      verify: test: crossing at 90 % with a live session → one open request;
      second tick → same id.
- [x] **1.6 CLI.** `agent-switch switch list|show|request|decide|status --json`.
      verify: CLI tests for each verb's JSON shape and exit codes.
- [-] **1.7 ~~Fix `--print-only` transferring files~~ — cancelled, not a defect.**
      Moving and only skipping the launch is the documented contract
      (`starlight/src/content/docs/guides/move-a-session.mdx:84` "--print-only
      still moves") and is pinned by `tests/cli-e2e.test.ts:333`. The mapping
      read it as a preview flag; it never was one.

## Phase 2 — MCP server and the setting (`main`)

- [ ] **2.1 `link.autoConnect` setting**, default on, CLI `link on|off|status
      --json`, read by `mcp serve` on every `tools/list`.
      verify: state tests: absent → on; `off` persisted; status JSON.
- [ ] **2.2 `agent-switch mcp serve`.** Pure-Node stdio JSON-RPC: `initialize`,
      `tools/list`, `tools/call`, `ping`; logs to stderr only; unknown method →
      `-32601`. Tools per the table above, backed by `src/link/`.
      verify: spawn test driving a full handshake + each tool over stdio.
- [ ] **2.3 Disabled behaviour.** `autoConnect: off` → empty tool list and
      `link_status.enabled=false`.
      verify: spawn test with the setting off.
- [ ] **2.4 Doctor row** for the link (enabled, AC detected, AC entry present).
      verify: doctor test fixture.

## Phase 3 — GUI on `main` (2.x redesign)

- [ ] **3.1 Near-limit sheet reads requests.** `screens/near-limit.tsx` opens
      for an open request (any `raisedBy`), labels "requested by agent-config"
      when `raisedBy:"ac"`, and writes its choice through `switch decide`.
      "Ask once" moves from localStorage to the request state.
      verify: GUI unit tests: AC-raised request opens the sheet once; a request
      decided in AC closes it without asking.
- [ ] **3.2 Settings toggle** "Let agent-config connect" in the protection pane.
      verify: settings test round-trips via CLI.

## Phase 4 — v3 (`feat/v3-design-fidelity`)

- [ ] **4.1 Bring phases 1–2 into v3** by merging `main`; resolve against
      `--stop-source`, hosted takeover and `continue`.
      verify: full test suite on the v3 branch.
- [ ] **4.2 DecisionSheet backed by requests.** `limit-auto.ts` keys on request
      id + rev; `moveOne` stops executing in the GUI and calls `switch decide`;
      the executor runs the move. Multi-session spread (`spreadSessions`) becomes
      one decision per session request.
      verify: v3 adapter tests: decision in AC closes the sheet; checked sessions
      produce one decision each; no GUI-side takeover remains.
- [ ] **4.3 Toggle in v3 settings** via the shared redesign pane.
      verify: v3 settings test.

## Phase 5 — Docs

- [ ] **5.1 Starlight guide "Working with agent-config"** (link, setting,
      tools, the request lifecycle) and README row.
      verify: starlight build.

## Decisions

| # | Decision | Why |
|---|---|---|
| D1 | No automatic move, ever; user approval in either tool | Owner, 2026-11-05, after council rejection of unattended moves |
| D2 | AS executes, AC requests/relays only | Keeps AC's recorded fences (AC never switches accounts) and one executor |
| D3 | Pure-Node MCP, no SDK | AS ships zero runtime dependencies |
| D4 | stdio only, no port | Same-user child process; no token, nothing listening |
| D5 | Core on `main` first, merged into v3 | One implementation, two GUIs |

## Out of scope

Free/local LLM accounts as move targets · automatic moves · AC executing
anything · a network listener · Codex `--stop-source` (separate work).
