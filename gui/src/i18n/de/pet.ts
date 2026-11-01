import type { pet as en } from "../en/pet.js";

/** German copy – `pet` namespace. Informal "du"; every English key, no extras. */
export const pet: { readonly [K in keyof typeof en]: string } = {
  "pet.hint.switch": "klicken zum Wechseln",
  "pet.hint.update": "klicken zum Aktualisieren",
  "pet.hint.settings": "klicken für Pet-Einstellungen",
};
