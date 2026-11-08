---
complexity: structural
status: ready
relates:
  - slug: road-to-the-agent-config-link
    relation: extends
    note: "Reuses the switch request, the MCP link and the DecisionSheet; adds a second reason to ask."
  - slug: road-to-service-executed-moves
    relation: disjoint
    note: "Who executes an approved answer stays as decided there."
---

# Roadmap: limits that last the whole run

> **Source:** owner request 2026-11-07 (chat): when agent-switch sees accounts
> being used at different paces, it suggests moving a session to another
> account — in the app **and** in the conversation itself, through agent-config
> where that is the better path. Goal: the limits of all accounts are spread
> and used over the whole run, not one exhausted while another resets unused.
> v2 (`main`) and v3 (`dev/v3`).
>
> Owner decision (same turn): the trigger is a **pace imbalance between
> accounts**, not a single session that uses a lot.

## Constraints (do not relitigate)

- A suggestion never moves anything. A running session changes its account only
  after the user answers (`NON-GOALS.md` § No request-level routing;
  `road-to-the-agent-config-link` D1).
- One request object, one executor: a pace suggestion is a switch request like a
  limit request; whoever answers first, in AS or AC, decides for both.
- `switch_decide` stays a tool the host asks the user about — never on an
  auto-allow list, also not from the chat path.

## Ground truth (verified at `2ddd0db`, `dev/v3`)

| Fact | Source |
|---|---|
| Requests are raised only at the ask mark (90 %, below protection) | `src/link/raise.ts:11-21` (`ASK_AT_PCT`, `askWindow`) |
| Request reason carries `{window, fill, resetsAt}`, no kind | `src/link/requests.ts:41-48` |
| Dedup id = account + session + window + resetsAt | `src/link/requests.ts:113` (`requestId`) |
| "Need" = rest of the longest window ÷ hours to its reset | `src/balance.ts:1-45` (`weigh`) |
| Usage history is sampled at most every 55 min | `src/history.ts:33` (`HISTORY_MIN_GAP_MS`) |
| AS hooks report events only, never add context to a turn; no `UserPromptSubmit` | `src/hooks.ts:35` (`HOOK_EVENTS`) |
| Codex hooks: SessionStart, Stop, SessionEnd only | `src/codex-hooks.ts:28` |
| MCP tools `limits_get`, `switch_list`, `switch_request`, `switch_decide` exist | `src/link/mcp.ts` |

## Design

**Pace, measured.** For each account with a live session, per window with a
reset time: `burn` = fill change per hour over the recent captures (daemon
state + `usage-latest` + history, newest first, at least two points ≥ 30 min
apart); `etaFull` = hours until the protection threshold at that burn.

- **Too fast:** `etaFull < hoursToReset × 0.8` — it runs out well before reset.
- **Has room to spare:** a same-provider account, not busy, whose projected
  fill at its reset is below 60 % — that room would expire unused.
- **Ask** only when both exist. The request gets `reason.kind: "pace"` plus
  `etaFull` and, per candidate, `spareAtReset` (the % that would expire).

**Asked once per window.** The request id gains the kind, so a later limit ask
(`kind: "limit"`) still opens. A declined or snoozed pace request is not raised
again for that account until its window resets. At most one open pace request
per account.

**Setting `pace.suggest`** (state.json, default **on** — owner asked for it;
off = no pace requests, limit requests unchanged). Toggle in v2 and v3 settings
and `agent-switch pace on|off|status --json`.

**In the conversation — two paths, AC preferred.**

1. **With agent-config:** AC's prompt-time hook reads open requests for the
   calling session through the link (`switch_list` with `session`), shows the
   suggestion in the chat in plain words, and the agent answers through
   `switch_decide` after the user agrees. AS supplies the text-ready fields; the
   rendering lives in AC (counterpart roadmap there). Works for Claude and Codex.
2. **Without agent-config (Claude only):** an opt-in AS `UserPromptSubmit` hook
   that prints one line of context when an open request names this session,
   pointing at `agent-switch switch decide <id> …`. It stays silent when the AC
   link is connected, so the user never sees the suggestion twice.

**In the app:** a pace request is an attention item and a notification, not a
sheet that pops up — it is not urgent. Clicking it opens the existing
DecisionSheet, worded for pace ("<A> runs out in ~6 h, resets in 2 d; <B> would
lose 45 % at its reset").

## Phase 1 — Core on `main` (2.x)

- [x] **1.1 Burn rate.** `src/link/pace.ts`: `burnRate(account, window)` and
      `etaFull` from the captures named above; null with fewer than two usable
      points or after a reset between them.
      verify: red-first unit tests — steady burn, reset between points, too few
      points, flat usage (no ETA).
- [x] **1.2 Imbalance check.** `paceReason(...)` → `{kind:"pace", window, fill,
      resetsAt, etaFull}` or null, using the two marks; candidates carry
      `spareAtReset`, busy accounts never offered (`candidates.ts`).
      verify: tests — too fast + room → reason; too fast, every other account
      busy or full → null; both slow → null.
- [x] **1.3 Request kind.** `reason.kind` (`"limit"` default for old files),
      id includes the kind; decline/snooze of a pace request blocks re-raising
      until the window resets.
      verify: tests — old request files still read; pace and limit requests on
      the same window coexist; declined pace not raised twice.
- [x] **1.4 Daemon raises pace requests** next to the limit branch, gated by
      `pace.suggest`.
      verify: daemon test — imbalance with a live session → one open pace
      request; second tick → same id; setting off → none.
- [x] **1.5 Setting + CLI.** `pace on|off|status --json`.
      verify: CLI tests for JSON shape and persistence.
      `needs` does not exist on 2.x; listing a pace request as its own kind there
      moved to 4.2.

## Phase 2 — The conversation (`main`)

- [x] **2.1 Link fields.** `switch_list` filters by `session`; each request
      carries `summary` (one plain sentence) and `kind`; `limits_get` adds
      `burnPerHour`/`etaFull` per window. Old fields kept; the contract stays
      `1`, because the additions are not breaking and agent-config treats any
      other number as no link.
      verify: MCP spawn test over stdio for the filter and new fields.
- [x] **2.2 Own chat hook (Claude, opt-in).** `UserPromptSubmit` relay prints
      the context line for an open request on this session; silent when the AC
      link is connected or `pace.suggest` is off; hook install/uninstall through
      the existing hook manager.
      verify: hook test — open request → one line; AC connected → nothing;
      no request → nothing; never blocks the prompt (exit 0 on any error).
      Done as `agent-switch hooks chat on|off|status`. With `pace.suggest` off
      only pace requests go quiet; a limit request still gets its line.
- [x] **2.3 Counterpart in agent-config.** Note in AC's
      `road-to-a-link-with-agent-switch` that the prompt-time hook renders pace
      requests from `switch_list` (session filter, `summary`) and routes the
      answer through `switch_decide`.
      verify: the note exists in the AC repo (separate PR there).
      Done: Phase 6 of the AC roadmap, event4u-app/agent-config#2916.

## Phase 3 — App on `main` (v2 redesign)

- [x] **3.1 Attention item + notification** for pace requests; the sheet opens
      on click with the pace wording; answering records through `switch decide`.
      verify: GUI unit tests — pace request does not auto-open the sheet; click
      opens it; answer in AC removes the item.
- [x] **3.2 Settings toggle** "Suggest a switch when accounts run at different
      paces".
      verify: settings test round-trips via CLI.

## Phase 4 — v3 (`dev/v3`)

- [x] **4.1 Merge phases 1–3 into v3**, resolve against the v3 DecisionSheet and
      service-executed moves.
      verify: full test suite on v3.
      v3 takes 2.x changes as their own commits, not a merge of `main`: the
      three feature commits were cherry-picked onto `dev/v3`.
- [x] **4.2 v3 attention item and wording** in the DecisionSheet; `needs` lists
      a pace request as its own kind.
      verify: `gui/src/v3/adapter` test for a pace request.
- [x] **4.3 Toggle in v3 settings.**
      verify: v3 settings test.

## Phase 5 — Docs

- [x] **5.1** `NON-GOALS.md` § No request-level routing names the pace
      suggestion; README row; Starlight "Working with agent-config" gets the
      chat path; a short guide section on pace.
      verify: starlight build.

## Decisions

| # | Decision | Why | Revisit if |
|---|---|---|---|
| D1 | Trigger = pace imbalance between accounts | Owner, 2026-11-07 | single-session hogs turn out to be the real cause |
| D2 | Marks: too fast at `etaFull < 0.8 × resetH`, spare below 60 % projected | Agent call; asks early enough to matter, rarely enough not to nag | users decline most pace requests |
| D3 | `pace.suggest` default on | Owner asked for the behaviour; it only suggests | it proves noisy |
| D4 | Pace = attention item, not an auto-opening sheet | Not urgent; the limit sheet stays the interrupting one | users miss pace suggestions |
| D6 | Pace ignores windows resetting within 6 h; a poll at the ask mark raises the limit ask instead | The 5h window fills during any real session and would flag every session; near the limit the limit ask already speaks | short windows turn out to be where the imbalance shows |
| D5 | Chat via AC first; own Claude hook only as fallback, silent when AC is connected | One voice in the chat; Codex has no prompt hook | AC link is off for most users |
