import type { engines as en } from "../en/engines.js";

/** German copy – `engines` namespace. Informal "Du"; every English key, no extras. */
export const engines: { readonly [K in keyof typeof en]: string } = {
  "engines.notice.limitNearTitle": "Limit fast erreicht",
  "engines.notice.limitNearRebind":
    "{tool}/{account} hat ≥{threshold}\u00a0% erreicht – Vorschlag: {tool}/{target}. Wechsle mit `agent-switch rebind` (kein automatischer Wechsel).",
  "engines.notice.limitNearManual": "{tool}/{account} hat ≥{threshold}\u00a0% erreicht – Vorschlag: {tool}/{target}. Wechsle von Hand (kein automatischer Wechsel).",
  "engines.notice.switchedTitle": "Konto gewechselt",
  "engines.notice.switchedBody": "{tool} nutzt jetzt {name}.",
  "engines.notice.deactivatedTitle": "Konto deaktiviert",
  "engines.notice.deactivatedBodyNamed": "Das aktive {tool}-Konto ({name}) ist deaktiviert.",
  "engines.notice.deactivatedBody": "Das aktive {tool}-Konto ist deaktiviert.",
  "engines.notice.updatedTitle": "Auf {tag} aktualisiert",
  "engines.notice.updatedBody": "Starte agent-switch neu, damit es greift.",
  "engines.notice.updateFailedTitle": "Update auf {tag} fehlgeschlagen",
  "engines.notice.updateFailedBody": "Versuch es unter Einstellungen › Updates erneut.",
  "engines.notice.updateAvailableTitle": "Update verfügbar – {tag}",
  "engines.notice.updateAvailableBody": "Installiere es unter Einstellungen › Updates.",
  "engines.notice.updateAvailableBodyKind": "Installiere es unter Einstellungen › Updates ({kind}).",
  "engines.notice.agentConfigTitle": "agent-config-Update verfügbar",
  "engines.notice.agentConfigBodyHighlight": "v{current} → v{latest} – {highlight} · Neuigkeiten unter Tools → agent-config.",
  "engines.notice.agentConfigBody": "v{current} → v{latest} · Neuigkeiten unter Tools → agent-config.",
  "engines.notice.toolUpdateTitle": "{tool}: Update verfügbar",
  "engines.notice.toolUpdateBody": "v{current} → v{latest} – aktualisiere es unter Tools.",
  "engines.notice.waitingTitle": "{project} wartet auf dich",
  "engines.notice.waitingBody": "Eine Sitzung auf {name} hat eine Frage an dich.",
  "engines.notice.usageFetchFailedTitle": "Nutzung nicht abrufbar",
  "engines.notice.usageFetchFailedBody": "Die Nutzungslimits für {profile} ließen sich nicht abrufen.",
  "engines.notice.usageFetchFailedOutage":
    "Die Nutzungslimits für {profile} ließen sich seit {minutes} Min. nicht abrufen. Die letzten bekannten Werte bleiben stehen.",
};
