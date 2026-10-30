# Parity checklist — classic window → redesign

The classic `App.tsx` page tree is retired; `main.tsx` mounts `RedesignApp`
directly (no flag). This file lists every export of `gui/src/ipc.ts` and where
the redesign reaches it, or why it is intentionally unreachable from the UI.
Paths are relative to `gui/src/`.

## Background engines (were LegacyApp effects)

| Behaviour | New home |
|---|---|
| Usage auto-refresh timer (toggle + interval, re-based on change, persisted deadline) | `redesign/engines/usage-refresh.ts` |
| Usage fetch: cache, per-account cooldown, Claude stagger, sticky resets, "Usage fetch failed" notice, manual refresh forces + restarts countdown, rename drops cache | `vm/usage-loader.ts` (used by `vm/load.ts`), `vm/actions.ts` (`refreshUsage`, `updateAccount`) |
| 24 h agent-switch auto-update (install enabled kinds, notify others, dedupe, retry failed) | `redesign/engines/updates.ts` (`runAutoUpdateCheck`, `updateDue`) |
| agent-config update notice (hourly, once per version, only when installed) | `redesign/engines/updates.ts` (`checkAgentConfigUpdate`) |
| Notification fire path: desktop → toast fallback, osNotified skip, mute kinds, pet routing / `petDeliver`, max 5 per sync, no history replay | `redesign/engines/notifications.ts` |
| Muted kinds hidden from sheet + badge | `vm/load.ts`, `redesign/engines/notifications.ts` |
| Session monitoring: hooks re-ensured on open, 5 s log poll while on | `redesign/engines/notifications.ts` |
| Desktop-notification click → window + notifications sheet | `redesign/engines/notifications.ts` |
| Clear all → also removes this app's delivered desktop notifications (`clearDesktopNotifications`, classic `clearNotifs`) | `vm/actions.ts` (`clearNotifications`). The redesign missed this until now: it cleared the log only and its confirm text said nothing else changes. |
| Slow readouts cached between reloads: tooling sweep (re-run on "Check now", on tray focus when ≥ 60 s old, after a tooling terminal run), latest-version lookups (at most hourly per tool), `doctor` (re-run on Health open, "Check again", a repair, autostart / shared-setup writes) | `vm/slow-cache.ts` (used by `vm/load.ts`). Before, every reload — after each action and each tray focus — re-ran all three and spent the unauthenticated GitHub budget. |
| Record-and-sync from any writer (incl. the tray window via a Tauri event) | `redesign/engines/bus.ts` |
| Tray tooltip (`setTrayTooltip`) + pet mood/working (`petEmitContext`) after every load | `redesign/engines/pet.ts` (`pushContext`) |
| Pet show-on-open (presence "always") + one-time `PET_WELCOME` (`claimPetWelcome`) | `redesign/engines/pet.ts` (`petStartup`) |
| Pet bubble click navigation (`onPetAction`) | `redesign/engines/pet.ts` (`petRoute`) |
| Switch notice ("Account switched / deactivated") + shared-setup relink after use / rebind | `redesign/engines/switch-effects.ts` (main window and tray) |
| Near-limit threshold lowered past current usage → immediate notice | `redesign/engines/near-limit.ts`, wired in `screens/settings/protection.tsx` |
| Minimize-to-Dock pushed to Rust on open | `redesign/engines/startup.ts` |
| Shared-setup reconcile on open and when the Claude account set changes | `redesign/engines/startup.ts` (`reconcileShare`) |
| Theme before first paint; launch-at-login default (`applyAutostartDefault` → `autostart.ts` `reconcileAutostart`) | `main.tsx` (unchanged — never lived in LegacyApp) |
| Tray popover enabled by the main window | `redesign/tray/bridge.ts` `useTrayRequests` (now always mounted) |
| agent-config keepalive (`ac-keepalive.ts`) | **Not started** — it serves the embedded agent-config view, which neither window wires (owner decision: browser flow). Starting it without a visible view would hold AC's server open forever, which the module forbids. |

## ipc.ts exports

| Export | Reached from | Note |
|---|---|---|
| `agentConfigVersion` | `redesign/engines/updates.ts` | |
| `acDiscover` | `vm/load.ts` | |
| `acOpenInBrowser` | `vm/actions.ts` → `screens/tools.tsx` | |
| `acForceRestart` | `vm/actions.ts` → `screens/tools.tsx` | |
| `acEnsure`, `acApi` | `ac-keepalive.ts` only | Keepalive not started (see above). |
| `acRelease` | Rust on app exit | No UI control by design. |
| `acOpenSettingsWindow` | — | Embedded view deliberately not UI-wired (owner decision 2026-07-24), same as the classic window. |
| `shareStatus` | `screens/tools.tsx`, `engines/startup.ts`, `engines/switch-effects.ts` | |
| `shareOn`, `shareOff` | `vm/actions.ts` → `screens/tools.tsx`; `engines/startup.ts` | |
| `shareSync` | `vm/actions.ts`, `screens/fix-dialog.tsx`, `engines/switch-effects.ts` | |
| `toolingStatus` | `vm/load.ts` | |
| `runToolingAction` | — | Install / update now run visibly in the built-in terminal (`tooling install|upgrade <id>`, `screens/terminal-sheet.tsx`), per the design's update sheet. The classic one-click background run for agent-config is replaced by that visible run. |
| `listProfiles` | `vm/load.ts`, `screens/reauth.tsx` | |
| `activeStatus` | — | Unused by both windows (kept for the CLI contract tests). |
| `switchProfile` | `vm/actions.ts` (`setDefault`) | |
| `rebindArgs` | via `rebindTo` | Pure builder. |
| `rebindTo` | `vm/actions.ts` (`rebind`) → session sheet, near-limit sheet | |
| `deactivateProfile` | `vm/actions.ts` (`deactivate`) → `screens/account-actions.tsx` | |
| `installSessionHooks`, `uninstallSessionHooks` | `screens/settings/notifications.tsx`; install also `engines/notifications.ts` | |
| `removeProfile`, `renameProfile`, `setProfileLabel` | `vm/actions.ts` → account menu / sheet | |
| `setProfileDisabled` | `vm/actions.ts` (`setAccountDisabled`: row menu Disable / Turn back on) | |
| `installShellIntegration` | `vm/actions.ts` (red banner in `Shell.tsx`, Health fix) | |
| `setProfileColor` | `vm/actions.ts` (`updateAccount`: colour picked in Add account and the account flyout) | |
| `PROFILE_NAME_RE`, `assertValidName` | `screens/account-logic.ts`; internal | |
| `loginArgs` | `screens/account-logic.ts` (add account) | |
| `reloginArgs` | `screens/account-logic.ts` (sign in again — `agent-switch login`) | |
| `sessionArgs` | `screens/start-session.tsx` (now with `--cwd`) | |
| `openWeb` | `vm/actions.ts` (`openUsagePage`) | |
| `profileUsage` | `vm/usage-loader.ts` | |
| `usageHistory` | `screens/usage-history.tsx` | |
| `getAutoSwitch`, `setAutoSwitch` | `screens/settings/protection.tsx` | |
| `redeemReset` | `vm/actions.ts` → `screens/account-actions.tsx` | |
| `getProviders` | `vm/load.ts` | |
| `setProvider`, `linkProviderBinary`, `unlinkProviderBinary` | `vm/actions.ts` → `screens/settings/providers.tsx` | |
| `uninstall` | `vm/actions.ts` → `screens/settings/advanced.tsx` | |
| `getAutostart` | `vm/load.ts` | |
| `setAutostart` | `screens/settings/general.tsx`, `screens/health.tsx`, `screens/fix-dialog.tsx` | |
| `getAutostartPreference` | `screens/health.tsx` | |
| `applyAutostartDefault` | `main.tsx` | |
| `claimPetWelcome` | `engines/pet.ts` | |
| `listApps` | `vm/load.ts` | |
| `openApp` | `vm/actions.ts` → apps, account sheet/menu, start session; tray account rows via `bridge.ts` `TRAY_APP_EVENT` (validated by `appRequest`, run in the main window — the tray stays read-only) | |
| `listLaunchers` | `vm/load.ts` → `ViewModel.launchers` | |
| `setLauncher` | `vm/actions.ts` → Tools › Apps, one switch per app × account (macOS only) | |
| `copyAppSettings` | `vm/actions.ts` → Tools › Apps, account row menu (apps whose layout the CLI knows) | |
| `listSessions` | `vm/load.ts`, `engines/pet.ts` | |
| `sessionPreview` | `vm/actions.ts` (`previewSession`) → session sheet | |
| `deleteSession`, `deleteSessionArgs` | `vm/actions.ts` (`trashSession`) | |
| `restoreSession` | `vm/actions.ts`, `screens/session-sheet.tsx` | |
| `extractHandoffBrief` | `vm/actions.ts` (`handoffBrief`) | |
| `handoffSeedArgs`, `takeoverArgs`, `compactArgs` | `screens/session-sheet.tsx`, `screens/near-limit.tsx` | |
| `getNotifyConfig`, `setNotify` | `screens/settings/notifications.tsx` | |
| `setTrayTooltip` | `engines/pet.ts` | |
| `quitApp` | `vm/actions.ts` → settings, tray | |
| `restartApp` | `vm/actions.ts` → `screens/settings/updates.tsx`, `screens/terminal-sheet.tsx` (after an update) | |
| `showWindow` | — | The redesign shows the window through `notifications.ts` `showAppWindow` / tray `bridge.ts` (same `show_window` command). |
| `setMinimizeToDock` | `screens/settings/general.tsx`, `engines/startup.ts` | |
| `selfUpdate` | `vm/actions.ts` → `screens/settings/updates.tsx`; `engines/updates.ts` | |
| `listNotifications` | `vm/load.ts`, `engines/notifications.ts` | |
| `recordNotification` | `engines/bus.ts` (every notice the window records) | |
| `clearNotifications` | `vm/actions.ts` → `screens/notifications-sheet.tsx` | Followed by `notifications.ts` `clearDesktopNotifications`. |
| `getOsNotify`, `setOsNotify` | `screens/settings/notifications.tsx`; `getOsNotify` also `engines/notifications.ts` | |
| `petShow`, `petHide`, `petResetPosition`, `petEmitPose`, `petMoveTo` | `screens/settings/pet.tsx`; `petShow` also `engines/pet.ts` | |
| `petEmitNotification`, `petEmitContext`, `onPetAction` | `engines/pet.ts` | |
| `petDeliver` | `engines/notifications.ts`, `screens/settings/pet.tsx` (test bubbles) | |
| `memberKey` | internal (protection / pool commands) | |
| `listProtection` | `vm/load.ts` | |
| `setProtection` | `vm/actions-foundations.ts` → account sheet, settings › protection | |
| `listPools` | `vm/load.ts` | |
| `createPool`, `addPoolMember` | `screens/settings/distribution.tsx`; via `act` | |
| `removePoolMember` | `vm/actions-foundations.ts` (`setPoolMembership`) → account sheet | |
| `createPool`, `renamePool`, `deletePool`, `addPoolMember`, `removePoolMember` | `screens/pools-panel.tsx` (Accounts › Projects & pools: New pool, rename / delete in the card's ⋯ menu, member chips) | |
| `suggestPools`, `confirmPoolSuggestions` | `vm/actions-foundations.ts` seam only | No control yet; reachable via `agent-switch pool suggest`. |
| `listMappings` | `vm/load.ts` | Now `mappings --json`. |
| `parseMappings` | `listMappings` fallback | Only for a CLI older than `mappings --json`, which ignores the flag and prints text. |
| `mapFolder`, `unmapFolder` | `vm/actions-foundations.ts` → **Accounts › Projects & pools: Add binding form + row menu "Edit binding" (inline, same form) and "Remove binding"** (new) | |
| `setMappingPaused` | `vm/actions-foundations.ts` `setBindingPaused` → the per-binding switch (`map --pause/--resume`) | |
| `resolveDir` | `vm/actions-foundations.ts` (`explainFolder`) → Projects & pools "Try a folder" | |
| `authStatus` | `vm/load.ts` | |
| `doctor` | `vm/load.ts`, `screens/health.tsx`, `screens/fix-dialog.tsx` | |
| `listActivity` | `vm/load.ts`, `vm/actions-foundations.ts` | |
| `getGuard`, `setGuard` | `vm/load.ts`; `screens/settings/advanced.tsx` | |
| Types (`AcStatus`, `AcError`, `AcApiResponse`, `ShareStatus`, `ToolingId`, `ToolingIdentity`, `ToolingEntry`, `UsageHistorySample`, `UsageHistoryProfile`, `AutoSwitch`, `AutoSwitchMap`, `AppInfo`, `NotifyConfig`, `SelfUpdateResult`, `ProtectionRow`, `PoolRow`, `PoolListRow`, `PoolProposal`, `MappingRow`, `DirResolution`, `AuthStatusRow`, `DoctorCheckRow`, `DoctorReport`, `ActivityEntryKind`, `ActivityEntry`, `GuardPolicy`, `GuardStatus`) | — | Types only. |

## Gaps closed in this change

- **Start session in a folder**: `sessionArgs(provider, name, cwd)` adds `--cwd`; the preview reads `<folder> $ claude`. The "Not available here: starting in …" line is gone (the desktop-app path still says the app opens without a folder).
- **Folder bindings**: Add binding (folder + tool + account or pool) and Remove binding were disabled / missing.
- **Near-limit test fire** on lowering the threshold (classic footer select).
- **Switch notices + shared relink** on use / deactivate / rebind (classic `runUse` / `runOff`).
- **Every engine above** — the redesign window was not self-sufficient before.

## Deleted with the classic tree

| File | Covered by |
|---|---|
| `App.tsx`, `App.test.tsx` | Engine behaviours → `redesign/engines/engines.test.ts`, `notification-engine.test.tsx`; screens → `redesign/**/*.test.tsx` |
| `redesign/flag.ts` | — (flag removed) |
| `Sidebar.tsx` | `redesign/Shell.tsx` (`Shell.test.tsx`) |
| `UsageSection.tsx` (+ test), `UsageBars.tsx` (+ test) | Accounts list meters + `screens/usage-history.tsx` (`accounts.test.tsx`) |
| `ToolingSection.tsx` (+ test) | `screens/tools.tsx` (`screens-b.test.tsx`) |
| `AgentConfigCard.tsx` (+ test), `ReleaseNotes.tsx` (+ test) | Tools › agent-config card + its release notes list, Overview promo (`screens-b.test.tsx`, `screens.test.tsx`) |
| `NotificationBell.tsx`, `notif-kind.tsx`, `Toaster.tsx` | `screens/notifications-sheet.tsx`, `ui/Toaster.tsx` |
| `EmbeddedTerminal.tsx` | `screens/terminal-sheet.tsx` (`terminal.ts` kept) |
| `rebind-dialog.ts` (+ test) | Session sheet / near-limit sheet switch (`screens.test.tsx`, ranking in `vm/rules.ts`) |
| `components/ui/*` (shadcn) | `ui/*` — nothing imported them any more |

Kept although only the classic window used them before: `usage-cache.ts` (now
`vm/usage-loader.ts`), `agent-config.ts`, `release-notes.ts`, `tool-updates.ts`,
`ac-keepalive.ts`.
