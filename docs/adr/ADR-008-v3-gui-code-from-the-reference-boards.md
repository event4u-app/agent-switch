# ADR-008 — v3 GUI code grows from the reference boards, board by board

- **Status:** Proposed (2026-11-02) — draft from `road-to-agent-switch-v3-central`
  Phase 0.
- **Design basis:** `docs/design/agent-switch-v3-ui-spec.md` (binding, strict
  fidelity) and `docs/design/agent-switch-v3-reference.patch` (boards on demo
  data, themes, five shared `gui/src/ui/` changes).

## Context

The reference patch applies cleanly on `ff38137` and passes `tsc` and the GUI
tests, but applied whole it drops GUI line coverage from above the 78 % floor to
63.6 % (`gui/vite.config.ts`): ~5,000 lines of board code are rendered only by a
design canvas, never by a test. The spec says where boards and spec disagree the
spec wins, and the design-fidelity rule says the artifact's own code is adapted,
not re-derived.

## Decision

1. **Adapt, board by board.** Each board moves from the patch into `gui/src/v3/`
   as the screen it becomes, wired to engine data, in the same change as its
   tests. Its markup, classes and tokens are kept; only demo data is replaced.
2. **Product code first, canvas second.** The theme registry, resolver and their
   contrast tests (`themes/*`) and the kit (`kit.tsx`) land first, as product
   code. Demo data (`data.ts`), the design canvas entry (`v3.html`,
   `vite.v3embed.config.ts`, `embed.tsx`) and the view switcher stay out of the
   product bundle; they may live under `gui/design/` for render checks, and are
   then excluded from the app build, never from coverage of product code.
3. **The coverage floor is kept.** No `coverage.exclude` for product code, no
   lowered threshold. A board that cannot be tested yet does not land yet.
4. **Shared `ui/` changes** (Segmented raise fill, 12 px floating layers,
   `AcRoot` style prop) land in the change that first needs them, with a render
   check of the 2.11 screens they also change.
5. **Every deviation from the spec is owner-confirmed** and listed in the
   fidelity matrix (spec §14) with its evidence.

## Consequences

- The v3 window can be assembled behind a setting while the 2.11 window stays
  the default, so `dev/v3` stays shippable at every merge.
- The reference patch stays in `docs/design/` as the source to adapt from, until
  the last board is ported.

## Alternatives

- **Apply the patch whole, then wire** — rejected: fails the coverage gate on the
  first PR and leaves demo data reachable in the product.
- **Exclude `gui/src/v3/` from coverage** — rejected: it is the code users run.
- **Rebuild the boards from the spec text** — rejected: a re-derivation is a
  design deviation and throws away reviewed code.
