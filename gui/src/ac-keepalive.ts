/**
 * Keepalive for the embedded agent-config view. AC's local server idle-shuts
 * after 30 min without an authed /api/* request, so while the view is VISIBLE
 * we ping comfortably inside that window. The section UI (a later phase)
 * calls startKeepalive() when the view becomes visible and stopKeepalive()
 * when it hides — a backgrounded AS must never hold a server open forever.
 */

import { acApi, acEnsure } from "./ipc.js";

/** Well inside AC's 30-min idle window. */
export const KEEPALIVE_INTERVAL_MS = 5 * 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;

/** Start pinging (idempotent — a running keepalive is restarted). Fires one
 *  immediate ping: if the server idle-shut while the view was hidden, the
 *  ensure fallback respawns it transparently the moment the view is visible. */
export function startKeepalive(intervalMs: number = KEEPALIVE_INTERVAL_MS): void {
  stopKeepalive();
  timer = setInterval(() => {
    void pingOnce();
  }, intervalMs);
  void pingOnce();
}

export function stopKeepalive(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

/** One authed ping; on any failure a single acEnsure() — the transparent
 *  respawn path. An ensure failure is left for the section UI to surface on
 *  the next interaction (no retry loop here). */
async function pingOnce(): Promise<void> {
  try {
    const res = await acApi("GET", "/api/v1/ping");
    if (res.status === 200) return;
  } catch {
    /* fall through to ensure */
  }
  try {
    await acEnsure();
  } catch {
    /* surfaced by the section UI, not the keepalive */
  }
}
