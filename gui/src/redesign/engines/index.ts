/**
 * The background engines the window runs while it is open (hidden included —
 * a tray app stays up for weeks). Each lives in its own file with its pure core
 * exported for tests; this hook only composes them inside the store.
 */

import { useLimitAutoOpen } from "./limit-open.js";
import { useNotificationEngine } from "./notifications.js";
import { usePetAndTray } from "./pet.js";
import { useSessionsPoll } from "./sessions-poll.js";
import { useStartupEngines } from "./startup.js";
import { useUpdateWatchers } from "./updates.js";
import { useUsageAutoRefresh } from "./usage-refresh.js";

/** `chatsHere`: how many chats this window runs right now. */
export function useEngines(opts: { chatsHere?: () => number } = {}): void {
  useNotificationEngine();
  useUsageAutoRefresh();
  useSessionsPoll();
  useUpdateWatchers(opts.chatsHere);
  usePetAndTray();
  useStartupEngines();
  useLimitAutoOpen();
}
