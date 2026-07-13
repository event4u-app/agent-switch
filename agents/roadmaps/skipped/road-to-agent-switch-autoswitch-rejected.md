---
complexity: lightweight
status: draft
---

# Roadmap: Rejected capabilities — automated rotation & cookie-snapshot switching

> Deliberately-not-built ideas from the claude-swap analysis and the Chrome
> "Claude Account Switcher" extension, captured so the reasoning survives and
> the questions are not relitigated from scratch.

**This roadmap is SKIPPED, not planned.** It lives in `skipped/` to preserve
the ideas and the rejection rationale. Every item is `[-] cancelled` — no
execution is intended. Reopening requires the `revisit-if:` condition on the
matching lock in
[`../road-to-agent-switch-gui-service.md`](../road-to-agent-switch-gui-service.md)
`## Rejected scope`.

## Goal (of the rejection)

Keep agent-switch clearly on the right side of Anthropic's (and OpenAI's / Google's)
usage policies: it separates contexts (private / work / client), it never pools
subscriptions to route around rate limits, and it never becomes decision-support
for doing so.

## Context

- Two sources proposed these capabilities: an external Python snapshot-switcher
  (its `autoswitch.py` engine) and a browser extension (cookie-snapshot
  switching + a usage bar wired for switch decisions).
- Council re-evaluation (claude-sonnet-4-5 + gpt-4o, 2 rounds, 2026-07-13):
  unanimous that the auto-rotation engine stays rejected; one member urged
  rejecting even the monitoring surface as rotation decision-support.
- Why capture instead of delete: the ideas are technically real and will be
  suggested again (forks, issues). A written lock with rationale is cheaper
  than re-arguing it each time.

## Phase 1: Automated / assisted account rotation — REJECTED

- [-] **Quota-watch auto-switch:** poll usage, switch to the account with the
      most headroom before hitting a limit. <!-- cancelled: usage-policy conflict — subscription pooling to circumvent rate limits -->
- [-] **Switch strategies** (`best` / `next-available`), hysteresis, cooldowns,
      adaptive poll cadence tuned for failover. <!-- cancelled: the failover engine itself is the violation -->
- [-] **Cross-account headroom ranking** — sort/label profiles by remaining
      quota. <!-- cancelled: this IS the rotation decision, minus the final switch() call -->
- [-] **"Switch to X" prompts / notifications** driven by another account's
      headroom. <!-- cancelled: notification optimized for the forbidden task -->
- [-] **Switch-on-limit** — auto-rotate when the active account hits its cap. <!-- cancelled: canonical rate-limit circumvention -->

**Why:** Anthropic's usage policy prohibits circumventing rate limits;
automated failover across pooled subscriptions is the textbook case. Building
the decision infrastructure (poll + persist + rank + notify) whose only
coherent purpose is choosing when to rotate is the same violation with extra
steps — the missing `switch()` call is not the line. The same reasoning applies
to Codex (OpenAI) and Gemini (Google) accounts.

## Phase 2: Cross-account usage history & ranking store — REJECTED

- [-] **Persisted cross-account usage store** feeding trend-based rotation
      decisions. <!-- cancelled: only consumer is rotation; own-profile history for display is allowed elsewhere -->
- [-] **Machine-readable cross-account usage output** (`--json` listing every
      account's headroom) that trivially scripts "pick the freshest account". <!-- cancelled: scripting surface for rotation -->

**Boundary (what IS allowed, built elsewhere):** one-shot own-usage display
(`status`), **active-profile** threshold notifications (the same info Claude
Code's native `/usage` shows), and **own-profile** 30-day history for a
sparkline. These are in
[`../road-to-agent-switch-gui-service.md`](../road-to-agent-switch-gui-service.md) — they
are not rotation infrastructure because they never compare accounts to choose
one.

## Phase 3: Cookie snapshot/restore switching (browser) — REJECTED

- [-] **Snapshot claude.ai cookies per account and restore on switch** (the
      Chrome extension's mechanism). <!-- cancelled: staleness-prone; persistent per-profile browser context is strictly better -->
- [-] **Cross-machine plaintext credential transfer** (the Python tool's
      `transfer`). <!-- cancelled: plaintext credential envelopes; security + staleness -->

**Why:** Not a policy issue — an architecture one. Cookie/credential snapshots
go stale on token rotation. agent-switch's `web` command already uses persistent
per-profile browser user-data-dirs (no extraction, no staleness), which is the
superior approach. Adopting cookie-swap would be a regression.

## Phase 4: OAuth token-refresh grant — REJECTED

- [-] **Refresh tokens from outside Claude Code** (the Python tool's token
      grant). <!-- cancelled: would rotate refresh tokens under live sessions for no benefit; keeps agent-switch off write paths -->

**Why:** agent-switch profiles are live logins that refresh themselves. Refreshing
from outside rotates the refresh token underneath a running session and can
invalidate it. Staying read-only (and only under Claude Code's locks) is a
deliberate invariant.

## Notes

- Non-rejected inspirations from the same sources were adopted — see
  `ADOPTED.md` (Python tool) and `EXTENSION-ANALYSIS.md` (extension). This file
  is only the rejected set.
- If Anthropic/OpenAI/Google ever publish an official multi-account or
  usage-pooling policy that permits automated rotation, or ship native profile
  switching, reopen via the `revisit-if:` on the active roadmap's lock — do not
  silently resurrect items from here.
