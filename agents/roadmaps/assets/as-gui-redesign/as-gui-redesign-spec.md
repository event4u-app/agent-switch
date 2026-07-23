---
kind: design-spec
implements: ../../road-to-agent-setup-hub.md (Phase 1–3), ../../road-to-ac-embedded-settings.md (Phase 2)
---

# agent-switch GUI redesign — implementation spec

Companion to the seven SVG mockups in this folder. The mockups are the
visual contract; this file is the machine-readable half — what a
refactoring agent needs that a picture cannot carry.

**Scope note:** this is a *structural* redesign. The palette, the token
schema and the Darcula/event4u identity in `gui/src/index.css` are already
deliberate and are carried over unchanged. Anyone re-picking colours here
is out of scope.

## Asset map

| File | Surface | Implements |
|---|---|---|
| `as-gui-00-shell-anatomy.svg` | App shell, sidebar, regions, responsive rail | Hub Phase 1 |
| `as-gui-01-profiles.svg` | Profiles section | Hub Phase 1 |
| `as-gui-02-usage.svg` | Usage section | Hub Phase 1 |
| `as-gui-03-tooling.svg` | Tooling section | Hub Phase 3 |
| `as-gui-04-ecosystem.svg` | Ecosystem section | Hub Phase 2 |
| `as-gui-05-ecosystem-embedded-ac.svg` | Ecosystem › agent-config settings | Embedded-settings Phase 2 |
| `as-gui-06-settings.svg` | Settings section | Hub Phase 1 |

Every mockup is drawn at the **true window size, 1040 × 620**
(`gui/src-tauri/tauri.conf.json`). Measurements read off the SVGs are
directly usable; nothing is drawn at a flattering scale.

## Layout grid

| Region | Size | Notes |
|---|---|---|
| Sidebar | `200px` fixed | Collapses to a `56px` icon rail below `820px` window width |
| Traffic-light reserve | top `44px` of the sidebar | `titleBarStyle: Overlay`, `trafficLightPosition {x:12,y:24}`. macOS only — reclaimed on Windows/Linux |
| Header | `52px` | Section title + subtitle left; primary action, refresh, notifications right |
| Content | fills remainder, `24px` gutters | One section at a time |
| Content footer | `32px` | Refresh age left, active scope right |
| Nav row | `34px`, `8px` radius | `3px` left accent bar when active |
| Card radius | `10px` | Controls `7px`, pills `9px` (fully round) |
| Card padding | `24px` horizontal, `20px` vertical | |

## Tokens

All existing tokens in `gui/src/index.css` are unchanged. **One addition:**

```css
--sidebar: 225 5% 15%;  /* ≈ #232427 — between --background and --card; canonical hex lives in the shared token source */
```

The sidebar needs its own elevation step; reusing `--card` makes the nav
float, reusing `--background` makes it disappear. Add it to both themes and
to the shared token source when `road-to-shared-design-tokens` (agent-config
repo) lands.

Colour semantics used in the mockups, all from existing tokens:

| Meaning | Token | Hex (dark) |
|---|---|---|
| Primary action, active accent | `--primary` | `#d15c38` |
| Healthy / under threshold | `--success` | `#499c54` |
| Approaching threshold | *(new)* `--warning` | `#d9a441` |
| Over threshold / destructive | `--destructive` | `#f0524d` |
| Unknown / not detected | `--muted-foreground` | `#868a91` |

`--warning` is a genuine addition: the Usage and Tooling sections need a
three-state scale and the current palette has only success/destructive.
Add it rather than overloading `--destructive` for "getting close".

## Section inventory

### 1. Profiles
Replaces today's whole main pane.
- **Filter row:** provider segmented control (demoted from top-level nav),
  tag filter, search, sort selector. Default sort: **headroom descending**.
- **Card, 96px:** name + identity, tag pills, active accent bar, two usage
  windows (session + limiting window) with reset time in words, and four
  controls — `Use` (filled only on the active row) · `Terminal` ·
  `Desktop` · overflow (`⋯` → Rename, Import, Remove).
- **States:** active · idle · usage-unavailable (a sentence naming the fix,
  never `N.A.` with a hatched bar) · empty list (invitation to add).
- Card height must stay ≤ 96px so four profiles are visible without
  scrolling at 620px.

### 2. Usage
New section. Owns everything comparative.
- **Headroom summary:** one sentence naming the account with most room and
  a switch action. Same thresholds the auto-switch daemon uses.
- **Comparison table:** one aligned row per account — session window, week
  window, reset countdown. Per-model rows (today's `Fable` / `All`) become
  an expandable sub-row here, not card content.
- **History:** 30-day rolling line per account for the limiting window.
- **Footer must always read "own profiles only."**

### 3. Tooling
New section. Renders the CLI's JSON readout; **never detects on its own**.
- Row states: `ok` (58px) · `wrong-binary` (94px, amber accent) ·
  `missing` (76px). Height encodes urgency; rows sort by attention first.
- Install/Update actions run `agent-switch tooling install|upgrade <id>`
  **inside the embedded terminal** (owner amendment 2026-07-23,
  superseding the copy-only stance: a terminal-visible, user-initiated
  run answers the council's actual objections — silent EACCES failures
  and PATH-invisible results — that only applied to unattended spawns).
  Copy-command remains the fallback where no verified command exists
  (agy) and on wrong-binary rows (auto-replacing a foreign tool is
  invasive); those copy rows keep the EACCES note.
- rtk must be probed for **identity**, not just presence — see the
  AC-side `road-to-rtk-onboarding-correctness` roadmap (agent-config
  repo); when agent-config is installed, the tooling readout delegates to
  its detection contract.

### 4. Ecosystem
Where the deleted footer banner goes.
- `deriveAgentConfigView()` in `gui/src/agent-config.ts` is **kept
  unchanged**; only the render site moves out of `AgentConfigBanner.tsx`.
- Installed state stops being invisible: shows what agent-config is doing
  in this profile (skills, commands, shared or not).
- Shared setup (`share on/off`) is surfaced here, since it is the tree
  agent-config installs into (`share.ts` links `settings.json`,
  `keybindings.json`, `CLAUDE.md` + `skills/`, `commands/`, `agents/`).
- One boundary line on the page: nothing installs itself, agent-switch is
  not a proxy.

### 5. Ecosystem › agent-config settings
- Nested sub-item, not a sixth section.
- Opens `http://127.0.0.1:<port>/#/settings?embed=1&theme=<t>&token=<token>`
  in a **separate AS-managed `WebviewWindow`** (stable API; council
  decision 2026-07-23 — no iframe, no unstable child webview). The window
  closes with AS, positions relative to the AS window, and its title
  names target + profile.
- **Provenance is mandatory:** the Ecosystem card shows version, port,
  target profile; the window title repeats target + profile.
- **"Open in browser" is permanent**, on every platform, always.

### 6. Settings
- Five groups: General · Notifications · Auto-switch · Updates · Advanced.
- **This phase adds no settings.** The diff is a redistribution of
  `gui/src/settings-store.ts`. A new setting appearing here fails the
  phase's acceptance criterion.
- Destructive actions quarantined at the end of Advanced behind a confirm.
- No save button — settings apply on change, and the footer says so.

## What is deleted

| Removed | Replaced by |
|---|---|
| Full-width provider tab bar as top-level nav | 248px filter control inside Profiles |
| Permanent agent-config footer strip | Ecosystem section + one self-retiring first-run card |
| Header gear icon | Settings sidebar section |
| Header history icon | Usage section |
| Footer "All accounts" select (the auto-switch tag-scope selector, `App.tsx:1230-1234` — not an account picker) | Auto-switch scope control inside Settings › Auto-switch; page-level filters in Profiles / Usage |
| Footer Quit + auto-switch status | Sidebar base |
| `N.A.` + hatched bars | A sentence naming the fix |
| Per-card rename/delete icons | Overflow menu |

Net: **five removals from permanent chrome** — rows 1–4 plus the footer
cluster (rows 5–6, "All accounts" select + Quit/status, counted as one).
Rows 7–8 (`N.A.` bars, per-card icons) are content replacements, not
chrome. Two new sections are added that a user navigates to. This is the
net-negative-surface criterion in `../../road-to-agent-setup-hub.md`; the
PR should be able to prove it by count against exactly this list.

## Copy rules

- Name things by what the user controls: `Terminal`, not `Term`;
  `Desktop`, not `Claude Desktop` (the provider is already the filter).
- Errors state what happened and what to run. They do not apologise and
  are never vague.
- Empty states are invitations to act, not shrugs.
- Third-party claims are attributed, never asserted in our voice —
  "Upstream reports 60–90% savings (their measurement)".
- An action keeps its name through the whole flow: the button that says
  `Use` produces a toast that says `Using personal`.

## Quality floor

- Usable at `minWidth 640 × minHeight 480` — verified by spike S0.1.
- Visible keyboard focus on every control; the sidebar is arrow-navigable.
- Colour is never the only signal: the active profile has an accent bar
  **and** an "Active" pill; usage states have colour **and** a percentage.
- `prefers-reduced-motion` respected; section transitions are the only
  animation and they are suppressible.
- No layout shift when a detection sweep completes — reserve the row
  heights and render a skeleton.

## Open questions for the maintainer

1. **Sort default on Profiles** — headroom (proposed) or the current
   manual order? Headroom is the more useful daily answer but reorders a
   list users may have memorised.
2. **Overflow menu contents** — is `Terminal` or `Desktop` the more-used
   launch target? The less-used one could join the overflow and free a slot.
3. **`--warning` token** — confirm the amber `#d9a441` against the Darcula
   palette, or supply the preferred value.
