# ADR-002 — Session preview is a second sanctioned, bounded transcript reader

- **Status:** Accepted (2026-07-19)
- **Supersedes (in part):** the "transcripts are opaque — the only body reader is
  telemetry" lock recorded in `src/sessions.ts` (road-to-session-handoff) and
  restated in `docs/adr/archive/…` context. This ADR reopens that lock under the
  decision-revisit gate for one bounded new use.

## Context

The `road-to-session-handoff` decision set a hard architectural lock: a
transcript is an OPAQUE, version-unstable blob; the only sanctioned reads are
`readSessionHeader` (first line only, `src/sessions.ts`) and read-only telemetry
(context/token counts, `src/telemetry.ts`). "No other module parses a transcript
body."

A user request to make the GUI Sessions list more useful — a collapsible
per-session **content preview** (the first few conversation turns) — is directly
blocked by that lock: a real preview must read `message.content` bodies, which
the lock forbids outside telemetry.

Per the decision-revisit gate, a genuinely beneficial change blocked by a
recorded past decision is surfaced and re-evaluated, not silently built against
the lock nor silently dropped. The changed condition is legitimate: the earlier
lock was written for **transfer** (where body parsing buys nothing and only adds
version-fragility) and for **cross-vendor egress** (ADR-001, where content
leaving the machine is the risk). A local, read-only, in-GUI preview of the
user's OWN session is neither transfer nor egress.

## Decision

Sanction a **second** transcript reader, `src/session-preview.ts`, under the
same four-gate discipline that governs `src/telemetry.ts`:

1. **Capped read** — only the first `PREVIEW_BYTE_CAP` (128 KiB) of the file (the
   HEAD), never the whole transcript.
2. **Fenced parse** — every line parse is try/caught; malformed lines are
   skipped, never thrown.
3. **Degraded mode** — an unreadable/empty/bodyless transcript returns `null`;
   the GUI shows nothing rather than crashing.
4. **Bounded output** — at most `PREVIEW_MAX_MESSAGES` (6) turns, each truncated
   to `PREVIEW_TEXT_CAP` (240) chars; tool_use / tool_result / thinking / image
   blocks and meta lines are dropped, slash-command + system-reminder envelopes
   stripped.

Boundaries that keep this consistent with ADR-001:

- **Local-only, no egress.** The preview is displayed in the user's own GUI. It
  never enters a handoff brief, argv, a log line, or any outbound path. The
  cross-vendor content-egress tier of ADR-001 stays deferred and unaffected.
- **Single named module.** All preview body-reading lives in
  `src/session-preview.ts` — the "one named reader" shape ADR-001 required of any
  future content reader.
- **Privacy-gated.** The GUI fetches and renders a preview only when the existing
  `Hide session summaries` setting is OFF — the same toggle that governs the
  first-line summary, now covering the deeper preview too.
- **Claude only.** The codex rollout blob is opaque and often `.zst`-compressed;
  `readCodexPreview` returns `null` by construction. A codex preview is deferred
  behind its own format spike.

## Consequences

- The Sessions list can show a real, bounded conversation preview per Claude
  session, collapsible, without a network call.
- The "opaque blob for transfer" invariant is unchanged: takeover/delete still
  never parse beyond line 1; the two body readers (telemetry, preview) are the
  only exceptions, both capped + fenced + degraded-mode.
- The iron-rule comments in `src/sessions.ts` and `src/telemetry.ts` are updated
  to name the second sanctioned reader, so the lock text and the code agree.
- Preview parsing is version-tolerant by degrading to `null`, so a future Claude
  transcript-format drift blanks the preview rather than crashing the list.

## Alternatives considered

- **Stay within the lock** — "preview" = the existing first-line summary only. No
  body reader, ships immediately, but does not deliver the requested content
  preview. Rejected as the primary path (offered to the user; they chose the real
  preview), but it remains the graceful fallback whenever the reader returns
  `null`.
- **Extend `telemetry.ts`** — add preview extraction to the existing sanctioned
  module. Rejected: telemetry's single responsibility is token/context counts
  from the transcript TAIL; a preview reads message text from the HEAD. Splitting
  by responsibility (own module) keeps both readers legible.
- **Include codex now** — rejected; the opaque/compressed rollout format needs
  its own spike. Deferred, not silently narrowed.

## References

- `src/session-preview.ts` — the sanctioned reader this ADR authorizes.
- `src/telemetry.ts` — the first sanctioned reader (the precedent pattern).
- `src/sessions.ts` — the "transcripts are opaque" lock this ADR reopens.
- `docs/adr/ADR-001-cross-provider-handoff-is-a-lossy-bridge.md` — the
  cross-vendor content-egress tier that stays deferred.
