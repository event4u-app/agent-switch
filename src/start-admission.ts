/**
 * Start admission: a routed start picks an account, then prepares it (a
 * settings sync) before the binary runs. A sign-in or rebind in that window
 * would put the binary on a login nobody picked, so the account is read again
 * right before the spawn and any change refuses the start.
 *
 * The shell wrapper spawns the binary itself after `dir --guard` has exited;
 * that last step is outside this check, which is why the CLI reference calls
 * the wrapper's pick advisory from that point on.
 */

/** Why a start may not go ahead, or null when the account is the one picked. */
export function admissionRefusal(key: string, atPick: string | null, atStart: string | null): string | null {
  if (atPick === atStart) return null;
  return `${key} changed its sign-in between the pick and the start (${atPick ?? "signed out"} → ${atStart ?? "signed out"}); start again to pick anew`;
}
