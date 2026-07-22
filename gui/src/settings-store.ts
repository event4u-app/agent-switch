/**
 * Small local (localStorage) UI preferences, guarded so a missing/blocked
 * localStorage never throws. Backend state (profiles, per-provider auto-switch)
 * lives in the CLI; these are view-level toggles only.
 */

import type { NotificationKind } from "./notifications.js";

const AUTOSWITCH_GLOBAL_KEY = "agent-switch-autoswitch-global";

/** Global master for the auto-switch feature. Default OFF — the user must
 *  explicitly turn it on; only the literal "on" enables it. While off, the app
 *  hides the auto-switch toggle/dots and no provider can auto-switch. */
export function getAutoSwitchGlobal(): boolean {
  try {
    return localStorage.getItem(AUTOSWITCH_GLOBAL_KEY) === "on";
  } catch {
    return false;
  }
}

export function setAutoSwitchGlobalFlag(on: boolean): void {
  try {
    localStorage.setItem(AUTOSWITCH_GLOBAL_KEY, on ? "on" : "off");
  } catch {
    /* no/blocked localStorage → in-memory only for this session */
  }
}

const AUTO_REFRESH_KEY = "agent-switch-auto-refresh-limits";

/** Whether usage limits auto-refresh on the 5-minute timer. Default ON — only
 *  the literal "off" disables it (so a fresh install gets the timer). */
export function getAutoRefreshLimits(): boolean {
  try {
    return localStorage.getItem(AUTO_REFRESH_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setAutoRefreshLimitsFlag(on: boolean): void {
  try {
    localStorage.setItem(AUTO_REFRESH_KEY, on ? "on" : "off");
  } catch {
    /* no/blocked localStorage → in-memory only for this session */
  }
}

const REFRESH_INTERVAL_KEY = "agent-switch-refresh-interval-min";

/** Allowed auto-refresh intervals (minutes): 5..60 in 5-minute steps. */
export const REFRESH_INTERVAL_CHOICES = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60] as const;
export const DEFAULT_REFRESH_MINUTES = 10;

/** Auto-refresh interval in minutes. Drives both the countdown timer and the
 *  per-profile usage-fetch cooldown. Default 10; a stored value is clamped to
 *  the nearest allowed step so a bad/legacy entry can never break the timer. */
export function getRefreshMinutes(): number {
  try {
    const raw = Number(localStorage.getItem(REFRESH_INTERVAL_KEY));
    if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_REFRESH_MINUTES;
    return REFRESH_INTERVAL_CHOICES.reduce((best, c) =>
      Math.abs(c - raw) < Math.abs(best - raw) ? c : best,
    );
  } catch {
    return DEFAULT_REFRESH_MINUTES;
  }
}

export function setRefreshMinutes(min: number): void {
  try {
    localStorage.setItem(REFRESH_INTERVAL_KEY, String(min));
  } catch {
    /* no/blocked localStorage → in-memory only for this session */
  }
}

const AUTO_UPDATE_CHECK_KEY = "agent-switch-auto-update-check";

/** Whether the app checks for a newer release automatically (on open + every
 *  24h while running) and notifies when one is found. Default ON — only the
 *  literal "off" disables it, so a fresh install gets update checks. This is a
 *  check-and-notify toggle, NOT silent self-install. */
export function getAutoUpdateCheck(): boolean {
  try {
    return localStorage.getItem(AUTO_UPDATE_CHECK_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setAutoUpdateCheckFlag(on: boolean): void {
  try {
    localStorage.setItem(AUTO_UPDATE_CHECK_KEY, on ? "on" : "off");
  } catch {
    /* no/blocked localStorage → in-memory only for this session */
  }
}

const AUTO_UPDATE_KINDS_KEY = "agent-switch-auto-update-kinds";
const ALL_UPDATE_KINDS = ["major", "minor", "patch"] as const;
type StoredUpdateKind = (typeof ALL_UPDATE_KINDS)[number];

/** Which release types auto-update installs when it is on. Default: all three
 *  (major, minor, patch) — auto-update was turned on, so everything applies
 *  until the user narrows it. Persisted as a comma list; an unknown/missing
 *  value falls back to all. */
export function getAutoUpdateKinds(): StoredUpdateKind[] {
  try {
    const raw = localStorage.getItem(AUTO_UPDATE_KINDS_KEY);
    if (raw == null) return [...ALL_UPDATE_KINDS];
    const kinds = raw.split(",").filter((k): k is StoredUpdateKind => (ALL_UPDATE_KINDS as readonly string[]).includes(k));
    return kinds;
  } catch {
    return [...ALL_UPDATE_KINDS];
  }
}

export function setAutoUpdateKinds(kinds: StoredUpdateKind[]): void {
  try {
    localStorage.setItem(AUTO_UPDATE_KINDS_KEY, kinds.join(","));
  } catch {
    /* no/blocked localStorage → in-memory only for this session */
  }
}

const MINIMIZE_TO_DOCK_KEY = "agent-switch-minimize-to-dock";

/** macOS only: whether the yellow minimize button minimizes the window into the
 *  Dock (standard) or drops the app out of the Dock — same as closing. Default
 *  OFF: the app shows in the Dock while open, but minimizing/closing removes it
 *  from the Dock (it stays reachable from the menu-bar tray). Only the literal
 *  "on" enables minimize-into-Dock. */
export function getMinimizeToDock(): boolean {
  try {
    return localStorage.getItem(MINIMIZE_TO_DOCK_KEY) === "on";
  } catch {
    return false;
  }
}

export function setMinimizeToDockFlag(on: boolean): void {
  try {
    localStorage.setItem(MINIMIZE_TO_DOCK_KEY, on ? "on" : "off");
  } catch {
    /* no/blocked localStorage → in-memory only for this session */
  }
}

const UPDATE_NOTIFIED_VERSION_KEY = "agent-switch-update-notified-version";

/** The newest version we have already toasted the user about, so an automatic
 *  check fires at most one "update available" toast per version (not on every
 *  launch/interval). Empty string = never notified. */
export function getUpdateNotifiedVersion(): string {
  try {
    return localStorage.getItem(UPDATE_NOTIFIED_VERSION_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setUpdateNotifiedVersion(version: string): void {
  try {
    localStorage.setItem(UPDATE_NOTIFIED_VERSION_KEY, version);
  } catch {
    /* no/blocked localStorage → in-memory only for this session */
  }
}

const NEXT_USAGE_REFRESH_AT_KEY = "agent-switch-next-usage-refresh-at";

/** Wall-clock (unix ms) of the next scheduled usage refresh, persisted so a dev
 *  rebuild/reload does NOT restart the countdown (which would re-fetch and burn
 *  the rate-limited endpoint). 0 = unset. */
export function getNextUsageRefreshAt(): number {
  try {
    const n = Number(localStorage.getItem(NEXT_USAGE_REFRESH_AT_KEY));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function setNextUsageRefreshAt(ts: number): void {
  try {
    localStorage.setItem(NEXT_USAGE_REFRESH_AT_KEY, String(ts));
  } catch {
    /* no/blocked localStorage → in-memory only for this session */
  }
}

const AGENT_CONFIG_NOTIFIED_VERSION_KEY = "agent-switch-agent-config-notified-version";

/** The newest agent-config version we have already notified about, so the
 *  hourly check fires at most one "update available" notification per version.
 *  Empty string = never notified. */
export function getAgentConfigNotifiedVersion(): string {
  try {
    return localStorage.getItem(AGENT_CONFIG_NOTIFIED_VERSION_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setAgentConfigNotifiedVersion(version: string): void {
  try {
    localStorage.setItem(AGENT_CONFIG_NOTIFIED_VERSION_KEY, version);
  } catch {
    /* no/blocked localStorage → in-memory only for this session */
  }
}

const NOTIF_LAST_READ_KEY = "agent-switch-notif-last-read";

/** Timestamp (unix ms) of the newest notification the user has seen. The bell's
 *  unread count is the number of notifications newer than this. Default 0 (a
 *  fresh install treats every existing notification as unread). */
export function getNotifLastRead(): number {
  try {
    const raw = Number(localStorage.getItem(NOTIF_LAST_READ_KEY));
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  } catch {
    return 0;
  }
}

export function setNotifLastRead(ts: number): void {
  try {
    localStorage.setItem(NOTIF_LAST_READ_KEY, String(ts));
  } catch {
    /* no/blocked localStorage → in-memory only for this session */
  }
}

const SHARE_GLOBAL_KEY = "agent-switch-share-global";

/** Whether the global ~/.claude content (agent-config skills etc.) should be
 *  linked into every profile. Default ON — only the literal "off" disables it,
 *  so a fresh install shares by default. The GUI reconciles the real link state
 *  to this preference. */
export function getShareGlobal(): boolean {
  try {
    return localStorage.getItem(SHARE_GLOBAL_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setShareGlobalFlag(on: boolean): void {
  try {
    localStorage.setItem(SHARE_GLOBAL_KEY, on ? "on" : "off");
  } catch {
    /* no/blocked localStorage → in-memory only for this session */
  }
}

const DEV_MODE_KEY = "agent-switch-dev-mode";

/** Developer mode — unlocks in-app test helpers (generate notifications, force
 *  an auto-switch). Default OFF. The toggle is only offered when the app runs
 *  from a dev build (`import.meta.env.DEV`), so a shipped release can neither
 *  show nor enable it. */
export function getDevMode(): boolean {
  try {
    return localStorage.getItem(DEV_MODE_KEY) === "on";
  } catch {
    return false;
  }
}

export function setDevModeFlag(on: boolean): void {
  try {
    localStorage.setItem(DEV_MODE_KEY, on ? "on" : "off");
  } catch {
    /* no/blocked localStorage → in-memory only for this session */
  }
}

const MUTED_KINDS_KEY = "agent-switch-muted-notif-kinds";

/** Notification kinds the user has muted — suppressed from desktop, toast, and
 *  the unread badge (they still land in the CLI log). Default: none muted. */
export function getMutedKinds(): NotificationKind[] {
  try {
    const stored = localStorage.getItem(MUTED_KINDS_KEY);
    // Default (never set): mute `warning` — the "Usage fetch failed" class — so a
    // transient rate-limit blip doesn't nag on desktop/toast/badge (it still
    // lands in the flyout log). An explicit stored value (incl. `[]`) wins.
    if (stored === null) return ["warning"];
    const raw: unknown = JSON.parse(stored);
    return Array.isArray(raw) ? (raw.filter((k) => typeof k === "string") as NotificationKind[]) : [];
  } catch {
    return ["warning"];
  }
}

export function setMutedKinds(kinds: NotificationKind[]): void {
  try {
    localStorage.setItem(MUTED_KINDS_KEY, JSON.stringify(kinds));
  } catch {
    /* no/blocked localStorage → in-memory only for this session */
  }
}

const HIDE_SUMMARIES_KEY = "agent-switch-hide-summaries";

/** Suppress session summaries in the Sessions list (the one pre-existing
 *  transcript-content egress to the GUI). Default OFF — summaries show unless
 *  the user opts to hide them. */
export function getHideSummaries(): boolean {
  try {
    return localStorage.getItem(HIDE_SUMMARIES_KEY) === "on";
  } catch {
    return false;
  }
}

export function setHideSummariesFlag(on: boolean): void {
  try {
    localStorage.setItem(HIDE_SUMMARIES_KEY, on ? "on" : "off");
  } catch {
    /* no/blocked localStorage → in-memory only for this session */
  }
}
