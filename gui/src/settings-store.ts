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
