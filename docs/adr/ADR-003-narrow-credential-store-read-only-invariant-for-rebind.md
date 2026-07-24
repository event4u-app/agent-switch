# ADR-003 — Narrowing the read-only credential-store invariant to permit the `rebind` write path

- **Status:** Proposed (pending Phase-0 falsification evidence — this ADR is not
  Accepted until the r0* spikes pass against the installed Claude Code version)
- **Context roadmap:** `agents/roadmaps/road-to-live-rebind.md` (the feature that
  requires the write path) and
  `agents/roadmaps/skipped/road-to-agent-switch-autoswitch-rejected.md` (Phase 4,
  where the read-only invariant was locked)

## Context

Phase 4 of `road-to-agent-switch-autoswitch-rejected.md` locked a hard
invariant: agent-switch never writes Claude Code's credential storage — staying
read-only is a deliberate choice, not an accident. `src/credentials.ts` carries
no `write()` by design. The rationale was **staleness from refresh-rotation**: a
credential the harness holds is not a static secret but a token subject to
background refresh/rotation, and a snapshot agent-switch wrote back would go
stale the moment the running process rotated it — worse than not writing at all.

The `road-to-live-rebind.md` feature — an in-session account switch that reaches
any already-running terminal, not just newly-spawned ones — requires writing the
credential store that the running Claude Code process **re-reads**. This directly
collides with the Phase-4 lock.

The old premise underlying the lock was that "you can't re-point a live
process". That premise was wrong, and the correction is the whole basis for
reopening: agent-switch does not reach into the process's memory. It writes the
**credential store the process re-reads** on its next auth cycle. The unit of
change is the on-disk store, not the process — and that store is writable. What
the lock actually protected against (staleness) is a property of *how* you write,
not *whether* you may.

Per the decision-revisit gate, a genuinely beneficial change blocked by a
recorded past decision is surfaced and re-evaluated, not silently built against
the lock nor silently dropped. The changed condition is legitimate: the Phase-4
lock generalized "a naive snapshot write-back goes stale" into "never write",
and the `rebind` design defeats the staleness mechanism directly rather than
avoiding writes altogether.

## Decision

Narrow the invariant from "agent-switch never writes Claude Code's credential
storage" to **"agent-switch never writes Claude Code's credential storage
OUTSIDE the `rebind` path."** Everywhere else, `src/credentials.ts` stays
read-only exactly as before.

The write path is deliberately narrow and hard-gated:

1. **Exactly one module.** All credential-store writes live in the single
   `rebind` module — the "one named writer" shape mirroring the "one named
   reader" discipline of ADR-002. No other module gains a `write()`.
2. **Lock-held only.** The write is reachable only while Claude Code's own lock
   (`<config_home>.lock`) is held, so agent-switch never races the harness's own
   refresh/rotation cycle for the same store.
3. **Move-semantics.** The new credential is put in place by an atomic move, not
   an in-place mutate — the store is replaced whole, never partially written.
4. **Provenance-check.** The write proceeds only after verifying the store it is
   about to replace is the one it read (provenance), so a concurrent external
   change is detected rather than clobbered.
5. **Per-profile binding-marker.** A binding-marker records which account a
   profile is bound to, keeping the 1:1 profile↔account mapping honest and
   detectable (a profile can never silently point at the wrong account).

The original staleness rationale is **not refuted** — a naive snapshot write-back
would still go stale. It is **neutralized**: move-semantics plus a
freshen-under-lock write means the store agent-switch writes is the current one
at the moment the process re-reads it, not a decayed snapshot. That
neutralization is **gated by the Phase-0 spikes**: if the r0* falsification
spikes fail against the installed Claude Code version, the neutralization does
not hold and the honest-null fallback applies — **the read-only invariant stands
unchanged and `rebind` is not built.**

## Consequences

- The `rebind` write path is a **security-sensitive surface** — it writes
  credential storage — so the threat-model discipline applies before the code is
  written, and the change is not a routine edit.
- The per-profile binding-marker keeps the 1:1 profile↔account mapping honest:
  a profile bound to account A can be detected as such, so a `rebind` that would
  break the mapping is caught rather than silently applied.
- `CLAUDE_CONFIG_DIR` isolation stays the **primary** mechanism for keeping
  profiles apart; the credential-store write is the additive live-rebind path on
  top of it, not a replacement for isolation.
- The invariant text in `src/credentials.ts` and the Phase-4 roadmap lock are to
  be updated to name the single sanctioned exception, so the lock text and the
  code agree (the same lock-text-follows-code discipline ADR-002 applied).
- If Phase-0 falsification fails, none of the above lands: the ADR closes as an
  honest null and agent-switch remains read-only.

## Alternatives considered

- **Local OAuth proxy** (Option 4 / OmniRoute-shape) — route the subscription
  OAuth flow through a local harness that presents a `claude-cli` identity.
  Rejected: highest compliance risk of any option — it spoofs the claude-cli
  identity and routes subscription OAuth through an intermediary, which is the
  path most likely to violate provider terms. Not adopted.
- **Keychain cookie / credential snapshot** — copy the credential out of the OS
  keychain and re-inject a snapshot. Rejected: staleness-prone — this is exactly
  the naive write-back the Phase-4 lock was written against, with no
  move-under-lock neutralization. Not adopted.
- **Keep the invariant absolute** — never write the credential store; accept that
  live rebind of an already-running terminal is infeasible and ship only the
  spawn-time path. This is the honest-null fallback if the Phase-0 spikes fail,
  not the primary path.

## References

- `agents/roadmaps/road-to-live-rebind.md` — the feature that requires the write
  path and defines the Phase-0 falsification spikes.
- `agents/roadmaps/skipped/road-to-agent-switch-autoswitch-rejected.md` (Phase 4)
  — the read-only invariant this ADR narrows.
- `src/credentials.ts` — the module the read-only invariant lives in; gains the
  single sanctioned `rebind` writer.
- `docs/adr/ADR-001-cross-provider-handoff-is-a-lossy-bridge.md` — the
  transcript-egress boundary and the "one named module" discipline this ADR
  reuses for the write path.
