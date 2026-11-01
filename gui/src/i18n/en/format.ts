/** English copy — `format` namespace. Keys are "format.<name>"; `{param}` interpolates;
 *  plural sets use the suffixes _one / _other (Intl.PluralRules categories). */
export const format = {
  "format.now": "now",
  "format.justNow": "just now",
  "format.minAgo": "{count} min ago",
  "format.hAgo": "{count} h ago",
  "format.daysAgo_one": "{count} d ago",
  "format.daysAgo_other": "{count} d ago",
  "format.expired": "expired",
  "format.today": "today",
  "format.tomorrow": "tomorrow",
  "format.inDays_one": "in {count} day",
  "format.inDays_other": "in {count} days",
} as const;
