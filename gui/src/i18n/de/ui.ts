import type { ui as en } from "../en/ui.js";

/** German copy – `ui` namespace. Informal "Du"; every English key, no extras. */
export const ui: { readonly [K in keyof typeof en]: string } = {
  "ui.copy.copyText": "{text} kopieren",
  "ui.meter.windowUsed": "Fenster {label} genutzt",
  "ui.meter.windowChecked": "Fenster {label} · {checked}",
  "ui.meter.old": "{age} alt",
  "ui.meter.usageUnknown": "Nutzung unbekannt",
  "ui.meter.checkedJustNow": "gerade geprüft",
  "ui.meter.checkedAgo": "vor {age} geprüft",
  "ui.meter.justNow": "soeben",
  "ui.meter.ago": "vor {age}",
};
