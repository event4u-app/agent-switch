---
title: Desktop Pet
description: An optional animated companion that floats above your windows and shows notifications as reactions and speech bubbles.
---

The desktop pet is an **optional** companion window: a small pixel-art character that stays on top of all your windows and turns agent-switch notifications into something you notice out of the corner of your eye — without switching apps and without another notification-center entry.

It is **off by default**. Enable it under the **Pet** entry in the left sidebar.

## What it does

- **Reacts to notifications** — the daemon's events (usage limit near, context thresholds, fetch failures, errors) play a matching animation: success jumps, errors stumble, warnings wait, info waves.
- **Speech bubbles** — the notification title appears as a bubble next to the pet. The **usage-limit-near** bubble is clickable: it opens the main window with the switch dialog pre-selected. The click only *navigates* — switching always stays behind the dialog's explicit confirmation, nothing ever switches automatically.
- **Ambient context mood** — a small dot on the pet mirrors the worst live-session context fill (like the tray tooltip): amber from 60 %, pulsing red from 80 %.

## Notification routing

Pet → **Notification routing** (left sidebar) decides how the pet relates to the normal pipeline:

| Mode | Behaviour |
|---|---|
| **Pet + system** (default) | Pet reacts *and* the desktop notification / toast fires as usual. |
| **Pet only** | For kinds the pet covers, it replaces desktop notifications and toasts. The bell flyout always keeps the full log. |
| **Decoration only** | The pet ignores notifications entirely — it just keeps you company. |

The pet's per-kind switches are **independent** of the desktop mutes, so "pet reacts to errors only" (or covering a kind you muted on the desktop) works.

## Configuration

Everything lives under the **Pet** sidebar entry and applies live:

- **Pet picker** — eight bundled characters.
- **Speech bubbles** on/off + display duration.
- **Size** — small / medium / large.
- **Animations** — Auto (follows your system's reduce-motion preference), On, Off (static sprite).
- **Position** — click and hold the pet to drag it anywhere; its position is remembered. *Reset position* brings it back to the bottom-right corner. When you change the size, the corner nearest the screen edge stays fixed, so the pet never grows off-screen.

## Platform notes

- **macOS** — window transparency uses Tauri's `macOSPrivateApi`; fully supported in the shipped build.
- **Windows** — supported; the pet re-asserts its always-on-top state periodically (some overlays steal it).
- **Linux** — best-effort: transparency and always-on-top depend on your compositor.

## For pet authors

Pets use the openpets package format: a `pet.json` manifest plus one `spritesheet.webp` (8 columns × 9 rows, 192×208 px frames — one reaction per row). The bundled pets and the full row contract live in the repo under `gui/public/pets/`.
