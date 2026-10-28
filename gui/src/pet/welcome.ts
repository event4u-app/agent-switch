/**
 * The Pet intro is shown once per install (D36). The flag lives in the GUI
 * settings file (via `agent-switch gui-settings`), not only in the webview's
 * `localStorage`, which a reinstall or a cleared webview profile resets. The old
 * `localStorage` flag is migrated in, and kept in sync as a fallback for when
 * the CLI cannot be reached.
 */

export interface PetWelcomeDeps {
  /** The file flag; `undefined` when it could not be read. */
  readFileFlag: () => Promise<boolean | undefined>;
  writeFileFlag: () => Promise<void>;
  legacyWelcomed: () => boolean;
  markLegacy: () => void;
}

/** True exactly when the caller should show the intro now. Persists the flag
 *  BEFORE returning true, so a crash mid-intro never shows it a second time. */
export async function claimPetWelcome(d: PetWelcomeDeps): Promise<boolean> {
  let fromFile: boolean | undefined;
  try {
    fromFile = await d.readFileFlag();
  } catch {
    fromFile = undefined;
  }
  if (fromFile === true) return false;
  const legacy = d.legacyWelcomed();
  d.markLegacy();
  try {
    await d.writeFileFlag();
  } catch {
    /* the legacy flag still guards this webview */
  }
  return !legacy;
}
