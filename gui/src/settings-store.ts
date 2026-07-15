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
