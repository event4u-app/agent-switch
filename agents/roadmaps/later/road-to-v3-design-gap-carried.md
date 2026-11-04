---
complexity: small
status: later
---

# Roadmap: v3 design gap — carried items

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

- [ ] **Approval keys on a focused Needs-you item**: ⇧↵ always, ⌫ deny, Y yes.
  `needs --json` items carry no approval id, which `needs allow|deny` needs.
  Remotely, "always" is never offered (v3.2 rule), so ⇧↵ stays in the chat.
  *Trigger:* the needs item carries the approval id of its session.
  *Owner:* agent.

## Owner decisions

| Id | Question | Options |
|---|---|---|
| G1 | Library "All": archived rows with an "archived" chip, as on the boards, or rename "All" to "Active"? | **Decided 2026-11-04: 1** — the owner: "100% an den Entwurf halten, optisch". Done: All shows archived rows with their chip; Pinned counts archived pins. |
| G2 | Sessions in your own terminal: keep the chat-style read-only timeline (ADR-010), or draw it in terminal style (mono 12.5/1.5 on the terminal background)? | 1. keep · 2. terminal style |
| G3 | Terminal font: IBM Plex Mono as on the boards, or SF Mono? | **Decided 2026-11-04: 1**, same instruction. Done: Plex Mono 12.5 px on an 18.75 px line (xterm's line height translated from the CSS one). |

*Trigger:* the owner answers; each answer becomes one step here.
