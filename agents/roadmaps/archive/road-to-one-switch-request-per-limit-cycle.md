---
complexity: small
status: ready
---

# Roadmap: one switch request per limit cycle

> Found 2026-11-07 from the agent-config side while building its Phase 4
> (`road-to-a-link-with-agent-switch` in `event4u-app/agent-config`). The link
> contract promises that "raising twice in one limit cycle returns the existing
> request instead of a second one"; on 2.13.2 it does not.

## Evidence

On one machine, 2026-11-07, `agent-switch switch list --json` reported **115
open requests**. Many name the same session, the same window and the same
reason (`claude/MathiasB/<session> at 90% of seven_day`), each under a
different id. Two of them, same session, same window:

| id | `reason.resetsAt` |
|---|---|
| `cd65cd4f4dd9ad14` | `2026-11-07T18:00:00.373531+00:00` |
| `2f85b9b821e796c4` | `2026-11-07T17:59:59.892533+00:00` |

Both are `raisedBy: as-daemon`.

## Cause

`requestId` (`src/link/requests.ts:67-68`) hashes the **raw** `resetsAt`
string. The host reports the reset of one window with sub-second jitter from
poll to poll, and here across a second boundary, so every poll that sees the
window over its threshold derives a new id and `raise`
(`src/link/requests.ts:111-131`) finds no existing request. The daemon raises
per poll (`src/link/raise.ts:42`), so the duplicates grow with uptime.

## Phase 1 — One request per cycle

- [x] **1. Normalise the reset before it names a request.** In `requestId`,
      hash `resetsAt` rounded to the nearest minute (an unparseable or `null`
      value stays as it is). Rounding to whole seconds is not enough: the
      evidence above straddles a second boundary. The stored
      `reason.resetsAt` stays as observed.
      verify: `tests/link-requests.test.ts` — two raises whose `resetsAt`
      differ by under a second, across a second and across a minute
      boundary (`17:59:59.892` / `18:00:00.373`), return one request with
      `created: false` on the second; two resets an hour apart stay two
      requests.
- [x] **2. Settle the duplicates already on disk.** Requests that now map to
      the same normalised id: keep the oldest open one, mark the rest
      `expired` (written back, like `settle`), so the app stops asking the
      same question many times.
      verify: test over a store holding the two requests above.
      Done in `RequestStore`: `list()` settles them, and `raise()` finds a
      cycle stored under its old id, so a declined cycle stays declined.
- [x] **3. Contract note.** The link contract lives in agent-config
      (`docs/contracts/agent-switch-link.md` § Identity and deduplication);
      a one-line amendment there names the normalisation, so both sides read
      "one request per cycle" the same way.
      Done: event4u-app/agent-config#2918.

## Out of scope

Changing when the daemon raises, or the candidate list. agent-config already
claims its own raise once per `(account, window, resets_at)`; this fixes the
agent-switch side, where the app shows the duplicates.
