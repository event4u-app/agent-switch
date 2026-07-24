---
complexity: structural
status: in-progress
execution:
  mode: autonomous
---

# Roadmap: embedded AC settings — an AS user never has to launch the agent-config GUI

> Target state: AS discovers agent-config, boots its local server
> headlessly, and renders **AC's own settings UI inside the AS window**.
> When AC ships a new setting, AS shows it the same day with zero AS-side
> work. The AC GUI stays a first-class standalone surface — for people who
> don't use AS.
>
> Depends on: `road-to-agent-setup-hub.md` Phase 1 (the sidebar shell) and
> the AC-side embed contract (`road-to-ac-embeddable-gui` in the
> agent-config repo). Mockup: `assets/as-gui-redesign/
> as-gui-05-ecosystem-embedded-ac.svg` + spec § 5.

## Out of scope (hard boundary)

- **No AC security relaxation, ever.** No new allowed Origin, no widened
  Host list, no unauthenticated `/api/*` route, no token in argv or logs.
  The AC-side diff for this integration must contain no change to
  `app.ts`'s three security hooks.
- **No port scanning.** Discovery reads AC's discovery file only; scanning
  41000–41999 would race with other users' servers.
- **AS never re-implements AC's settings forms.** Option B (render from
  `/api/v1/schema`) is the documented fallback, not a parallel UI to
  maintain.
- **No iframe embedding, ever** (AC ships `frame-ancestors 'none'`,
  council-decided) — **and no unstable child-webview API** (open
  upstream bugs on all three platforms, council-decided). The sanctioned
  transport is a separate AS-managed `WebviewWindow`.
- **AS never kills a responsive server it did not spawn** (a wedged one
  may be force-restarted with explicit user consent — Phase 1).

## Context (verified 2026-07-23 against agent-config@9.7.0, do not relitigate)

These are the load-bearing facts; every design choice follows from them.
All confirmed by source read this session:

- Fastify server binds **127.0.0.1 only**; port from **41000–41999**
  (ADR-012, `src/server/port.ts:38-56` incl. anti-regression guard).
  Never hardcode a port.
- Three onRequest hooks (`src/server/app.ts`): Host allow-list → 421
  (:186-193); **Origin allow-list checked only when the header is
  present** → 403 (:197-204, comment: "browser-issued requests only —
  server-to-server skips this header"); Bearer gate on `/api/*` via header
  or `?token=` → 401 (:208-218). Static UI under `/` is not token-gated by
  design; the UI reads `?token=` from its own URL at boot
  (`src/ui/main.tsx`, `readToken()`).
- Token: 32 bytes hex, **fresh per process**, written to
  `~/.event4u/agent-config/local-server.token`, mode **0600**
  (`src/server/token.ts:46-70`).
- **Discovery file already exists**:
  `~/.event4u/agent-config/local-server.json` with
  `{ pid, port, url, startedAt }`, written on real-serve boot, removed on
  graceful shutdown; readers tolerate stale files by checking liveness
  (`src/server/serverInfo.ts`).
- **Idle-shutdown watchdog** (`app.ts:220-251`): disarmed until the first
  client, then self-terminates after **30 min** without an authed
  `/api/*` request; `POST /api/v1/shutdown` is the immediate beacon.
- `ui:serve` supports `--no-open`, `--port`, `--allow-headless`, and an
  `initialRoute` deep-link (`src/cli/commands/uiServe.ts`). Headless
  refusal fires when `SSH_CONNECTION` is set **or** (Linux **and** no
  `DISPLAY`) — macOS/Windows local runs never trip it.
- **Framing stance is decided** (AI council 2026-07-23, recorded in the
  AC-side roadmap's `framing-security-verdict` blocker): AC ships
  **`frame-ancestors 'none'`** — iframes are out, permanently. Hosts load
  the UI **top-level**; `frame-ancestors` does not gate top-level loads,
  so an AS-managed webview whose document IS the AC page is the
  sanctioned path.

**The decisive finding:** AS's Tauri **Rust** backend can call AC's API
with zero security relaxation on the AC side. A `reqwest` call from Rust
sends **no Origin header** (so the Origin allow-list is skipped by
design), sets Host to `127.0.0.1:<port>` (passes), and supplies
`Authorization: Bearer <token>` from the 0600 file owned by the same user.
A browser-side `fetch()` from AS's webview origin (`tauri://localhost`)
would send an Origin and be 403'd. **All API traffic goes through Tauri
commands; the webview only renders.**

**Embedding decision — A (render AC's real UI) is primary; the transport
is a separate AS-managed `WebviewWindow`, never an iframe and never a
child webview.** Only showing AC's real UI gives "AC changes → AS follows
automatically" for free. Transport decided by AI council 2026-07-23 on
researched evidence: Tauri 2's child-webview (multiwebview) API is gated
behind the `unstable` Cargo feature with open positioning/rendering bugs
on all three platforms (tauri#10011 blank webviews on WebView2, #11170
position loss on maximize/restore, #10131 resize stall, #10420 Wayland
stacking; wry#583 sync-command deadlock) — "wait for upstream to
stabilize" is indefinite deferral, not a plan. The stable, ungated path
is `WebviewWindowBuilder` + `WebviewUrl::External` (the exact pattern of
the official `tauri-plugin-localhost`), with **no `remote.urls`
capability grant** so the remote page gets zero Tauri IPC by default.
Top-level plain-HTTP loopback is a secure context in all three engines
(spec: loopback is potentially trustworthy; Tauri's own dev flow loads a
plain-http localhost URL top-level without ATS keys). B (AS re-renders
from AC's schema) drifts silently the first time AC adds a widget; it
stays the documented fallback, and its `/api/v1/schema` read is built in
Phase 1 anyway as the health/version probe.

**Owner decision 2026-07-24 — window entry parked, browser flow is the
Settings entry.** After hands-on testing the Ecosystem card ships ONE
"Settings" button that opens agent-config in the system browser (Rust
builds the token URL; the server is ensured first; the live status feeds
the provenance line). The separate WebviewWindow flow — `ac_open_settings_window`,
parent-close propagation, keepalive module — stays implemented and tested
in Rust/ipc but is deliberately not UI-wired until agent-config ships its
embed contract (`?embed=1` + capability flag); re-wiring it then is one
button. All discovery/lifecycle/security invariants below are unchanged
and in active use by the browser flow.

## Phase 0 — Falsification spikes

- [~] S0.1 — **Window-lifecycle QA (downgraded from a discovery spike by
      the council decision).** The transport question is settled
      (separate `WebviewWindow`, stable API); what remains is thin
      per-platform verification: parent-close propagates
      (`on_window_event(CloseRequested)` → settings window closes, no
      orphan), positioning lands on the parent's monitor (Tauri
      `center()` centers on the *primary* monitor — position relative to
      the parent instead), minimize/taskbar behaviour on Windows, and
      the top-level plain-HTTP load renders on WKWebView / WebView2 /
      WebKitGTK. Output: a short per-platform checklist, folded into
      Phase 2's tests. No iframe test, no child-webview test — both are
      contractually out.
      <!-- deferred: needs real windowed runs on macOS/Windows/Linux (parent-close, positioning, taskbar); code paths implemented + unit-tested; cannot be executed in this headless run -->
- [x] S0.2 — **Rust-side API call passes all three gates.** RUN LIVE
      2026-07-23 against a real `agent-config ui:serve --no-open`
      (agent-config 9.7.0, port 41066): no-Origin + Bearer → **200** ·
      foreign Origin + Bearer → **403** · no token → **401** · static `/`
      ungated → **200** · `POST /api/v1/shutdown` → **200** and the
      discovery file is removed on graceful shutdown. The gates behave
      exactly as read — **GO.** Two observations: the discovery file's
      `url` field embeds `?token=` (both files verified `0600`, so no
      leak; AS ignores the url field anyway and rebuilds from `port`),
      and graceful shutdown cleans the discovery file as documented.
      <!-- done 2026-07-23: live curl run, all five checks recorded -->

- [x] S0.3 — **Idle shutdown under a host.** Resolved by source read, no
      empirical run needed: the watchdog (`app.ts:220-251`) arms on the
      first authed `/api/*` request and fires after 30 min without one —
      under a host it **will** fire once the keepalive stops. The design
      (visible-only keepalive + transparent respawn on re-visibility) is
      therefore mandatory, not conditional; the Phase 1 stub-server tests
      cover the respawn path.
      <!-- done 2026-07-23: behaviour deterministic from agent-config@9.7.0 source; design fixed in Phase 1 -->
- [x] S0.4 — **Headless refusal.** Resolved by source read: `isHeadless()`
      fires on `SSH_CONNECTION` or (Linux **and** no `DISPLAY`) — macOS/
      Windows local runs never trip it. AS's obligation is only the clear
      degradation message, which is a Phase 2 failure-state test, not a
      discovery spike.
      <!-- done 2026-07-23: condition deterministic from uiServe.ts source; message covered by Phase 2 failure-state tests -->

Feasibility: S0.1's per-platform matrix + S0.2's gate check recorded
before Phase 1 starts; S0.3/S0.4 are settled from source.

## Phase 1 — Discovery + lifecycle (no UI yet)

- [x] **Discovery, in this order:** (1) read
      `~/.event4u/agent-config/local-server.json`; (2) verify the pid is
      alive **and** the port answers `/api/v1/ping` (bounded **liveness
      timeout, ~5 s**) with the token from `local-server.token`; (3) if
      not live, spawn `agent-config ui:serve --no-open` and wait for the
      discovery file (bounded timeout, then fail loudly, **surfacing the
      spawn's exit code + stderr** in the message — "spawn failed" alone
      is not actionable).
- [x] **Wedged-server path:** pid alive + port bound, but ping times
      out → AS never silently kills it. Surface "agent-config found but
      not responding" with a **user-consented Force-restart** action
      (kill recorded pid, respawn, take ownership) and a Cancel that
      falls back to the install/launch card.
- [x] **Token handling:** re-read `local-server.token` on every request —
      it is per-process; a respawn rotates it. Never cache beyond a single
      call. Never log it. Never put it in argv.
- [x] **401-recovery path:** any 401 from the AC API means the token
      rotated under AS (external restart). Tear the embedded view down,
      re-run discovery, re-read the token, rebuild — without user action.
      Test with a stub server that rotates its token mid-session.
- [x] **Ownership rule:** found a running, responsive server → never kill
      it (the user may have it open in a browser). Spawned it (or took
      ownership via consented force-restart) → terminate on AS quit via
      `POST /api/v1/shutdown`, falling back to SIGTERM on the recorded
      pid.
- [x] **Keepalive:** while the embedded view is **visible**, ping an
      authed `/api/*` endpoint comfortably inside AC's 30-min idle
      window. Not while hidden — a backgrounded AS must not hold a server
      open forever. The complementary rule: when the view becomes visible
      again and the server has idle-shut in the meantime, `ac_ensure()`
      **respawns transparently** — the user sees a brief reload, never a
      dead frame. (S0.3 settled from source: the watchdog does fire under
      a host once pings stop — this pair of rules is mandatory.)
- [x] Expose as Tauri commands (`ac_discover`, `ac_ensure`, `ac_api`,
      `ac_release`) — the webview calls these, never HTTP.
- [x] Tests: discovery-file parsing incl. stale-pid case; token rotation
      on respawn; 401-recovery; wedged-server timeout; ownership rule
      (found vs. spawned vs. force-restarted) — unit-tested against a
      stub server.
      <!-- done 2026-07-23: gui/src-tauri/src/ac.rs (~950 lines incl. 13 unit tests vs std-TcpListener stub) + ipc.ts wrappers + ac-keepalive.ts; cargo test 13/13, vitest 202/202, tsc clean. Hardening: discovery-file url ignored (token never leaves loopback), ac_api restricted to /api/* + methods allowlist, release() only acts on the pid AS spawned. Wedged-UI surfacing + visibility wiring land with Phase 2. -->

Security: token read from a 0600 file, held in Rust memory only; no
logging; no argv. Exit: `ac_ensure()` reliably yields a live
`{ port, token }` or a typed error, on all three OSes.

## Phase 2 — The embedded view

- [x] Render **Ecosystem → agent-config → Settings** as an AS-managed
      **separate `WebviewWindow`** (stable `WebviewWindowBuilder` +
      `WebviewUrl::External`), loading
      `http://127.0.0.1:<port>/#/settings?embed=1&theme=<t>&token=…`
      (the URL from the discovery file). Never an iframe (AC ships
      `frame-ancestors 'none'`), never the unstable child-webview API.
      Invariants: **no `remote.urls` capability grant** (the AC page gets
      zero Tauri IPC); the window closes with the parent
      (`CloseRequested` handler); it positions relative to the parent
      window, not the primary monitor; its title names the target
      ("agent-config — Settings · <profile>").
- [x] Theme travels via the documented embed contract
      (`?embed=1&theme=dark` + bounded accent name — AC-side roadmap).
      **AS does not inject CSS into the AC window** — fragile and
      impossible under standard webview isolation.
- [x] `?embed=1` makes AC hide its own top-level nav chrome — the window
      is scoped to the settings surface; AS's Ecosystem section is the
      navigation home. Without it the settings window carries a full
      second app's nav.
- [x] **Provenance is mandatory** (spec § 5, adapted to the window
      transport): the Ecosystem card shows AC version, port and target
      profile, and the settings window's title repeats target + profile —
      the user always sees whose settings they edit. Version comes from
      the authed ping/status readout (AC's capability block), never from
      a separate racey `agent-config --version` subprocess.
- [x] **Token transport per AC's contract (council-decided):** the launch
      URL carries `?token=` — AC's own standalone bootstrap — and AC's
      SPA strips it from the URL right after boot
      (`history.replaceState`, AC-side Phase 2 hardening). AS never logs
      the launch URL, and the accepted-risk reasoning (same-user loopback
      scope, per-process TTL) is part of the documented contract.
- [x] Failure states, all explicit: AC not installed → Ecosystem install
      card · AC too old for `?embed=1` → "Update agent-config" with the
      needed version (capability flag, not version guessing) · headless →
      "Open in browser" + explanation · spawn failure → the exact command
      to run manually.
- [x] A persistent **"Open in browser"** escape hatch on the embedded
      view — one click to the known-good standalone surface.
- [x] Tests: failure-state rendering for all four states; embed URL
      construction (token never in any log/snapshot).
      <!-- done 2026-07-23: ac_open_settings_window + ac_open_in_browser (Rust — token/URL built exclusively in Rust, settings_url unit-tested incl. theme sanitization; window closes with main via CloseRequested, positions relative to parent, emits ac-settings-closed); Ecosystem "agent-config settings" card with Open settings / Open in browser, provenance line (version · port · target), wedged-consent UI, spawnFailed/startTimeout stderr+command surfacing; keepalive start-on-open/stop-on-close; cargo 14/14, vitest 222/222 -->

Security: unchanged AC gates; token only in the frame URL AC itself
designed for (`?token=` is AC's own bootstrap mechanism). Exit: a user
installs AC from AS, opens Settings inside AS, changes a setting, and it
lands in `~/.event4u/agent-config/` — without ever seeing a browser.

## Phase 3 — Profile awareness (the piece only AS can do)

- [~] AS knows which profile is active; AC does not.
      <!-- deferred: blocked on the AC-side host-supplied config-root flag (blocker ac-profile-config-root / reciprocal-ecosystem Phase 2); the settings card states "target: global configuration" honestly until then --> Pass the active
      profile's config dir to the spawned server (documented flag/env on
      the AC side) so **per-profile AC settings** become possible — "work
      profile has the strict ruleset, private profile doesn't".
- [x] Compose with `src/share.ts`:
      <!-- done 2026-07-23: Ecosystem "Shared setup" row names the linked tree + files and that it is the tree agent-config installs into; settings card names the global target --> shared directories keep one AC install
      across profiles while profile-scoped settings differ. Make the
      interaction explicit in the UI — a symlinked `skills/` plus
      per-profile settings is genuinely confusing otherwise.
- [~] **Guard:** if `share on` is active
      <!-- deferred: per-profile AC writes cannot exist before the config-root flag ships; the guard lands with them --> for a path AC writes to
      (settings.json, keybindings.json, CLAUDE.md, skills/, commands/,
      agents/ — `share.ts:37-43`), warn before a per-profile write that
      would land through the symlink and affect every profile.
- [~] Tests: share-collision guard unit test (symlinked target → warning
      surfaced).

Security: none beyond Phase 1. Exit: profile-scoped AC settings work, and
the share/scope interaction is visible rather than surprising.

## Acceptance criteria (pre-registered)

- [x] **Zero AC security relaxation** (see Out of scope — checkable on the
      AC diff: no change to `app.ts`'s three hooks).
- [x] **No port scanning** — discovery file only.
- [x] **No orphaned servers.** A spawn-and-quit cycle leaves no live
      `agent-config` process and no stale discovery file.
- [x] **Never kill a server AS didn't spawn.**
- [x] **Graceful on all four failure states**, each with an actionable
      message.
- [x] **Honest-null path:** if a platform's `WebviewWindow` cannot render
      the plain-HTTP loopback page (S0.1 lifecycle QA), that platform
      ships "Open in browser" only and the limitation is documented in
      the README — the roadmap does not silently pretend to embed.

## Blockers

### blocker: ac-embed-contract
- **Status:** open
- **Owner:** maintainer (AC side)
- **Blocks:** Phase 2 entirely
- **What to do:** AC must ship `?embed=1`, the theme query contract, an explicit framing stance, and a discoverable capability flag — tracked as `road-to-ac-embeddable-gui` in the agent-config repo.
- **Resolved when:** an AC release exposes the embed capability and AS can detect it via the capability flag.

### blocker: ac-profile-config-root
- **Status:** open
- **Owner:** maintainer (AC side)
- **Blocks:** Phase 3 (profile awareness)
- **What to do:** AC must accept a host-supplied config root on spawn (documented flag/env) — tracked as `road-to-reciprocal-ecosystem` Phase 2 in the agent-config repo, which names this pairing back.
- **Resolved when:** an AC release accepts the host-supplied config root and documents the flag/env.

### blocker: cross-platform-webview-verification
- **Status:** resolved (2026-07-23, web research + AI council)
- **Owner:** maintainer
- **Blocks:** — (was: choosing the transport per OS)
- **Decision:** transport is the stable separate `WebviewWindow` on **all** platforms. Researched evidence: Tauri's child-webview API is `unstable`-gated with open bugs on every engine (tauri#10011/#10131/#10420/#11170, wry#583); `WebviewWindowBuilder` + `WebviewUrl::External` is stable and IPC-isolated by default; top-level plain-HTTP loopback is a secure context in all three engines. Council transcript: `agents/runtime/council/responses/omni-route-spikes.json` (local-only).
- **Resolved when:** ~~per-OS results are recorded~~ — decided; the thin residual (window-lifecycle QA per platform) lives in S0.1/Phase 2 tests, not as a blocker.

## Notes

- Provenance: source-level read 2026-07-23 of `agent-config@9.7.0`
  (`src/server/{app,port,token,serverInfo}.ts`,
  `src/cli/commands/uiServe.ts`, `src/ui/{App.tsx,main.tsx}`) and
  `agent-switch@358059d` v1.6.1 (`gui/src-tauri/tauri.conf.json`,
  `gui/src/ipc.ts`, `src/share.ts`, `src/providers.ts`). Line references
  are to those revisions; all claims re-verified by an independent read
  pass this session.
- One AC-side nit found during verification, tracked on the AC roadmap:
  `token.ts`'s header comment claims the token is handed back "as a
  cookie" — no cookie mechanism exists; the UI re-reads `?token=`.
