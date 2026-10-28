/**
 * The background engines the window runs while it is open (hidden included —
 * a tray app stays up for weeks). Each lives in its own file with its pure core
 * exported for tests; this hook only composes them inside the store.
 */

import { useNotificationEngine } from "./notifications.js";
import { usePetAndTray } from "./pet.js";
import { useStartupEngines } from "./startup.js";
import { useUpdateWatchers } from "./updates.js";
import { useUsageAutoRefresh } from "./usage-refresh.js";

export function useEngines(): void {
  useNotificationEngine();
  useUsageAutoRefresh();
  useUpdateWatchers();
  usePetAndTray();
  useStartupEngines();
}
