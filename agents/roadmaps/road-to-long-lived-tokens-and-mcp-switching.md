---
complexity: large
status: planned
tree_pin: d138118
---

# Roadmap: long-lived tokens per profile, then switching over MCP

> **Source:** owner turn 2026-11-05, from the agent-config container-benchmark work.
> Benchmark sweeps run Claude Code headless in containers. Containers cannot use a
> profile's Keychain login, so each account needs a `claude setup-token` token
> (one year, model requests only). The agent-config bench keeps those tokens in its
> own pool today (`~/.event4u/agent-config/secrets/claude-oauth-tokens/`). The owner
> wants them to live in agent-switch, one per profile, so a script uses the
> profile instead of a token file and stops being logged out. The owner also wants
> switching reachable over MCP in v3.
> **Blocked on Phase 0.** Two recorded positions in this tree stand against the
> core of it (see "Conflicts" below). Nothing past Phase 0 starts before they are
> resolved.

## Branch

- **Phase 1 and 2 (2.x):** `feat/profile-tokens` from `main`; the PR targets `main`.
- **Phase 3 (v3):** `feat/v3-mcp-switching` from `dev/v3`; the PR targets `dev/v3`.

## Goal

1. A profile can carry a long-lived token.
2. `agent-switch exec` hands that token to the official CLI it launches, and to
   nothing else.
3. A script or container sweep asks agent-switch which account has headroom, and
   runs on it, without ever seeing a token.
4. From v3, an agent can make the same choice over MCP.

## How AS and AC combine

The owner's design (2026-11-05):

| Installed | Where the token comes from | How a run gets an account | When the account runs out |
|---|---|---|---|
| **AS + AC** | AS creates it during the AS login it already runs, through Anthropic's own `claude setup-token` flow: one extra browser confirmation, no second login | AC asks AS (`agent-switch exec` in 2.x, `accounts.pick` over MCP in v3) | AS tells the user the account is at its limit and **offers** the switch; the user confirms |
| **AC only** | The user runs `claude setup-token` per account and drops the token into AC's pool (`~/.event4u/agent-config/secrets/claude-oauth-tokens/`), as today | AC runs on the account the user named (`--account`) | AC's brake stops the sweep and names the other accounts that have a token; the user resumes on one |

**No automatic switching in either case.** The tool offers a switch and the user
makes it. The owner checked this model for AS before; it is the basis of the
existing limit alerts and the `rebind` picker.

## Conflicts — read before anything else

| Position | Where | What it says | Why this roadmap collides |
|---|---|---|---|
| No holding, brokering or forwarding of logins | `NON-GOALS.md` § "No holding, brokering or forwarding of logins" | agent-switch keeps logins where each provider puts them; only `import` and `rebind` write | Storing a `setup-token` token in agent-switch is holding a login |
| One named writer | ADR-003 | `rebind` is the only credential writer, under lock, with provenance | A token store is a second writer |
| `CLAUDE_CODE_OAUTH_TOKEN` is an override to warn about | `src/doctor.ts` `AUTH_OVERRIDE_ENV` | The variable makes every profile use one credential | Injecting it per profile is exactly that variable |
| No MCP or HTTP server | `archive/road-to-signals-the-host-already-sends.md` D6, `NON-GOALS.md` § "No server outside your own network…" | `--json` on every command is the machine contract; a server is a non-goal; revisit if agent-config names a call `--json` cannot serve | Phase 3 is an MCP server |

**What Anthropic's pages say** (read 2026-11-05):

- The legal page, under "Usage policy › Authentication and credential use", says developers may not "collect, store, or intermediate Claude.ai credentials or session tokens".
- The authentication page says `setup-token` "does not save the token anywhere". It tells the user to set the token as `CLAUDE_CODE_OAUTH_TOKEN` wherever they want to authenticate.
- Neither page says whether a tool on the user's own machine may store the user's own `setup-token` and hand it only to the official CLI.
- The legal page sends questions about permitted authentication to Anthropic sales.

So the restriction neither clearly covers this case nor clearly allows it.

## Constraints (binding)

- A token never leaves the machine and never reaches a process other than the
  provider's official CLI started by `launch()`. That includes the docker client the
  bench starts, because it passes the variable by name.
- A token is never printed, logged, returned by `--json` or MCP, or written to a
  history, snapshot or picks file.
- agent-switch never mints a token itself. When it creates one, it starts the
  official `claude setup-token` command for the profile, and sign-in completes in
  Anthropic's own browser flow. agent-switch only takes the printed token off
  that command's output and puts it in the profile's secret store. Pasting it on
  stdin stays available.
- No automatic account switching. At a limit, agent-switch and AC offer the
  switch; the user confirms it.
- No refresh logic. A `setup-token` token has a fixed lifetime; agent-switch shows
  its age and warns before a year is up. ADR-004 still holds for Keychain logins.
- The macOS secret lives in the Keychain under an agent-switch item per profile,
  on the existing `agent-switch.agy.*` pattern. Linux and Windows use the platform
  secret store where one exists, otherwise a 0600 file beside `config/`, named as
  the weaker option in `doctor`.

## Verified against the tree (2026-11-05, `dev/v3` @ d138118)

| What | Where |
|---|---|
| Read-only credential store, Keychain then `.credentials.json` | `src/credentials.ts` |
| Keychain wrapper, service naming | `src/keychain.ts` |
| Pattern for an agent-switch-owned Keychain item per profile | `src/agy-keychain.ts` |
| One env-building point for every launch | `launch()`, `src/commands/shared.ts:134-152` |
| Headroom pick with no network call | `src/balance.ts`, `src/dir-resolve.ts` |
| Pick plus launch for scripts | `cmdExec`, `src/commands/routing.ts:345-371` |
| The only local API: protocol server on a 0600 Unix socket | ADR-006, `src/engine/server.ts`, `src/protocol/` |

## Phase 0 — Gates (decisions, no code)

- [ ] **0.1 Ask Anthropic.** Ask Anthropic, through the contact the legal page
      names, whether a local tool may store the owner's own `setup-token` token
      and pass it only to the official CLI on the same machine. Done when the
      written answer is filed under `docs/` as evidence. A "no" ends Phases 1 and 2.
      Phase 3 then exposes only what agent-switch can do without holding a token:
      choosing an account and running `exec` on a Keychain login.
- [ ] **0.2 ADR amending the non-goal.** Only on a clear "yes" to 0.1. The ADR:
      - narrows "No holding … of logins" to an explicit exception: an owner-supplied
        `setup-token` token, stored in the OS secret store, passed only to the
        official CLI;
      - names the second writer and its lock;
      - amends ADR-003.

      This decision belongs to the owner, not the council: it weakens a recorded
      floor.
- [ ] **0.3 Reopen D6 (MCP).** The revisit condition in D6 is met: agent-config now
      names a call `--json` cannot serve, which is an agent choosing and switching
      accounts mid-session through its tool interface. Put the reopen to the council
      with D6's text, ADR-006 and this roadmap. Done when the verdict is recorded
      with its scope and its revisit-if.

## Phase 1 — Tokens per profile (2.x)

- [ ] **1.0 A token at login.** Gated on 0.1. `agent-switch login|add <name>
      --with-token` runs the normal login first, then the official
      `claude setup-token` for that profile in the same session: one more browser
      confirmation, no second sign-in. agent-switch stores the printed token
      (1.1) and never echoes it. The GUI's sign-in offers the same as a checkbox.
      Done when a test with a stub `claude` shows the token goes from stdout into
      the store and appears in no log, history or terminal echo.
- [ ] **1.1 `agent-switch token set|clear|status <profile>`.**
      - `set` reads the token from stdin only, never from an argument. It rejects a
        value that is not a single `sk-ant-oat` token and stores it in the
        profile's secret item.
      - `status` shows presence, age and days left, never the value.
      - Done when tests cover the set/clear round trip, an argv token being
        refused, and `status --json` carrying no token.
- [ ] **1.2 Injection in `launch()`.** For a Claude profile that has a token,
      `launch()` sets `CLAUDE_CODE_OAUTH_TOKEN`. It always removes
      `ANTHROPIC_API_KEY` and the other override variables from the child env,
      because they would take precedence. Done when an env-snapshot test shows the
      token reaches `run`, `exec` and `login` only, and `ANTHROPIC_API_KEY` is
      absent.
- [ ] **1.3 `doctor` knows the difference.** A token that `launch()` injected
      counts as the profile's own login. A `CLAUDE_CODE_OAUTH_TOKEN` already set in
      the user's shell still warns. Done when doctor tests cover both cases.
- [ ] **1.4 Expiry warning.** The status line and the GUI show the token's age and
      warn 30 days before a year is up. Done when the test fixtures cover fresh,
      warning and expired tokens.

## Phase 2 — Scripts and the agent-config bench (2.x)

- [ ] **2.1 `exec` for a container launcher.** `agent-switch exec --provider claude
      --exclude … -- docker run … -e CLAUDE_CODE_OAUTH_TOKEN …` works:
      - the docker client inherits the injected variable;
      - the picked profile name appears in `picks.jsonl`;
      - the token appears nowhere.

      Done when an integration test with a stub binary shows the variable arrives
      by name and the pick is recorded.
- [ ] **2.2 Headroom for a sweep.** `agent-switch dir --json --require-token`
      returns the account with the most headroom among profiles that have a
      token, or a clear "none". Done when a test covers the pick and the empty case.
- [ ] **2.3 agent-config switches over.** In the agent-config repo,
      `bench_ab_v2_run --isolation container` resolves its account through
      `agent-switch exec` when `agent-switch` is on PATH and falls back to its own
      token pool otherwise. At a limit the sweep stops. With AS, the user is
      offered a switch to the account `dir` would pick; without AS, the brake names
      the other pool accounts. Nothing switches without the user's confirmation.
      Done when agent-config's container tests cover both paths and show no
      unconfirmed switch.
      Tracked there as a follow-up to `road-to-benchmarks-in-clean-containers`.

## Phase 3 — MCP switching (v3, only after 0.3)

- [ ] **3.1 MCP server on the engine socket.** A stdio MCP server, started by the
      host as `agent-switch mcp serve`, that talks to the engine over the ADR-006
      socket and opens no port. Its tools:
      - `accounts.list`: name, provider, headroom, token present yes/no;
      - `accounts.pick`: the same choice as `dir`;
      - `accounts.use`: switch the active profile;
      - `sessions.handoff`: an existing `takeover` or `handoff` behind the existing
        confirmation.

      No tool returns a credential, an env or a command line. Done when protocol
      tests show every tool's output schema has no field that can hold a token.
- [ ] **3.2 Guarding the switch.** `accounts.use` and `sessions.handoff` change
      what the user's next session runs on, so they ask for the same confirmation
      the GUI does and go through the existing `guard`. Done when a test shows a
      call without confirmation changes nothing.
- [ ] **3.3 agent-config consumes it.** agent-config's subagent and bench code uses
      `accounts.pick` when the MCP server is configured, otherwise `exec`. Done
      when that is documented in agent-config's MCP tool list.

## Ordering

0.1 → 0.2 → Phase 1 → Phase 2. 0.3 can run in parallel with all of them. Phase 3
starts only after 0.3, and its token-related tools only after 0.2.

## Acceptance

- `agent-switch exec` runs a container sweep across several accounts. No token
  appears in any file, log, report or `--json` output agent-switch writes.
- On a "no" to 0.1, Phase 3 still delivers account choice over MCP, and the
  roadmap says in one line which part was dropped and why.

## Decisions

| # | Decision | Alternatives | Reason | Revisit-if |
|---|---|---|---|---|
| D1 | Phase 0 gates everything, with Anthropic's answer first | Build now and mark it experimental | The tree's own non-goal and Anthropic's restriction both point the other way; a code path that holds tokens is costly to take back once shipped | Anthropic publishes a rule that covers this case |
| D2 | agent-switch may start the official `claude setup-token` right after its own login and keep the printed token (still gated on 0.1) | Paste only (the first draft of this roadmap); a second, separate sign-in | Sign-in still completes through Anthropic's own flow (legal page). The user is signing in through agent-switch anyway, and one extra confirmation avoids repeated logins. The storage question is the same either way and stays with 0.1 | Anthropic's answer to 0.1 distinguishes launching the official command from storing its output |
| D5 | Switching is offered, never automatic, in AS and AC alike | Rotate to the next account with headroom | The owner's legal line; matches what AS already does at a limit | — |
| D3 | The MCP server rides the engine socket over stdio | An HTTP server on localhost | `NON-GOALS.md`: nothing listens on a port | — |
| D4 | No MCP tool returns a credential or an env | A `token.get` tool for scripts | A tool that returns a token is the egress leg of a credential leak; `exec` covers the script case | — |
