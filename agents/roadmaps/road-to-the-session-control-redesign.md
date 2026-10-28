---
complexity: large
status: in-progress
---

# Roadmap: the session-control redesign (GUI, icon, README)

> **Source:** `agents/tmp.old/inbox-2026-10-a/` — `redesign/` (28 artboards + the
> compiled design bundle in `collections/*.zip`), `agent-switch-icon-{dark,light}.svg`,
> the owner's invocation (2026-10-28): build the new design *from its code, not only
> the screenshots*, the new icon, an updated README with the new `info-banner.png`,
> and AC-style screenshots with a hero section.
>
> Sibling: [`road-to-honest-foundations.md`](road-to-honest-foundations.md) supplies
> the backend data the new screens show. Where a screen needs data no backend
> produces yet, the screen ships with the redesign's own honest empty/unknown state
> (`Usage unknown`, `Monitor only`, `Planned`, `Liveness unknown`) — never demo data.

## Goal

The GUI looks and behaves like the redesign 1:1: deep-navy `--ac-*` token layer,
Inter / Anton / IBM Plex Mono, a top bar with four places (Overview · Sessions ·
Accounts · Tools) and Health / Activity / Notifications / Settings on the right,
sheets and dialogs instead of inline forms, a tray popover, the new icon — fed by
the real CLI `--json` contract. README and screenshots show the result.

## Constraints (from the owner, binding)

- **The design is the spec.** Build it 1:1; adapt the redesign's own code
  (stack-compatible: React 18 + Radix + lucide + Tailwind 3 + cva). Any deviation is
  surfaced, never made silently.
- **Tools keep working undisturbed** ("in Ruhe weiter nutzen"): the redesign changes
  only the AS window; it adds no launcher, hook or login by itself.
- **Switch's intro stays byte-exact and once-only** (`PET_WELCOME`).
- **No demo data in the product.** The design's demo data defines the view-model
  shape only.

## Phase 0 — Foundation: tokens, fonts, primitives

- [x] `--ac-*` token layer (dark default, light via `data-theme`) in `gui/src/index.css`,
      Tailwind colour + `font-display` / `font-ac-mono` entries, `.ac-caps`, the four
      animations with `prefers-reduced-motion` off-switch.
- [x] Fonts shipped locally (offline Tauri): Inter 400/500/600, Anton 400, IBM Plex
      Mono 400/500 as woff2 under `gui/src/assets/fonts/` with their OFL licence.
- [x] Primitives ported from the bundle into `gui/src/ui/`: Button, IconButton, Caps,
      Kbd, PageHeader, SectionHeader, Badge, Card, AccountDot, SessionStateIcon,
      UsageWindowRow, CapacityMeter (10-min staleness rule), Switch, EmptyState,
      DefinitionList, TextInput, AppLogo, Sheet, Dialog, RowMenu, Select, Segmented,
      SettingRow/SettingGroup, SheetSection, Toaster.
- [x] Format helpers (`ago`, duration, countdown, expiry, `~/` paths) with tests.

## Phase 1 — View model + shell

- [x] `gui/src/vm/` — typed view model (Account, Session, Attention, Check, Tool,
      Surface, ActivityEvent, Notice, Provider, Pool, Binding) built from the existing
      `ipc.ts` calls; ranking (`state → fresh → headroom`), "Next in <pool>", tone rule.
      Unit-tested; unknown values stay `null`, never `0`.
- [x] Store/context with `go / open / close / toast / act`; every `act.*` maps to an
      `ipc.ts` function or is absent (button hidden or disabled with its reason).
- [x] Shell: 52 px top bar (Tauri drag region, 84 px macOS inset), places with counts,
      Health pill, Activity, Notifications bell, Settings, ⌘K / ⌘N / ⌘, shortcuts,
      error banner, overlay host.
- [x] ⌘K command search over the loaded view model.

## Phase 2 — Screens

- [x] Overview: "What's going on?", Needs you (attention queue), Running now, What's
      left; first-run state; agent-config promo (no-AC).
- [x] Sessions list + Session sheet (preview, why, protection note, Switch live / Take
      over / Hand off with the explicit confirm, trash/restore/compact).
- [x] Accounts (+ Usage history, Projects & pools), Account detail sheet, Add account
      (4 steps, login in the built-in terminal), Sign in again (reauth) dialog.
- [x] Tools (agent-config card, shared setup, tools list) + Apps + Update sheet
      (streams the real terminal).
- [x] Start session dialog and Near-limit sheet (decisions limited to what the backend
      can do; unavailable options carry their reason).
- [x] Health (readiness, autostart desired vs actual, checks + Fix dialog), Activity,
      Notifications sheet.
- [x] Settings shell + General, Sign-ins, Protection, Distribution, Notifications,
      Desktop pet, Providers, Updates, Advanced.
- [ ] Old `App.tsx` page tree retired once every function has a new home; parity
      checklist: every existing ipc action still reachable.

## Phase 3 — Tray popover + icon

- [x] Tray popover window (340 px, hides on blur) with attention, ranked accounts,
      status bar, Start session / Open / Quit; native menu kept as fallback.
- [x] New icon: app bundle icons regenerated from the dark SVG (`tauri icon`),
      `icon-source.png`, monochrome macOS tray template derived from the mark,
      Starlight favicon/logo, in-app `AppLogo` dark/light.

## Phase 4 — README, banner, screenshots

- [ ] Screenshot pipeline: Vite + Playwright with a mocked Tauri IPC answering
      anonymised fixtures; 1600×1000 dark captures under `.github/assets/screenshots/`.
- [ ] README rewritten AC-style: centred linked `info-banner.png`, H1 + tagline,
      badges, hero screenshot, "More views" collapsible 2×2 table, multi-provider
      wording, feature list matching the shipped capabilities.
- [ ] Starlight GUI screenshots and docs pages updated to the new UI.

## Acceptance

- `cd gui && npm test` and `npm run build` green; root `npm test` green.
- Every artboard has a matching screen; a fidelity checklist names, per screen, the
  bundle lines it was ported from and every deviation with its reason.
- No screen shows a number without its data age; unknown is grey, never "free".

## Risks

| Risk | Mitigation |
|---|---|
| Porting minified JSX misreads behaviour | port per component against the bundle line refs; screenshot compare to `redesign/full/*` |
| Screens promise backend that does not exist | honest degraded states; foundations roadmap closes the biggest gaps |
| `App.tsx` retirement loses a function | parity checklist over every `ipc.ts` export before deletion |
| Tray popover window behaves differently per OS | native menu stays as fallback |
