/**
 * The backend seam (`act` in the design store). Each method maps to exactly one
 * existing ipc.ts call. Design actions without a backend are ABSENT from the
 * object — callers check presence and hide or disable the control with its
 * reason; nothing is faked.
 *
 * Absent today: addAccount, signIn, startSession, takeOver, handOff, compact,
 * runTool (these run in the built-in terminal — wired by the screens lane via
 * the existing *Args builders), decideLimit, setProtection,
 * toggleRule, runFix, pickFolder, exportDiagnostics, openUsagePage, setSetting,
 * petTest, movePet.
 */

import * as ipc from "../ipc.js";
import { clearDesktopNotifications, requestDesktopPermission, type DesktopPermission } from "../notifications.js";
import type { ProfileLabel, ProviderId, ProviderSurface } from "../transforms.js";
import { checkForUpdate, type UpdateCheck } from "../updates.js";
import { dropUsageSnapshot } from "../usage-cache.js";
import { forceDoctorOnNextLoad, forceToolsOnNextLoad } from "./slow-cache.js";
import { forceUsageFor, forceUsageOnNextLoad, restartUsageCountdown } from "./usage-loader.js";
import type { IdentityColor, Session, ViewModel } from "./types.js";

export interface Actions {
  setDefault?(accountId: string): Promise<void>;
  deactivate?(tool: ProviderId): Promise<void>;
  removeAccount?(accountId: string): Promise<void>;
  updateAccount?(accountId: string, patch: { name?: string; label?: ProfileLabel | null; color?: IdentityColor }): Promise<void>;
  redeemReset?(accountId: string): Promise<void>;
  refreshUsage?(): Promise<void>;
  /** One account's usage, past its cooldown. */
  refreshAccountUsage?(accountId: string): Promise<void>;
  recheckTools?(): Promise<void>;
  trashSession?(sessionId: string): Promise<{ trashId: string | null }>;
  restoreSession?(sessionId: string, handle: string): Promise<void>;
  /** Live switch of a running Claude session's account (macOS, ADR-003). */
  rebind?(sessionId: string, targetAccountId: string): Promise<void>;
  openApp?(appId: string, accountId: string): Promise<void>;
  /** Create or remove the account's Dock/Spotlight launcher for an app (macOS). */
  setLauncher?(appId: string, accountId: string, on: boolean): Promise<void>;
  /** Copy desktop settings into `toAccountId`; `from` is an account id or "default". */
  copyAppSettings?(appId: string, from: string, toAccountId: string): Promise<void>;
  openAgentConfig?(): Promise<void>;
  restartAgentConfig?(): Promise<void>;
  setSharedSetup?(enabled: boolean, source?: string): Promise<void>;
  setAutostart?(on: boolean): Promise<void>;
  setAccountDisabled?(accountId: string, disabled: boolean): Promise<void>;
  installShellIntegration?(): Promise<void>;
  setProvider?(tool: ProviderId, surface: ProviderSurface, on: boolean): Promise<void>;
  linkProviderBinary?(tool: ProviderId, path: string): Promise<void>;
  unlinkProviderBinary?(tool: ProviderId): Promise<void>;
  clearNotifications?(): Promise<void>;
  requestNotifyPermission?(): Promise<DesktopPermission>;
  checkForUpdate?(): Promise<UpdateCheck>;
  selfUpdate?(): Promise<ipc.SelfUpdateResult>;
  uninstall?(): Promise<void>;
  quit?(): Promise<void>;
  /** First turns of a session, read on demand (ADR-002). */
  previewSession?(sessionId: string): Promise<{ role: "you" | "agent"; text: string }[]>;
  /** Metadata-only handoff brief of a session for a target account; writes the
   *  brief file the seed command references by path. */
  handoffBrief?(sessionId: string, targetAccountId: string): Promise<{ brief: string; briefPath: string }>;
  /** Relink drifted shared-setup links (`share sync`) against a source. */
  shareSync?(source: string): Promise<void>;
}

/** `claude:work` → ["claude", "work"]. Names never contain ":" (PROFILE_NAME_RE). */
export function splitAccountId(id: string): [ProviderId, string] {
  const i = id.indexOf(":");
  return [id.slice(0, i) as ProviderId, id.slice(i + 1)];
}

function sessionParts(s: Session): { provider: ProviderId; sessionId: string; profile: string } {
  const [provider, profile] = splitAccountId(s.accountId);
  return { provider, sessionId: s.id.slice(s.id.indexOf(":") + 1), profile };
}

export function createActions(getVm: () => ViewModel, reload: () => Promise<void>): Actions {
  const session = (id: string) => {
    const s = getVm().sessions.find((x) => x.id === id);
    if (!s) throw new Error(`Unknown session ${id}`);
    return sessionParts(s);
  };
  const thenReload =
    <A extends unknown[]>(fn: (...a: A) => Promise<unknown>) =>
    async (...a: A) => {
      await fn(...a);
      await reload();
    };

  return {
    setDefault: thenReload((id: string) => ipc.switchProfile(...splitAccountId(id))),
    deactivate: thenReload((tool: ProviderId) => ipc.deactivateProfile(tool)),
    removeAccount: thenReload((id: string) => ipc.removeProfile(...splitAccountId(id))),
    updateAccount: thenReload(async (id: string, patch: { name?: string; label?: ProfileLabel | null; color?: IdentityColor }) => {
      const [provider, name] = splitAccountId(id);
      if (patch.label !== undefined) await ipc.setProfileLabel(provider, name, patch.label);
      if (patch.color !== undefined) await ipc.setProfileColor(provider, name, patch.color);
      if (patch.name && patch.name !== name) {
        await ipc.renameProfile(provider, name, patch.name);
        // A reused name must never show a prior account's numbers; dropping the
        // attempt stamps also lets the renamed account fetch right away.
        dropUsageSnapshot(`${provider}/${name}`);
        dropUsageSnapshot(`${provider}/${patch.name}`);
      }
    }),
    setAccountDisabled: thenReload((id: string, disabled: boolean) => ipc.setProfileDisabled(...splitAccountId(id), disabled)),
    redeemReset: thenReload((id: string) => ipc.redeemReset(...splitAccountId(id))),
    // Manual refresh: past the per-account cooldown, and the countdown restarts.
    refreshUsage: async () => {
      forceUsageOnNextLoad();
      restartUsageCountdown();
      await reload();
    },
    refreshAccountUsage: async (id: string) => {
      const [provider, profile] = splitAccountId(id);
      forceUsageFor(`${provider}/${profile}`);
      await reload();
    },
    // "Check now": a fresh tooling sweep (latest versions stay hourly).
    recheckTools: async () => {
      forceToolsOnNextLoad();
      await reload();
    },
    trashSession: async (id: string) => {
      const p = session(id);
      const res = await ipc.deleteSession(p.provider, p.sessionId, p.profile);
      await reload();
      return { trashId: res.trashId };
    },
    restoreSession: thenReload(async (id: string, handle: string) => {
      const p = session(id);
      await ipc.restoreSession(p.provider, handle, p.profile);
    }),
    rebind: thenReload(async (id: string, target: string) => {
      const p = session(id);
      await ipc.rebindTo(splitAccountId(target)[1], p.profile);
    }),
    openApp: (appId: string, id: string) => ipc.openApp(appId, splitAccountId(id)[1]),
    setLauncher: thenReload((appId: string, id: string, on: boolean) => ipc.setLauncher(appId, splitAccountId(id)[1], on)),
    copyAppSettings: thenReload((appId: string, from: string, to: string) =>
      ipc.copyAppSettings(appId, from === "default" ? "default" : splitAccountId(from)[1], splitAccountId(to)[1]),
    ),
    openAgentConfig: async () => {
      await ipc.acOpenInBrowser();
    },
    restartAgentConfig: thenReload(() => ipc.acForceRestart()),
    // These change what `doctor` checks, so the reload re-runs it.
    setSharedSetup: thenReload((enabled: boolean, source?: string) => {
      forceDoctorOnNextLoad();
      return enabled ? ipc.shareOn(source) : ipc.shareOff();
    }),
    setAutostart: thenReload((on: boolean) => {
      forceDoctorOnNextLoad();
      return ipc.setAutostart(on);
    }),
    installShellIntegration: thenReload(async () => {
      forceDoctorOnNextLoad();
      await ipc.installShellIntegration();
    }),
    setProvider: thenReload((tool: ProviderId, surface: ProviderSurface, on: boolean) => ipc.setProvider(tool, surface, on)),
    linkProviderBinary: thenReload((tool: ProviderId, path: string) => ipc.linkProviderBinary(tool, path)),
    unlinkProviderBinary: thenReload((tool: ProviderId) => ipc.unlinkProviderBinary(tool)),
    // The log, then this app's delivered desktop notifications (classic window).
    clearNotifications: thenReload(async () => {
      await ipc.clearNotifications();
      await clearDesktopNotifications();
    }),
    requestNotifyPermission: () => requestDesktopPermission(),
    checkForUpdate: () => checkForUpdate(),
    selfUpdate: () => ipc.selfUpdate(),
    uninstall: () => ipc.uninstall(),
    quit: () => ipc.quitApp(),
    previewSession: async (id: string) => {
      const p = session(id);
      const res = await ipc.sessionPreview(p.provider, p.sessionId, p.profile);
      return res.messages.map((m) => ({ role: m.role === "user" ? ("you" as const) : ("agent" as const), text: m.text }));
    },
    handoffBrief: (id: string, target: string) => {
      const p = session(id);
      return ipc.extractHandoffBrief(p.provider, p.profile, p.sessionId, splitAccountId(target)[0]);
    },
    shareSync: thenReload((source: string) => {
      forceDoctorOnNextLoad();
      return ipc.shareSync(source);
    }),
  };
}

// ---- Accounts lane: the foundation readouts on the same `act`, plus the
// account extras. Interface merging keeps the declaration above untouched.

export interface Actions extends Partial<import("./actions-foundations.js").FoundationActions> {
  /** claude.ai in the account's own browser profile (`agent-switch web`); its
   *  Settings › Usage page shows a free reset when Claude offers one. */
  openUsagePage?(accountId: string): Promise<void>;
}

export function createAccountActions(): Pick<Actions, "openUsagePage"> {
  return { openUsagePage: (id: string) => ipc.openWeb(splitAccountId(id)[1]) };
}
