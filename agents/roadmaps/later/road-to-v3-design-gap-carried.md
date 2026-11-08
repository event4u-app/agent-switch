---
complexity: small
status: later
---

# Roadmap: v3 design gap — carried items

> **Owner question (/roadmap:triage-parked, 2026-11-07):** the keys trigger has fired in substance — `needs --json` items carry the approval id in `version` (`src/commands/needs.ts:96-109`, `src/attention.ts:73-76`), so the approval keys (⇧↵/⌫/Y, `gui/src/v3/window.tsx:439-443` handles only Enter and `l`) are agent-executable now. G2 looks answered by #166 (`gui/src/v3/transcript-terminal.tsx`, a terminal-style view beside the chat view), an option the table never offered. The macOS terminal check stays owner-only.
> Candidates: (1) move the approval keys into an active roadmap, record G2 as "both views, #166", re-park the terminal check; (2) record G2 differently; (3) leave parked.
> **Decided 2026-11-07 (owner, option 1):** the approval keys moved to [`road-to-the-ready-remainders.md`](../road-to-the-ready-remainders.md) 5.1. G2 recorded on 2026-11-08 as "both views, #166". Only the macOS terminal check stays parked here (owner-only).

> **Source:** carried from [`archive/road-to-v3-design-gap.md`](../archive/road-to-v3-design-gap.md)
> (`agents/tmp.old/inbox-2026-11-c/`), 2026-11-03.

Each item names what keeps it from running now and what pulls it back.

## Acceptance in the real window

- [ ] **Terminal on macOS**: open a hosted Claude Code session in the Tauri
  window. The `╭─╮` boxes draw rounded arcs with continuous side lines (WebGL
  renderer), and the text sits 16/20 px from the edges. Headless Chromium has no
  GPU, so the render harness shows only the DOM fallback.
  Found 2026-11-04: at 2× the WebGL canvas came out CSS-sized while its glyphs
  were drawn in device pixels, so text rendered at twice its size. XtermBox now
  drops WebGL when its canvas is not device-sized (`webglCanvasSane`); then the
  DOM renderer draws the right size with square box corners. Check in the real
  window which of the two WKWebView ends up with.
  *Trigger:* the owner runs a v3 build on the Mac. *Owner:* user (needs the
  real window).

## Keyboard

- [ ] **Approval keys on a focused Needs-you item**: ⇧↵ always, ⌫ deny, Y yes. <!-- moved-to: road-to-the-ready-remainders.md 5.1 (2026-11-07) -->
  `needs --json` items carry no approval id, which `needs allow|deny` needs.
  Remotely, "always" is never offered (v3.2 rule), so ⇧↵ stays in the chat.
  *Trigger:* the needs item carries the approval id of its session.
  *Owner:* agent.

## Owner decisions

| Id | Question | Options |
|---|---|---|
| G1 | Library "All": archived rows with an "archived" chip, as on the boards, or rename "All" to "Active"? | **Decided 2026-11-04: 1** — the owner: "100% an den Entwurf halten, optisch". Done: All shows archived rows with their chip; Pinned counts archived pins. |
| G2 | Sessions in your own terminal: keep the chat-style read-only timeline (ADR-010), or draw it in terminal style (mono 12.5/1.5 on the terminal background)? | **Decided 2026-11-08: both views** (owner, /roadmap:triage-parked follow-up) — shipped in #166 (6929831): a Terminal/Chat switch for own-terminal sessions, terminal style in `gui/src/v3/transcript-terminal.tsx`, the chat-style timeline (ADR-010) kept beside it. |
| G3 | Terminal font: IBM Plex Mono as on the boards, or SF Mono? | **Decided 2026-11-04: 1**, same instruction. Done: Plex Mono 12.5 px on an 18.75 px line (xterm's line height translated from the CSS one). |

*Trigger:* the owner answers; each answer becomes one step here.
