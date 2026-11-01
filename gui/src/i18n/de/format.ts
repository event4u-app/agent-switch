import type { format as en } from "../en/format.js";

/** German copy – `format` namespace. Informal "Du"; every English key, no extras. */
export const format: { readonly [K in keyof typeof en]: string } = {
  "format.now": "jetzt",
  "format.justNow": "soeben",
  "format.minAgo": "vor {count} Min.",
  "format.hAgo": "vor {count} Std.",
  "format.daysAgo_one": "vor {count} Tag",
  "format.daysAgo_other": "vor {count} Tagen",
  "format.expired": "abgelaufen",
  "format.today": "heute",
  "format.tomorrow": "morgen",
  "format.inDays_one": "in {count} Tag",
  "format.inDays_other": "in {count} Tagen",
};
