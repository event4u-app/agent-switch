---
complexity: standard
status: in-progress
---

# Roadmap: 1.0.1 — review follow-up (rotation integrity + claude-swap adoptions)

> Response to the 1.0.0 review feedback (`agents/tmp/feedback-1.0.0-1.txt`).
> Decision on the rotation engine: **keep it, but stop compounding** — restore
> the deliberately-omitted usage-policy disclosure and correct the misleading
> README history (feedback option 2). Plus the three uncontroversial adoptions
> from the claude-swap comparison, gated by risk.

## Goal

Bring 1.0.0 back onto the project's stated identity — "ship only what the
evidence supports, honestly disclosed" — without removing the (user-decided)
opt-in rotation capability, and adopt the safe enrichments identified in the
comparison. Credential-bearing work is threat-modelled, not auto-shipped.

## Phase 1 — Rotation integrity (feedback option 2)

- [x] Restore the usage-policy warning on `autoswitch on` (CLI enable path,
  `src/index.ts`) — states the pooling-to-route-around-limits risk plainly.
- [x] Restore the usage-policy warning to the README rotation section.
- [x] Correct the README "later reversed" line to the recorded fact: a
  unanimous review recommended removal and the decision **overrode** it (not a
  resolved relitigation); point to the verbatim rejection rationale in
  `agents/roadmaps/skipped/road-to-agent-switch-autoswitch-rejected.md`.
- [x] Adversarial honesty/legal review of the disclosure wording (team pass):
  "can violate" (not "violates") kept; weasel "flagged" replaced with the
  unanimous-recommend-removal statement; provider → providers' (plural).

## Phase 2 — Pace usage enrichment (informational, NOT a rotation signal)

- [x] Pure `pace(window, now)` in `src/usage.ts` — "ahead of pace" =
  `utilization/100 − fractionElapsed > minGap`, measured against the snapshot's
  `capturedAt` (the `fetched_at` analog), 24h post-reset suppression, min-gap
  vs noise, 5h window excluded. Mirror in `gui/src/transforms.ts`.
- [x] Tests for `pace()` (both copies): ahead / on-pace / behind, post-reset
  suppression, 5h-excluded, stale-snapshot judged against `capturedAt`.
- [x] Surface a compact "ahead of pace" badge in `formatSnapshot()` (CLI) and
  `UsageBars.tsx` (GUI). Informational only — never wired to a switch decision.

## Phase 3 — MCP-OAuth share guard (latent-leak hardening)

- [x] Guard test: `settings.json` (shared as a whole-file symlink by `share on`)
  must carry no `mcpServers` / OAuth-token keys — the one path where MCP auth
  material could propagate across profiles. `.claude.json` / `.credentials.json`
  are already on the never-shared list; this closes the residual gap named in
  the comparison.

## Phase 4 — Cross-machine transfer export — DEFERRED (security-sensitive)

- [~] Config-only export (reuse the `share.ts` allowlist) + opt-in `--full` with
  mandatory user encryption; never export the path-hashed macOS Keychain entry.
  **Deferred:** `--full` bundles live OAuth refresh/access tokens — a leaked
  bundle is an account-takeover vector. Needs its own threat-modelled pass
  (per `security-sensitive-stop`), not an autonomous run. Tracked here so the
  decision and rationale survive.
