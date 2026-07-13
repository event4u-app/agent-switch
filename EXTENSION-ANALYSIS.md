# EXTENSION-ANALYSIS.md — "Claude Account Switcher" Chrome extension

Analysis basis: CRX downloaded from the Chrome Web Store (id
`plhekogpadjpgebikhkgmjdfpikgabij`, v0.2.3), unpacked and read directly
(service worker + utils + content script + grep over the bundled React popup).
2026-07-13.

## What it is

A **browser-only, cookie-snapshot** account switcher for `claude.ai`.
Manifest v3, permissions `cookies` + `storage` + `tabs`, host
`https://claude.ai/*`. React popup UI, background service worker. It does
**not** touch Claude Code (the CLI) at all — a different surface from agent-switch's
core, overlapping only with agent-switch's `web` command.

## Mechanisms (read from the actual code)

### Switch = cookie snapshot/restore (service-worker.ts)
- **Save** (`ne`): `chrome.cookies.getAll({domain:"claude.ai"})`, store the full
  cookie set per profile in `chrome.storage.local` under `claude_profiles`.
  Max **5** accounts. Captures `name/value/domain/path/secure/httpOnly/
  sameSite/session/expirationDate/storeId/hostOnly/partitionKey`.
- **Switch** (`re`): remove all `claude.ai` cookies (`O`), then set the saved
  profile's cookies (`te`), then navigate the claude.ai tab to `lastChatUrl`.
- **Active profile** identified by the cookie whose name includes `session`
  (`W`), matched by value.
- This is a **snapshot architecture** — the exact staleness-prone class agent-switch
  deliberately rejected for the CLI. agent-switch's `web` command (persistent
  per-profile Playwright user-data-dir) is the superior browser approach: no
  cookie extraction, no staleness. **Not adopted.**

### Usage bar = claude.ai web endpoints (service-worker.ts `h`)
- `GET https://claude.ai/api/organizations` (cookie-auth, `credentials:include`)
  → pick the org with `capabilities` including `chat`.
- `GET https://claude.ai/api/organizations/{uuid}/usage` → reads windows keyed
  `five_hour`/`session`/`fiveHour` and `weekly`/`seven_day`/`week`; fields
  `utilization`/`utilization_pct`/`percentage`/`pct` and
  `resets_at`/`reset_at`/`renew_at`.
- Also **per-model** usage (`models`/`model_usage`), **Claude Code daily
  routines** (`routines`/`daily_routines`/`claude_code_routines` → used/limit),
  and **plan tier** (`Free`/`Pro`/`Max 5x`/`Max 20x`/`Team`/`Enterprise`,
  derived from `subscription_tier`/`rate_limit_tier`/…).
- Identity via `GET /api/users/current` then `/api/account` (email).
- **Usage history**: 30-day rolling store, ≤720 samples, in
  `claude_usage_history` — powers a sparkline.
- **On-demand** (fetched on popup open), **not** background polling.

Note: this is the **claude.ai web** usage endpoint (cookie-auth), *different*
from agent-switch's `api.anthropic.com/api/oauth/usage` (OAuth-token-auth). Field
names converge (`utilization`, `resets_at`). The extension's model is richer
(plan tier, per-model, Claude Code routines, history).

### Other features
- Import/Export profiles as JSON (`claude-profiles-YYYY-MM-DD.json`).
- Per-profile color index ("toolbar rings"), rename, dedupe-on-name.
- Settings: theme (auto/light/dark), `showProgressBar`, `notificationsEnabled`.
- Storage hardening: `chrome.storage.local.setAccessLevel(TRUSTED_CONTEXTS)`.

### Ads / monetization / tracking — NONE FOUND
The user recalled "it has ads". The code shows the opposite: the only external
host referenced anywhere is `react.dev/errors/` (React's own dev error page).
Grep for analytics/telemetry/affiliate/premium/upgrade surfaced only React
internal strings (`…DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE`) and the UI
label **"No analytics"** next to **"Local-first storage"**. No third-party
beacon, no ad network, no paid tier in this version. (Possible the user
confused it with another extension, or an older/newer build differs.)

## What agent-switch adopts vs. rejects

**Adopt (into the v2 family):**
1. **Richer usage model** — plan tier, per-model utilization, Claude Code daily
   routines, 30-day usage history sparkline. Applies to the CLI usage engine
   (own-profile only) and the GUI. → `road-to-agent-switch-gui-service.md`.
2. **The claude.ai web usage endpoint** as an *additional* read source for
   profiles used via the browser (`web`), where an OAuth token is not in hand.
   → `road-to-agent-switch-gui-service.md` (defensive, optional).
3. **Import/Export profiles as JSON**, **per-profile color**, **theme** — GUI
   affordances. → `road-to-agent-switch-gui-service.md`.
4. **GUI/UX inspiration** — usage bars, color-coded profiles, usage overview —
   the visual target for the menubar/tray frontend the owner asked for.

**Reject:**
- **Cookie snapshot/restore switching** — staleness-prone; agent-switch's persistent
  per-profile browser context is strictly better. Not adopted.
- Anything that would rank accounts by headroom or drive switching from usage
  → see `skipped/road-to-agent-switch-autoswitch-rejected.md` (policy lock).
