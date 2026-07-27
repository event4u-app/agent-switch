/**
 * Pet model — pure data + decision functions for the desktop pet. Rendering
 * lives in pet-main.ts, the notification fan-out in App.tsx; both consume this
 * module. Kept free of Tauri/DOM imports so vitest covers it as-is.
 *
 * Sprite contract: gui/public/pets/README.md — 8 cols x 9 rows, 192x208 px
 * frames, one reaction per row.
 */

import type { NotificationKind } from "../notifications.js";

export const PET_IDS = [
  "agent-switch-007",
  "agent-config-warden",
  "agent-switch-scout",
  "dev-bot",
  "event4u-bard",
  "event4u-raver",
  "event4u-stage-crew",
  "the-ceo",
] as const;

export type PetId = (typeof PET_IDS)[number];
export const DEFAULT_PET: PetId = "agent-switch-007";

export const FRAME_W = 192;
export const FRAME_H = 208;

export type Reaction =
  | "idle"
  | "running-right"
  | "running-left"
  | "waving"
  | "jumping"
  | "failed"
  | "waiting"
  | "running"
  | "review";

export const ROWS: Record<Reaction, { row: number; frames: number; durationMs: number }> = {
  idle: { row: 0, frames: 6, durationMs: 5500 },
  "running-right": { row: 1, frames: 8, durationMs: 1060 },
  "running-left": { row: 2, frames: 8, durationMs: 1060 },
  waving: { row: 3, frames: 4, durationMs: 700 },
  jumping: { row: 4, frames: 5, durationMs: 840 },
  failed: { row: 5, frames: 8, durationMs: 1220 },
  waiting: { row: 6, frames: 6, durationMs: 1010 },
  running: { row: 7, frames: 6, durationMs: 820 },
  review: { row: 8, frames: 6, durationMs: 1030 },
};

/** Notification kind → transient reaction (pack README host mapping). */
export const KIND_TO_REACTION: Record<NotificationKind, Reaction> = {
  success: "jumping",
  error: "failed",
  warning: "waiting",
  info: "waving",
};

/** How many loops a transient reaction plays before returning to idle. */
export const TRANSIENT_LOOPS = 2;

/** Minimum gap between two transient reactions (openpets number). */
export const REACTION_COOLDOWN_MS = 10_000;

export type PetTier = "pet-only" | "hybrid" | "os-only";
export type PetSize = "small" | "medium" | "large";
export type PetMotion = "auto" | "on" | "off";
export type BubbleDuration = "short" | "normal" | "long";

export const PET_SIZE_FACTOR: Record<PetSize, number> = {
  small: 0.75,
  medium: 1,
  large: 1.25,
};

export const BUBBLE_DURATION_MS: Record<BubbleDuration, number> = {
  short: 4000,
  normal: 6500,
  long: 10_000,
};

/** The daemon's near-limit event carries a manual-switch suggestion — the one
 *  actionable bubble in v1 (click navigates to the confirm dialog, never
 *  switches by itself). */
export function isSwitchSuggestion(message: string): boolean {
  return /suggested profile/i.test(message);
}

/** One-line, length-capped speech-bubble text. Control characters and
 *  newlines collapse to spaces so a log-ish message can't deform the bubble. */
export function sanitizeBubble(text: string, max = 140): string {
  // eslint-disable-next-line no-control-regex
  const oneLine = text.replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

export interface PetRouting {
  /** Emit the event to the pet window. */
  toPet: boolean;
  /** Pet replaces desktop notification + toast for this event (tier pet-only). */
  suppressDesktopAndToast: boolean;
}

/** Routing decision for one notification event. Pet reactions are gated by the
 *  pet's OWN per-kind set (independent of the desktop mutes) so "pet reacts to
 *  errors only" is expressible; `osNotified` events stay skipped everywhere. */
export function decidePetRouting(args: {
  petEnabled: boolean;
  tier: PetTier;
  petKinds: readonly NotificationKind[];
  kind: NotificationKind;
  osNotified: boolean;
}): PetRouting {
  const toPet =
    args.petEnabled && !args.osNotified && args.tier !== "os-only" && args.petKinds.includes(args.kind);
  return { toPet, suppressDesktopAndToast: toPet && args.tier === "pet-only" };
}

export type Mood = "watch" | "alarm";

/** Ambient context mood from the worst live-session context fill: quiet below
 *  60%, watch at 60–79%, alarm at ≥80% (mirrors the daemon's default 80/95
 *  thresholds without duplicating them). */
export function contextMood(pct: number | null): Mood | null {
  if (pct == null || pct < 60) return null;
  return pct >= 80 ? "alarm" : "watch";
}

/** Validated pet id — anything unknown falls back to the default pet. */
export function asPetId(raw: string | null): PetId {
  return (PET_IDS as readonly string[]).includes(raw ?? "") ? (raw as PetId) : DEFAULT_PET;
}
