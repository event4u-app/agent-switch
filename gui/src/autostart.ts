/**
 * Start at login: default ON for a fresh install, and a user's OFF survives
 * every update.
 *
 * The preference (`unset | enabled(first-run|user) | disabled(user)`) lives in
 * the GUI settings file via the CLI, separate from the OS login item, so it can
 * tell "never decided" from "turned off". The first-run transaction enables the
 * login item, READS the OS state back, and only then persists `enabled
 * (first-run)`; if the OS does not confirm, nothing is persisted, the state is
 * `degraded`, and the next launch retries.
 *
 * Migration: 2.1.0 enabled autostart once and set the `localStorage` key
 * `agent-switch-autostart-defaulted`. With that key present the default already
 * ran, so the current OS state IS the user's choice — it is recorded as is and
 * never switched back on.
 */

export type AutostartPref =
  | { state: "unset" }
  | { state: "enabled"; by: "first-run" | "user" }
  | { state: "disabled"; by: "user" };

export type AutostartStatus = "enabled" | "disabled" | "degraded";

export interface AutostartDeps {
  readPref: () => Promise<AutostartPref>;
  writePref: (state: "enabled" | "disabled", by: "first-run" | "user") => Promise<void>;
  markDegraded: (reason: string) => Promise<void>;
  osEnable: () => Promise<void>;
  osDisable: () => Promise<void>;
  osIsEnabled: () => Promise<boolean>;
  legacyDefaulted: () => boolean;
}

export const LEGACY_AUTOSTART_KEY = "agent-switch-autostart-defaulted";

async function osState(d: AutostartDeps): Promise<boolean | null> {
  try {
    return await d.osIsEnabled();
  } catch {
    return null;
  }
}

/** Run once per launch. Never throws. */
export async function reconcileAutostart(d: AutostartDeps): Promise<AutostartStatus> {
  let pref: AutostartPref;
  try {
    pref = await d.readPref();
  } catch {
    // Without the stored preference we cannot tell a user's off from "never
    // decided" — touch nothing, and report what the OS says.
    return (await osState(d)) ? "enabled" : "degraded";
  }
  if (pref.state === "disabled") return "disabled";
  if (pref.state === "enabled") return (await osState(d)) ? "enabled" : "degraded";

  if (d.legacyDefaulted()) {
    const on = await osState(d);
    if (on === null) return "degraded";
    await d.writePref(on ? "enabled" : "disabled", on ? "first-run" : "user").catch(() => {});
    return on ? "enabled" : "disabled";
  }

  try {
    await d.osEnable();
  } catch {
    /* confirmed (or not) by the read-back below */
  }
  const on = await osState(d);
  if (on) {
    await d.writePref("enabled", "first-run").catch(() => {});
    return "enabled";
  }
  await d.markDegraded(on === null ? "the system state could not be read" : "the system did not confirm the login item").catch(() => {});
  return "degraded";
}

/** The Settings toggle: an explicit user choice, persisted as such. */
export async function setAutostartPreference(on: boolean, d: AutostartDeps): Promise<void> {
  if (on) await d.osEnable();
  else await d.osDisable();
  await d.writePref(on ? "enabled" : "disabled", "user");
}
