/**
 * Small local (localStorage) UI preferences, guarded so a missing/blocked
 * localStorage never throws. Backend state (profiles, per-provider auto-switch)
 * lives in the CLI; these are view-level toggles only.
 */

const AUTOSWITCH_GLOBAL_KEY = "agent-switch-autoswitch-global";

/** Global master for the auto-switch feature. Default ON (available); when the
 *  user turns it off the app hides the toggles/dots and deactivates every
 *  provider's auto-switch. Only the literal "off" disables it. */
export function getAutoSwitchGlobal(): boolean {
  try {
    return localStorage.getItem(AUTOSWITCH_GLOBAL_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setAutoSwitchGlobalFlag(on: boolean): void {
  try {
    localStorage.setItem(AUTOSWITCH_GLOBAL_KEY, on ? "on" : "off");
  } catch {
    /* no/blocked localStorage → in-memory only for this session */
  }
}
