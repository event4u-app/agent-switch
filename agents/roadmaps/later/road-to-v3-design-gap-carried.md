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
| G1 | Library "All": archived rows with an "archived" chip, as on the boards, or rename "All" to "Active"? | 1. show archived under All · 2. rename to Active |
| G2 | Sessions in your own terminal: keep the chat-style read-only timeline (ADR-010), or draw it in terminal style (mono 12.5/1.5 on the terminal background)? | 1. keep · 2. terminal style |
| G3 | Terminal font: IBM Plex Mono as on the boards, or SF Mono? | 1. Plex Mono · 2. SF Mono |

*Trigger:* the owner answers; each answer becomes one step here.
