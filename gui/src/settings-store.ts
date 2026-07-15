/**
 * Small local (localStorage) UI preferences, guarded so a missing/blocked
 * localStorage never throws. Backend state (profiles, per-provider auto-switch)
 * lives in the CLI; these are view-level toggles only.
 */

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
