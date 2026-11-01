import type { overview as en } from "../en/overview.js";

/** German copy – `overview` namespace. Informal "Du"; every English key, no extras. */
export const overview: { readonly [K in keyof typeof en]: string } = {
  "overview.title": "Was ist los?",
  "overview.reading": "Liest Konten und Sitzungen …",
  "overview.needsYou": "Braucht dich",
  "overview.nothingNeedsYou": "Nichts braucht dich. Sitzungen laufen auf ihren Konten weiter.",
  "overview.monitoringHint": "Fragen einer Sitzung erscheinen hier; eine Berechtigungsabfrage nur mit {link}.",
  "overview.monitoringLink": "eingeschalteter Sitzungsüberwachung",
  "overview.runningNow": "Läuft gerade",
  "overview.nothingRuns": "Gerade läuft nichts.",
  "overview.whatsLeft": "Was übrig ist",
  "overview.promo.title": "Mehr Power für deine KI-Agenten mit {name} – kostenlos & Open Source",
  "overview.promo.sub": "Skills, Befehle und Regeln in jeder Sitzung – Agent Switch installiert und aktualisiert es für dich.",
  "overview.promo.install": "Installieren",
  "overview.promo.notNow": "Nicht jetzt – es bleibt unter Tools",
  "overview.firstRun.title": "Lass uns dein erstes Konto hinzufügen",
  "overview.firstRun.sub": "Agent Switch hält deine Konten getrennt und gibt jeder Sitzung das richtige. Deine Tools funktionieren genau wie vorher.",
  "overview.firstRun.found": "Auf diesem Computer gefunden",
  "overview.firstRun.nothingChanged": "Nichts wurde geändert. Deine aktuellen Anmeldungen bleiben, wo sie sind.",
  "overview.firstRun.addAccount": "Konto hinzufügen",
  "overview.firstRun.whatWorksWhere": "Sehen, was wo funktioniert",
};
