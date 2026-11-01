import type { tray as en } from "../en/tray.js";

/** German copy – `tray` namespace. Informal "Du"; every English key, no extras. */
export const tray: { readonly [K in keyof typeof en]: string } = {
  "tray.ready": "Bereit",
  "tray.checkHealth": "Zustand prüfen",
  "tray.appFallback": "App",
  "tray.working": "{count} aktiv",
  "tray.ctxTitle": "Vollstes Kontextfenster einer laufenden Sitzung",
  "tray.ctx": "Kontext {pct}\u00a0%",
  "tray.paused": "{count} pausiert",
  "tray.updates_one": "{count} Update",
  "tray.updates_other": "{count} Updates",
  "tray.startSession": "Sitzung starten",
  "tray.quit": "Agent Switch beenden",
};
