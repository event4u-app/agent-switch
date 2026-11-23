---
complexity: structural
status: proposal
tree_pin: c3ca61d
relates:
  - slug: road-to-long-lived-tokens-and-mcp-switching
    relation: disjoint
    note: "Token storage and MCP switching stay there; nothing here holds or moves a Claude login."
  - slug: road-to-agent-switch-statusline-usage
    relation: disjoint
    note: "Phase 3 here spikes a cheaper zero-network source first; step 3.4 is only a pointer back to that roadmap if the spike fails."
  - slug: road-to-host-signals-followups
    relation: extends
    note: "Pulls its 'replay the pick ledger' step forward as the gate for step 1.3."
  - slug: road-to-a-trusted-install
    relation: disjoint
    note: "Signing stays parked there; Phase 7 here is an integrity check that needs no certificate."
  - slug: road-to-session-orchestration
    relation: extends
    note: "Its one-line 'Per-profile GitHub/MCP sharing matrix' becomes Phase 6 here."
---

> **Intake:** owner inbox round `inbox-2026-11-d` (the analysis, chat and this draft are in `agents/tmp.old/inbox-2026-11-d/a/`, gitignored), triaged 2026-11-23 into `later/` by `road-to-a-workbench-that-tells-the-truth` 8.7.
> **Resume condition:** the owner answers its "Decisions (all proposed)" and the Phase 0 spike records; until then nothing here is built.

# Road to a reading every pick can trust

> **Status: proposal.** Every ID in this file (F…, DP…, step numbers) is a
> proposal of this draft. None is adopted; do not cite one as a basis elsewhere
> before the owner has taken it.
>
> **Source:** owner turn 2026-11-23 — "improve agent-switch further; analyse the
> current state and `uwuclxdy/clauth` in depth; three loops".
>
> **Pins.** agent-switch `main` @ `c3ca61d` (2026-11-13, npm 2.14.3, 646 commits);
> agent-switch `dev/v3` @ `56e5f4d` (2026-11-13, 269 commits ahead of `main`, 75
> behind); clauth `mommy` @ `19a028b` (2026-11-22, v0.18.2, 2,908 commits, about
> 263k lines of Rust under `src/`). Every `file:line` below was re-read at these
> pins on 2026-11-23. Lines without a branch name are `main`.
>
> **Harvest form.** Each finding starts from a defect in this tree. clauth and
> the web are drawn in per defect, as evidence or as a pattern. Nothing is in
> here because clauth has it.

## Goal

Every surface that picks or shows an account works from a reading that says what
it knows: which window it weighed, whether a failed read means "sign in again",
"the provider throttles reads" or "offline", and whether the account stops at
its limit or continues on paid usage. The readings cost fewer requests than
today, not more.

## What the comparison showed

clauth is the opposite architecture and the opposite policy. It swaps one
credential in place, refreshes tokens itself, switches accounts automatically
down a fallback chain, opens 5-hour windows with paid pings, and sends Claude
Code's own `User-Agent`. agent-switch refuses each of those in `NON-GOALS.md`,
ADR-003, ADR-004 and `skipped/road-to-agent-switch-autoswitch-rejected.md`.
What transfers is clauth's measured knowledge of Claude Code's internals and
four engineering patterns: typed read outcomes, one shared fetch gate,
host-observed refusals as evidence, and one write discipline for shared files.

One consequence matters most. Anthropic's `/api/oauth/usage` endpoint
rate-limits per account, hard (anthropics/claude-code#31637, #30930, #77477:
`retry-after` of 0, or 471–700 s for hours with several pollers). clauth
answers by copying Claude Code's `User-Agent` byte for byte
(`src/usage/fetch.rs:1405-1418`). agent-switch will not, so its only honest
answer is to ask less often and to read what Claude Code already wrote to disk.

## Findings

All verified at `c3ca61d`. "v3" says whether `dev/v3` @ `56e5f4d` differs.

| ID | Defect | Evidence | v3 |
|---|---|---|---|
| F1 | The balance rule takes "the window that resets last" as the account's week. A per-model window (Fable) that resets later than the all-models week then defines the account's need. Proof below: an account at 80 % of its week with 10 h left is weighed as "95 % left, 160 h". | `src/balance.ts:27-33`, `:38-45` | same |
| F2 | A per-model window at its limit excludes the account for every model. The shell wrapper gives `dir` no session arguments, so the model is unknowable when the pick is made. | `src/balance.ts:36-37`; `src/shellenv.ts:121`, `:125` | same |
| F3 | `dir` weighs a window whose reset has passed as still full; the limits report drops such windows first. Two answers for one account. The daemon's re-read bounds it to one poll. | `src/dir-resolve.ts:226`, `:280` vs `src/link/limits.ts:74-82`; `src/daemon.ts:769` | same |
| F4 | A failed usage read has no type. 401, 403, 429, 5xx and a timeout all return `null`, although a status classifier exists in the same file. The only outcome is "Usage fetch failed" after 15 minutes, and `dir` says "too old to trust" for a dead login and a throttled read alike. | `src/api.ts:57-71`, `:89-94`; `src/daemon.ts:85-102`, `:610-612`, `:782-793`; `src/dir-resolve.ts:276-278` | same |
| F5 | 429 handling adds load. Three retries inside one call, each wait capped at 5 s, discard a longer `Retry-After`. The backoff lives in the daemon's memory, so the CLI and the app fetch again while the daemon backs off, and a restart forgets it. The tree's own comment records the symptom. | `src/api.ts:39-43`, `:60-65`; `src/daemon.ts:286-302`, `:947`; `src/commands/shared.ts:178-188` | same |
| F6 | The `User-Agent` says `agent-switch/1.0` at version 2.14.3. | `src/api.ts:53`, `:109`; `package.json:3` | same |
| F7 | The `/usage` blocks `extra_usage` and `spend` are dropped. An account that continues on paid extra usage reads exactly like one that stops at its limit. | `src/usage.ts:64-92` (no reader; `grep extra_usage\|spend src/usage.ts` → 0). Shape: clauth `src/usage/fetch.rs:278-298`, `:378-394` | same |
| F8 | Three shared files are written without rename or lock, next to neighbours that do it right: the daemon state, the usage history (read-modify-write by several recorders) and the hook event ring (read-modify-write by one process per hook). | `src/daemon.ts:179-182`; `src/history.ts:53-62`; `src/hooks.ts:239-245`. Right: `src/history.ts:77-82`, `src/protection.ts:50-55` | ring fixed (`src/hooks.ts:459-`, append-only); other two same |
| F9 | The desktop app is downloaded, unpacked and started with no integrity check. | `src/gui-launch.ts:181-186`, `:245-264` | same |
| F10 | What the host says when a turn dies never reaches the usage state. `StopFailure` with `rate_limit`, `authentication_failed` or `billing_error` produces a notice only; `dir` keeps picking the account until a poll says otherwise. | `src/hooks.ts:168-174`, `:186-194`; `grep StopFailure src` → `hooks.ts` only | same |
| F11 | `share --history` links `projects/` into the profile. clauth documents that Claude Code's permission exemptions (auto memory, a session's tool results) need the literal and the resolved path inside the literal `CLAUDE_CONFIG_DIR`, and that through a `projects` link every auto-memory write and tool-result read prompts. **Not yet observed in this tree.** | `src/share.ts:60-61`; clauth `src/cc_exempt.rs:5-9` | same |
| F12 | A profile cannot say what it lacks. MCP server logins live in each config dir's credential store (`mcpOAuth`), user-scope MCP server definitions in each config dir's `.claude.json`. agent-switch follows neither and shows neither. `rebind` moves the whole credential blob, so a rebound session's MCP logins may become the other account's set. **The rebind effect is not yet observed.** | `src/config-transfer.ts:38`; `src/claude-settings.ts:38-39`; `src/rebind.ts:233`, `:724-725`; clauth `src/mcp_sync.rs:1-3`, `:38-39`, `src/claude_json.rs:3-5`; planned as one line in `later/road-to-session-orchestration.md:78` | same |
| F13 | A usage reading that costs no request goes unread. Claude Code keeps its own last usage read in each config dir's `.claude.json` (`cachedUsageUtilization`). **Known by name only; shape and freshness unverified.** | clauth `src/claude_json.rs:49-53`; no reader in `src/` | same |

**Proof for F1–F3** (built `dist/` at `c3ca61d`, `now` = 2026-11-23T10:00Z,
threshold 95):

```text
case 1  5h 10 %, week 30 %, Fable week 100 %
        → {"usable":false,"why":"at 100% of its Fable window (limit 95%)"}
case 2  week 80 % resets in 10 h, Fable week 5 % resets in 160 h
        → {"usable":true,"need":0.59375,"rest":95,"resetH":160,"window":"Fable","key":"weekly_fable"}
case 3  5h 100 % with a reset 2 min ago, snapshot 4 min old
        → "Skipped claude/a: at 100% of its 5h window (limit 95%)"
```

## What the three loops changed

| Loop | Draft | What the re-read overturned |
|---|---|---|
| 1 | Six phases led by a token and cost dashboard, an incident feed, MCP login sync, the statusline source and a checksum. | — |
| 2 | Dashboard and incident feed dropped: no defect in this tree asks for them, and the feed adds a network host to a README that lists every host. MCP login sync cut to a read-only readout plus an owner decision, because it is a second credential writer (ADR-003). Statusline moved behind a spike of the `.claude.json` cache, which needs no status-line slot. The hook ring turned out fixed on `dev/v3`. | Additive harvest; a policy conflict presented as a feature; a heavy path chosen before the cheap one was tested. |
| 3 | F1 proved by running the built tree, so it leads. clauth's single-fetcher lease replaced by an attempt record on disk: clauth needs a lease because its TUI and its daemon both decide; here one daemon decides and the others only read. The model-aware pick (F2) got a gate, since it changes which account a start lands on. | A pattern copied at the size its source needs; a behaviour change planned without the ledger replay the tree already asks for. |

## Decisions (all proposed)

| ID | ownership | proposal | alternatives | revisit if |
|---|---|---|---|---|
| DP1 | reversible-technical | Land on `main`, merge forward into `dev/v3`. F1–F7 and F9–F13 are identical on both. | Wait for v3 | v3 becomes `main` before Phase 1 starts |
| DP2 | reversible-technical | One attempt record on disk per profile gates every reader. No lease, no lock file held for life. | clauth's fetch lease (`src/daemon/probe.rs:16-23`) | two processes ever decide (not only read) |
| DP3 | owner | A start never moves onto paid extra usage because another account is full. Extra usage is shown and named, never weighed as room. | Treat it as headroom behind a setting | the owner wants a spend ceiling per account |
| DP4 | owner | User-scope MCP server definitions with no secret-shaped value follow the source, behind the existing `confirmNew`. This narrows the 2026-11-05 "MCP servers never travel" decision. | Keep them per profile; readout only | — |
| DP5 | owner | MCP logins are never copied between profiles. agent-switch shows which profile lacks which login and starts the official sign-in there. | Copy with lineage tracking as clauth does (`src/mcp_sync.rs`) | the owner accepts a second credential writer by ADR |
| DP6 | owner | Whether release digests ship inside the provenance-attested npm package (npm publish then waits for the app build). | GitHub's asset digest only (step 7.1) | `road-to-a-trusted-install` is taken up |

## Phase 0 — Spikes (records only, no product code)

- [ ] **0.1 The usage cache in `.claude.json` (F13).** On macOS with two
      signed-in profiles, one with a live session: record the shape of
      `cachedUsageUtilization`, which windows it carries (per-model ones or
      not), its account stamp, when Claude Code rewrites it, and how old it
      gets in an idle profile. Record the Claude Code version.
      verify: a dated record under `agents/evidence/` with a redacted sample and
      a pass/fail line: "fresh within 5 min while a session works: yes/no".
- [ ] **0.2 History link and permission prompts (F11).** Profile with
      `share on --history`: let a session write auto memory and read one of its
      own tool results, interactive and with `-p`. Record whether it prompts.
      verify: a dated record; on "prompts", the exact path pair Claude Code compared.
- [ ] **0.3 MCP logins across a rebind (F12).** Profile A holds a login to one
      MCP server, B none. Rebind A's session to B, then back with `--restore`.
      Record which server keys each store holds after each step. Keys only,
      never a token.
      verify: a dated record with the three key lists.
- [ ] **0.4 Replay the pick ledger with the 1.1 and 1.3 rules.**
      Run `picks.jsonl` through the current rule and the proposed one.
      verify: a record with the number of picks that change and three examples.
      <!-- from: later/road-to-host-signals-followups.md "Replay the pick ledger" -->
- [ ] **0.5 Asset digests (F9).** Read one published release through the GitHub
      API and record whether every asset carries a SHA-256 digest.
      verify: the redacted API answer in the record. (Not checked in this draft:
      the API was not reachable from the analysis session.)

## Phase 1 — The weigh says the same thing everywhere (F1, F3, F2)

- [ ] **1.1 The account's week is the all-models week.** `weigh` takes
      `seven_day` when present, else today's rule. A per-model window never
      defines need.
      verify: test seen red first with proof case 2 → `key: "seven_day"`,
      `resetH: 10`; the 1,500-world property test stays green.
- [ ] **1.2 One filter for windows that still hold.** `dir` and `limits` weigh
      through the same function, which drops a window whose reset has passed.
      verify: test seen red first with proof case 3 → the account is picked,
      with "5h reset 2 min ago" in `why`; `grep "weigh(" src` shows no caller
      that passes an unfiltered snapshot.
- [ ] **1.3 A per-model limit gates the model it names.** Gated on 0.4. The
      wrapper passes the session's arguments (`dir --guard -- "$@"`). The model
      comes from `--model`, `ANTHROPIC_MODEL` or the profile's `settings.json`.
      A known model that is not the capped one is not excluded. An unknown model
      keeps today's rule. `doctor` reports a wrapper that still calls the old form.
      verify: tests for known-other, known-capped and unknown; proof case 1 with
      `--model sonnet` → picked, with the Fable limit named in `why`; a
      `shellenv` snapshot test per shell.

## Phase 2 — A failed read says why, and nobody asks twice (F4, F5, F6)

- [ ] **2.1 Typed read outcome.** `fetchUsage` returns `ok`, `sign-in-needed`
      (401), `refused` (403), `throttled` with the server's wait (429),
      `provider-error` (5xx), `offline` or `unreadable` (200, unknown shape).
      verify: one test per status, seen red first; no caller treats `null` as a reason.
- [ ] **2.2 One attempt record per profile, on disk.** `usage-attempt.json`
      beside `usage-latest.json`: last attempt, outcome, `notBefore`. The daemon,
      `status` and the app's reads all honour `notBefore`. `Retry-After` sets it,
      capped at 30 min; without the header the existing doubling applies. At
      most one retry inside a call, and only when the server asks for 5 s or
      less. The in-memory map goes.
      verify: test — daemon records `throttled` until T; a CLI read before T
      makes no request; a daemon restart before T makes none either.
- [ ] **2.3 The reason reaches every surface.** `dir --json` and its `why`
      lines, `status`, the limits report's `why` (additive, schema stays 1) and
      the app say "sign in again", "the provider is throttling usage reads, next
      try 12:40" or "offline", not "too old to trust".
      verify: CLI snapshot tests for the three texts (the CLI stays English);
      app string tests in `en` and `de`.
- [ ] **2.4 The `User-Agent` carries the real version.**
      verify: test compares it with `package.json`.
- [ ] **2.5 Count the requests.** The daemon logs usage requests per account per
      hour, and `doctor --json` returns the last 24 h.
      verify: test with a fake clock. This is the measure for the acceptance below.

## Phase 3 — Readings that cost no request (F13, F10)

- [ ] **3.1 Read Claude Code's own cache.** Gated on 0.1 = pass. A profile's
      `.claude.json` usage cache becomes a source, tagged `source: "host-cache"`,
      and only when its account stamp matches the profile's identity. The newest
      source wins; a source that lacks a window never deletes one another source has.
      verify: fixtures from the 0.1 record; a mismatched stamp is ignored.
- [ ] **3.2 Skip the poll a local reading makes unnecessary.** An account whose
      newest reading is younger than the pool cadence is not polled.
      verify: with 2.5, a profile with a working session shows 0 usage requests
      per hour in a daemon test.
- [ ] **3.3 The host's word counts.** `StopFailure` with `rate_limit` marks the
      account "the host says it is at its limit". The mark ends with a later
      finished turn in that profile, or with a reading under the threshold after
      a reset. `authentication_failed` marks "sign in again" at once. `dir`
      skips a marked account with that reason. Nothing is switched.
      verify: tests for set, clear by `Stop`, clear by reset, and no clear by time alone.
      Pattern: clauth's refusal record, which a later successful turn clears
      (`wiki/Auto-Switch.md`, "Running it").
- [ ] **3.4 Only if 0.1 fails:** reopen
      `later/road-to-agent-switch-statusline-usage.md` at its Phase 0. Nothing is
      duplicated here. Note for that roadmap: the status line carries the 5-hour
      and 7-day windows only, for Pro and Max, after a session's first response.

## Phase 4 — Paid usage is named (F7, DP3)

- [ ] **4.1 Parse `extra_usage` and `spend`.** Defensive, into one optional
      block on the snapshot: on/off, used, limit, currency, percent. Unknown
      shapes yield no block.
      verify: fixtures for on, off, off-with-stale-limit and absent.
- [ ] **4.2 Say which of the two happens at the limit.** The protection notice,
      the session row and `status` say "continues on paid extra usage (31 of 50
      USD)" or "stops at the limit". The pick never treats paid usage as room.
      verify: notice tests; a property that no pick changes when only the block changes.

## Phase 5 — Files that survive two writers (F8)

- [ ] **5.1 One helper for shared JSON.** Write to a temp file, then rename;
      read-modify-write under `withFileLockSync`. The daemon state and the usage
      history use it.
      verify: a test with two processes appending history 200 times each → 400
      samples before trimming, never a parse error on a concurrent read.
- [ ] **5.2 The hook ring on `main`.** Take the append-only writer from
      `dev/v3`. Skip this step if v3 has become `main` first.
      verify: the two-process test from 5.1 against the ring.
- [ ] **5.3 Keep it that way.** A lint test fails on `fs.writeFileSync` to a
      path under the agent-switch root outside the helper, with a short allowlist.
      verify: the test goes red when `src/daemon.ts:181` is restored.

## Phase 6 — A profile that says what it lacks (F12, F11)

- [ ] **6.1 `agent-switch mcp-status [--json]`.** Per profile: the user-scope
      MCP servers its source defines, which of them the profile has, and for
      which a login is stored. Names and yes/no only. `doctor` gets one line.
      verify: `--json` schema test with no field that can hold a token; a
      profile with a missing login is listed.
- [ ] **6.2 Definitions follow, if the owner takes DP4.**
      verify: a definition with a secret-shaped `env` or header value never travels.
- [ ] **6.3 Sign in where it is missing (DP5).** From the readout, start the
      official client under that profile for the sign-in. No token is read or written.
      verify: test with a stub `claude` records the config dir it was started with.
- [ ] **6.4 Rebind and MCP logins.** From the 0.3 record: if a rebind replaces
      the session's MCP logins, say so in the rebind dialog and in `--when-idle`.
      verify: dialog test asserts the sentence.
- [ ] **6.5 History link.** Only if 0.2 shows prompts: choose the fix from the
      record. Candidates: point auto memory at the resolved directory through
      the profile's settings, or warn in `share on --history` and `doctor`.
      verify: the 0.2 scenario repeated, no prompt, or the warning shown.

## Phase 7 — A download that is what the release published (F9)

- [ ] **7.1 Check before the first start.** Gated on 0.5. Compare size and
      SHA-256 with the release's asset digest. A mismatch deletes the file,
      refuses the start and keeps the cached version.
      verify: test with a corrupted artifact → refused, cached version started.
- [ ] **7.2 DP6** goes to `later/road-to-a-trusted-install.md` as one line.

## Order

Phase 0 runs first and in parallel. Then 1.1 and 1.2, which need no gate.
Phase 2 before Phase 3, because 3.2 is measured with 2.5. Phases 4, 5 and 7 are
independent. 1.3 waits for 0.4, Phase 6 for 0.2, 0.3 and the owner's DP4/DP5.

## Not in this roadmap — where each clauth capability goes

| clauth capability | Disposition |
|---|---|
| Fallback chain, burn-aware switching, `--with-fallback`, weekday home account | `declined`: `skipped/road-to-agent-switch-autoswitch-rejected.md`; owner rule, no automatic switch |
| Own refresh grant (`src/oauth.rs:27`) | `declined`: ADR-004 |
| Claude Code's `User-Agent` on usage reads | `declined`: NON-GOALS, no impersonation. Phases 2 and 3 are the answer |
| `auto_start` pings and the interleaving queue; `usage_probe` through a model request | `declined`: spends quota to shape or read windows |
| `daemon --listen` REST API, device pairing, phone approvals, terminal streams | `declined`: NON-GOALS, nothing listens on a port |
| `delegate` over MCP | `already-planned` in its confirmed form: `road-to-long-lived-tokens-and-mcp-switching.md` Phase 3 |
| `start --isolated` (auth only, no memory, plugins, hooks) | `parked`: a clean config dir needs a login in it; possible without a copy once that roadmap's step 1.2 injects the token by environment |
| In-place credential swap, `.claude.json` and `settings.json` reconcilers | `not needed`: one live config dir per profile; `src/claude-settings.ts` and `src/follow.ts` cover settings |
| Token and cost dashboard, durable day ledger | `declined for now`: no defect here; revisit if the owner wants spend per account |
| Incident feed from status.claude.com | `declined for now`: one more host; revisit if 2.1 shows unexplained `provider-error` runs |
| `cleanupPeriodDays` put-back (`src/retention.rs`) | `checked, no defect`: profiles own their stores and the settings sync carries the key |
| Tier detection, canceled plans | `already-planned`: `road-to-the-ready-remainders.md` 3.8 on `dev/v3` |
| minisign-verified self-update | `not needed`: the CLI updates through npm with provenance; the app download is Phase 7 |
| File-system watcher instead of 2 s timers | `parked`: no measured cost |

## Risk register

| Rank | Risk | Mitigation | Phase |
|---|---|---|---|
| 1 | 1.3 sends a start to an account the host then refuses | unknown model keeps today's rule; ledger replay first; 3.3 marks the refusal | 1 |
| 2 | `.claude.json`'s cache is stale or changes shape | spike gate; account stamp check; newest-wins merge keeps the poll as fallback | 3 |
| 3 | The attempt record blocks reads for too long | 30-min cap; a changed login lifts it, as the backoff's stamp does today (`src/daemon.ts:298-302`) | 2 |
| 4 | A host mark never clears | two clear paths; shown with its age in `dir --json`; `doctor` lists marks | 3 |
| 5 | The wrapper change reaches only new shells | `doctor` check; old form keeps working | 1 |
| 6 | The lint test blocks legitimate writes | allowlist with a reason per entry | 5 |

## Acceptance

- [ ] AC-1 — Proof cases 1 to 3 give the corrected results on `main` and `dev/v3`.
- [ ] AC-2 — With a throttled account, daemon, CLI and app together make no
      usage request before `notBefore` (2.2), and every surface names the reason (2.3).
- [ ] AC-3 — Usage requests per account per hour (2.5), measured over one working
      day before Phase 2 and after Phase 3, are reported as two numbers in the
      PR. No target is set before the first measurement exists.
- [ ] AC-4 — No file under the agent-switch root is written outside the helper,
      except the allowlist (5.3).
- [ ] AC-5 — `agent-switch mcp-status --json` names every missing MCP login and
      carries no token (6.1).
- [ ] AC-6 — A corrupted app download is never started (7.1).
- [ ] AC-7 — Each of the five spikes has a dated record, including the failed ones.

## Sources

- agent-switch `main` @ `c3ca61d`, `dev/v3` @ `56e5f4d`; clauth @ `19a028b`.
- Claude Code docs: status line (`rate_limits`: `five_hour`, `seven_day`,
  `spend_limit`; Pro and Max; after the first response), hooks reference
  (`StopFailure`: output ignored), legal and compliance ("Authentication and
  credential use"), read 2026-11-23.
- anthropics/claude-code issues #31637, #30930, #77477 (usage endpoint 429).
- contextbolt.com Claude usage checker: Claude Code saves its limits in
  `.claude.json` each time it checks them. Second, independent pointer to F13.
- dev.to "One brain, two wallets": MCP OAuth tokens and `.claude.json` are per
  config dir.
