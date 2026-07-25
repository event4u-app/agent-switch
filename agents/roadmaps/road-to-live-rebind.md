---
complexity: standard
status: in-progress
---

# Roadmap: live account rebind (in-session switch, any terminal)

> Switch the account under a **running** Claude Code session — iTerm, PhpStorm,
> VS Code, any terminal — without touching the process. The mechanism is a
> credential-store swap the process re-reads on its own, not process control and
> not a proxy. In the same move: retire the automatic quota-rotation, and replace
> it with a policy-compliant "limit is near" notification that offers a **manual**
> switch (accept → switch to a chosen profile; cancel → carry on).
>
> This supersedes the earlier "Option 4 / local OAuth proxy" direction. A proxy
> that routes subscription OAuth through a local harness (OmniRoute-shape) is the
> highest-compliance-risk option; `rebind` reaches the same in-session goal with
> no proxy and no `claude-cli` identity spoofing.

## Why the old premise was wrong (the enabling insight)

The assumption "a running CLI process cannot be re-pointed" is false. It is not
the **process** that changes — it is the **store the process re-reads**. Claude
Code re-reads its OAuth credential at runtime; swapping which account sits in a
profile's store therefore reaches every already-running session, regardless of
which terminal launched it. `CLAUDE_CONFIG_DIR` isolation stays — it remains the
differentiator for clean parallel logins. `rebind` is a **second, explicitly
tracked** operation beside it: isolation decides *which dir new processes get*;
rebind decides *which account sits in a profile's store right now*.

## Out of scope — hard boundary (the compliance line)

Owner compliance decision (2026-07-24): **switching is allowed and needs only a
USER INTERACTION; the sole forbidden case is a FULLY-automatic switch (no user
interaction).** Anthropic permits multiple accounts and switching between them;
tools may switch on user interaction, no notice required. This **supersedes** the
stricter reading of the 2026-07-13 autoswitch lock (which forbade even a
headroom-ranked suggestion) — superseded on the owner's call, recorded here.

**Forbidden (out of scope):**
- **Fully-automatic switch** — the daemon, or anything, changing the active
  account / rebinding a session **without a user interaction**. This is the one
  thing Phase 3 removes.
- **Local OAuth proxy + MITM (CA/DNS) front-end** — not this roadmap.

**In scope (allowed — because it is user-interaction-gated):**
- A modal/popup the user clicks to switch — easy, one interaction.
- Showing usage and **pre-selecting the best-headroom profile** in that modal: the
  user interaction is the compliance guarantee, so the suggestion is a convenience,
  not automated rotation. `pickSwitchTarget` is therefore **kept** (repurposed to
  compute the modal suggestion), not removed.
- An active-profile threshold notification that offers the switch.

The one invariant: **no switch without a user interaction.**

## Ground truth (to VERIFY in Phase 0, per the installed CC version)

Claude Code's credential storage is an **internal contract, not an API** — every
claim below is a Phase-0 falsification gate, re-pinned per CC version by a canary
(risk #1). Source-class column: `verified (agent-switch)` = read in this repo;
`claim (claude-swap c89e6f9)` = read in the comparison tool, to be re-verified here.

| Fact | Detail | Source class |
|---|---|---|
| Runtime re-read | CC re-reads its OAuth credential during a session; it does not hold the launch-time token forever | claim (claude-swap `utils/auth.ts`) |
| Refresh lock | CC guards its OAuth refresh with `proper-lockfile`: a **directory** `<config_home>.lock` (mkdir-atomic mutex, stale after 10s, holder touches ~every 5s) | claim (claude-swap `claude_locks.py`, `utils/lockfile.ts`) |
| Linux/Windows pickup | credentials in `.credentials.json`; a change is re-read → new account takes effect on the **next message**, no restart | claim (claude-swap `credentials.py`) |
| macOS pickup | Keychain read with ~30s cache → running session adopts the swap once the cache expires | claim (claude-swap) |
| Store-clobber race | the only real race: a swap landing inside CC's refresh window gets overwritten by the refreshed old token. Closed by swapping **under CC's own lock** — CC's double-checked re-read then sees the fresh, non-expired token and aborts its own refresh | claim (claude-swap `switcher.py:4308`) |
| Token-family single-store | one token family must live in exactly one store → **move, never copy**; provenance-fingerprint before attributing a live credential to a slot (issue #117) | claim (claude-swap `switcher.py:4544`) |
| Deterministic keychain name | `Claude Code-credentials-<sha256(NFC(dir))[:8]>` — path is NFC-normalized, unresolved | claim (claude-swap `session.py:164`); **already present** as `serviceNameFor()` in `keychain.ts` (verified, agent-switch) |
| Structural advantage | rebind keeps cwd **and** config-dir constant; only the credential inside the store changes — no path/session remap needed | verified (agent-switch) |

## Conflict A — the read-only invariant is narrowed, not deleted (ADR-revisit)

Phase 4 of the rejection is explicit: *"agent-switch never writes Claude Code's
credential storage … staying read-only is a deliberate invariant"* (`credentials.ts`
carries no `write()` by design). `rebind` writes the store, so the invariant
changes — **consciously**, via an ADR, never silently:

- New wording: *"agent-switch never writes Claude Code's credential storage
  **outside the `rebind` path**."*
- The write path lives in **exactly one module**, reachable **only** while CC's
  lock is held, with **move-semantics + provenance-check + binding-marker** as
  hard preconditions.
- The original rationale (staleness from refresh-rotation under a live session)
  is **not refuted** — it is neutralized by the move + freshen-under-lock
  mechanics. That neutralization is a Phase-0 gate: if the spike cannot show
  clean usage attribution after a swap-under-lock against the installed CC
  version, **the invariant stands and this roadmap ends with an honest null.**

## Council review (deep, 2026-07-24) — incorporated

Reviewed at deep tier (claude-sonnet-4-5 + gpt-4o, design lens; cost $0.12;
responses in `agents/runtime/council/responses/live-rebind-review.json`).
**Caveat:** the Sonnet response confabulated line numbers and non-existent
"prior rounds" / "Phase -1"; those citations are discarded — the concerns below
are kept on merit only.

- **Convergence:** CC-internal-contract reliance needs a drift-response + rollback,
  not just "fail loud"; the Phase-0 honest-null gate is correctly placed;
  **compliance is the real gate** — a quota-triggered switch may cross policy even
  when manual.
- **Incorporated:** finding 1 → ADR now gates the write module (Phase 1 before
  Phase 2); finding 2 → global binding registry + lock (Phase 2); finding 3 →
  canary drift-response matrix (Phase 0); finding 4 → R0.6 cross-version skew
  (Phase 0); finding 5 → fingerprint-mismatch states (Phase 2).
- **Finding 6 (compliance) — resolved by the owner (2026-07-24), NOT via an
  Anthropic-guidance gate.** The council feared a quota-triggered manual switch
  might cross single-user-per-subscription. The owner's ruling sets the line at
  **user interaction**: a modal the user clicks is compliant, no Anthropic notice
  needed; only a fully-automatic switch is forbidden. The Phase-4
  Anthropic-guidance gate is removed; the invariant becomes "no switch without a
  user interaction" (§ Out of scope).
- **Dissent noted:** Sonnet maximalist ("resolve Anthropic's stance before Phase 0");
  gpt-4o moderate and sides with the roadmap that the macOS ~30s latency is
  non-critical. Adopted the moderate read; the owner's user-interaction line
  settles the compliance question the maximalist raised.

## Phases

### Phase 0 — Falsification spikes (the gate; `scripts/spikes/r0*`)

Same pattern as the `g0*` session-handoff spikes: self-contained, explicit
PASS/FAIL, honest-null path, throwaway accounts in `mktemp` cwds, no real
projects touched.

- [x] **Spike scaffolding authored** — `scripts/spikes/r01-r04` + README
      result-matrix (`bash -n` + shellcheck clean, executable, safe-by-construction:
      refuses without two throwaway account args, `mktemp` cwd, arg1-store
      backed-up+restored via trap, arg2 read-only, honest-null exit codes;
      authored 2026-07-24, not run). The R0.* gates below stay open — they are the
      **runs**, which require two throwaway logged-in accounts against CC 2.1.218.
- [~] **R0.1 (Linux/Win live-reload):** N/A on this macOS host — deferred to a
      Linux/Win machine. `rebind` must not ship on those platforms until R0.1
      passes there (the `.credentials.json` file backend is unproven).
- [x] **R0.2 (macOS keychain pickup):** PASS (2026-07-24, CC 2.1.218) — two
      distinct accounts (arg1 `matze.b@`, arg2 `m.berg@`); baseline ran on arg1;
      the Keychain swap under CC's lock landed; the next turn ran on **arg2**.
      Latency: fresh `claude -p` instant; long-lived session ≤ ~30s cache —
      non-critical in the manual flow.
- [x] **R0.3 (lock-protocol correctness):** PASS — (a) lock is a real mutex
      (rejects a second acquire; a >10s-stale lock is taken over); (c)
      move-semantics (store empty between move-out/in; one family in one store);
      (b) no old-token clobber after a turn. Note: CC's own "abort my refresh"
      branch is **inferred** from (b)'s effect, not observed directly.
- [x] **R0.4 (freshening):** PASS — token >10 min → no freshen; profile endpoint
      200; safe to swap directly. Dead-token quarantine branch drilled via
      `--force-quarantine`.
- [ ] **R0.6 (cross-CC-version skew, Council finding 4):** rebind lives across CC
      auto-updates, so R0.1–R0.4 only prove the *installed* version. Re-run them
      after a CC update, OR — if that cannot be scripted — declare version-skew an
      explicit go/no-go (rebind ships with a hard CC-version pin + refuse on
      mismatch).
- [ ] **Canary + drift-response matrix (Council finding 3):** pin the observed lock
      protocol + keychain naming + cache TTL for the current CC version; on drift,
      "fail loud" is defined by a matrix — drift type → severity → action →
      user-facing message (e.g. keychain-name format changed → hard-refuse rebind +
      surface "CC credential layout changed, rebind disabled pending
      re-verification"). No silent degradation.

Result matrix → consequence: **macOS gates R0.2–R0.4 PASSED (2026-07-24, CC
2.1.218) → ADR-003 Accepted (Phase 1); the write module (Phase 2) may build for
the macOS Keychain path.** No FAIL/null fired, so the honest-null fallback did not
trigger. Linux/Win (R0.1) + cross-version skew (R0.6) remain open and gate
shipping on those platforms.

Security: read/write against CC's own store under its lock; throwaway accounts only.

### Phase 1 — ADR-003 gate (decide BEFORE the write path is built)

Per Council finding 1: the ADR must **gate** the invariant change, not chronicle
it after merge. Drafted now; Accepted only once Phase 0 passes; the write module
(Phase 2) does not start until it is Accepted.

- [x] Wrote `docs/adr/ADR-003-narrow-credential-store-read-only-invariant-for-rebind.md`
      (Status: **Proposed**, not Accepted until the Phase-0 spikes pass): the
      conscious revisit of the Phase-4 read-only lock — context, narrowed wording,
      move+freshen+lock mechanics that neutralize the staleness rationale, the
      Phase-0 gate, and the honest-null fallback. (ADR index: N/A — agent-switch
      keeps no `docs/adr` index file; ADR-001/002/003 are standalone.)
- [x] Phase-0 (macOS) passed → ADR-003 flipped to **Accepted** (2026-07-24).
      Deferred: update the invariant text in `src/credentials.ts` + the Phase-4
      lock to name the single exception (ships with the Phase-2 write module).

### Phase 2 — `agent-switch rebind <account> [--profile <p>]` (the one write module)

Gated on ADR-003 **Accepted** (Phase 1) + Phase 0 green. **Core slice landed
2026-07-24** — `src/rebind.ts` (the single write path), `keychain.addPassword`
(the one new write primitive), `credentials.ts` invariant comment updated to name
the exception, wired into `index.ts`; 9 unit tests + tsc + suite green (54 pass).
Follow-up slices stay open below.

- [~] Resolve the running session's config-home. Landed: `--profile <p>` explicit
      + default to the active profile. Deferred: live pid/process **auto**-detection
      (`hooks.ts` gives only a config-dir→profile decode; a live-process lookup is
      net-new).
- [x] Acquire CC's lock (`withProperLock` on the config dir; ~9s timeout) before
      any mutation — unit-tested (lock precedes the first write).
- [x] **Global binding registry + global lock (Council finding 2):** registry at
      `<ROOT>/.agent-switch-rebind-registry.json`, guarded by a **global** lock
      (outer to CC's per-profile lock). `rebind()` refuses if the account is already
      bound to another profile; `restoreRebind()` clears the entry. Unit-tested.
- [x] Freshen guard (R0.4): refuse a target < 10 min to expiry — no token minting;
      unit-tested. *(a real refresh grant is a follow-up; the guard ships now.)*
- [x] **Move-semantics** (macOS): target credential moved INTO the running store
      (`serviceNameFor()` + `security add-generic-password -U`), the target store
      emptied (Keychain entry deleted, plaintext file moved aside — never deleted),
      both originals stashed in the marker BEFORE any mutation. Linux/Win backend
      deferred (R0.1). Unit-tested.
- [x] **Provenance-fingerprint mismatch states (Council finding 5):**
      `accountFingerprint()` (a stable claim, else a hash excluding volatile token
      material). At swap + restore the live store content is re-read + compared:
      same/rotated-token → proceed; different account → **quarantine** (stash aside,
      no clobber, throw); unparseable → **refuse**. Unit-tested (all three).
- [x] Per-profile **binding-marker** stashing both originals — keeps the 1:1 mapping
      honest + recoverable after a crash. Unit-tested.
- [x] **Rollback / kill-switch (Council convergence):** `State.rebind =
      {disabled, consecutiveFailures}`; `rebind()` refuses when disabled, trips at
      3 consecutive failures, resets on success; `restoreRebind()` still works
      (recovery). CLI `agent-switch rebind --reset` clears it. Unit-tested.
- [x] `agent-switch rebind --restore [--profile <p>]` — reverses the swap (both
      stores restored, target file returned, marker cleared). Unit-tested.
- [x] UX expectation printed: fresh process instant, long-lived session ≤ ~30s
      (Keychain cache). macOS-only; **refuses on Linux/Win** (R0.1 unproven).

Security: this is the narrowed-invariant write path — gated by ADR-003 Accepted + Phase 0.

### Phase 3 — Retire the FULLY-automatic switch (keep notify + suggestion)

The forbidden thing is a switch **without user interaction**. Remove exactly that;
keep the notification and the headroom **suggestion** (which now feeds the
user-clicked modal, per § Out of scope).

- [x] Removed the daemon's **automatic `setActive(target)` on threshold**
      (`daemon.ts`) — the fully-automatic act. The threshold path now only
      **notifies** (naming the suggested target). Verified: `setActive` gone from
      the daemon; tsc + daemon/cli-e2e/gui tests green (65 + 116 pass).
- [x] **Kept `pickSwitchTarget`** (`usage.ts`) — repurposed (docstring updated) to
      compute the suggested target for the notification + the Phase-4 modal.
- [x] Kept **own-profile** threshold notifications and the Codex-reset-redeem-then-
      stay path (it does not rotate accounts).
- [x] Re-shaped the `autoswitch on/off/threshold/tag` help (CLI + GUI copy) from
      "auto-switch" to "**notify + suggest; never switches automatically**". The
      failover `SwitchStrategy` is marked **deprecated (no switching effect)** in
      help; plumbing kept — full type removal deferred (below).
- [ ] Update `skipped/road-to-agent-switch-autoswitch-rejected.md` +
      `road-to-usage-reliability-and-portability.md` "Out of scope" notes to the
      owner's user-interaction line. *(deferred — recorded-decision doc edit, done
      deliberately, not autonomously)*
- [ ] **Follow-up: regression test** — assert the daemon notifies + never calls
      `setActive` on threshold (needs `pollProvider` exported + an ESM mock harness;
      the daemon internals are currently untested — flagged by the Phase-3 impl).
- [ ] **Follow-up: residual copy** — the per-tab status-dot tooltip + Settings tab
      label still read "Auto-switch"; align to "notify near limit".

Security: net compliance improvement — removes the only fully-automatic path;
switching becomes user-interaction-only.

### Phase 4 — Limit dialog (CLI first) — user-interaction-gated

CLI-first landed 2026-07-25 — `agent-switch rebind` (no `<account>` arg) is the
interactive picker (`src/rebind-dialog.ts` = pure model + `readline` shell); 11 tests.

- [x] Active-profile threshold-near → notify — the daemon's "Usage limit near"
      message now names `agent-switch rebind` (the dialog) + the suggested profile.
- [x] Offer a switch via a picker the **user selects** → on pick, `rebind` to the
      chosen profile. The explicit selection IS the compliance line.
- [x] The picker shows per-profile usage and **pre-selects the best-headroom
      profile** (owner decision — user-interaction-gated). The user can pick any.
- [x] Cancel (`q` / Ctrl-C / empty-with-no-suggestion) → stays on the current
      profile; the dialog never switches on its own. Non-TTY → prints the exact
      command, no hang.
- [x] Left the separate `agent-switch status` / GUI usage panel untouched.

Security: the one invariant — **no switch without a user interaction** (§ Out of
scope). No Anthropic-guidance gate (owner resolved finding 6).

### Phase 5 — GUI parity (later)

- [ ] Mirror the compliant limit dialog in the Tauri app (the `EmbeddedTerminal`
      path already runs `rebind`-shaped interactive flows).

### Phase 6 — Other providers (gated, later)

- [ ] Per-provider ground-truth table before any rebind parity. Codex has no
      usage readout (identity only) and different credential mechanics; Antigravity
      has no session store. No parity is assumed from the Claude spike.

## Risks & rules

1. **Internal CC contract, not an API (#1 risk).** Every ground-truth row is a
   Phase-0 gate + a per-version canary. Lock protocol, keychain naming, and cache
   TTL can change on any CC release — fail loud on drift.
2. **One write module, always under CC's lock.** No credential-store write escapes
   the `rebind` path; the narrowed invariant is enforced by module boundary.
3. **Move, never copy.** One token family in exactly one store; provenance-check
   before attributing a live credential to a slot (issue #117).
4. **Policy line (owner, 2026-07-24).** Any switch requiring a **user interaction**
   is fine — including a limit-triggered modal that pre-selects the best-headroom
   profile. The sole forbidden case is a **fully-automatic** switch (no user
   interaction). No Anthropic notice required.
5. **macOS latency is a feature-note, not a blocker.** In the manual flow the
   ~30s Keychain cache is harmless; the token **freshening** step is still
   mandatory.

## Provenance (verified claims)

- Mechanism source: `claude-swap` (c89e6f9) — `credentials.py:691` (mtime
  re-read), `switcher.py:4308` (swap under CC locks), `:4544` (#117 provenance),
  `session.py:164` (deterministic keychain name).
- agent-switch (verified in-repo): `keychain.ts` `serviceNameFor()`;
  `credentials.ts` read-only invariant; `daemon.ts:353-390` current rotation +
  `pickSwitchTarget`; `hooks.ts` pid→profile mapping.
- Comparison context: `cc-switch` (settings.json env hot-reload, API-keys, not
  subscription OAuth); `OmniRoute` (local-proxy route — the superseded, highest-
  risk option). Full deep-dive lives in the session record, not tracked here.
- Lock: `skipped/road-to-agent-switch-autoswitch-rejected.md`; council 2026-07-13.
