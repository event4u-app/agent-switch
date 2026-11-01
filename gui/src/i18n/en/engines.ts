/** English copy — `engines` namespace. Keys are "engines.<name>"; `{param}` interpolates;
 *  plural sets use the suffixes _one / _other (Intl.PluralRules categories).
 *
 *  `engines.notice.*` are the notifications the GUI records into the shared log.
 *  The log keeps the English text (the daemon's dedup and the pet's click routing
 *  match it), so these English strings are also the parse templates that turn a
 *  logged notice back into the live language at display time — change one only
 *  together with every reader of that text. */
export const engines = {
  "engines.notice.limitNearTitle": "Usage limit near",
  "engines.notice.limitNearRebind":
    "{tool}/{account} hit ≥{threshold}% — suggested profile: {tool}/{target}. Run `agent-switch rebind` to switch (no automatic switch).",
  "engines.notice.limitNearManual": "{tool}/{account} hit ≥{threshold}% — suggested profile: {tool}/{target}. Switch manually (no automatic switch).",
  "engines.notice.switchedTitle": "Account switched",
  "engines.notice.switchedBody": "{tool} is now using {name}.",
  "engines.notice.deactivatedTitle": "Account deactivated",
  "engines.notice.deactivatedBodyNamed": "Deactivated the active {tool} account ({name}).",
  "engines.notice.deactivatedBody": "Deactivated the active {tool} account.",
  "engines.notice.updatedTitle": "Updated to {tag}",
  "engines.notice.updatedBody": "Restart agent-switch to apply.",
  "engines.notice.updateFailedTitle": "Update to {tag} failed",
  "engines.notice.updateFailedBody": "Open Settings › Updates to retry.",
  "engines.notice.updateAvailableTitle": "Update available — {tag}",
  "engines.notice.updateAvailableBody": "Open Settings › Updates to install it.",
  "engines.notice.updateAvailableBodyKind": "Open Settings › Updates to install it ({kind}).",
  "engines.notice.agentConfigTitle": "agent-config update available",
  "engines.notice.agentConfigBodyHighlight": "v{current} → v{latest} — {highlight} · read what's new under Tools → agent-config.",
  "engines.notice.agentConfigBody": "v{current} → v{latest} · read what's new under Tools → agent-config.",
  "engines.notice.toolUpdateTitle": "{tool} update available",
  "engines.notice.toolUpdateBody": "v{current} → v{latest} — open Tooling to update.",
  "engines.notice.waitingTitle": "{project} is waiting for you",
  "engines.notice.waitingBody": "A session on {name} asks you something.",
  "engines.notice.usageFetchFailedTitle": "Usage fetch failed",
  "engines.notice.usageFetchFailedBody": "Could not fetch usage limits for {profile}.",
  "engines.notice.usageFetchFailedOutage": "Could not fetch usage limits for {profile} for {minutes} min. Keeping the last known values.",
} as const;
